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

/// Rename a target folder (by id) to `new_name`, moving the directory on disk.
/// Keeps the shortcut; updates id/name/path. Errors on empty name or a collision
/// with another target.
pub fn rename_in(list: &mut Vec<FolderInfo>, id: &str, new_name: &str) -> Result<(), String> {
    if new_name.trim().is_empty() {
        return Err("folder name cannot be empty".to_string());
    }
    let pos = list
        .iter()
        .position(|f| f.id == id)
        .ok_or_else(|| "no such folder".to_string())?;
    let old_path = Path::new(&list[pos].path).to_path_buf();
    let parent = old_path
        .parent()
        .ok_or_else(|| "folder has no parent".to_string())?;
    let new_path = parent.join(new_name);
    let new_path_str = new_path.to_string_lossy().to_string();
    let new_id = normalize_path(&new_path_str);
    if list.iter().enumerate().any(|(i, f)| i != pos && f.id == new_id) {
        return Err("a target with that name already exists".to_string());
    }
    std::fs::rename(&old_path, &new_path).map_err(|e| e.to_string())?;
    list[pos].id = new_id;
    list[pos].name = new_name.to_string();
    list[pos].path = new_path_str;
    Ok(())
}

/// Remove a target folder (by id) and renumber the remaining shortcuts to a
/// contiguous 1..=N (v1 bug #2 "ghost folders" fix). The on-disk dir is kept.
pub fn delete_in(list: &mut Vec<FolderInfo>, id: &str) {
    list.retain(|f| f.id != id);
    list.sort_by_key(|f| f.shortcut);
    for (i, f) in list.iter_mut().enumerate() {
        f.shortcut = (i + 1) as u8;
    }
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

#[tauri::command]
pub async fn rename_folder(
    state: State<'_, FolderState>,
    id: String,
    name: String,
) -> Result<Vec<FolderInfo>, String> {
    let mut list = state.0.lock().map_err(|e| e.to_string())?;
    rename_in(&mut list, &id, &name)?;
    Ok(list.clone())
}

#[tauri::command]
pub async fn delete_folder(
    state: State<'_, FolderState>,
    id: String,
) -> Result<Vec<FolderInfo>, String> {
    let mut list = state.0.lock().map_err(|e| e.to_string())?;
    delete_in(&mut list, &id);
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

    #[test]
    fn rename_moves_dir_and_updates_entry_keeping_shortcut() {
        let base = tempdir().unwrap();
        let mut list = Vec::new();
        let f = upsert_target(&mut list, &base_str(&base), "Old").unwrap();
        rename_in(&mut list, &f.id, "New").unwrap();
        assert_eq!(list[0].name, "New");
        assert_eq!(list[0].shortcut, 1);
        assert!(base.path().join("New").is_dir());
        assert!(!base.path().join("Old").exists());
        assert_ne!(list[0].id, f.id); // id follows the new path
    }

    #[test]
    fn rename_to_existing_target_errors() {
        let base = tempdir().unwrap();
        let mut list = Vec::new();
        let a = upsert_target(&mut list, &base_str(&base), "A").unwrap();
        upsert_target(&mut list, &base_str(&base), "B").unwrap();
        assert!(rename_in(&mut list, &a.id, "B").is_err());
    }

    #[test]
    fn delete_removes_and_renumbers_shortcuts() {
        let base = tempdir().unwrap();
        let mut list = Vec::new();
        let a = upsert_target(&mut list, &base_str(&base), "a").unwrap(); // 1
        let b = upsert_target(&mut list, &base_str(&base), "b").unwrap(); // 2
        upsert_target(&mut list, &base_str(&base), "c").unwrap(); // 3
        delete_in(&mut list, &b.id); // remove shortcut 2
        assert_eq!(list.len(), 2);
        let shortcuts: Vec<u8> = list.iter().map(|f| f.shortcut).collect();
        assert_eq!(shortcuts, vec![1, 2]); // renumbered contiguous
        assert!(list.iter().any(|f| f.id == a.id && f.shortcut == 1));
        let d = upsert_target(&mut list, &base_str(&base), "d").unwrap();
        assert_eq!(d.shortcut, 3); // next create fills the freed top
    }
}
