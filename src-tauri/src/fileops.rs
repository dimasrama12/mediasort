//! File moves for target-folder sorting + batch rename: rename fast-path, cross-volume
//! copy-then-delete fallback, `_N` collision suffix, two-phase batch rename.

use crate::model::FileInfo;
use crate::scan::build_file_info;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// How many `_N` variants to try before giving up. An unbounded `loop { n += 1 }` hangs the app
/// on a directory that somehow holds every candidate name, with no way for the user out of it.
const MAX_COLLISION_TRIES: u32 = 10_000;

/// Write `bytes` to `target` **atomically**: temp sibling, then rename over the target.
///
/// `std::fs::write` truncates first, so a crash or power loss mid-write leaves a truncated file.
/// For the two files that hold app state (`trash.json`, `settings.json`) that is data loss: both
/// fall back to a default on a parse error, so a half-written index silently orphans everything
/// it described. Only the rename can be interrupted, and that step is atomic.
pub fn write_atomic(target: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = target.with_extension(format!("{}.tmp", std::process::id()));
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, target).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

/// Claim a free destination name inside `target`'s directory, **creating the file to reserve it**.
///
/// `exists()`-then-write is a race: two moves landing in one folder at the same moment both see a
/// free name and the second silently overwrites the first. `create_new(true)` is the atomic
/// "create only if absent" the OS already offers, so exactly one caller can win a given name. The
/// returned path is an empty placeholder that the caller's rename/copy overwrites.
fn reserve_target(target: &Path) -> Result<PathBuf, String> {
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let stem = target
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let ext = target.extension().map(|e| e.to_string_lossy().to_string());

    for n in 0..=MAX_COLLISION_TRIES {
        let candidate = if n == 0 {
            target.to_path_buf()
        } else {
            parent.join(match &ext {
                Some(e) => format!("{stem}_{n}.{e}"),
                None => format!("{stem}_{n}"),
            })
        };
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(_) => return Ok(candidate),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("{}: {e}", candidate.display())),
        }
    }
    Err(format!(
        "could not find a free name for {stem} after {MAX_COLLISION_TRIES} tries"
    ))
}

/// Move one file into `dest_dir`, returning its new absolute path.
pub fn move_one(src: &str, dest_dir: &str) -> Result<PathBuf, String> {
    let src_path = Path::new(src);
    let file_name = src_path
        .file_name()
        .ok_or_else(|| format!("no file name in {src}"))?;
    let dest_dir_path = Path::new(dest_dir);
    std::fs::create_dir_all(dest_dir_path).map_err(|e| e.to_string())?;

    // The reservation is an empty placeholder; both branches below overwrite it (Windows'
    // rename replaces an existing file, and `copy` truncates). If the move fails outright the
    // placeholder is removed so a failed move never leaves a 0-byte ghost in the target folder.
    let target = reserve_target(&dest_dir_path.join(file_name))?;

    if std::fs::rename(src_path, &target).is_ok() {
        return Ok(target);
    }
    // Cross-volume: rename fails with EXDEV (cross-device) — copy then delete.
    let moved = std::fs::copy(src_path, &target)
        .map_err(|e| e.to_string())
        .and_then(|_| std::fs::remove_file(src_path).map_err(|e| e.to_string()));
    match moved {
        Ok(()) => Ok(target),
        Err(e) => {
            let _ = std::fs::remove_file(&target);
            Err(e)
        }
    }
}

/// Delete files outright — no app trash, no OS recycle bin (§6 `Shift+Delete`). Returns the
/// paths that are actually gone, so the UI removes exactly those rows and a locked or
/// already-missing file doesn't silently disappear from the grid while still being on disk.
/// Directories are refused: this command exists to delete media, and recursive deletion is not
/// something a keyboard shortcut should ever be able to trigger.
pub fn delete_permanently_in(paths: &[String]) -> Vec<String> {
    let mut gone = Vec::with_capacity(paths.len());
    for p in paths {
        let path = Path::new(p);
        match std::fs::metadata(path) {
            Ok(m) if m.is_file() => {
                if std::fs::remove_file(path).is_ok() {
                    gone.push(p.clone());
                }
            }
            // Already missing counts as deleted — the grid should drop the row either way.
            Err(_) => gone.push(p.clone()),
            _ => {}
        }
    }
    gone
}

