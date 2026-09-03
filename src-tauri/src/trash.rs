//! App-managed trash (files-only): move-to-trash, restore, list, empty, stats.
//! Ported from v1 `source/trash.go`. Pure `*_in` helpers take an explicit
//! `trash_dir` so tests touch only a tempdir; commands resolve the real dir.

use crate::model::{TrashItem, TrashStats};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

pub fn metadata_path(trash_dir: &Path) -> PathBuf {
    trash_dir.join("trash.json")
}

pub fn load_metadata(trash_dir: &Path) -> BTreeMap<String, TrashItem> {
    match std::fs::read_to_string(metadata_path(trash_dir)) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => BTreeMap::new(),
    }
}

pub fn save_metadata(
    trash_dir: &Path,
    map: &BTreeMap<String, TrashItem>,
) -> Result<(), String> {
    let s = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    std::fs::write(metadata_path(trash_dir), s).map_err(|e| e.to_string())
}

fn now_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Move each existing file into `trash_dir/<id>` (rename fast-path, cross-volume
/// copy+delete fallback). Missing/failing files are skipped, not errored.
/// Merges the new items into `trash.json`.
pub fn trash_files_in(trash_dir: &Path, paths: &[String]) -> Result<Vec<TrashItem>, String> {
    std::fs::create_dir_all(trash_dir).map_err(|e| e.to_string())?;
    let mut created = Vec::new();
    for p in paths {
        let src = Path::new(p);
        let meta = match std::fs::metadata(src) {
            Ok(m) if m.is_file() => m,
            _ => continue,
        };
        let base = src
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let id = format!("trash_{}_{}", now_nanos(), base);
        let dest = trash_dir.join(&id);
        if std::fs::rename(src, &dest).is_err() {
            if std::fs::copy(src, &dest).is_err() {
                continue;
            }
            if std::fs::remove_file(src).is_err() {
                let _ = std::fs::remove_file(&dest);
                continue;
            }
        }
        created.push(TrashItem {
            id,
            original_path: p.clone(),
            trash_path: dest.to_string_lossy().to_string(),
            name: base,
            size: meta.len(),
            deleted_at: now_millis(),
        });
    }
    if !created.is_empty() {
        let mut map = load_metadata(trash_dir);
        for it in &created {
            map.insert(it.id.clone(), it.clone());
        }
        save_metadata(trash_dir, &map)?;
    }
    Ok(created)
}

/// All trash entries, newest-first. Skips `trash.json`; synthesizes an item
/// (empty original_path) for any on-disk entry missing from metadata.
pub fn list_trash_in(trash_dir: &Path) -> Result<Vec<TrashItem>, String> {
    let map = load_metadata(trash_dir);
    let mut out = Vec::new();
    let rd = match std::fs::read_dir(trash_dir) {
        Ok(rd) => rd,
        Err(_) => return Ok(out), // no dir yet ⇒ empty
    };
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name == "trash.json" {
            continue;
        }
        if let Some(it) = map.get(&name) {
            out.push(it.clone());
        } else if let Ok(m) = entry.metadata() {
            out.push(TrashItem {
                id: name.clone(),
                original_path: String::new(),
                trash_path: entry.path().to_string_lossy().to_string(),
                name,
                size: m.len(),
                deleted_at: 0,
            });
        }
    }
    out.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
    Ok(out)
}

pub fn stats_in(trash_dir: &Path) -> Result<TrashStats, String> {
    let items = list_trash_in(trash_dir)?;
    let total_size = items.iter().map(|i| i.size).sum();
    Ok(TrashStats {
        count: items.len() as u32,
        total_size,
    })
}

/// Restore `trash_dir/id` to `dest_path`, suffixing `_restored_N` on collision.
pub fn restore_in(trash_dir: &Path, id: &str, dest_path: &str) -> Result<String, String> {
    let entry = trash_dir.join(id);
    if !entry.exists() {
        return Err("item not found in trash".to_string());
    }
    let mut target = PathBuf::from(dest_path);
    if target.exists() {
        let dir = target.parent().map(|p| p.to_path_buf()).unwrap_or_default();
        let stem = target
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let ext = target.extension().map(|e| e.to_string_lossy().to_string());
        let mut n = 1;
        loop {
            let cand = dir.join(match &ext {
                Some(e) => format!("{stem}_restored_{n}.{e}"),
                None => format!("{stem}_restored_{n}"),
            });
            if !cand.exists() {
                target = cand;
                break;
            }
            n += 1;
        }
    }
    if std::fs::rename(&entry, &target).is_err() {
        std::fs::copy(&entry, &target).map_err(|e| e.to_string())?;
        std::fs::remove_file(&entry).map_err(|e| e.to_string())?;
    }
    let mut map = load_metadata(trash_dir);
    map.remove(id);
    save_metadata(trash_dir, &map)?;
    Ok(target.to_string_lossy().to_string())
}

/// Hard-remove every trash entry (except trash.json) and reset the metadata.
/// The recycle-bin hop lives in the `empty_trash` command, not here.
pub fn empty_in(trash_dir: &Path) -> Result<(), String> {
    if let Ok(rd) = std::fs::read_dir(trash_dir) {
        for entry in rd.flatten() {
            if entry.file_name() == std::ffi::OsStr::new("trash.json") {
                continue;
            }
            let p = entry.path();
            let _ = if p.is_dir() {
                std::fs::remove_dir_all(&p)
            } else {
                std::fs::remove_file(&p)
            };
        }
    }
    save_metadata(trash_dir, &BTreeMap::new())
}

pub struct TrashState(pub Mutex<PathBuf>);
impl TrashState {
    pub fn new(dir: PathBuf) -> Self {
        Self(Mutex::new(dir))
    }
}

