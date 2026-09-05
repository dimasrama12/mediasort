//! Target folders (1–9 shortcuts) — create, dedup by normalized path, list.

use crate::model::{FileType, FolderInfo};
use crate::paths::normalize_path;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

/// Media files sitting **directly** inside `path` - the number the sidebar shows next to a target
/// folder.
///
/// This is read from disk on every listing rather than tracked as a counter, and that is the whole
/// point: the count used to start at 0 for every folder (including folders registered with
/// "Add existing folders...", which could already hold hundreds of files) and was only ever nudged
/// up and down by the frontend as it moved things. Anything that happened outside the app - or any
/// `Ctrl+R`, which re-listed the folders from a backend that had never counted anything - reset the
/// display to 0. A `read_dir` of one folder is microseconds; a number that lies is forever.
pub fn count_media_in(path: &str) -> u32 {
    let rd = match std::fs::read_dir(path) {
        Ok(rd) => rd,
        Err(_) => return 0, // folder deleted or unreadable: 0 is the honest answer
    };
    let mut n = 0u32;
    for entry in rd.flatten() {
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let is_media = entry
            .path()
            .extension()
            .and_then(|e| e.to_str())
            .and_then(FileType::from_extension)
            .is_some();
        if is_media {
            n += 1;
        }
    }
    n
}

/// Refresh every entry's `file_count` from disk. Called on every command that hands the list back
/// to the UI, so what the sidebar shows is always what the folder actually holds.
pub fn with_live_counts(list: &[FolderInfo]) -> Vec<FolderInfo> {
    list.iter()
        .map(|f| FolderInfo {
            file_count: count_media_in(&f.path),
            ..f.clone()
        })
        .collect()
}

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
    let file_count = count_media_in(&path_str);
    let folder = FolderInfo {
        id,
        name: name.to_string(),
        path: path_str,
        shortcut,
        file_count,
    };
    list.push(folder.clone());
    Ok(folder)
}

/// Register an *existing* folder (picked via the OS file explorer) as a target, deduping by
/// normalized path. Unlike `upsert_target` this takes a full absolute path and does not create
/// anything — it errors if the path isn't an existing directory. Assigns the lowest free 1..=9
/// shortcut; returns the existing entry unchanged if already registered.
pub fn add_existing_in(list: &mut Vec<FolderInfo>, path: &str) -> Result<FolderInfo, String> {
    let p = Path::new(path);
    if !p.is_dir() {
        return Err(format!("not a folder: {path}"));
    }
    let path_str = p.to_string_lossy().to_string();
    let id = normalize_path(&path_str);
    if let Some(existing) = list.iter().find(|f| f.id == id) {
        return Ok(existing.clone()); // dedup — same guard as upsert_target
    }
    let shortcut = (1u8..=9)
        .find(|n| !list.iter().any(|f| f.shortcut == *n))
        .ok_or_else(|| "all 9 target slots are in use".to_string())?;
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path_str.clone());
    // An existing folder can already be full; starting it at 0 was the other half of the
    // wrong-counter bug.
    let file_count = count_media_in(&path_str);
    let folder = FolderInfo {
        id,
        name,
        path: path_str,
        shortcut,
        file_count,
    };
    list.push(folder.clone());
    Ok(folder)
}

/// Re-register a saved session's target folders, in the order given, and report which ones took.
///
/// Pure half of `adopt_session`. Folders that no longer exist on disk are skipped rather than
/// failing the batch — a saved project is a snapshot, and the user may well have deleted one of
/// its folders since. The survivors take the free 1..=9 slots in order, which for an untouched
/// project reproduces exactly the shortcuts it was saved with.
pub fn adopt_in(list: &mut Vec<FolderInfo>, folder_paths: &[String]) -> Vec<String> {
    let mut granted = Vec::new();
    for p in folder_paths {
        if add_existing_in(list, p).is_ok() {
            granted.push(p.clone());
        }
    }
    granted
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
    list[pos].file_count = count_media_in(&new_path_str);
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
    scope: State<'_, crate::guard::AccessScope>,
    base: String,
    name: String,
) -> Result<FolderInfo, String> {
    let mut list = state.0.lock().map_err(|e| e.to_string())?;
    let folder = upsert_target(&mut list, &base, &name)?;
    scope.allow(&folder.path); // a registered target is a place this session may write
    Ok(folder)
}

/// Register several picked folders at once (§2 multi-select). Adds as many as there are free
/// 1..=9 slots and returns the whole list; folders that don't fit (or aren't directories) are
/// skipped rather than failing the batch, so picking ten folders still registers nine.
#[tauri::command]
pub async fn add_existing_folders(
    state: State<'_, FolderState>,
    scope: State<'_, crate::guard::AccessScope>,
    paths: Vec<String>,
) -> Result<Vec<FolderInfo>, String> {
    let mut list = state.0.lock().map_err(|e| e.to_string())?;
    for p in &paths {
        if add_existing_in(&mut list, p).is_ok() {
            scope.allow(p);
        }
    }
    Ok(with_live_counts(&list))
}