#[tauri::command]
pub async fn delete_files_permanently(
    scope: tauri::State<'_, crate::guard::AccessScope>,
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    scope.check_all(&paths)?;
    tauri::async_runtime::spawn_blocking(move || delete_permanently_in(&paths))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn move_files(
    scope: tauri::State<'_, crate::guard::AccessScope>,
    paths: Vec<String>,
    dest: String,
) -> Result<Vec<String>, String> {
    // Both ends: a move is a delete from one place and a create in another.
    scope.check_all(&paths)?;
    scope.check(&dest)?;
    let mut out = Vec::with_capacity(paths.len());
    for p in &paths {
        out.push(move_one(p, &dest)?.to_string_lossy().to_string());
    }
    Ok(out)
}

/// One planned rename: absolute source → absolute destination. Serializable so the frontend can
/// hand `rename_files` explicit `{from, to}` pairs for undo/redo.
#[derive(Debug, PartialEq, Clone, Serialize, Deserialize)]
pub struct RenamePlan {
    pub from: String,
    pub to: String,
}

/// Compute destination paths for a batch rename (pure, no IO). Each file keeps its directory
/// and extension; its base name = `pattern` with `{n}` replaced by the zero-padded sequence
/// number (`start + index`), or the number appended when the pattern has no `{n}`.
pub fn plan_batch_rename(paths: &[String], pattern: &str, start: u32, pad: usize) -> Vec<RenamePlan> {
    paths
        .iter()
        .enumerate()
        .map(|(i, from)| {
            let p = Path::new(from);
            let parent = p.parent().unwrap_or_else(|| Path::new(""));
            let ext = p.extension().map(|e| e.to_string_lossy().to_string());
            let num = start as u64 + i as u64;
            let num_str = if pad > 0 {
                format!("{num:0width$}", width = pad)
            } else {
                num.to_string()
            };
            let base = if pattern.contains("{n}") {
                pattern.replace("{n}", &num_str)
            } else {
                format!("{pattern} {num_str}")
            };
            let file_name = match &ext {
                Some(e) => format!("{base}.{e}"),
                None => base,
            };
            RenamePlan {
                from: from.clone(),
                to: parent.join(file_name).to_string_lossy().to_string(),
            }
        })
        .collect()
}

/// Execute a batch rename on disk. Two-phase: every source is first moved to a unique temp name
/// (freeing all final names, so intra-batch reshuffles can't clash), then each temp is moved to
/// its final target, `_N`-suffixed only on collision with a pre-existing external file. Returns
/// the new absolute paths in input order.
pub fn apply_batch_rename(
    paths: &[String],
    pattern: &str,
    start: u32,
    pad: usize,
) -> Result<Vec<String>, String> {
    apply_renames(&plan_batch_rename(paths, pattern, start, pad))
}

/// Execute explicit source→target renames on disk. Two-phase: every source is first moved to a
/// unique temp name (freeing all final names, so an intra-batch reshuffle — including a straight
/// swap a↔b — can't clash), then each temp is moved to its final target, `_N`-suffixed only on
/// collision with a pre-existing *external* file. Returns the new absolute paths in input order.
/// Shared core behind both batch rename and its undo/redo (`rename_files`).
pub fn apply_renames(plans: &[RenamePlan]) -> Result<Vec<String>, String> {
    // Phase 1: sources -> unique temps.
    let mut temps: Vec<PathBuf> = Vec::with_capacity(plans.len());
    for (i, plan) in plans.iter().enumerate() {
        let from = Path::new(&plan.from);
        let parent = from.parent().unwrap_or_else(|| Path::new("."));
        let temp = parent.join(format!(".mediasort_rename_tmp_{i}"));
        std::fs::rename(from, &temp).map_err(|e| format!("rename {}: {e}", plan.from))?;
        temps.push(temp);
    }

    // Phase 2: temps -> final targets.
    let mut out = Vec::with_capacity(plans.len());
    for (temp, plan) in temps.iter().zip(plans.iter()) {
        let target = reserve_target(Path::new(&plan.to))?;
        std::fs::rename(temp, &target).map_err(|e| format!("rename -> {}: {e}", plan.to))?;
        out.push(target.to_string_lossy().to_string());
    }
    Ok(out)
}

/// Rename `paths` to `pattern`+`{n}` and return the rebuilt `FileInfo` for each renamed file
/// (backend stays the source of truth for the normalized id). Group membership is dropped.
#[tauri::command]
pub async fn batch_rename(
    scope: tauri::State<'_, crate::guard::AccessScope>,
    paths: Vec<String>,
    pattern: String,
    start: u32,
    pad: u32,
) -> Result<Vec<FileInfo>, String> {
    scope.check_all(&paths)?;
    let new_paths = apply_batch_rename(&paths, &pattern, start, pad as usize)?;
    let mut out = Vec::with_capacity(new_paths.len());
    for p in &new_paths {
        out.push(
            build_file_info(Path::new(p)).ok_or_else(|| format!("stat after rename failed: {p}"))?,
        );
    }
    Ok(out)
}

/// Rename files to explicit target paths and return the rebuilt `FileInfo` per file. The undo/redo
/// primitive for batch rename: undo renames each file back to its exact original name (the `{n}`
/// pattern API can't express arbitrary per-file names), redo re-applies the new names.
#[tauri::command]
pub async fn rename_files(
    scope: tauri::State<'_, crate::guard::AccessScope>,
    renames: Vec<RenamePlan>,
) -> Result<Vec<FileInfo>, String> {
    // Both ends again: `from` is what gets unlinked, `to` is what gets created.
    scope.check_all(renames.iter().map(|r| &r.from))?;
    scope.check_all(renames.iter().map(|r| &r.to))?;
    let new_paths = apply_renames(&renames)?;
    let mut out = Vec::with_capacity(new_paths.len());
    for p in &new_paths {
        out.push(
            build_file_info(Path::new(p)).ok_or_else(|| format!("stat after rename failed: {p}"))?,
        );
    }
    Ok(out)
}

#[cfg(test)]
mod delete_tests {
    use super::*;

    #[test]
    fn removes_files_and_reports_exactly_what_went() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.jpg");
        let b = dir.path().join("b.jpg");
        std::fs::write(&a, b"x").unwrap();
        std::fs::write(&b, b"y").unwrap();
        let missing = dir.path().join("gone.jpg").to_string_lossy().to_string();

        let gone = delete_permanently_in(&[
            a.to_string_lossy().to_string(),
            missing.clone(),
            b.to_string_lossy().to_string(),
        ]);

        assert_eq!(gone.len(), 3); // a, the already-missing one, and b
        assert!(!a.exists() && !b.exists());
    }

    #[test]
    fn refuses_directories() {
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("keep");
        std::fs::create_dir(&sub).unwrap();
        std::fs::write(sub.join("inside.jpg"), b"x").unwrap();

        let gone = delete_permanently_in(&[sub.to_string_lossy().to_string()]);

        assert!(gone.is_empty(), "a directory is never deleted");
        assert!(sub.join("inside.jpg").exists());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn moves_file_into_dest_and_returns_new_path() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("a.jpg");
        fs::write(&src, b"x").unwrap();
        let dest = dir.path().join("Keep");
        let new = move_one(src.to_str().unwrap(), dest.to_str().unwrap()).unwrap();
        assert_eq!(new, dest.join("a.jpg"));
        assert!(new.exists());
        assert!(!src.exists()); // source gone
    }

    #[test]
    fn collision_gets_suffixed() {
        let dir = tempdir().unwrap();
        let dest = dir.path().join("Keep");
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join("a.jpg"), b"old").unwrap(); // occupy the slot
        let src = dir.path().join("a.jpg");
        fs::write(&src, b"new").unwrap();
        let new = move_one(src.to_str().unwrap(), dest.to_str().unwrap()).unwrap();
        assert_eq!(new, dest.join("a_1.jpg"));
        assert!(new.exists());
    }

    // Compare on the computed file names (separator-agnostic across platforms).
    fn plan_names(paths: &[String], pattern: &str, start: u32, pad: usize) -> Vec<String> {
        plan_batch_rename(paths, pattern, start, pad)
            .iter()
            .map(|p| {
                Path::new(&p.to)
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string()
            })
            .collect()
    }

    #[test]
    fn plan_substitutes_pattern_pads_and_keeps_extension() {
        let paths = vec!["/x/a.jpg".to_string(), "/x/b.png".to_string()];
        assert_eq!(plan_names(&paths, "Trip {n}", 1, 3), vec!["Trip 001.jpg", "Trip 002.png"]);
        // directory is preserved
        assert_eq!(
            Path::new(&plan_batch_rename(&paths, "Trip {n}", 1, 3)[0].to).parent(),
            Path::new("/x/a.jpg").parent()
        );
    }

    #[test]
    fn plan_appends_number_when_pattern_lacks_placeholder_and_pad_zero() {
        let paths = vec!["/x/a.jpg".to_string()];
        assert_eq!(plan_names(&paths, "Vacation", 5, 0), vec!["Vacation 5.jpg"]);
    }

    #[test]
    fn plan_handles_extensionless_files() {
        let paths = vec!["/x/README".to_string()];
        assert_eq!(plan_names(&paths, "doc-{n}", 1, 2), vec!["doc-01"]);
    }

    #[test]
    fn apply_renames_in_order_and_removes_originals() {
        let dir = tempdir().unwrap();
        for n in ["a.jpg", "b.jpg", "c.jpg"] {
            fs::write(dir.path().join(n), b"x").unwrap();
        }
        let paths: Vec<String> = ["a.jpg", "b.jpg", "c.jpg"]
            .iter()
            .map(|n| dir.path().join(n).to_string_lossy().to_string())
            .collect();
        let out = apply_batch_rename(&paths, "Photo {n}", 1, 2).unwrap();
        assert_eq!(out.len(), 3);
        assert!(dir.path().join("Photo 01.jpg").exists());
        assert!(dir.path().join("Photo 02.jpg").exists());
        assert!(dir.path().join("Photo 03.jpg").exists());
        assert!(!dir.path().join("a.jpg").exists());
    }

    #[test]
    fn apply_shift_by_one_does_not_suffix_thanks_to_two_phase() {
        // 1,2,3 -> 2,3,4: each target briefly collides with a not-yet-renamed source.
        let dir = tempdir().unwrap();
        for n in ["1.jpg", "2.jpg", "3.jpg"] {
            fs::write(dir.path().join(n), b"x").unwrap();
        }
        let paths: Vec<String> = ["1.jpg", "2.jpg", "3.jpg"]
            .iter()
            .map(|n| dir.path().join(n).to_string_lossy().to_string())
            .collect();
        let out = apply_batch_rename(&paths, "{n}", 2, 0).unwrap();
        assert_eq!(out[0], dir.path().join("2.jpg").to_string_lossy());
        assert!(dir.path().join("2.jpg").exists());
        assert!(dir.path().join("4.jpg").exists());
        assert!(!dir.path().join("2_1.jpg").exists()); // no spurious suffix
    }

    #[test]
    fn apply_suffixes_on_external_collision() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.jpg"), b"x").unwrap();
        fs::write(dir.path().join("Photo 01.jpg"), b"occupied").unwrap(); // not in batch
        let paths = vec![dir.path().join("a.jpg").to_string_lossy().to_string()];
        let out = apply_batch_rename(&paths, "Photo {n}", 1, 2).unwrap();
        assert_eq!(out[0], dir.path().join("Photo 01_1.jpg").to_string_lossy());
        assert!(dir.path().join("Photo 01_1.jpg").exists());
    }

    #[test]
    fn apply_renames_hits_exact_targets_and_supports_undo_roundtrip() {
        // The rename_files primitive must land on *exact* names (no pattern), both forward and back —
        // that's what makes batch-rename undoable.
        let dir = tempdir().unwrap();
        let orig = dir.path().join("IMG_1234.jpg");
        fs::write(&orig, b"x").unwrap();
        let o = orig.to_string_lossy().to_string();
        let r = dir.path().join("Trip 01.jpg").to_string_lossy().to_string();

        let fwd = apply_renames(&[RenamePlan { from: o.clone(), to: r.clone() }]).unwrap();
        assert_eq!(fwd, vec![r.clone()]);
        assert!(Path::new(&r).exists() && !orig.exists());

        let back = apply_renames(&[RenamePlan { from: r.clone(), to: o.clone() }]).unwrap();
        assert_eq!(back, vec![o.clone()]); // exact original name, no _N suffix
        assert!(orig.exists() && !Path::new(&r).exists());
    }

    #[test]
    fn apply_renames_swaps_two_files_via_two_phase() {
        // a↔b in one batch: each target briefly collides with a not-yet-moved source. The temp
        // phase must let this succeed without spurious `_N` suffixes.
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.jpg"), b"A").unwrap();
        fs::write(dir.path().join("b.jpg"), b"B").unwrap();
        let a = dir.path().join("a.jpg").to_string_lossy().to_string();
        let b = dir.path().join("b.jpg").to_string_lossy().to_string();
        let out = apply_renames(&[
            RenamePlan { from: a.clone(), to: b.clone() },
            RenamePlan { from: b.clone(), to: a.clone() },
        ])
        .unwrap();
        assert_eq!(out, vec![b.clone(), a.clone()]);
        assert_eq!(fs::read_to_string(&a).unwrap(), "B"); // contents swapped
        assert_eq!(fs::read_to_string(&b).unwrap(), "A");
    }
}
