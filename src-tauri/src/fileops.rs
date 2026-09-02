//! File moves for target-folder sorting + batch rename: rename fast-path, cross-volume
//! copy-then-delete fallback, `_N` collision suffix, two-phase batch rename.

use std::path::{Path, PathBuf};

/// Return `target` if free, else the first `stem_N.ext` variant that doesn't exist.
fn resolve_collision(target: &Path) -> PathBuf {
    if !target.exists() {
        return target.to_path_buf();
    }
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let stem = target
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let ext = target.extension().map(|e| e.to_string_lossy().to_string());
    let mut n = 1;
    loop {
        let candidate = parent.join(match &ext {
            Some(e) => format!("{stem}_{n}.{e}"),
            None => format!("{stem}_{n}"),
        });
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
    }
}

/// Move one file into `dest_dir`, returning its new absolute path.
pub fn move_one(src: &str, dest_dir: &str) -> Result<PathBuf, String> {
    let src_path = Path::new(src);
    let file_name = src_path
        .file_name()
        .ok_or_else(|| format!("no file name in {src}"))?;
    let dest_dir_path = Path::new(dest_dir);
    std::fs::create_dir_all(dest_dir_path).map_err(|e| e.to_string())?;

    let target = resolve_collision(&dest_dir_path.join(file_name));

    match std::fs::rename(src_path, &target) {
        Ok(()) => Ok(target),
        Err(_) => {
            // Cross-volume: rename fails with EXDEV — copy then delete.
            std::fs::copy(src_path, &target).map_err(|e| e.to_string())?;
            std::fs::remove_file(src_path).map_err(|e| e.to_string())?;
            Ok(target)
        }
    }
}

#[tauri::command]
pub async fn move_files(paths: Vec<String>, dest: String) -> Result<Vec<String>, String> {
    let mut out = Vec::with_capacity(paths.len());
    for p in &paths {
        out.push(move_one(p, &dest)?.to_string_lossy().to_string());
    }
    Ok(out)
}

/// One planned rename: absolute source → absolute destination (same directory).
#[derive(Debug, PartialEq)]
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
    let plans = plan_batch_rename(paths, pattern, start, pad);

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
        let target = resolve_collision(Path::new(&plan.to));
        std::fs::rename(temp, &target).map_err(|e| format!("rename -> {}: {e}", plan.to))?;
        out.push(target.to_string_lossy().to_string());
    }
    Ok(out)
}

#[tauri::command]
pub async fn batch_rename(
    paths: Vec<String>,
    pattern: String,
    start: u32,
    pad: u32,
) -> Result<Vec<String>, String> {
    apply_batch_rename(&paths, &pattern, start, pad as usize)
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
}
