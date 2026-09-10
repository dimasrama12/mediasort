//! Target folders (keyed by a free-form key string) — create, dedup by normalized path, list.

use crate::model::{FileType, FolderInfo};
use crate::paths::normalize_path;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

/// Every key the app can hand to a target folder, in the order it hands them out: the digits
/// first (so a small library still gets 1, 2, 3…), then the letters in QWERTY order, then the
/// symbols under the right hand.
///
/// Mirrored **verbatim** in `src/lib/keybindings.ts::KEY_POOL`, which needs the same order to
/// sort the sidebar. Same arrangement as `paths.rs` / `paths.ts`: two copies, one order, a test
/// on each side pinning the literal.
pub const KEY_POOL: &str = "1234567890QWERTYUIOPASDFGHJKLZXCVBNM;',./-=";

/// The first pool key that is neither already held by a folder nor reserved by an app shortcut.
///
/// Returns `""` when the pool is exhausted rather than erroring: the folder is still registered
/// and still accepts drops, it just has no keystroke. Erroring would put the old nine-folder cap
/// back in through the side door.
pub fn next_free_key(list: &[FolderInfo], reserved: &[String]) -> String {
    KEY_POOL
        .chars()
        .map(|c| c.to_string())
        .find(|k| !list.iter().any(|f| &f.key == k) && !reserved.contains(k))
        .unwrap_or_default()
}

/// The keys the frontend's app-wide shortcuts already occupy, so auto-assignment never hands one
/// out. Seeded with the *default* global bindings plus the structurally fixed keys, so it is
/// never empty even if the frontend never calls in; `set_reserved_keys` replaces it with the
/// user's real (possibly rebound) set once settings have loaded.
pub struct ReservedKeys(pub Mutex<Vec<String>>);

impl Default for ReservedKeys {
    fn default() -> Self {
        Self(Mutex::new(
            [
                "Ctrl+O", "Ctrl+Shift+O", "Ctrl+N", "Delete", "B", "Shift+Delete", "`", "Shift+R",
                "Ctrl+A", "Ctrl+H", "[", "]", "T", "Ctrl+,", "Ctrl+'", "Ctrl+R", "F5", "Alt+X",
                "Ctrl+F", "J", "K", "Enter", "Escape", "Space", "ArrowLeft", "ArrowRight",
                "ArrowUp", "ArrowDown", "Ctrl+Z", "Ctrl+Y", "Ctrl+Shift+Z",
            ]
            .iter()
            .map(|s| s.to_string())
            .collect(),
        ))
    }
}

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

/// Session-only registry of target folders + their keys.
#[derive(Default)]
pub struct FolderState(pub Mutex<Vec<FolderInfo>>);

/// Register a target folder under `base`, deduping by normalized path.
/// Returns the existing entry unchanged if already registered; otherwise
/// creates the directory, assigns the first free pool key, and appends.
pub fn upsert_target(
    list: &mut Vec<FolderInfo>,
    base: &str,
    name: &str,
    reserved: &[String],
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
    let key = next_free_key(list, reserved);
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    let file_count = count_media_in(&path_str);
    let folder = FolderInfo {
        id,
        name: name.to_string(),
        path: path_str,
        key,
        key_custom: false,
        file_count,
    };
    list.push(folder.clone());
    Ok(folder)
}

/// Register an *existing* folder (picked via the OS file explorer) as a target, deduping by
/// normalized path. Unlike `upsert_target` this takes a full absolute path and does not create
/// anything — it errors if the path isn't an existing directory. Assigns the first free pool key;
/// returns the existing entry unchanged if already registered.
pub fn add_existing_in(
    list: &mut Vec<FolderInfo>,
    path: &str,
    reserved: &[String],
) -> Result<FolderInfo, String> {
    let p = Path::new(path);
    if !p.is_dir() {
        return Err(format!("not a folder: {path}"));
    }
    let path_str = p.to_string_lossy().to_string();
    let id = normalize_path(&path_str);
    if let Some(existing) = list.iter().find(|f| f.id == id) {
        return Ok(existing.clone()); // dedup — same guard as upsert_target
    }
    let key = next_free_key(list, reserved);
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
        key,
        key_custom: false,
        file_count,
    };
    list.push(folder.clone());
    Ok(folder)
}