#[tauri::command]
pub async fn add_existing_folder(
    state: State<'_, FolderState>,
    scope: State<'_, crate::guard::AccessScope>,
    path: String,
) -> Result<FolderInfo, String> {
    let mut list = state.0.lock().map_err(|e| e.to_string())?;
    let folder = add_existing_in(&mut list, &path)?;
    scope.allow(&folder.path);
    Ok(folder)
}

#[tauri::command]
pub async fn list_target_folders(
    state: State<'_, FolderState>,
) -> Result<Vec<FolderInfo>, String> {
    let list = state.0.lock().map_err(|e| e.to_string())?;
    Ok(with_live_counts(&list))
}

/// Forget every registered target folder (the directories themselves are left alone).
///
/// Scanning a new root starts a new sorting session: the target folders from the last one belong
/// to a different library and their 1-9 shortcuts would silently file photos into the wrong place.
/// The frontend clears its own list on `startScan`; without this the backend kept holding them and
/// the very next `Ctrl+R` brought them all back.
#[tauri::command]
pub async fn clear_target_folders(state: State<'_, FolderState>) -> Result<(), String> {
    state.0.lock().map_err(|e| e.to_string())?.clear();
    Ok(())
}

/// Make a loaded project a **live** session again (§ project restore).
///
/// Loading a project used to write its roots, files and folders into the frontend store and stop
/// there. The backend knew nothing about any of it, which broke the session in two ways that both
/// looked like "the 1-9 keys are dead":
///
///   * the target-folder registry stayed empty, so the first move's `syncFolders` re-listed
///     *nothing* straight over the sidebar and took every shortcut with it;
///   * neither the roots nor the folders were in the access scope or the asset-protocol scope, so
///     moves were refused as "outside this session's folders" and thumbnails would not load.
///
/// This grants both scopes and re-registers the folders, so a restored project behaves exactly
/// like the scan it was made from. It grants no more than `scan_folders` already does with the
/// paths the webview hands it.
#[tauri::command]
pub async fn adopt_session(
    app: AppHandle,
    state: State<'_, FolderState>,
    scope: State<'_, crate::guard::AccessScope>,
    roots: Vec<String>,
    folders: Vec<String>,
) -> Result<Vec<FolderInfo>, String> {
    for r in &roots {
        let _ = app.asset_protocol_scope().allow_directory(r, true);
    }
    scope.allow_all(&roots);

    let mut list = state.0.lock().map_err(|e| e.to_string())?;
    for p in adopt_in(&mut list, &folders) {
        let _ = app.asset_protocol_scope().allow_directory(&p, true);
        scope.allow(&p);
    }
    Ok(with_live_counts(&list))
}

#[tauri::command]
pub async fn rename_folder(
    state: State<'_, FolderState>,
    scope: State<'_, crate::guard::AccessScope>,
    id: String,
    name: String,
) -> Result<Vec<FolderInfo>, String> {
    let mut list = state.0.lock().map_err(|e| e.to_string())?;
    // The directory itself moves, so the old grant no longer covers it.
    if let Some(f) = list.iter().find(|f| f.id == id) {
        scope.check(&f.path)?;
    }
    rename_in(&mut list, &id, &name)?;
    if let Some(f) = list.iter().find(|f| f.name == name) {
        scope.allow(&f.path);
    }
    Ok(with_live_counts(&list))
}