fn dir_of(state: &State<'_, TrashState>) -> Result<PathBuf, String> {
    Ok(state.0.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
pub async fn trash_files(
    state: State<'_, TrashState>,
    paths: Vec<String>,
) -> Result<Vec<TrashItem>, String> {
    trash_files_in(&dir_of(&state)?, &paths)
}

#[tauri::command]
pub async fn list_trash(state: State<'_, TrashState>) -> Result<Vec<TrashItem>, String> {
    list_trash_in(&dir_of(&state)?)
}

#[tauri::command]
pub async fn restore_from_trash(
    state: State<'_, TrashState>,
    id: String,
    dest: String,
) -> Result<String, String> {
    // Returns the actual restored path (collision-suffixed if `dest` was occupied) so an
    // undo-trash can re-home the file entry exactly where it landed.
    restore_in(&dir_of(&state)?, &id, &dest)
}

#[tauri::command]
pub async fn trash_stats(state: State<'_, TrashState>) -> Result<TrashStats, String> {
    stats_in(&dir_of(&state)?)
}

#[tauri::command]
pub async fn empty_trash(state: State<'_, TrashState>) -> Result<(), String> {
    let dir = dir_of(&state)?;
    // Best-effort: send each entry to the OS Recycle Bin before clearing.
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for entry in rd.flatten() {
            if entry.file_name() == std::ffi::OsStr::new("trash.json") {
                continue;
            }
            let _ = trash::delete(entry.path());
        }
    }
    empty_in(&dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn trash_files_moves_file_and_writes_metadata() {
        let root = tempdir().unwrap();
        let trash_dir = root.path().join("trash");
        fs::create_dir_all(&trash_dir).unwrap();
        let src = root.path().join("a.jpg");
        fs::write(&src, b"hello").unwrap();

        let items = trash_files_in(&trash_dir, &[src.to_string_lossy().to_string()]).unwrap();
        assert_eq!(items.len(), 1);
        assert!(!src.exists(), "source removed");
        assert!(Path::new(&items[0].trash_path).exists(), "entry in trash");
        assert_eq!(items[0].size, 5);
        let meta = load_metadata(&trash_dir);
        assert!(meta.contains_key(&items[0].id));
    }

    #[test]
    fn trash_files_skips_missing_paths() {
        let root = tempdir().unwrap();
        let trash_dir = root.path().join("trash");
        fs::create_dir_all(&trash_dir).unwrap();
        let items = trash_files_in(&trash_dir, &["Z:/nope/x.jpg".to_string()]).unwrap();
        assert!(items.is_empty());
    }

    #[test]
    fn list_and_stats_reflect_trashed_files() {
        let root = tempdir().unwrap();
        let trash_dir = root.path().join("trash");
        fs::create_dir_all(&trash_dir).unwrap();
        for (n, body) in [("a.jpg", &b"12"[..]), ("b.jpg", &b"345"[..])] {
            let src = root.path().join(n);
            fs::write(&src, body).unwrap();
            trash_files_in(&trash_dir, &[src.to_string_lossy().to_string()]).unwrap();
        }
        let list = list_trash_in(&trash_dir).unwrap();
        assert_eq!(list.len(), 2);
        assert!(list[0].deleted_at >= list[1].deleted_at); // newest-first
        let stats = stats_in(&trash_dir).unwrap();
        assert_eq!(stats.count, 2);
        assert_eq!(stats.total_size, 5);
    }

    #[test]
    fn restore_moves_back_and_suffixes_on_collision() {
        let root = tempdir().unwrap();
        let trash_dir = root.path().join("trash");
        fs::create_dir_all(&trash_dir).unwrap();
        let src = root.path().join("a.jpg");
        fs::write(&src, b"data").unwrap();
        let dest = src.to_string_lossy().to_string();
        let items = trash_files_in(&trash_dir, &[dest.clone()]).unwrap();
        let id = items[0].id.clone();

        // original slot free ⇒ restores to the exact path
        let back = restore_in(&trash_dir, &id, &dest).unwrap();
        assert_eq!(back, dest);
        assert!(src.exists());
        assert!(!load_metadata(&trash_dir).contains_key(&id));

        // now the slot is occupied ⇒ suffix _restored_1
        let b = root.path().join("b.jpg");
        fs::write(&b, b"x").unwrap();
        let items2 = trash_files_in(&trash_dir, &[b.to_string_lossy().to_string()]).unwrap();
        let back2 = restore_in(&trash_dir, &items2[0].id, &dest).unwrap();
        assert!(back2.ends_with("a_restored_1.jpg"), "got {back2}");
    }

    #[test]
    fn restore_unknown_id_errors() {
        let root = tempdir().unwrap();
        let trash_dir = root.path().join("trash");
        fs::create_dir_all(&trash_dir).unwrap();
        assert!(restore_in(
            &trash_dir,
            "nope",
            &root.path().join("x.jpg").to_string_lossy()
        )
        .is_err());
    }

    #[test]
    fn empty_clears_entries_and_metadata() {
        let root = tempdir().unwrap();
        let trash_dir = root.path().join("trash");
        fs::create_dir_all(&trash_dir).unwrap();
        let src = root.path().join("a.jpg");
        fs::write(&src, b"data").unwrap();
        trash_files_in(&trash_dir, &[src.to_string_lossy().to_string()]).unwrap();
        assert_eq!(list_trash_in(&trash_dir).unwrap().len(), 1);

        empty_in(&trash_dir).unwrap();
        assert!(list_trash_in(&trash_dir).unwrap().is_empty());
        assert!(load_metadata(&trash_dir).is_empty());
        assert!(metadata_path(&trash_dir).exists()); // reset to {}
    }
}