/// Re-register a saved session's target folders, in the order given, and report which ones took.
///
/// Pure half of `adopt_session`. Folders that no longer exist on disk are skipped rather than
/// failing the batch — a saved project is a snapshot, and the user may well have deleted one of
/// its folders since. The survivors take the free pool keys in order, which for an untouched
/// project reproduces exactly the keys it was saved with.
pub fn adopt_in(list: &mut Vec<FolderInfo>, folder_paths: &[String], reserved: &[String]) -> Vec<String> {
    let mut granted = Vec::new();
    for p in folder_paths {
        if add_existing_in(list, p, reserved).is_ok() {
            granted.push(p.clone());
        }
    }
    granted
}

/// Rename a target folder (by id) to `new_name`, moving the directory on disk.
/// Keeps the key; updates id/name/path. Errors on empty name or a collision
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

/// Hand the app-assigned keys back out from the top of the pool, in `list`'s current order.
///
/// Folders whose key the *user* set are skipped and their keys removed from the pool first, so an
/// auto key can never be handed a key someone picked by hand.
fn rekey_auto(list: &mut [FolderInfo], reserved: &[String]) {
    let pinned: Vec<String> = list
        .iter()
        .filter(|f| f.key_custom && !f.key.is_empty())
        .map(|f| f.key.clone())
        .collect();
    let mut pool = KEY_POOL
        .chars()
        .map(|c| c.to_string())
        .filter(|k| !pinned.contains(k) && !reserved.contains(k));
    for f in list.iter_mut().filter(|f| !f.key_custom) {
        f.key = pool.next().unwrap_or_default();
    }
}

/// Put `list` in the order the sidebar shows it, re-keying as needed.
///
/// Off (the default): insertion order, keys untouched — the folder you added third keeps the key
/// it was given. On: sorted by name, and every app-assigned key is handed out again in that new
/// order, so `1` is always the folder at the top of the list.
pub fn apply_order(list: &mut [FolderInfo], alphabetical: bool, reserved: &[String]) {
    if !alphabetical {
        return;
    }
    list.sort_by_key(|f| f.name.to_lowercase());
    rekey_auto(list, reserved);
}

/// Point a folder's key at `key` and mark it hand-set. Refuses a key another folder already
/// holds, naming it — a silent steal would leave the other folder mysteriously unreachable.
/// Conflicts with *app shortcuts* are the frontend's to catch: it owns the binding map.
pub fn set_key_in(list: &mut [FolderInfo], id: &str, key: &str) -> Result<(), String> {
    if !key.is_empty() {
        if let Some(other) = list.iter().find(|f| f.id != id && f.key == key) {
            return Err(format!("{key} is already \"{}\".", other.name));
        }
    }
    let f = list
        .iter_mut()
        .find(|f| f.id == id)
        .ok_or_else(|| "no such folder".to_string())?;
    f.key = key.to_string();
    f.key_custom = true;
    Ok(())
}

/// Remove a target folder (by id) and hand the app-assigned keys back out from the top, so the
/// digits stay gapless (v1 bug #2 "ghost folders"). A key the user set by hand stays with its
/// folder — renumbering someone's hand-picked `F` is exactly the surprise custom keys exist to
/// avoid. The on-disk dir is kept.
pub fn delete_in(list: &mut Vec<FolderInfo>, id: &str, reserved: &[String]) {
    list.retain(|f| f.id != id);
    rekey_auto(list, reserved);
}

/// Read the A→Z preference straight from settings.json, the same way `scan_folders` reads
/// `scan_subfolders`. Defaults to false on any failure: insertion order is the safe answer.
fn alphabetical(app: &AppHandle) -> bool {
    app.state::<crate::settings::SettingsState>()
        .0
        .lock()
        .map(|p| crate::settings::load_from(&p).sort_folders_alphabetically)
        .unwrap_or(false)
}