#[tauri::command]
pub async fn delete_folder(
    state: State<'_, FolderState>,
    id: String,
) -> Result<Vec<FolderInfo>, String> {
    let mut list = state.0.lock().map_err(|e| e.to_string())?;
    delete_in(&mut list, &id);
    Ok(with_live_counts(&list))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn base_str(d: &tempfile::TempDir) -> String {
        d.path().to_string_lossy().to_string()
    }

    #[test]
    fn adopting_a_saved_session_restores_the_shortcuts_in_order() {
        // Loading a project put the folders back in the *frontend* store and nowhere else. The
        // backend registry stayed empty, so the first move's `syncFolders` re-listed an empty
        // registry straight over the sidebar and every 1-9 key went dead until a restart.
        let base = tempdir().unwrap();
        let mut paths = Vec::new();
        for n in ["one", "two", "three"] {
            let d = base.path().join(n);
            std::fs::create_dir_all(&d).unwrap();
            paths.push(d.to_string_lossy().to_string());
        }
        let mut list = Vec::new();
        let granted = adopt_in(&mut list, &paths);
        assert_eq!(granted.len(), 3);
        assert_eq!(
            list.iter().map(|f| (f.name.as_str(), f.shortcut)).collect::<Vec<_>>(),
            vec![("one", 1), ("two", 2), ("three", 3)],
        );
    }

    #[test]
    fn adopting_skips_folders_that_no_longer_exist_without_losing_the_rest() {
        let base = tempdir().unwrap();
        let kept = base.path().join("kept");
        std::fs::create_dir_all(&kept).unwrap();
        let mut list = Vec::new();
        let granted = adopt_in(
            &mut list,
            &[
                "Z:/deleted/by/the/user".to_string(),
                kept.to_string_lossy().to_string(),
            ],
        );
        assert_eq!(granted.len(), 1);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].shortcut, 1, "the survivor takes the first free slot");
    }

    #[test]
    fn adopting_twice_does_not_duplicate_or_consume_extra_slots() {
        let base = tempdir().unwrap();
        let d = base.path().join("one");
        std::fs::create_dir_all(&d).unwrap();
        let paths = vec![d.to_string_lossy().to_string()];
        let mut list = Vec::new();
        adopt_in(&mut list, &paths);
        adopt_in(&mut list, &paths);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].shortcut, 1);
    }

    #[test]
    fn create_assigns_first_shortcut_and_makes_dir() {
        let base = tempdir().unwrap();
        let mut list = Vec::new();
        let f = upsert_target(&mut list, &base_str(&base), "Family").unwrap();
        assert_eq!(f.shortcut, 1);
        assert_eq!(f.file_count, 0); // a folder it just created really is empty
        assert!(base.path().join("Family").is_dir());
        assert_eq!(list.len(), 1);
    }

    #[test]
    fn counts_only_media_directly_inside_the_folder() {
        let base = tempdir().unwrap();
        let dir = base.path().join("Sorted");
        std::fs::create_dir_all(dir.join("nested")).unwrap();
        std::fs::write(dir.join("a.jpg"), b"x").unwrap();
        std::fs::write(dir.join("b.MP4"), b"x").unwrap();
        std::fs::write(dir.join("notes.txt"), b"x").unwrap(); // not media
        std::fs::write(dir.join("nested/c.png"), b"x").unwrap(); // not direct
        assert_eq!(count_media_in(&dir.to_string_lossy()), 2);
        // A folder that no longer exists reports 0 instead of erroring the whole listing.
        assert_eq!(count_media_in(&base.path().join("gone").to_string_lossy()), 0);
    }

    #[test]
    fn registering_an_existing_folder_reports_what_is_already_in_it() {
        let base = tempdir().unwrap();
        let existing = base.path().join("Archive");
        std::fs::create_dir_all(&existing).unwrap();
        for n in 0..5 {
            std::fs::write(existing.join(format!("p{n}.jpg")), b"x").unwrap();
        }
        let mut list = Vec::new();
        let f = add_existing_in(&mut list, &existing.to_string_lossy()).unwrap();
        assert_eq!(f.file_count, 5, "an already-populated target must not report 0");
    }

    #[test]
    fn live_counts_track_what_lands_in_the_folder() {
        // The Ctrl+R regression: the registry's stored count is stale the moment anything moves,
        // so every listing re-reads the directory.
        let base = tempdir().unwrap();
        let mut list = Vec::new();
        let f = upsert_target(&mut list, &base_str(&base), "Keep").unwrap();
        assert_eq!(with_live_counts(&list)[0].file_count, 0);
        std::fs::write(Path::new(&f.path).join("one.jpg"), b"x").unwrap();
        std::fs::write(Path::new(&f.path).join("two.png"), b"x").unwrap();
        assert_eq!(with_live_counts(&list)[0].file_count, 2);
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
    fn add_existing_registers_a_real_dir_and_dedups() {
        let base = tempdir().unwrap();
        let existing = base.path().join("Archive");
        std::fs::create_dir_all(&existing).unwrap();
        let mut list = Vec::new();
        let path = existing.to_string_lossy().to_string();
        let a = add_existing_in(&mut list, &path).unwrap();
        assert_eq!(a.name, "Archive");
        assert_eq!(a.shortcut, 1);
        // Re-adding the same folder dedups to the same entry (no second slot consumed).
        let b = add_existing_in(&mut list, &path).unwrap();
        assert_eq!(a.id, b.id);
        assert_eq!(list.len(), 1);
    }

    #[test]
    fn add_existing_errors_on_nonexistent_path() {
        let mut list = Vec::new();
        assert!(add_existing_in(&mut list, "Z:/definitely/not/here").is_err());
    }

    #[test]
    fn add_existing_shares_shortcut_pool_with_created_folders() {
        let base = tempdir().unwrap();
        let mut list = Vec::new();
        upsert_target(&mut list, &base_str(&base), "Created").unwrap(); // shortcut 1
        let existing = base.path().join("Existing");
        std::fs::create_dir_all(&existing).unwrap();
        let f = add_existing_in(&mut list, &existing.to_string_lossy()).unwrap();
        assert_eq!(f.shortcut, 2); // next free slot
    }

    #[test]
    fn rename_moves_dir_and_updates_entry_keeping_shortcut() {
        let base = tempdir().unwrap();
        let mut list = Vec::new();
        let f = upsert_target(&mut list, &base_str(&base), "Old").unwrap();
        std::fs::write(Path::new(&f.path).join("x.jpg"), b"x").unwrap();
        rename_in(&mut list, &f.id, "New").unwrap();
        assert_eq!(list[0].name, "New");
        assert_eq!(list[0].file_count, 1, "the count follows the folder through a rename");
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
