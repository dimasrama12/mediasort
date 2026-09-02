//! Target folders (1–9 shortcuts) — create, dedup by normalized path, list.

use crate::model::FolderInfo;
use crate::paths::normalize_path;
use std::path::Path;
use std::sync::Mutex;
use tauri::State;

/// Session-only registry of target folders + their 1–9 shortcuts.
#[derive(Default)]
pub struct FolderState(pub Mutex<Vec<FolderInfo>>);

/// Register a target folder under `base`, deduping by normalized path.
/// Returns the existing entry unchanged if already registered; otherwise
/// creates the directory, assigns the lowest free 1..=9 shortcut, and appends.
pub fn upsert_target(
    list: &mut Vec<FolderInfo>,
    base: &str,
    name: &str,
) -> Result<FolderInfo, String> {
    if name.trim().is_empty() {
        return Err("folder name cannot be empty".to_string());
    }
    let path = Path::new(base).join(name);
    let path_str = path.to_string_lossy().to_string();
    let id = normalize_path(&path_str);
    if let Some(existing) = list.iter().find(|f| f.id == id) {
        return Ok(existing.clone()); // dedup — v1 bug #1 guard
    }
    let shortcut = (1u8..=9)
        .find(|n| !list.iter().any(|f| f.shortcut == *n))
        .ok_or_else(|| "all 9 target slots are in use".to_string())?;
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    let folder = FolderInfo {
        id,
        name: name.to_string(),
        path: path_str,
        shortcut,
        file_count: 0,
    };
    list.push(folder.clone());
    Ok(folder)
}

#[tauri::command]
pub async fn create_folder(
    state: State<'_, FolderState>,
    base: String,
    name: String,
) -> Result<FolderInfo, String> {
    let mut list = state.0.lock().map_err(|e| e.to_string())?;
    upsert_target(&mut list, &base, &name)
}

#[tauri::command]
pub async fn list_target_folders(
    state: State<'_, FolderState>,
) -> Result<Vec<FolderInfo>, String> {
    let list = state.0.lock().map_err(|e| e.to_string())?;
    Ok(list.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn base_str(d: &tempfile::TempDir) -> String {
        d.path().to_string_lossy().to_string()
    }

    #[test]
    fn create_assigns_first_shortcut_and_makes_dir() {
        let base = tempdir().unwrap();
        let mut list = Vec::new();
        let f = upsert_target(&mut list, &base_str(&base), "Family").unwrap();
        assert_eq!(f.shortcut, 1);
        assert_eq!(f.file_count, 0);
        assert!(base.path().join("Family").is_dir());
        assert_eq!(list.len(), 1);
    }

    #[test]
    fn duplicate_path_dedups_to_same_entry() {
        let base = tempdir().unwrap();
        let mut list = Vec::new();
        let a = upsert_target(&mut list, &base_str(&base), "Keep").unwrap();
        let b = upsert_target(&mut list, &base_str(&base), "Keep").unwrap();
        assert_eq!(a.id, b.id);
        assert_eq!(a.shortcut, b.shortcut);
        assert_eq!(list.len(), 1); // no duplicate — bug #1
    }

    #[test]
    fn distinct_folders_get_sequential_shortcuts() {
        let base = tempdir().unwrap();
        let mut list = Vec::new();
        assert_eq!(upsert_target(&mut list, &base_str(&base), "a").unwrap().shortcut, 1);
        assert_eq!(upsert_target(&mut list, &base_str(&base), "b").unwrap().shortcut, 2);
        assert_eq!(upsert_target(&mut list, &base_str(&base), "c").unwrap().shortcut, 3);
    }

    #[test]
    fn tenth_folder_errors() {
        let base = tempdir().unwrap();
        let mut list = Vec::new();
        for i in 1..=9 {
            upsert_target(&mut list, &base_str(&base), &format!("f{i}")).unwrap();
        }
        assert!(upsert_target(&mut list, &base_str(&base), "overflow").is_err());
    }

    #[test]
    fn empty_name_errors() {
        let mut list = Vec::new();
        assert!(upsert_target(&mut list, "C:/base", "   ").is_err());
    }
}