#[tauri::command]
pub async fn create_folder(
    app: AppHandle,
    state: State<'_, FolderState>,
    scope: State<'_, crate::guard::AccessScope>,
    reserved: State<'_, ReservedKeys>,
    base: String,
    name: String,
) -> Result<FolderInfo, String> {
    // reserved before state, every time — the one lock order that can't deadlock the two.
    let res = reserved.0.lock().map_err(|e| e.to_string())?.clone();
    let mut list = state.0.lock().map_err(|e| e.to_string())?;
    let folder = upsert_target(&mut list, &base, &name, &res)?;
    scope.allow(&folder.path); // a registered target is a place this session may write
    apply_order(&mut list, alphabetical(&app), &res);
    // Read the entry back rather than returning the one `upsert_target` built: with A→Z on the
    // ordering pass may have handed this very folder a different key on its way past.
    Ok(list
        .iter()
        .find(|f| f.id == folder.id)
        .cloned()
        .unwrap_or(folder))
}

/// Register several picked folders at once (§2 multi-select). There is no slot cap any more —
/// every folder that is a real directory gets registered; only folders the pool runs dry on land
/// keyless (drag-only), and even that stops mattering once a user starts picking custom keys.
#[tauri::command]
pub async fn add_existing_folders(
    app: AppHandle,
    state: State<'_, FolderState>,
    scope: State<'_, crate::guard::AccessScope>,
    reserved: State<'_, ReservedKeys>,
    paths: Vec<String>,
) -> Result<Vec<FolderInfo>, String> {
    let res = reserved.0.lock().map_err(|e| e.to_string())?.clone();
    let mut list = state.0.lock().map_err(|e| e.to_string())?;
    for p in &paths {
        if add_existing_in(&mut list, p, &res).is_ok() {
            scope.allow(p);
        }
    }
    apply_order(&mut list, alphabetical(&app), &res);
    Ok(with_live_counts(&list))
}

#[tauri::command]
pub async fn add_existing_folder(
    app: AppHandle,
    state: State<'_, FolderState>,
    scope: State<'_, crate::guard::AccessScope>,
    reserved: State<'_, ReservedKeys>,
    path: String,
) -> Result<FolderInfo, String> {
    let res = reserved.0.lock().map_err(|e| e.to_string())?.clone();
    let mut list = state.0.lock().map_err(|e| e.to_string())?;
    let folder = add_existing_in(&mut list, &path, &res)?;
    scope.allow(&folder.path);
    apply_order(&mut list, alphabetical(&app), &res);
    Ok(list
        .iter()
        .find(|f| f.id == folder.id)
        .cloned()
        .unwrap_or(folder))
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
/// to a different library and their keys would silently file photos into the wrong place.
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
/// looked like "the keys are dead":
///
///   * the target-folder registry stayed empty, so the first move's `syncFolders` re-listed
///     *nothing* straight over the sidebar and took every key with it;
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
    reserved: State<'_, ReservedKeys>,
    roots: Vec<String>,
    folders: Vec<String>,
) -> Result<Vec<FolderInfo>, String> {
    for r in &roots {
        let _ = app.asset_protocol_scope().allow_directory(r, true);
    }
    scope.allow_all(&roots);

    let res = reserved.0.lock().map_err(|e| e.to_string())?.clone();
    let mut list = state.0.lock().map_err(|e| e.to_string())?;
    for p in adopt_in(&mut list, &folders, &res) {
        let _ = app.asset_protocol_scope().allow_directory(&p, true);
        scope.allow(&p);
    }
    apply_order(&mut list, alphabetical(&app), &res);
    Ok(with_live_counts(&list))
}

#[tauri::command]
pub async fn rename_folder(
    app: AppHandle,
    state: State<'_, FolderState>,
    scope: State<'_, crate::guard::AccessScope>,
    reserved: State<'_, ReservedKeys>,
    id: String,
    name: String,
) -> Result<Vec<FolderInfo>, String> {
    let res = reserved.0.lock().map_err(|e| e.to_string())?.clone();
    let mut list = state.0.lock().map_err(|e| e.to_string())?;
    // The directory itself moves, so the old grant no longer covers it.
    if let Some(f) = list.iter().find(|f| f.id == id) {
        scope.check(&f.path)?;
    }
    rename_in(&mut list, &id, &name)?;
    if let Some(f) = list.iter().find(|f| f.name == name) {
        scope.allow(&f.path);
    }
    // A rename can change where the folder sorts, so the A→Z pass has to run again.
    apply_order(&mut list, alphabetical(&app), &res);
    Ok(with_live_counts(&list))
}

#[tauri::command]
pub async fn delete_folder(
    app: AppHandle,
    state: State<'_, FolderState>,
    reserved: State<'_, ReservedKeys>,
    id: String,
) -> Result<Vec<FolderInfo>, String> {
    let res = reserved.0.lock().map_err(|e| e.to_string())?.clone();
    let mut list = state.0.lock().map_err(|e| e.to_string())?;
    delete_in(&mut list, &id, &res);
    apply_order(&mut list, alphabetical(&app), &res);
    Ok(with_live_counts(&list))
}

/// Tell the backend which keys the frontend's app-wide shortcuts occupy, so auto-assignment never
/// hands one out. Pushed once at startup and after every rebind — the frontend owns the binding
/// map, so it is the only side that can know.
#[tauri::command]
pub async fn set_reserved_keys(
    reserved: State<'_, ReservedKeys>,
    keys: Vec<String>,
) -> Result<(), String> {
    *reserved.0.lock().map_err(|e| e.to_string())? = keys;
    Ok(())
}

/// Point a target folder at a key the user picked. Returns the refreshed list.
#[tauri::command]
pub async fn set_folder_key(
    app: AppHandle,
    state: State<'_, FolderState>,
    reserved: State<'_, ReservedKeys>,
    id: String,
    key: String,
) -> Result<Vec<FolderInfo>, String> {
    let res = reserved.0.lock().map_err(|e| e.to_string())?.clone();
    let mut list = state.0.lock().map_err(|e| e.to_string())?;
    set_key_in(&mut list, &id, &key)?;
    apply_order(&mut list, alphabetical(&app), &res);
    Ok(with_live_counts(&list))
}

/// Re-apply the folder ordering after the A→Z preference has been saved. Deliberately separate
/// from `list_target_folders`: a *listing* that re-keys folders as a side effect would fire on
/// every Ctrl+R and every post-move sync, which is the surprise this app has been bitten by
/// before. Ordering changes only when something actually changed it.
#[tauri::command]
pub async fn reorder_folders(
    app: AppHandle,
    state: State<'_, FolderState>,
    reserved: State<'_, ReservedKeys>,
) -> Result<Vec<FolderInfo>, String> {
    let res = reserved.0.lock().map_err(|e| e.to_string())?.clone();
    let mut list = state.0.lock().map_err(|e| e.to_string())?;
    apply_order(&mut list, alphabetical(&app), &res);
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
    fn keys_come_from_the_pool_in_order() {
        let base = tempdir().unwrap();
        let mut list = Vec::new();
        let r: Vec<String> = Vec::new();
        assert_eq!(upsert_target(&mut list, &base_str(&base), "a", &r).unwrap().key, "1");
        assert_eq!(upsert_target(&mut list, &base_str(&base), "b", &r).unwrap().key, "2");
        assert_eq!(upsert_target(&mut list, &base_str(&base), "c", &r).unwrap().key, "3");
        assert!(list.iter().all(|f| !f.key_custom), "auto keys are not custom");
    }

    #[test]
    fn reserved_keys_are_skipped_by_auto_assignment() {
        // "2" is the user's own shortcut for something; the folder must not shadow it.
        let base = tempdir().unwrap();
        let mut list = Vec::new();
        let r = vec!["2".to_string(), "3".to_string()];
        assert_eq!(upsert_target(&mut list, &base_str(&base), "a", &r).unwrap().key, "1");
        assert_eq!(upsert_target(&mut list, &base_str(&base), "b", &r).unwrap().key, "4");
    }

    #[test]
    fn more_than_nine_folders_can_be_registered() {
        // The whole point of the change: the old 1..=9 cap errored on the tenth folder.
        let base = tempdir().unwrap();
        let mut list = Vec::new();
        let r: Vec<String> = Vec::new();
        for i in 1..=12 {
            upsert_target(&mut list, &base_str(&base), &format!("f{i}"), &r).unwrap();
        }
        assert_eq!(list.len(), 12);
        assert_eq!(list[9].key, "0", "the tenth folder takes the last digit");
        assert_eq!(list[10].key, "Q", "the eleventh moves on to the letters");
    }

    #[test]
    fn an_exhausted_pool_still_registers_the_folder_without_a_key() {
        // Better a folder you can only drag onto than a folder you cannot create.
        let mut list = Vec::new();
        let reserved: Vec<String> = KEY_POOL.chars().map(|c| c.to_string()).collect();
        assert_eq!(next_free_key(&list, &reserved), "");
        let base = tempdir().unwrap();
        let f = upsert_target(&mut list, &base_str(&base), "nokey", &reserved).unwrap();
        assert_eq!(f.key, "");
        assert_eq!(list.len(), 1);
    }

    #[test]
    fn the_pool_holds_every_key_exactly_once() {
        let mut seen = std::collections::HashSet::new();
        for c in KEY_POOL.chars() {
            assert!(seen.insert(c), "{c} appears twice in KEY_POOL");
        }
        assert_eq!(KEY_POOL.chars().count(), 43);
    }

    #[test]
    fn adopting_a_saved_session_restores_the_keys_in_order() {
        // Loading a project put the folders back in the *frontend* store and nowhere else. The
        // backend registry stayed empty, so the first move's `syncFolders` re-listed an empty
        // registry straight over the sidebar and every key went dead until a restart.
        let base = tempdir().unwrap();
        let mut paths = Vec::new();
        for n in ["one", "two", "three"] {
            let d = base.path().join(n);
            std::fs::create_dir_all(&d).unwrap();
            paths.push(d.to_string_lossy().to_string());
        }
        let mut list = Vec::new();
        let granted = adopt_in(&mut list, &paths, &[]);
        assert_eq!(granted.len(), 3);
        assert_eq!(
            list.iter().map(|f| (f.name.as_str(), f.key.as_str())).collect::<Vec<_>>(),
            vec![("one", "1"), ("two", "2"), ("three", "3")],
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
            &[],
        );
        assert_eq!(granted.len(), 1);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].key, "1", "the survivor takes the first free key");
    }

    #[test]
    fn adopting_twice_does_not_duplicate_or_consume_extra_slots() {
        let base = tempdir().unwrap();
        let d = base.path().join("one");
        std::fs::create_dir_all(&d).unwrap();
        let paths = vec![d.to_string_lossy().to_string()];
        let mut list = Vec::new();
        adopt_in(&mut list, &paths, &[]);
        adopt_in(&mut list, &paths, &[]);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].key, "1");
    }

    #[test]
    fn create_assigns_first_key_and_makes_dir() {
        let base = tempdir().unwrap();
        let mut list = Vec::new();
        let r: Vec<String> = Vec::new();
        let f = upsert_target(&mut list, &base_str(&base), "Family", &r).unwrap();
        assert_eq!(f.key, "1");
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
        let f = add_existing_in(&mut list, &existing.to_string_lossy(), &[]).unwrap();
        assert_eq!(f.file_count, 5, "an already-populated target must not report 0");
    }

    #[test]
    fn live_counts_track_what_lands_in_the_folder() {
        // The Ctrl+R regression: the registry's stored count is stale the moment anything moves,
        // so every listing re-reads the directory.
        let base = tempdir().unwrap();
        let mut list = Vec::new();
        let r: Vec<String> = Vec::new();
        let f = upsert_target(&mut list, &base_str(&base), "Keep", &r).unwrap();
        assert_eq!(with_live_counts(&list)[0].file_count, 0);
        std::fs::write(Path::new(&f.path).join("one.jpg"), b"x").unwrap();
        std::fs::write(Path::new(&f.path).join("two.png"), b"x").unwrap();
        assert_eq!(with_live_counts(&list)[0].file_count, 2);
    }

    #[test]
    fn duplicate_path_dedups_to_same_entry() {
        let base = tempdir().unwrap();
        let mut list = Vec::new();
        let r: Vec<String> = Vec::new();
        let a = upsert_target(&mut list, &base_str(&base), "Keep", &r).unwrap();
        let b = upsert_target(&mut list, &base_str(&base), "Keep", &r).unwrap();
        assert_eq!(a.id, b.id);
        assert_eq!(a.key, b.key);
        assert_eq!(list.len(), 1); // no duplicate — bug #1
    }

    #[test]
    fn empty_name_errors() {
        let mut list = Vec::new();
        assert!(upsert_target(&mut list, "C:/base", "   ", &[]).is_err());
    }

    #[test]
    fn add_existing_registers_a_real_dir_and_dedups() {
        let base = tempdir().unwrap();
        let existing = base.path().join("Archive");
        std::fs::create_dir_all(&existing).unwrap();
        let mut list = Vec::new();
        let path = existing.to_string_lossy().to_string();
        let a = add_existing_in(&mut list, &path, &[]).unwrap();
        assert_eq!(a.name, "Archive");
        assert_eq!(a.key, "1");
        // Re-adding the same folder dedups to the same entry (no second slot consumed).
        let b = add_existing_in(&mut list, &path, &[]).unwrap();
        assert_eq!(a.id, b.id);
        assert_eq!(list.len(), 1);
    }

    #[test]
    fn add_existing_errors_on_nonexistent_path() {
        let mut list = Vec::new();
        assert!(add_existing_in(&mut list, "Z:/definitely/not/here", &[]).is_err());
    }

    #[test]
    fn add_existing_shares_key_pool_with_created_folders() {
        let base = tempdir().unwrap();
        let mut list = Vec::new();
        let r: Vec<String> = Vec::new();
        upsert_target(&mut list, &base_str(&base), "Created", &r).unwrap(); // key "1"
        let existing = base.path().join("Existing");
        std::fs::create_dir_all(&existing).unwrap();
        let f = add_existing_in(&mut list, &existing.to_string_lossy(), &r).unwrap();
        assert_eq!(f.key, "2"); // next free key
    }

    #[test]
    fn rename_moves_dir_and_updates_entry_keeping_key() {
        let base = tempdir().unwrap();
        let mut list = Vec::new();
        let r: Vec<String> = Vec::new();
        let f = upsert_target(&mut list, &base_str(&base), "Old", &r).unwrap();
        std::fs::write(Path::new(&f.path).join("x.jpg"), b"x").unwrap();
        rename_in(&mut list, &f.id, "New").unwrap();
        assert_eq!(list[0].name, "New");
        assert_eq!(list[0].file_count, 1, "the count follows the folder through a rename");
        assert_eq!(list[0].key, "1");
        assert!(base.path().join("New").is_dir());
        assert!(!base.path().join("Old").exists());
        assert_ne!(list[0].id, f.id); // id follows the new path
    }

    #[test]
    fn rename_to_existing_target_errors() {
        let base = tempdir().unwrap();
        let mut list = Vec::new();
        let r: Vec<String> = Vec::new();
        let a = upsert_target(&mut list, &base_str(&base), "A", &r).unwrap();
        upsert_target(&mut list, &base_str(&base), "B", &r).unwrap();
        assert!(rename_in(&mut list, &a.id, "B").is_err());
    }

    #[test]
    fn delete_rekeys_auto_folders_but_leaves_hand_set_keys_alone() {
        // The digits stay gapless (v1 bug #2 "ghost folders"), but a key the user picked by hand
        // is not renumbered out from under them — that is the whole point of custom keys.
        let base = tempdir().unwrap();
        let mut list = Vec::new();
        let r: Vec<String> = Vec::new();
        upsert_target(&mut list, &base_str(&base), "a", &r).unwrap(); // 1
        let b = upsert_target(&mut list, &base_str(&base), "b", &r).unwrap(); // 2
        upsert_target(&mut list, &base_str(&base), "c", &r).unwrap(); // 3
        let d = upsert_target(&mut list, &base_str(&base), "d", &r).unwrap(); // 4
        set_key_in(&mut list, &d.id, "F").unwrap(); // hand-set

        delete_in(&mut list, &b.id, &r);

        let keys: Vec<(&str, &str)> =
            list.iter().map(|f| (f.name.as_str(), f.key.as_str())).collect();
        assert_eq!(keys, vec![("a", "1"), ("c", "2"), ("d", "F")]);
    }

    #[test]
    fn setting_a_key_marks_it_custom_and_refuses_one_another_folder_holds() {
        let base = tempdir().unwrap();
        let mut list = Vec::new();
        let r: Vec<String> = Vec::new();
        let a = upsert_target(&mut list, &base_str(&base), "a", &r).unwrap();
        let b = upsert_target(&mut list, &base_str(&base), "b", &r).unwrap();

        set_key_in(&mut list, &a.id, ";").unwrap();
        assert_eq!(list[0].key, ";");
        assert!(list[0].key_custom);

        let err = set_key_in(&mut list, &b.id, ";").unwrap_err();
        assert!(err.contains("\"a\""), "the message names the folder that holds it: {err}");
        assert_eq!(list[1].key, "2", "the refused folder keeps the key it had");
    }

    #[test]
    fn setting_a_key_a_folder_already_holds_itself_is_allowed() {
        let base = tempdir().unwrap();
        let mut list = Vec::new();
        let a = upsert_target(&mut list, &base_str(&base), "a", &[]).unwrap();
        set_key_in(&mut list, &a.id, "1").unwrap(); // same key, now pinned
        assert!(list[0].key_custom);
    }

    #[test]
    fn alphabetical_order_rekeys_auto_folders_only() {
        let base = tempdir().unwrap();
        let mut list = Vec::new();
        let r: Vec<String> = Vec::new();
        upsert_target(&mut list, &base_str(&base), "Zebra", &r).unwrap(); // 1
        upsert_target(&mut list, &base_str(&base), "Family", &r).unwrap(); // 2
        let anak = upsert_target(&mut list, &base_str(&base), "Anak", &r).unwrap(); // 3
        set_key_in(&mut list, &anak.id, "F").unwrap();

        apply_order(&mut list, true, &r);

        assert_eq!(
            list.iter().map(|f| (f.name.as_str(), f.key.as_str())).collect::<Vec<_>>(),
            vec![("Anak", "F"), ("Family", "1"), ("Zebra", "2")],
            "sorted by name; Anak keeps its hand-set F and yields 1 to Family",
        );
    }

    #[test]
    fn alphabetical_order_never_hands_out_a_pinned_key() {
        let base = tempdir().unwrap();
        let mut list = Vec::new();
        let z = upsert_target(&mut list, &base_str(&base), "Zebra", &[]).unwrap();
        upsert_target(&mut list, &base_str(&base), "Anak", &[]).unwrap();
        set_key_in(&mut list, &z.id, "1").unwrap(); // pins "1" — the first pool entry

        apply_order(&mut list, true, &[]);

        assert_eq!(list[0].name, "Anak");
        assert_eq!(list[0].key, "2", "1 is taken by Zebra, so Anak gets the next one");
        assert_eq!(list[1].key, "1");
    }

    #[test]
    fn order_off_leaves_both_order_and_keys_untouched() {
        let base = tempdir().unwrap();
        let mut list = Vec::new();
        upsert_target(&mut list, &base_str(&base), "Zebra", &[]).unwrap();
        upsert_target(&mut list, &base_str(&base), "Anak", &[]).unwrap();
        apply_order(&mut list, false, &[]);
        assert_eq!(
            list.iter().map(|f| (f.name.as_str(), f.key.as_str())).collect::<Vec<_>>(),
            vec![("Zebra", "1"), ("Anak", "2")],
        );
    }

    #[test]
    fn a_project_saved_with_numeric_shortcuts_still_loads_and_adopts() {
        // The v0.2.0 project format. Serde drops the unknown "shortcut", the folder arrives
        // keyless, and adopting hands out fresh keys in saved order.
        let json = r#"{"id":"d:\\a\\one","name":"one","path":"D:\\a\\one",
                       "shortcut":3,"fileCount":5}"#;
        let f: FolderInfo = serde_json::from_str(json).unwrap();
        assert_eq!(f.key, "");
        assert!(!f.key_custom);
        assert_eq!(f.name, "one", "the rest of the folder survives");

        let base = tempdir().unwrap();
        let d = base.path().join("one");
        std::fs::create_dir_all(&d).unwrap();
        let mut list = Vec::new();
        adopt_in(&mut list, &[d.to_string_lossy().to_string()], &[]);
        assert_eq!(list[0].key, "1");
    }
}
