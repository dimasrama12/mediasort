# Multi-library scanning and custom folder keys — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let MediaSort scan several libraries at once, file into any number of target folders under keys the user chooses, sort those folders A→Z, and scope a grouping run to chosen libraries.

**Architecture:** `FolderInfo.shortcut: u8` (1..=9) becomes `key: String` + `key_custom: bool`, where the key string is the exact canonical combo form `keybindings.ts::eventToCombo()` already produces. That single change removes the nine-folder cap and makes "does this folder key conflict with an app shortcut?" a string lookup. The backend registry stays the single source of truth for keys; the frontend pushes the set of keys its shortcuts occupy into backend state so auto-assignment can avoid them.

**Tech Stack:** Tauri v2 + Rust (backend, `src-tauri/`), React 19 + TypeScript + Zustand + Tailwind v4 (frontend, `src/`), Vitest + Testing Library (frontend tests), `cargo test` (backend tests).

**Spec:** `docs/superpowers/specs/2026-09-10-multi-library-and-custom-folder-keys-design.md`

## Global Constraints

- **The key pool is defined twice and must stay byte-identical:** `KEY_POOL = "1234567890QWERTYUIOPASDFGHJKLZXCVBNM;',./-="` in both `src-tauri/src/folders.rs` and `src/lib/keybindings.ts`. This mirrors the existing `paths.rs` / `paths.ts` convention in this repo; each side carries a comment naming the other.
- **Key strings are canonical combos** produced by `eventToCombo()`: modifiers in fixed order `Ctrl`, `Alt`, `Shift`, `Meta`; single characters upper-cased; named keys verbatim. `""` means "no key".
- **`FolderInfo.key` is never `shortcut`.** After Task 3 no `shortcut` identifier survives anywhere in `src/` or `src-tauri/src/` except inside prose comments.
- **App shortcuts always win at match time.** In `FileGrid`'s handler the folder-key lookup stays *after* the rebindable-action switch. Never move it earlier.
- **`list_target_folders` must never mutate keys.** It sorts for display only. Re-keying happens on mutating commands and on the explicit `reorder_folders` call.
- **New `AppSettings` fields carry `#[serde(default)]`** so an existing `settings.json` keeps loading.
- **Every task ends green:** `npm test` and `cd src-tauri && cargo test` both pass before the commit.
- **Commit trailers** on every commit:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01VySPUVYR3LsknyVxzaWrij
  ```

## File Structure

| File | Responsibility |
|---|---|
| `src-tauri/src/model.rs` | `FolderInfo` shape; `AppSettings.sort_folders_alphabetically` |
| `src-tauri/src/folders.rs` | `KEY_POOL`, `next_free_key`, `rekey_auto`, `apply_order`, `set_key_in`, `ReservedKeys`, all folder commands |
| `src-tauri/src/lib.rs` | manage `ReservedKeys`; register three new commands |
| `src/lib/keybindings.ts` | `addScanFolder` action, `KEY_POOL`, `keyRank`, `FIXED_KEYS`, `reservedKeys()` — stays app-agnostic |
| `src/lib/folderKeys.ts` | **new** — `keyConflict()`, the three refusal rules, app-aware |
| `src/lib/groupScope.ts` | **new** — `filesInScope()`, root-prefix filter |
| `src/lib/types.ts` | `FolderInfo.key`/`keyCustom`, `AppSettings.sortFoldersAlphabetically` |
| `src/lib/commands.ts` | `setReservedKeys`, `setFolderKey`, `reorderFolders` bindings |
| `src/lib/appActions.ts` | `addScanFlow()` |
| `src/store/useAppStore.ts` | `startAddScan`, `scanBase`, `addFiles` dedupe, group-scope state |
| `src/components/FileGrid.tsx` | `addScanFolder` case, combo-based folder match, floating `+` |
| `src/components/Sidebar.tsx` | key-chip capture, A→Z toggle, multi-root header, cap removal |
| `src/components/SettingsPanel.tsx` | folder-key conflict check, `setReservedKeys` pushes |
| `src/components/GroupScopePanel.tsx` | **new** — the library picker modal |
| `src/components/Toolbar.tsx` | group-scope guard |
| `src/App.tsx` | mount `GroupScopePanel`, initial `setReservedKeys` |

**Task order is dependency order.** Tasks 1–2 are Rust-only and leave the frontend uncompilable against the new IPC shape; Task 3 closes that gap. Do not reorder 1→3.

---

### Task 1: Rust — the key model and the pool

**Files:**
- Modify: `src-tauri/src/model.rs:66-73` (`FolderInfo`), `:200-211` (its serde test)
- Modify: `src-tauri/src/folders.rs` — `upsert_target`, `add_existing_in`, `adopt_in`, `rename_in`, and the commands that call them
- Test: `src-tauri/src/folders.rs` `#[cfg(test)] mod tests` (in-file, the repo's convention)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `folders::KEY_POOL: &str`
  - `folders::next_free_key(list: &[FolderInfo], reserved: &[String]) -> String`
  - `folders::ReservedKeys(pub Mutex<Vec<String>>)` with a `Default` impl
  - `FolderInfo { id, name, path, key: String, key_custom: bool, file_count: u32 }` (serde camelCase → `key`, `keyCustom`)
  - `upsert_target(list, base, name, reserved) -> Result<FolderInfo, String>`
  - `add_existing_in(list, path, reserved) -> Result<FolderInfo, String>`
  - `adopt_in(list, folder_paths, reserved) -> Vec<String>`

- [ ] **Step 1: Write the failing tests**

Add to `src-tauri/src/folders.rs`'s `mod tests`, and **delete** the two tests that assert the old cap and numbering: `tenth_folder_errors` and `distinct_folders_get_sequential_shortcuts`.

```rust
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
```

Also update every surviving test in that module that constructs or asserts a folder: `.shortcut` → `.key`, `1u8` → `"1"`, and the extra `&r` argument. `adopting_a_saved_session_restores_the_shortcuts_in_order` becomes:

```rust
    #[test]
    fn adopting_a_saved_session_restores_the_keys_in_order() {
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
```

And in `src-tauri/src/model.rs`, the serde test:

```rust
        let f = FolderInfo {
            id: "d:\\a\\family".into(),
            name: "family".into(),
            path: "D:\\a\\family".into(),
            key: "1".into(),
            key_custom: false,
            file_count: 3,
        };
        let j = serde_json::to_string(&f).unwrap();
        assert!(j.contains("\"fileCount\":3"));
        assert!(j.contains("\"key\":\"1\""));
        assert!(j.contains("\"keyCustom\":false"));
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test folders`
Expected: FAIL — `cannot find value KEY_POOL`, `no field key on type FolderInfo`, wrong number of arguments.

- [ ] **Step 3: Change `FolderInfo`**

In `src-tauri/src/model.rs`, replace the `shortcut` field:

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FolderInfo {
    pub id: String,   // = normalize_path(path) — stable, unique, the dedup key
    pub name: String, // leaf folder name (display)
    pub path: String, // absolute path (as created)
    /// The single key that files into this folder: "1", "F", ";", "Shift+:". Canonically the
    /// same string `src/lib/keybindings.ts::eventToCombo()` produces, which is what makes a
    /// folder key and an app shortcut directly comparable. "" = no keystroke (drag-only).
    ///
    /// `#[serde(default)]` is the migration: a project saved before this field existed carries
    /// `"shortcut": 3` instead, serde drops the unknown field, and the folder arrives keyless —
    /// `adopt_session` then hands out fresh keys in saved order, reproducing 1, 2, 3…
    #[serde(default)]
    pub key: String,
    /// True when the *user* picked this key. The A→Z re-key leaves these alone and takes them
    /// out of the pool, so an auto key can never collide with one.
    #[serde(default)]
    pub key_custom: bool,
    pub file_count: u32,
}
```

- [ ] **Step 4: Add the pool, `next_free_key` and `ReservedKeys`**

In `src-tauri/src/folders.rs`, below the existing `use` block:

```rust
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
```

- [ ] **Step 5: Thread `reserved` through the pure helpers**

In `upsert_target`, replace the shortcut block:

```rust
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
    let folder = FolderInfo { id, name: name.to_string(), path: path_str, key, key_custom: false, file_count };
    list.push(folder.clone());
    Ok(folder)
}
```

Apply the same two changes to `add_existing_in` (signature gains `reserved: &[String]`; the `let shortcut = (1u8..=9)...ok_or_else(...)?` becomes `let key = next_free_key(list, reserved);`, and the struct literal gains `key, key_custom: false`). `adopt_in` gains `reserved: &[String]` and forwards it to `add_existing_in`. `rename_in` needs no signature change — it already preserves the key by only touching `id`/`name`/`path`/`file_count`.

- [ ] **Step 6: Update the command wrappers**

Each command that assigns a key gains `reserved: State<'_, ReservedKeys>` and reads it once:

```rust
#[tauri::command]
pub async fn create_folder(
    state: State<'_, FolderState>,
    scope: State<'_, crate::guard::AccessScope>,
    reserved: State<'_, ReservedKeys>,
    base: String,
    name: String,
) -> Result<FolderInfo, String> {
    let res = reserved.0.lock().map_err(|e| e.to_string())?.clone();
    let mut list = state.0.lock().map_err(|e| e.to_string())?;
    let folder = upsert_target(&mut list, &base, &name, &res)?;
    scope.allow(&folder.path); // a registered target is a place this session may write
    Ok(folder)
}
```

Do the same for `add_existing_folder`, `add_existing_folders` and `adopt_session`. **Lock `reserved` before `state`** in every one of them — one consistent order is what keeps two mutexes from ever deadlocking.

In `src-tauri/src/lib.rs:27`, add the state:

```rust
        .manage(folders::ReservedKeys::default())
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test`
Expected: PASS, all tests, no warnings about unused `shortcut`.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/model.rs src-tauri/src/folders.rs src-tauri/src/lib.rs
git commit -m "feat(folders): key strings instead of 1-9 shortcuts, no folder cap

FolderInfo.shortcut (u8, 1..=9) becomes key: String + key_custom: bool,
assigned from a 43-entry pool that skips keys the app's own shortcuts use.
An exhausted pool yields a keyless (drag-only) folder rather than an error,
so the nine-folder cap is genuinely gone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VySPUVYR3LsknyVxzaWrij"
```

---

### Task 2: Rust — ordering, manual keys, and the three new commands

**Files:**
- Modify: `src-tauri/src/model.rs` (`AppSettings` + its `Default`)
- Modify: `src-tauri/src/folders.rs` (`delete_in`, new helpers and commands)
- Modify: `src-tauri/src/lib.rs:70-109` (`generate_handler!`)
- Test: `src-tauri/src/folders.rs` `mod tests`, `src-tauri/src/settings.rs` `mod tests`

**Interfaces:**
- Consumes: `KEY_POOL`, `next_free_key`, `ReservedKeys`, `FolderInfo` (Task 1).
- Produces:
  - `folders::rekey_auto(list: &mut [FolderInfo], reserved: &[String])`
  - `folders::apply_order(list: &mut Vec<FolderInfo>, alphabetical: bool, reserved: &[String])`
  - `folders::set_key_in(list: &mut [FolderInfo], id: &str, key: &str) -> Result<(), String>`
  - commands `set_reserved_keys(keys: Vec<String>)`, `set_folder_key(id: String, key: String) -> Vec<FolderInfo>`, `reorder_folders() -> Vec<FolderInfo>`
  - `AppSettings.sort_folders_alphabetically: bool` (JSON `sortFoldersAlphabetically`)
- `delete_in` gains a third parameter: `delete_in(list, id, reserved)`.

- [ ] **Step 1: Write the failing tests**

Add to `folders.rs`'s `mod tests`, and **replace** `delete_removes_and_renumbers_shortcuts` with the first test below:

```rust
    #[test]
    fn delete_rekeys_auto_folders_but_leaves_hand_set_keys_alone() {
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
```

And in `src-tauri/src/settings.rs`'s `mod tests`:

```rust
    #[test]
    fn a_settings_file_without_the_sort_flag_loads_on_insertion_order() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        std::fs::write(&p, r#"{"similarityThreshold":72,"theme":"dark"}"#).unwrap();
        let loaded = load_from(&p);
        assert!(!loaded.sort_folders_alphabetically);
        assert_eq!(loaded.similarity_threshold, 72);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test`
Expected: FAIL — `cannot find function set_key_in`, `apply_order`, `no field sort_folders_alphabetically`.

- [ ] **Step 3: Add the settings flag**

In `src-tauri/src/model.rs`, inside `AppSettings` after `scan_subfolders`:

```rust
    /// Show target folders sorted by name instead of in the order they were added, re-keying the
    /// app-assigned keys as it goes so `1` is always the first folder in the list. Keys the user
    /// set by hand are pinned and skipped. `#[serde(default)]` keeps older settings.json loadable.
    #[serde(default)]
    pub sort_folders_alphabetically: bool,
```

and in `impl Default for AppSettings`, after `scan_subfolders: false,`:

```rust
            sort_folders_alphabetically: false,
```

- [ ] **Step 4: Add the ordering and key-setting helpers**

In `src-tauri/src/folders.rs`:

```rust
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
pub fn apply_order(list: &mut Vec<FolderInfo>, alphabetical: bool, reserved: &[String]) {
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
```

Rewrite `delete_in`:

```rust
/// Remove a target folder (by id) and hand the app-assigned keys back out from the top, so the
/// digits stay gapless (v1 bug #2 "ghost folders"). A key the user set by hand stays with its
/// folder — renumbering someone's hand-picked `F` is exactly the surprise custom keys exist to
/// avoid. The on-disk dir is kept.
pub fn delete_in(list: &mut Vec<FolderInfo>, id: &str, reserved: &[String]) {
    list.retain(|f| f.id != id);
    rekey_auto(list, reserved);
}
```

- [ ] **Step 5: Add the three commands**

In `src-tauri/src/folders.rs`. First a helper for reading the flag, mirroring how `scan_folders` reads `scan_subfolders`:

```rust
/// Read the A→Z preference straight from settings.json, the same way `scan_folders` reads
/// `scan_subfolders`. Defaults to false on any failure: insertion order is the safe answer.
fn alphabetical(app: &AppHandle) -> bool {
    app.state::<crate::settings::SettingsState>()
        .0
        .lock()
        .map(|p| crate::settings::load_from(&p).sort_folders_alphabetically)
        .unwrap_or(false)
}
```

```rust
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
```

Then add `app: AppHandle` and the `apply_order(&mut list, alphabetical(&app), &res);` call as the last step before the return in `create_folder`, `add_existing_folder`, `add_existing_folders`, `rename_folder`, `delete_folder` and `adopt_session`. `delete_folder` and `rename_folder` also need `reserved: State<'_, ReservedKeys>`; `delete_folder`'s `delete_in` call gains `&res`.

- [ ] **Step 6: Register the commands**

In `src-tauri/src/lib.rs`, inside `generate_handler!`, after `folders::delete_folder,`:

```rust
            folders::set_reserved_keys,
            folders::set_folder_key,
            folders::reorder_folders,
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src
git commit -m "feat(folders): A-Z ordering, hand-set keys, and the reserved-key channel

apply_order re-keys app-assigned folders in name order and pins hand-set
ones; set_folder_key refuses a key another folder holds; set_reserved_keys
lets the frontend tell the backend which keys its own shortcuts occupy.
list_target_folders stays read-only on purpose.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VySPUVYR3LsknyVxzaWrij"
```

---

### Task 3: Frontend — types and the mechanical fixture migration

This task changes no behaviour. It makes `src/` compile against the new IPC shape so later tasks can add behaviour without fighting type errors.

**Files:**
- Modify: `src/lib/types.ts:33-39` (`FolderInfo`), `:95-125` (`AppSettings` + `DEFAULT_SETTINGS`)
- Modify: `src/store/useAppStore.ts:579` (the `upsertFolder` sort)
- Modify (fixtures only): `src/App.test.tsx`, `src/components/ContextMenu.test.tsx`, `src/components/ExifPanel.test.tsx`, `src/components/FileGrid.test.tsx`, `src/components/Preview.test.tsx`, `src/components/Sidebar.test.tsx`, `src/lib/appActions.test.ts`, `src/lib/refresh.test.ts`, `src/store/useAppStore.test.ts`

**Interfaces:**
- Consumes: the Rust `FolderInfo` JSON shape from Task 1 (`key`, `keyCustom`).
- Produces:
  - `FolderInfo { id, name, path, key: string, keyCustom: boolean, fileCount: number }`
  - `AppSettings.sortFoldersAlphabetically: boolean`
  - `keyRank(key: string): number` — **defined in Task 4**; until then the store sort uses a local comparison. To avoid a forward reference, this task lands `keyRank` in `keybindings.ts` as part of its own change.

- [ ] **Step 1: Change the types**

`src/lib/types.ts`:

```ts
export interface FolderInfo {
  id: string;
  name: string;
  path: string;
  /** The single key that files into this folder: "1", "F", ";", "Shift+:". "" = no keystroke. */
  key: string;
  /** True when the user picked this key; the A→Z re-key leaves these alone. */
  keyCustom: boolean;
  fileCount: number;
}
```

In `AppSettings`, after `scanSubfolders`:

```ts
  /** Show target folders sorted by name instead of in the order they were added (§4). */
  sortFoldersAlphabetically: boolean;
```

and in `DEFAULT_SETTINGS`, after `scanSubfolders: false,`:

```ts
  sortFoldersAlphabetically: false,
```

- [ ] **Step 2: Add `KEY_POOL` and `keyRank` to keybindings.ts**

Append to `src/lib/keybindings.ts`:

```ts
/** Every key the app can hand to a target folder, in the order it hands them out.
 *  Mirrored **verbatim** from `src-tauri/src/folders.rs::KEY_POOL` — same arrangement as
 *  `paths.ts` mirroring `paths.rs`: two copies, one order, a test on each side pinning it. */
export const KEY_POOL = "1234567890QWERTYUIOPASDFGHJKLZXCVBNM;',./-=";

/** Where `key` sits in the pool, for sorting the sidebar. Keys outside the pool (a hand-set
 *  combo like "Shift+:") and the empty key sort last, in whatever order they arrived — the
 *  callers use a stable sort, so that is insertion order. */
export function keyRank(key: string): number {
  const i = key.length === 1 ? KEY_POOL.indexOf(key) : -1;
  return i < 0 ? Number.POSITIVE_INFINITY : i;
}
```

- [ ] **Step 3: Fix the store's folder sort**

`src/store/useAppStore.ts` — in `upsertFolder`, replace `(a, b) => a.shortcut - b.shortcut` with `(a, b) => keyRank(a.key) - keyRank(b.key)`, and add `keyRank` to the imports from `../lib/keybindings`.

- [ ] **Step 4: Migrate every test fixture**

Every `shortcut: N` in a folder literal becomes `key: "N", keyCustom: false`. Run this from the repo root, then eyeball the diff:

```bash
python - <<'PY'
import io, re, glob
files = ["src/App.test.tsx","src/components/ContextMenu.test.tsx","src/components/ExifPanel.test.tsx",
         "src/components/FileGrid.test.tsx","src/components/Preview.test.tsx",
         "src/components/Sidebar.test.tsx","src/lib/appActions.test.ts",
         "src/lib/refresh.test.ts","src/store/useAppStore.test.ts"]
for p in files:
    s = io.open(p, encoding="utf-8").read()
    # folder literals: shortcut: 1  ->  key: "1", keyCustom: false
    s = re.sub(r'shortcut:\s*(\d+)', lambda m: f'key: "{m.group(1)}", keyCustom: false', s)
    # helper params: (id: string, shortcut: number)  ->  (id: string, key: string)
    s = s.replace("(id: string, shortcut: number)", "(id: string, key: string)")
    s = re.sub(r'key: "i \+ 1", keyCustom: false', 'key: String(i + 1), keyCustom: false', s)
    io.open(p, "w", encoding="utf-8").write(s)
print("done")
PY
```

Then fix by hand what the script cannot see:

- `src/components/Sidebar.test.tsx:21` and `src/lib/appActions.test.ts:25` build keys from an index: `shortcut: i + 1` → `key: String(i + 1), keyCustom: false`.
- The two `mkFolder` helpers (`Sidebar.test.tsx:55`, `useAppStore.test.ts:17`) now take `key: string`; update their call sites from `mkFolder("a", 1)` to `mkFolder("a", "1")`.
- Any assertion reading `.shortcut` becomes `.key` with a string expectation.

- [ ] **Step 5: Run the whole suite**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, zero type errors. Fixture-only changes — no test should change meaning.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/keybindings.ts src/store/useAppStore.ts src/**/*.test.ts src/**/*.test.tsx
git commit -m "refactor(types): FolderInfo.shortcut -> key + keyCustom across the frontend

Mechanical: mirrors the Rust change, adds KEY_POOL/keyRank, and migrates
every test fixture. No behaviour change.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VySPUVYR3LsknyVxzaWrij"
```

---

### Task 4: The `addScanFolder` action, `FIXED_KEYS`, and `reservedKeys()`

**Files:**
- Modify: `src/lib/keybindings.ts`
- Test: `src/lib/keybindings.test.ts`

**Interfaces:**
- Consumes: `ACTIONS`, `KEY_POOL` (Task 3).
- Produces:
  - `ActionId` gains `"addScanFolder"`
  - `FIXED_KEYS: string[]`
  - `reservedKeys(bindings: Keybindings): string[]`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/keybindings.test.ts`:

```ts
test("every default combo is unique across actions", () => {
  const seen = new Map<string, string>();
  for (const a of ACTIONS) {
    for (const c of a.defaults) {
      expect(seen.has(c), `${c} is on both ${seen.get(c)} and ${a.id}`).toBe(false);
      seen.set(c, a.id);
    }
  }
});

test("addScanFolder defaults to Ctrl+Shift+O", () => {
  expect(DEFAULT_KEYBINDINGS.addScanFolder).toEqual(["Ctrl+Shift+O"]);
  expect(matchAction(DEFAULT_KEYBINDINGS, { key: "O", ctrlKey: true, shiftKey: true }, "global"))
    .toBe("addScanFolder");
});

test("Ctrl+Shift+O does not fire the plain scan action", () => {
  expect(matchAction(DEFAULT_KEYBINDINGS, { key: "O", ctrlKey: true }, "global")).toBe("scanFolder");
});

test("reservedKeys covers global bindings and the fixed keys, not preview ones", () => {
  const r = reservedKeys(DEFAULT_KEYBINDINGS);
  expect(r).toContain("Ctrl+O");
  expect(r).toContain("B"); // trash, a global default
  expect(r).toContain("J"); // grid nav, structural
  expect(r).toContain("Ctrl+Z"); // undo, structural
  expect(r).not.toContain("L"); // rotate-left is preview-scope: inert while the grid has focus
});

test("reservedKeys follows a rebind, freeing the key that was let go", () => {
  const rebound = { ...DEFAULT_KEYBINDINGS, trash: ["Ctrl+Backspace"] };
  const r = reservedKeys(rebound);
  expect(r).toContain("Ctrl+Backspace");
  expect(r).not.toContain("B"); // B is free again, so a folder may claim it
});

test("no fixed key is also a default binding", () => {
  const defaults = new Set(ACTIONS.flatMap((a) => a.defaults));
  for (const k of FIXED_KEYS) expect(defaults.has(k), `${k} is both fixed and bound`).toBe(false);
});

test("keyRank orders the pool and sinks anything outside it", () => {
  expect(keyRank("1")).toBe(0);
  expect(keyRank("0")).toBe(9);
  expect(keyRank("Q")).toBe(10);
  expect(keyRank("")).toBe(Number.POSITIVE_INFINITY);
  expect(keyRank("Shift+:")).toBe(Number.POSITIVE_INFINITY);
  expect(keyRank("1")).toBeLessThan(keyRank("Q"));
});

test("KEY_POOL matches the Rust copy in folders.rs", () => {
  // Pinned literal: if you change one side, this test makes you change the other.
  expect(KEY_POOL).toBe("1234567890QWERTYUIOPASDFGHJKLZXCVBNM;',./-=");
  expect(new Set(KEY_POOL).size).toBe(KEY_POOL.length);
});
```

Update the import at the top of the file to include `ACTIONS`, `DEFAULT_KEYBINDINGS`, `FIXED_KEYS`, `KEY_POOL`, `keyRank`, `matchAction`, `reservedKeys`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/keybindings.test.ts`
Expected: FAIL — `reservedKeys is not a function`, `FIXED_KEYS is not defined`.

- [ ] **Step 3: Implement**

In `src/lib/keybindings.ts`, add `"addScanFolder"` to the `ActionId` union (after `"scanFolder"`), and to `ACTIONS` immediately after the `scanFolder` entry:

```ts
  {
    id: "addScanFolder",
    label: "Add folder to the scan",
    scope: "global",
    defaults: ["Ctrl+Shift+O"],
  },
```

Then append:

```ts
/** Keys the app's structure owns, which are therefore never assignable to a target folder and
 *  never appear in the binding editor: grid navigation, the modal verbs, and undo/redo. They are
 *  not bindings — there is no action to rebind them off — so they are listed rather than derived. */
export const FIXED_KEYS: string[] = [
  "J", "K",
  "Enter", "Escape", "Space",
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
  "Ctrl+Z", "Ctrl+Y", "Ctrl+Shift+Z",
];

/** Every key a target folder must not be given: the combos the user's **global** actions occupy,
 *  plus `FIXED_KEYS`.
 *
 *  Preview-scope actions (rotate, zoom) are deliberately excluded. They fire only while the
 *  full-screen preview is open, and the preview returns before the grid's folder-key lookup is
 *  ever reached — so reserving `L`, `R`, `+`, `-`, `0` would cost five pool entries to prevent a
 *  collision that cannot happen. */
export function reservedKeys(bindings: Keybindings): string[] {
  const out = new Set<string>(FIXED_KEYS);
  for (const a of ACTIONS) {
    if (a.scope !== "global") continue;
    for (const c of bindings[a.id] ?? []) out.add(c);
  }
  return [...out];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/keybindings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/keybindings.ts src/lib/keybindings.test.ts
git commit -m "feat(keys): addScanFolder action, FIXED_KEYS, reservedKeys()

Ctrl+Shift+O is verified unique against every other default. reservedKeys
follows a rebind in both directions, so letting go of B frees it for a
target folder.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VySPUVYR3LsknyVxzaWrij"
```

---

### Task 5: The conflict rules

**Files:**
- Create: `src/lib/folderKeys.ts`
- Test: `src/lib/folderKeys.test.ts`

**Interfaces:**
- Consumes: `ACTIONS`, `FIXED_KEYS`, `formatCombo`, `Keybindings` (Task 4); `FolderInfo` (Task 3).
- Produces: `keyConflict(combo: string, bindings: Keybindings, folders: FolderInfo[], selfId: string): string | null` — the refusal message, or `null` when the key is free.

- [ ] **Step 1: Write the failing test**

Create `src/lib/folderKeys.test.ts`:

```ts
import { expect, test } from "vitest";
import { keyConflict } from "./folderKeys";
import { DEFAULT_KEYBINDINGS } from "./keybindings";
import type { FolderInfo } from "./types";

const folder = (id: string, name: string, key: string): FolderInfo => ({
  id, name, path: `C:/base/${id}`, key, keyCustom: true, fileCount: 0,
});

const folders = [folder("fam", "Family", "1"), folder("lama", "Foto Lama", ";")];

test("a free key has no conflict", () => {
  expect(keyConflict("W", DEFAULT_KEYBINDINGS, folders, "fam")).toBeNull();
});

test("a key bound to a global action is refused, naming the action", () => {
  const msg = keyConflict("Ctrl+O", DEFAULT_KEYBINDINGS, folders, "fam");
  expect(msg).toContain("Open / scan folder");
  expect(msg).toContain("Ctrl + O");
});

test("a key another folder holds is refused, naming that folder", () => {
  const msg = keyConflict(";", DEFAULT_KEYBINDINGS, folders, "fam");
  expect(msg).toContain("Foto Lama");
});

test("re-confirming the key a folder already holds is not a conflict", () => {
  expect(keyConflict("1", DEFAULT_KEYBINDINGS, folders, "fam")).toBeNull();
});

test("a structurally fixed key is refused as reserved", () => {
  expect(keyConflict("Enter", DEFAULT_KEYBINDINGS, folders, "fam")).toContain("reserved");
  expect(keyConflict("J", DEFAULT_KEYBINDINGS, folders, "fam")).toContain("reserved");
});

test("a preview-scope binding is free for a folder to take", () => {
  // L is rotate-left, but only inside the preview, which returns before folder keys are read.
  expect(keyConflict("L", DEFAULT_KEYBINDINGS, folders, "fam")).toBeNull();
});

test("a key freed by a rebind becomes available", () => {
  const rebound = { ...DEFAULT_KEYBINDINGS, trash: ["Ctrl+Backspace"] };
  expect(keyConflict("B", DEFAULT_KEYBINDINGS, folders, "fam")).toContain("Move to trash");
  expect(keyConflict("B", rebound, folders, "fam")).toBeNull();
});

test("an empty combo is refused rather than silently accepted", () => {
  expect(keyConflict("", DEFAULT_KEYBINDINGS, folders, "fam")).not.toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/folderKeys.test.ts`
Expected: FAIL — `Failed to resolve import "./folderKeys"`.

- [ ] **Step 3: Implement**

Create `src/lib/folderKeys.ts`:

```ts
//! The rules that decide whether a target folder may take a key (§3).
//!
//! Kept out of `keybindings.ts` on purpose: that module deliberately imports nothing
//! app-specific so it stays trivially testable, and these rules need `FolderInfo`.
//!
//! Note what is *not* here: nothing prevents a conflict from existing in the registry, because
//! the registry is not the enforcement point. `FileGrid` matches rebindable actions **before** it
//! looks a folder key up, so an app shortcut wins whatever the registry says. These rules exist
//! so the user is told at the moment they choose, rather than discovering a dead key later.

import type { FolderInfo } from "./types";
import type { Keybindings } from "./keybindings";
import { ACTIONS, FIXED_KEYS, formatCombo } from "./keybindings";

/** Why `combo` cannot be given to the folder `selfId`, as a message to show — or `null` if it
 *  can. `selfId` is excluded from the folder check so re-confirming a folder's own key is fine. */
export function keyConflict(
  combo: string,
  bindings: Keybindings,
  folders: FolderInfo[],
  selfId: string,
): string | null {
  if (!combo) return "That key cannot be used.";

  if (FIXED_KEYS.includes(combo)) {
    return `${formatCombo(combo)} is reserved by the app.`;
  }

  // Global scope only: a preview-scope binding fires only while the preview is open, where
  // folder keys are never read, so claiming one costs nothing.
  for (const a of ACTIONS) {
    if (a.scope !== "global") continue;
    if ((bindings[a.id] ?? []).includes(combo)) {
      return `${formatCombo(combo)} is already "${a.label}".`;
    }
  }

  const other = folders.find((f) => f.id !== selfId && f.key !== "" && f.key === combo);
  if (other) return `${formatCombo(combo)} is already "${other.name}".`;

  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/folderKeys.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/folderKeys.ts src/lib/folderKeys.test.ts
git commit -m "feat(keys): the three folder-key conflict rules

fixed key / global binding / another folder, each with the message the UI
shows. Preview-scope bindings are free to claim, and a key freed by a
rebind becomes available immediately.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VySPUVYR3LsknyVxzaWrij"
```

---

### Task 6: The IPC bindings and the reserved-key push

**Files:**
- Modify: `src/lib/commands.ts`
- Modify: `src/App.tsx:38-49` (the settings-load effect)
- Test: `src/App.test.tsx`

**Interfaces:**
- Consumes: the Rust commands from Task 2; `reservedKeys` (Task 4).
- Produces:
  - `setReservedKeys(keys: string[]): Promise<void>`
  - `setFolderKey(id: string, key: string): Promise<FolderInfo[]>`
  - `reorderFolders(): Promise<FolderInfo[]>`

- [ ] **Step 1: Write the failing test**

Append to `src/App.test.tsx` (follow the file's existing `vi.mock("./lib/commands", …)` block — add the three new functions to it as `vi.fn()`s first):

```ts
test("the reserved keys are pushed to the backend once settings have loaded", async () => {
  render(<App />);
  await waitFor(() => expect(commands.setReservedKeys).toHaveBeenCalled());
  const sent = vi.mocked(commands.setReservedKeys).mock.calls[0][0];
  expect(sent).toContain("Ctrl+O");
  expect(sent).toContain("J");
  expect(sent).not.toContain("L"); // preview scope
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/App.test.tsx`
Expected: FAIL — `commands.setReservedKeys is not a function`.

- [ ] **Step 3: Add the bindings**

In `src/lib/commands.ts`, after `clearTargetFolders`:

```ts
/** Tell the backend which keys the app's own shortcuts occupy, so a target folder is never
 *  auto-assigned one. Pushed at startup and after every rebind — the binding map lives here, so
 *  this side is the only one that can know. */
export const setReservedKeys = (keys: string[]): Promise<void> =>
  invoke<void>("set_reserved_keys", { keys });

/** Point a target folder at a key the user picked; returns the refreshed list. Rejects when
 *  another folder already holds it. */
export const setFolderKey = (id: string, key: string): Promise<FolderInfo[]> =>
  invoke<FolderInfo[]>("set_folder_key", { id, key });

/** Re-apply the A→Z ordering after the preference has been saved; returns the reordered list. */
export const reorderFolders = (): Promise<FolderInfo[]> =>
  invoke<FolderInfo[]>("reorder_folders");
```

- [ ] **Step 4: Push them at startup**

In `src/App.tsx`, inside the existing settings-load effect, right after `setSettings(merged);`:

```ts
        // The backend assigns folder keys and must not hand out one of ours. Pushed here rather
        // than at first use: a folder can be created before Settings is ever opened.
        void setReservedKeys(reservedKeys(merged.keybindings)).catch(() => {});
```

Add `setReservedKeys` to the `./lib/commands` import and `reservedKeys` to the `./lib/keybindings` import.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/commands.ts src/App.tsx src/App.test.tsx
git commit -m "feat(keys): push the reserved key set to the backend at startup

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VySPUVYR3LsknyVxzaWrij"
```

---

### Task 7: The additive-scan reducer

**Files:**
- Modify: `src/store/useAppStore.ts` — state, `startScan`, `addFiles`, `finishScan`, new `startAddScan`
- Test: `src/store/useAppStore.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - state `scanBase: number`
  - `startAddScan(newRoots: string[]): void`
  - `addFiles` now dedupes by `id`; `finishScan(total)` sets `scanned = scanBase + total`

- [ ] **Step 1: Write the failing tests**

Append to `src/store/useAppStore.test.ts`:

```ts
test("startAddScan keeps the session and clears only the groups", () => {
  const st = useAppStore.getState();
  st.startScan();
  st.setRoots(["D:/foto"]);
  st.addFiles([mk("a"), mk("b")]);
  st.setFolders([mkFolder("fam", "1")]);
  st.applyGroups(
    [{ id: "g1", name: "G1", fileIds: ["a"], similarity: 90, timeSpan: null, groupType: "visual" }],
    "visual",
  );

  useAppStore.getState().startAddScan(["E:/dcim"]);

  const s = useAppStore.getState();
  expect(s.roots).toEqual(["D:/foto", "E:/dcim"]);
  expect(s.scanning).toBe(true);
  expect(s.files.map((f) => f.id)).toEqual(["a", "b"]);
  expect(s.folders.map((f) => f.key)).toEqual(["1"]);
  expect(s.groups).toEqual([]);
  expect(s.groupMode).toBe("none");
  expect(s.activeGroupId).toBeNull();
  expect(s.files.every((f) => f.groupId === null)).toBe(true);
});

test("startAddScan keeps the undo stack, unlike startScan", () => {
  const st = useAppStore.getState();
  st.startScan();
  st.addFiles([mk("a")]);
  st.setFolders([mkFolder("fam", "1")]);
  st.completeMove(0, "fam", "C:/base/fam/a");
  expect(useAppStore.getState().undoStack).toHaveLength(1);

  useAppStore.getState().startAddScan(["E:/dcim"]);
  expect(useAppStore.getState().undoStack).toHaveLength(1);
});

test("addFiles ignores files already in the library", () => {
  const st = useAppStore.getState();
  st.startScan();
  st.addFiles([mk("a"), mk("b")]);
  st.addFiles([mk("b"), mk("c")]); // b arrives twice: overlapping roots
  expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["a", "b", "c"]);
});

test("scanned accumulates across an added scan instead of resetting", () => {
  const st = useAppStore.getState();
  st.startScan();
  st.addFiles([mk("a"), mk("b")]);
  st.finishScan(2);
  expect(useAppStore.getState().scanned).toBe(2);

  useAppStore.getState().startAddScan(["E:/dcim"]);
  useAppStore.getState().addFiles([mk("c")]);
  useAppStore.getState().finishScan(1);
  expect(useAppStore.getState().scanned).toBe(3);
});

test("a plain startScan still resets everything", () => {
  const st = useAppStore.getState();
  st.startScan();
  st.addFiles([mk("a")]);
  st.setFolders([mkFolder("fam", "1")]);
  st.finishScan(1);

  useAppStore.getState().startScan();
  const s = useAppStore.getState();
  expect(s.files).toHaveLength(0);
  expect(s.folders).toHaveLength(0);
  expect(s.scanned).toBe(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/store/useAppStore.test.ts`
Expected: FAIL — `startAddScan is not a function`.

- [ ] **Step 3: Implement**

In `src/store/useAppStore.ts`:

Add to the `AppState` interface next to `scanned`:

```ts
  /** Files already counted before the current scan began, so `scanned` can accumulate when a
   *  library is *added* to the session rather than replacing it. */
  scanBase: number;
```

and to the action list next to `startScan`:

```ts
  startAddScan: (newRoots: string[]) => void;
```

Add `scanBase: 0` to the initial state, to `reset()`'s object, and to `startScan()`'s object.

Then:

```ts
  /** Add libraries to the session instead of replacing it (§2).
   *
   *  The counterpart to `startScan`, and deliberately almost its opposite: files, target folders
   *  and their keys, the undo stack, the search box and the selection all survive, because the
   *  session is *continuing*. Only the grouping is dropped — a half-grouped library misleads,
   *  with the sidebar claiming "Group 3 — 47 files" while the photos that belong in it sit under
   *  "Ungrouped" because they arrived after the run. */
  startAddScan: (newRoots) =>
    set((s) => ({
      roots: [...s.roots, ...newRoots],
      scanning: true,
      scanBase: s.scanned,
      groups: [],
      groupMode: "none",
      activeGroupId: null,
      files: s.files.map((f) => (f.groupId === null ? f : { ...f, groupId: null })),
      grouping: false,
      groupProgress: null,
      contextMenu: null,
    })),
```

Replace `addFiles` and `finishScan`:

```ts
  /** Append a scan batch, skipping ids already in the library.
   *
   *  The backend dedupes within one run, but not across runs — adding `D:\foto` to a session that
   *  already scanned `D:\foto\2024` would otherwise list those files twice, and every id-keyed
   *  cache would then have two tiles fighting over one entry. */
  addFiles: (batch) =>
    set((s) => {
      const have = new Set(s.files.map((f) => f.id));
      const fresh = batch.filter((f) => !have.has(f.id));
      return fresh.length === 0 ? {} : { files: [...s.files, ...fresh] };
    }),
  finishScan: (total) => set((s) => ({ scanning: false, scanned: s.scanBase + total })),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS. The pre-existing `addFiles appends across batches` test still passes — its ids are distinct.

- [ ] **Step 5: Commit**

```bash
git add src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat(scan): startAddScan — add a library without ending the session

Keeps files, target folders, undo/redo and the search box; clears only the
grouping. addFiles now dedupes by id so overlapping roots cannot double-list,
and scanned accumulates across runs.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VySPUVYR3LsknyVxzaWrij"
```

---

### Task 8: `addScanFlow`

**Files:**
- Modify: `src/lib/appActions.ts` — new `addScanFlow`, **and** `openProject`'s folder sort at line 71
- Test: `src/lib/appActions.test.ts`

**Interfaces:**
- Consumes: `startAddScan` (Task 7), `pickFolders`/`scanFolders` (existing), `normalizePath` (existing), `keyRank` (Task 3).
- Produces: `addScanFlow(): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/appActions.test.ts` (the file already mocks `./commands`; ensure `pickFolders` and `scanFolders` are `vi.fn()`s there):

```ts
test("addScanFlow appends the root and keeps the session", async () => {
  const st = useAppStore.getState();
  st.startScan();
  st.setRoots(["D:/foto"]);
  st.addFiles([mk("a")]);
  st.setFolders([folder("fam", "1")]);
  st.finishScan(1);
  vi.mocked(commands.pickFolders).mockResolvedValueOnce(["E:/dcim"]);

  await addScanFlow();

  const s = useAppStore.getState();
  expect(s.roots).toEqual(["D:/foto", "E:/dcim"]);
  expect(s.files).toHaveLength(1);
  expect(s.folders).toHaveLength(1);
  expect(commands.clearTargetFolders).not.toHaveBeenCalled();
  expect(commands.scanFolders).toHaveBeenCalledWith(["E:/dcim"]);
});

test("addScanFlow scans only the roots that are new", async () => {
  const st = useAppStore.getState();
  st.setRoots(["D:/foto"]);
  vi.mocked(commands.pickFolders).mockResolvedValueOnce(["D:\\FOTO", "E:/dcim"]);

  await addScanFlow();

  // D:\FOTO is D:/foto in different clothes — same folder, already scanned.
  expect(commands.scanFolders).toHaveBeenCalledWith(["E:/dcim"]);
  expect(useAppStore.getState().roots).toEqual(["D:/foto", "E:/dcim"]);
});

test("addScanFlow says so and scans nothing when every pick is already scanned", async () => {
  const st = useAppStore.getState();
  st.setRoots(["D:/foto"]);
  vi.mocked(commands.pickFolders).mockResolvedValueOnce(["D:/foto"]);

  await addScanFlow();

  expect(commands.scanFolders).not.toHaveBeenCalled();
  expect(useAppStore.getState().notice).toMatch(/already/i);
  expect(useAppStore.getState().scanning).toBe(false);
});

test("addScanFlow does nothing when the picker is cancelled", async () => {
  vi.mocked(commands.pickFolders).mockResolvedValueOnce(null);
  await addScanFlow();
  expect(commands.scanFolders).not.toHaveBeenCalled();
  expect(useAppStore.getState().scanning).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/appActions.test.ts`
Expected: FAIL — `addScanFlow is not exported`.

- [ ] **Step 3: Implement**

In `src/lib/appActions.ts`, add `normalizePath` to the imports (`from "./paths"`) and append after `scanFlow`:

```ts
/** Add one or more libraries to the session without ending it (§2 — the blue `+`, Ctrl+Shift+O).
 *
 *  The difference from `scanFlow` is everything it does *not* do: no `clearTargetFolders`, because
 *  the targets belong to a session that is continuing; no `clearThumbnailMemo`, because the
 *  thumbnails already drawn are still of the same files. The backend needs no counterpart —
 *  `scan_folders` already grants access scope additively, and already prunes registered target
 *  folders out of the walk.
 *
 *  Roots are compared normalized, so picking `D:\FOTO` when `D:/foto` is open is recognised as the
 *  folder it is. Re-scanning an already-open library is a different request (that is Ctrl+R), so
 *  it says so rather than silently walking it twice. */
export async function addScanFlow(): Promise<void> {
  const dirs = await pickFolders();
  if (!dirs || dirs.length === 0) return;
  const st = useAppStore.getState();
  const open = new Set(st.roots.map(normalizePath));
  const fresh = dirs.filter((d) => !open.has(normalizePath(d)));
  if (fresh.length === 0) {
    st.setNotice(
      dirs.length === 1
        ? "That folder is already scanned."
        : "Those folders are already scanned.",
    );
    return;
  }
  st.setNotice(null);
  st.startAddScan(fresh);
  await scanFolders(fresh);
}
```

- [ ] **Step 4: Fix `openProject`'s folder sort**

`openProject` hands folders to `adopt_session` **in key order**, because the backend assigns the
lowest free key in the order it receives them — that ordering is what reproduces the numbering a
project was saved with. Its `.sort((a, b) => a.shortcut - b.shortcut)` no longer compiles.

Replace it with `keyRank`, and add `keyRank` to the `./keybindings` imports:

```ts
  const paths = [...project.folders]
    .sort((a, b) => keyRank(a.key) - keyRank(b.key))
    .map((f) => f.path);
```

A project saved by v0.2.0 has no keys at all, so every `keyRank` is `Infinity` and the sort is a
no-op — which is exactly right: the array is already in the order the project was saved in, and
`adopt_in` will hand out 1, 2, 3… along it.

Update the doc comment above `openProject` at the same time: "in **shortcut order** so the
backend's 'lowest free slot' assignment" becomes "in **key order** so the backend's 'next free
key' assignment".

Add this test to `src/lib/appActions.test.ts`:

```ts
test("openProject adopts folders in key order, and a legacy project in saved order", async () => {
  vi.mocked(commands.loadProject).mockResolvedValueOnce({
    id: "p1", name: "P1", savedAt: 0, roots: ["D:/foto"], files: [], groups: [],
    folders: [
      { id: "c", name: "C", path: "D:/foto/c", key: "F", keyCustom: true, fileCount: 0 },
      { id: "a", name: "A", path: "D:/foto/a", key: "1", keyCustom: false, fileCount: 0 },
      { id: "b", name: "B", path: "D:/foto/b", key: "2", keyCustom: false, fileCount: 0 },
    ],
  });
  await openProject("p1");
  // "1", "2" are pool keys and sort first; the hand-set "F" is outside the pool and goes last.
  expect(commands.adoptSession).toHaveBeenCalledWith(
    ["D:/foto"],
    ["D:/foto/a", "D:/foto/b", "D:/foto/c"],
  );
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test && npx tsc --noEmit`
Expected: PASS, zero type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/appActions.ts src/lib/appActions.test.ts
git commit -m "feat(scan): addScanFlow — pick folders and append them to the session

Normalized root comparison, so D:\\FOTO is recognised as the already-open
D:/foto rather than walked a second time.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VySPUVYR3LsknyVxzaWrij"
```

---

### Task 9: FileGrid — the `+` button and combo-based folder matching

**Files:**
- Modify: `src/components/FileGrid.tsx` — the action switch (~line 265), the digit block (~line 379), and the render tree
- Test: `src/components/FileGrid.test.tsx`

**Interfaces:**
- Consumes: `addScanFlow` (Task 8), `eventToCombo` (existing), `FolderInfo.key` (Task 3).
- Produces: no exports; behaviour only.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/FileGrid.test.tsx`:

```ts
test("a folder's custom key files the focused file into it", async () => {
  const lama = { id: "lama", name: "Foto Lama", path: "C:/base/lama", key: "F", keyCustom: true, fileCount: 0 };
  act(() => {
    useAppStore.setState({ files: [mk("a")], folders: [lama], focusedId: "a", selectedIds: [] });
  });
  render(<FileGrid />);
  await act(async () => {
    fireEvent.keyDown(window, { key: "f" }); // lower case: normalizeKey upper-cases it
  });
  await waitFor(() => expect(commands.moveFiles).toHaveBeenCalledWith(["a"], "C:/base/lama"));
});

test("digits still file, so nothing regressed for existing users", async () => {
  const fam = { id: "fam", name: "Family", path: "C:/base/fam", key: "1", keyCustom: false, fileCount: 0 };
  act(() => {
    useAppStore.setState({ files: [mk("a")], folders: [fam], focusedId: "a", selectedIds: [] });
  });
  render(<FileGrid />);
  await act(async () => {
    fireEvent.keyDown(window, { key: "1" });
  });
  await waitFor(() => expect(commands.moveFiles).toHaveBeenCalledWith(["a"], "C:/base/fam"));
});

test("an app shortcut wins over a folder that was somehow given the same key", async () => {
  // The registry should never allow this, but the grid must not depend on that being true.
  const bad = { id: "bad", name: "Bad", path: "C:/base/bad", key: "T", keyCustom: true, fileCount: 0 };
  act(() => {
    useAppStore.setState({ files: [mk("a")], folders: [bad], focusedId: "a", selectedIds: [] });
  });
  render(<FileGrid />);
  await act(async () => {
    fireEvent.keyDown(window, { key: "t" }); // T = open trash
  });
  expect(useAppStore.getState().trashOpen).toBe(true);
  expect(commands.moveFiles).not.toHaveBeenCalled();
});

test("a keyless folder is never matched", async () => {
  const none = { id: "none", name: "None", path: "C:/base/none", key: "", keyCustom: false, fileCount: 0 };
  act(() => {
    useAppStore.setState({ files: [mk("a")], folders: [none], focusedId: "a", selectedIds: [] });
  });
  render(<FileGrid />);
  await act(async () => {
    fireEvent.keyDown(window, { key: "Dead" });
  });
  expect(commands.moveFiles).not.toHaveBeenCalled();
});

test("Ctrl+Shift+O adds a folder to the scan", async () => {
  act(() => {
    useAppStore.setState({ files: [mk("a")], focusedId: "a" });
  });
  render(<FileGrid />);
  await act(async () => {
    fireEvent.keyDown(window, { key: "O", ctrlKey: true, shiftKey: true });
  });
  await waitFor(() => expect(appActions.addScanFlow).toHaveBeenCalled());
});

test("the blue + adds a folder to the scan and hides while scanning", async () => {
  render(<FileGrid />);
  const btn = screen.getByRole("button", { name: /add folder to the scan/i });
  await act(async () => {
    fireEvent.click(btn);
  });
  expect(appActions.addScanFlow).toHaveBeenCalled();

  act(() => useAppStore.setState({ scanning: true }));
  expect(screen.queryByRole("button", { name: /add folder to the scan/i })).toBeNull();
});
```

Add `addScanFlow: vi.fn()` to the file's existing `vi.mock("../lib/appActions", …)` block.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/FileGrid.test.tsx`
Expected: FAIL — no button with that name; `f` moves nothing.

- [ ] **Step 3: Handle the new action**

In `src/components/FileGrid.tsx`, add `addScanFlow` to the `../lib/appActions` import and a case in the action switch, next to `scanFolder`:

```tsx
          case "addScanFolder":
            e.preventDefault();
            void addScanFlow().catch(() => {});
            return;
```

- [ ] **Step 4: Match folders by combo**

Replace the digit block (the `if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key >= "1" && e.key <= "9")` guard and its `folders.find(...)` line) — keeping it in exactly the same place, after the action switch:

```tsx
      // Move to a target folder by its key: the selection if any, else the focused file.
      //
      // The key is any combo the user gave the folder — "1", "F", ";" — compared in the same
      // canonical form the keybinding editor produces, which is what lets one string answer both
      // "what fires this?" and "does it clash?".
      //
      // Position matters: this sits *after* the rebindable-action switch above, so an app
      // shortcut always wins. The registry refuses conflicting keys, but the grid does not rely
      // on that — a shortcut going dead is far worse than a folder key that never fires.
      //
      // Works while browsing a target folder too, which is the keyboard half of folder-to-folder
      // moves (§2): open Family, press F, and those photos are in Foto Lama. Pressing the key of
      // the folder you are already looking at is a no-op rather than a move onto itself.
      const combo = eventToCombo(e);
      const folder = combo ? folders.find((f) => f.key !== "" && f.key === combo) : undefined;
      if (folder) {
        if (folder.id === st.browseFolder?.id) return;
        const sel =
          selectedIds.length > 0
            ? files.filter((f) => selectedIds.includes(f.id)) // visible order
            : files.filter((f) => f.id === focusedId);
        if (sel.length === 0) return;
        e.preventDefault();
        // A refused move is the one outcome with nothing to see: the tile stays, the count does
        // not budge, and the key reads as broken. Say what went wrong instead.
        st.setNotice(null);
        void moveToFolder(sel, folder).catch((err) =>
          useAppStore.getState().setNotice(`Could not move to ${folder.name}: ${messageOf(err)}`),
        );
        return;
      }
```

Add `eventToCombo` to the `../lib/keybindings` import.

- [ ] **Step 5: Add the button**

Find the outermost element of `FileGrid`'s returned tree (the one wrapping the scroll container) and ensure it carries `relative`. Immediately inside it, add:

```tsx
      {/* Add a library without ending the session (§2). Pinned to the viewport corner rather than
          placed in flow, so it does not ride away with the thumbnails on a long scroll. Shown on
          an empty app too, where it simply performs a first scan. */}
      {!scanning && (
        <button
          type="button"
          onClick={() => void addScanFlow().catch(() => {})}
          aria-label="Add folder to the scan"
          title="Add folder to the scan (Ctrl+Shift+O)"
          className="press absolute bottom-4 left-4 z-10 grid h-9 w-9 place-items-center rounded-full bg-[var(--accent)] text-xl leading-none text-white shadow-[var(--shadow-3)] hover:bg-[var(--accent-hover)]"
        >
          +
        </button>
      )}
```

Add `const scanning = useAppStore((s) => s.scanning);` to the component's selectors if it is not already there.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS. The pre-existing digit-move tests still pass because Task 3 gave those fixtures `key: "1"`.

- [ ] **Step 7: Commit**

```bash
git add src/components/FileGrid.tsx src/components/FileGrid.test.tsx
git commit -m "feat(grid): file by any folder key, plus the blue + and Ctrl+Shift+O

The digit-range check becomes a canonical-combo lookup, in the same place as
before — after the action switch, so an app shortcut still wins even if a
conflicting key somehow reached the registry.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VySPUVYR3LsknyVxzaWrij"
```

---

### Task 10: Sidebar — key capture, A→Z toggle, multi-root header

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Test: `src/components/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `keyConflict` (Task 5), `setFolderKey`/`reorderFolders`/`saveSettings` (Task 6), `eventToCombo`/`formatCombo` (existing).
- Produces: no exports; behaviour only.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/Sidebar.test.tsx` (add `setFolderKey`, `reorderFolders` and `saveSettings` as `vi.fn()`s to its `vi.mock("../lib/commands", …)` block):

```ts
test("clicking a folder's key chip captures the next key", async () => {
  act(() => useAppStore.setState({ folders: [mkFolder("fam", "1")], roots: ["C:/base"] }));
  render(<Sidebar />);
  fireEvent.click(screen.getByRole("button", { name: /change the key for fam/i }));
  await act(async () => {
    fireEvent.keyDown(window, { key: "f" });
  });
  await waitFor(() => expect(commands.setFolderKey).toHaveBeenCalledWith("fam", "F"));
});

test("a key already owned by an app shortcut is refused, and nothing is sent", async () => {
  act(() => useAppStore.setState({ folders: [mkFolder("fam", "1")], roots: ["C:/base"] }));
  render(<Sidebar />);
  fireEvent.click(screen.getByRole("button", { name: /change the key for fam/i }));
  await act(async () => {
    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
  });
  expect(await screen.findByText(/Open \/ scan folder/)).toBeInTheDocument();
  expect(commands.setFolderKey).not.toHaveBeenCalled();
});

test("Escape cancels a capture without changing the key", async () => {
  act(() => useAppStore.setState({ folders: [mkFolder("fam", "1")], roots: ["C:/base"] }));
  render(<Sidebar />);
  fireEvent.click(screen.getByRole("button", { name: /change the key for fam/i }));
  await act(async () => {
    fireEvent.keyDown(window, { key: "Escape" });
  });
  expect(commands.setFolderKey).not.toHaveBeenCalled();
  expect(screen.getByText("1")).toBeInTheDocument();
});

test("the A-Z toggle saves the setting and reorders", async () => {
  act(() => useAppStore.setState({ folders: [mkFolder("fam", "1")], roots: ["C:/base"] }));
  render(<Sidebar />);
  fireEvent.click(screen.getByRole("checkbox", { name: /sort target folders alphabetically/i }));
  await waitFor(() => expect(commands.reorderFolders).toHaveBeenCalled());
  expect(useAppStore.getState().settings.sortFoldersAlphabetically).toBe(true);
  expect(commands.saveSettings).toHaveBeenCalled();
});

test("the header names every scanned root once there is more than one", () => {
  act(() => useAppStore.setState({ roots: ["D:/foto", "E:/dcim"] }));
  render(<Sidebar />);
  expect(screen.getByText(/\+1 more/)).toBeInTheDocument();
  expect(screen.getByTitle(/E:\/dcim/)).toBeInTheDocument();
});

test("a tenth target folder is offered, not blocked", () => {
  act(() =>
    useAppStore.setState({
      roots: ["C:/base"],
      folders: Array.from({ length: 9 }, (_, i) => mkFolder(`f${i}`, String(i + 1))),
    }),
  );
  render(<Sidebar />);
  const add = screen.getByRole("button", { name: /new folder/i });
  expect(add).not.toBeDisabled();
  expect(screen.queryByText(/all 9 keys used/i)).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/Sidebar.test.tsx`
Expected: FAIL — no "change the key" button, no checkbox, `New folder` is disabled at nine.

- [ ] **Step 3: Remove the cap**

In `src/components/Sidebar.tsx`, delete `const full = folders.length >= 9;`. Then:

- the `New folder` button loses `disabled={full || !base}` in favour of `disabled={!base}`, and its label becomes the plain `"New folder"` (drop the `{full ? "All 9 keys used" : …}` ternary);
- the `Add existing folders…` button loses `disabled={full}`;
- `onAddExisting` loses its `if (full) return;` guard and its `free`/`Only N of M folders fit` message — the whole `setError(paths.length > free ? … : null)` becomes `setError(null)`;
- the `newFolderRequested` effect drops `&& st.folders.length < 9`.

- [ ] **Step 4: Add key capture**

Add to the component's state:

```tsx
  const [capturingKey, setCapturingKey] = useState<string | null>(null); // folder id
```

and the capture effect, modelled on `SettingsPanel`'s:

```tsx
  // Capture the next keypress and give it to the folder being edited. Capture phase, so it beats
  // the grid's own handler — otherwise pressing "F" to *assign* F would file the selection into
  // whichever folder already had it.
  useEffect(() => {
    if (!capturingKey) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        setCapturingKey(null);
        return;
      }
      const combo = eventToCombo(e);
      if (!combo) return; // bare modifier — keep waiting
      const st = useAppStore.getState();
      const conflict = keyConflict(
        combo,
        bindingsWithDefaults(st.settings.keybindings),
        st.folders,
        capturingKey,
      );
      if (conflict) {
        setError(conflict);
        setCapturingKey(null);
        return;
      }
      setCapturingKey(null);
      setError(null);
      void setFolderKey(capturingKey, combo)
        .then(setFolders)
        .catch((err) => setError(String(err)));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturingKey, setFolders]);
```

Turn the `<kbd>` chip in the folder row into a button:

```tsx
              <button
                type="button"
                onClick={() => setCapturingKey(f.id)}
                aria-label={`Change the key for ${f.name}`}
                title={`Key: ${f.key ? formatCombo(f.key) : "none"} — click to change`}
                className={`press grid h-5 min-w-5 shrink-0 place-items-center rounded px-1 text-[11px] tabular-nums transition-colors ${
                  armed ? "bg-white/25 text-white" : "bg-[var(--elevated)] text-[var(--muted)]"
                }`}
              >
                {capturingKey === f.id ? "…" : f.key ? formatCombo(f.key) : "—"}
              </button>
```

Do the same substitution in the collapsed-sidebar chip list (`{f.shortcut}` → `{f.key || "—"}`), but leave those as plain browse buttons — the collapsed rail has no room for capture.

Add the imports: `setFolderKey`, `reorderFolders` from `../lib/commands`; `eventToCombo`, `formatCombo`, `bindingsWithDefaults` from `../lib/keybindings`; `keyConflict` from `../lib/folderKeys`; `saveSettings` from `../lib/commands`.

- [ ] **Step 5: Add the A→Z toggle**

Directly above the `<ul>` of folders:

```tsx
      {folders.length > 0 && (
        <label className="flex items-center gap-2 px-2 pb-1 text-[11px] text-[var(--muted)]">
          <input
            type="checkbox"
            checked={settings.sortFoldersAlphabetically}
            onChange={(e) => void onToggleSort(e.target.checked)}
            aria-label="Sort target folders alphabetically"
          />
          A→Z
        </label>
      )}
```

with the handler, and `const settings = useAppStore((s) => s.settings);` added to the selectors:

```tsx
  /** Flip the A→Z ordering. The setting is saved *before* the reorder, because the backend reads
   *  the flag straight from settings.json — the save is how the two agree on what "on" means. */
  async function onToggleSort(on: boolean) {
    const st = useAppStore.getState();
    const next = { ...st.settings, sortFoldersAlphabetically: on };
    st.setSettings(next);
    try {
      await saveSettings(next);
      setFolders(await reorderFolders());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }
```

- [ ] **Step 6: Show every scanned root in the header**

Replace the header's path line:

```tsx
        <div
          className="flex-1 min-w-0 text-[11px] text-[var(--muted)] truncate"
          title={roots.length > 0 ? roots.join("\n") : undefined}
        >
          {base || "No folder scanned"}
          {roots.length > 1 && (
            <span className="ml-1 text-[var(--accent-hover)]">+{roots.length - 1} more</span>
          )}
        </div>
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/Sidebar.tsx src/components/Sidebar.test.tsx
git commit -m "feat(sidebar): click a key chip to rebind it, A-Z toggle, no folder cap

The key chip becomes a capture button that refuses a key an app shortcut or
another folder holds, naming it. The nine-folder ceiling and its 'All 9 keys
used' label are gone, and the header names every scanned root.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VySPUVYR3LsknyVxzaWrij"
```

---

### Task 11: SettingsPanel — the reverse conflict check

**Files:**
- Modify: `src/components/SettingsPanel.tsx` — the capture effect (~line 84), `resetOneShortcut`, the "Reset all" button, `onReset`
- Test: `src/components/SettingsPanel.test.tsx`

**Interfaces:**
- Consumes: `setReservedKeys` (Task 6), `reservedKeys` (Task 4).
- Produces: no exports; behaviour only.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/SettingsPanel.test.tsx` (add `setReservedKeys: vi.fn()` to its commands mock):

```ts
test("an action cannot be rebound onto a key a target folder holds", async () => {
  act(() =>
    useAppStore.setState({
      settingsOpen: true,
      folders: [{ id: "lama", name: "Foto Lama", path: "C:/base/lama", key: "F", keyCustom: true, fileCount: 0 }],
    }),
  );
  render(<SettingsPanel />);
  fireEvent.click(screen.getByRole("button", { name: /shortcuts/i }));
  fireEvent.click(screen.getByRole("button", { name: /edit move to trash/i }));
  await act(async () => {
    fireEvent.keyDown(window, { key: "f" });
  });
  expect(await screen.findByText(/Foto Lama/)).toBeInTheDocument();
  // The binding is unchanged.
  expect(useAppStore.getState().settings.keybindings.trash).toEqual(["Delete", "B"]);
});

test("rebinding pushes the new reserved set to the backend", async () => {
  act(() => useAppStore.setState({ settingsOpen: true, folders: [] }));
  render(<SettingsPanel />);
  fireEvent.click(screen.getByRole("button", { name: /shortcuts/i }));
  fireEvent.click(screen.getByRole("button", { name: /edit move to trash/i }));
  await act(async () => {
    fireEvent.keyDown(window, { key: "Backspace", ctrlKey: true });
  });
  await waitFor(() => expect(commands.setReservedKeys).toHaveBeenCalled());
  const sent = vi.mocked(commands.setReservedKeys).mock.calls.at(-1)![0];
  expect(sent).toContain("Ctrl+Backspace");
  expect(sent).not.toContain("B");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/SettingsPanel.test.tsx`
Expected: FAIL — the rebind succeeds and no reserved set is pushed.

- [ ] **Step 3: Implement**

Add a `const [keyError, setKeyError] = useState<string | null>(null);`, and render it under the Shortcuts tab's intro paragraph:

```tsx
              {keyError && <p className="text-red-400 text-[11px] mb-1">{keyError}</p>}
```

In the capture effect, after `if (!combo) return;`:

```ts
      // A target folder's key is as real a binding as an action's. Stealing one would leave that
      // folder silently unreachable from the keyboard, so refuse and name it — the mirror image
      // of the check the sidebar runs when a folder tries to take an action's key.
      const clash = st.folders.find((f) => f.key !== "" && f.key === combo);
      if (clash) {
        setKeyError(`${formatCombo(combo)} is already the key for "${clash.name}".`);
        setCapturing(null);
        return;
      }
      setKeyError(null);
```

and after `void saveSettings(nextSettings).catch(() => {});`:

```ts
      void setReservedKeys(reservedKeys(next)).catch(() => {});
```

Do the same push in `resetOneShortcut`, in the "Reset all shortcuts" button's handler and in `onReset`, in each case using the binding map that was just applied:

```tsx
  const resetOneShortcut = (id: ActionId) => {
    const next = { ...bindings, [id]: [...DEFAULT_KEYBINDINGS[id]] };
    patch({ keybindings: next });
    void setReservedKeys(reservedKeys(next)).catch(() => {});
  };
```

Add `setReservedKeys` to the `../lib/commands` import and `reservedKeys` to the `../lib/keybindings` import.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsPanel.tsx src/components/SettingsPanel.test.tsx
git commit -m "feat(settings): refuse a rebind onto a folder's key, push reserved keys

The mirror of the sidebar's check, so neither side can silently take the
other's key. Every path that changes a binding re-pushes the reserved set.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VySPUVYR3LsknyVxzaWrij"
```

---

### Task 12: Group scope — the filter, the panel and the toolbar guard

**Files:**
- Create: `src/lib/groupScope.ts`, `src/lib/groupScope.test.ts`, `src/components/GroupScopePanel.tsx`, `src/components/GroupScopePanel.test.tsx`
- Modify: `src/store/useAppStore.ts`, `src/components/Toolbar.tsx`, `src/App.tsx`

**Interfaces:**
- Consumes: `normalizePath` (existing), `applyGroups` (existing), `useFocusTrap`/`useClickOutside` (existing).
- Produces:
  - `filesInScope(files: FileInfo[], roots: string[]): FileInfo[]`
  - store: `groupScopeMode: Exclude<GroupMode, "none"> | null`, `groupRoots: string[]`, `requestGroupScope(mode)`, `closeGroupScope()`, `setGroupRoots(roots)`

- [ ] **Step 1: Write the failing scope-filter test**

Create `src/lib/groupScope.test.ts`:

```ts
import { expect, test } from "vitest";
import { filesInScope } from "./groupScope";
import type { FileInfo } from "./types";

const mk = (path: string): FileInfo => ({
  id: path.replace(/\//g, "\\").toLowerCase(),
  path, name: "x.jpg", extension: "jpg", size: 1, modifiedAt: 0,
  dateTaken: null, fileType: "image", groupId: null,
});

test("files under a root are in scope, whatever the case or separator", () => {
  const files = [mk("D:/foto/a.jpg"), mk("D:\\FOTO\\sub\\b.jpg")];
  expect(filesInScope(files, ["d:\\foto"]).map((f) => f.path)).toEqual([
    "D:/foto/a.jpg",
    "D:\\FOTO\\sub\\b.jpg",
  ]);
});

test("a sibling folder sharing a name prefix is not in scope", () => {
  // "D:\foto2024" starts with "d:\foto" as a *string*, but is a different folder.
  const files = [mk("D:/foto/a.jpg"), mk("D:/foto2024/b.jpg")];
  expect(filesInScope(files, ["D:/foto"]).map((f) => f.path)).toEqual(["D:/foto/a.jpg"]);
});

test("several roots union", () => {
  const files = [mk("D:/foto/a.jpg"), mk("E:/dcim/b.jpg"), mk("F:/other/c.jpg")];
  expect(filesInScope(files, ["D:/foto", "E:/dcim"])).toHaveLength(2);
});

test("no roots means nothing in scope", () => {
  expect(filesInScope([mk("D:/foto/a.jpg")], [])).toEqual([]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/groupScope.test.ts`
Expected: FAIL — `Failed to resolve import "./groupScope"`.

- [ ] **Step 3: Implement the filter**

Create `src/lib/groupScope.ts`:

```ts
//! Which files a grouping run covers (§5).
//!
//! With several libraries open, "Group: Similar" over all of them is rarely what is wanted — a
//! phone dump and a scanned photo album have nothing to say to each other. The pop-up asks; this
//! module answers "is this file under one of the chosen roots?".

import type { FileInfo } from "./types";
import { normalizePath } from "./paths";

/** The files sitting under any of `roots`. `f.id` is already the normalized path (minted in Rust
 *  at scan time), so only the roots need normalizing here.
 *
 *  The separator in the prefix test is load-bearing: without it `D:\foto2024` would count as
 *  inside `D:\foto`, because one string does start with the other. */
export function filesInScope(files: FileInfo[], roots: string[]): FileInfo[] {
  if (roots.length === 0) return [];
  const prefixes = roots.map(normalizePath);
  return files.filter((f) =>
    prefixes.some((p) => f.id === p || f.id.startsWith(p + "\\")),
  );
}
```

- [ ] **Step 4: Add the store state**

In `src/store/useAppStore.ts`, in `AppState` near the other group fields:

```ts
  /** The grouping the user asked for while the library picker is open; null = picker closed (§5). */
  groupScopeMode: Exclude<GroupMode, "none"> | null;
  /** Roots the next grouping run covers. Seeded with every root, and re-seeded when one is added
   *  so a newly-scanned library is included by default rather than silently skipped. */
  groupRoots: string[];
```

actions:

```ts
  requestGroupScope: (mode: Exclude<GroupMode, "none">) => void;
  closeGroupScope: () => void;
  setGroupRoots: (roots: string[]) => void;
```

initial state `groupScopeMode: null, groupRoots: []` (add both to `reset()` too), and the implementations:

```ts
  requestGroupScope: (mode) =>
    set((s) => ({
      groupScopeMode: mode,
      // Any root not yet decided on is included: an added library the user has not thought about
      // should be grouped, not quietly left out.
      groupRoots: s.groupRoots.length === 0 ? [...s.roots] : s.groupRoots,
    })),
  closeGroupScope: () => set({ groupScopeMode: null }),
  setGroupRoots: (roots) => set({ groupRoots: roots }),
```

In `startAddScan`, add the new roots to `groupRoots` as well:

```ts
      groupRoots: s.groupRoots.length === 0 ? [] : [...s.groupRoots, ...newRoots],
```

- [ ] **Step 5: Write the failing panel test**

Create `src/components/GroupScopePanel.test.tsx`:

```tsx
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GroupScopePanel } from "./GroupScopePanel";
import { useAppStore } from "../store/useAppStore";
import type { FileInfo } from "../lib/types";

afterEach(() => {
  cleanup();
  useAppStore.getState().reset();
});

const mk = (path: string): FileInfo => ({
  id: path.replace(/\//g, "\\").toLowerCase(),
  path, name: "x.jpg", extension: "jpg", size: 1, modifiedAt: 0,
  dateTaken: null, fileType: "image", groupId: null,
});

const open = () =>
  act(() => {
    useAppStore.setState({
      roots: ["D:/foto", "E:/dcim"],
      files: [mk("D:/foto/a.jpg"), mk("D:/foto/b.jpg"), mk("E:/dcim/c.jpg")],
      groupRoots: ["D:/foto", "E:/dcim"],
      groupScopeMode: "visual",
    });
  });

test("it lists every root with its file count and the running total", () => {
  open();
  render(<GroupScopePanel onConfirm={vi.fn()} />);
  expect(screen.getByText("D:/foto")).toBeInTheDocument();
  expect(screen.getByText("E:/dcim")).toBeInTheDocument();
  expect(screen.getByText(/3 files/)).toBeInTheDocument();
});

test("unchecking a root lowers the total and confirms with the rest", () => {
  open();
  const onConfirm = vi.fn();
  render(<GroupScopePanel onConfirm={onConfirm} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "E:/dcim" }));
  expect(screen.getByText(/2 files/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^group$/i }));
  expect(onConfirm).toHaveBeenCalledWith("visual", ["D:/foto"]);
});

test("Group is disabled when nothing is checked", () => {
  open();
  render(<GroupScopePanel onConfirm={vi.fn()} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "D:/foto" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "E:/dcim" }));
  expect(screen.getByRole("button", { name: /^group$/i })).toBeDisabled();
});

test("Cancel closes without grouping", () => {
  open();
  const onConfirm = vi.fn();
  render(<GroupScopePanel onConfirm={onConfirm} />);
  fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
  expect(onConfirm).not.toHaveBeenCalled();
  expect(useAppStore.getState().groupScopeMode).toBeNull();
});

test("it renders nothing when no grouping was asked for", () => {
  const { container } = render(<GroupScopePanel onConfirm={vi.fn()} />);
  expect(container).toBeEmptyDOMElement();
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/components/GroupScopePanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement the panel**

Create `src/components/GroupScopePanel.tsx`:

```tsx
//! "Which libraries?" (§5).
//!
//! Once more than one library is open, a grouping run over all of them is rarely what is meant —
//! a phone dump and a scanned album have nothing to say to each other. With a single library
//! there is nothing to choose, so the Toolbar never opens this: a modal that always says the same
//! thing is a modal people learn to dismiss without reading.

import { useRef } from "react";
import { useAppStore } from "../store/useAppStore";
import { useClickOutside } from "../lib/useClickOutside";
import { useFocusTrap } from "../lib/useFocusTrap";
import { filesInScope } from "../lib/groupScope";
import type { GroupMode } from "../store/useAppStore";

const LABELS: Record<string, string> = {
  visual: "Similar",
  temporal: "Time",
  date: "Date",
  type: "Type",
};

export function GroupScopePanel({
  onConfirm,
}: {
  onConfirm: (mode: Exclude<GroupMode, "none">, roots: string[]) => void;
}) {
  const mode = useAppStore((s) => s.groupScopeMode);
  const roots = useAppStore((s) => s.roots);
  const files = useAppStore((s) => s.files);
  const chosen = useAppStore((s) => s.groupRoots);
  const setGroupRoots = useAppStore((s) => s.setGroupRoots);
  const close = useAppStore((s) => s.closeGroupScope);
  const cardRef = useRef<HTMLDivElement>(null);

  useClickOutside(mode != null, cardRef, close);
  useFocusTrap(mode != null, cardRef);

  if (mode == null) return null;

  const total = filesInScope(files, chosen).length;
  const toggle = (root: string) =>
    setGroupRoots(
      chosen.includes(root) ? chosen.filter((r) => r !== root) : [...chosen, root],
    );

  return (
    <div className="anim-fade absolute inset-0 z-40 flex items-center justify-center bg-[var(--scrim)]">
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Group: ${LABELS[mode] ?? mode}`}
        className="surface edge-lit flex w-[380px] flex-col gap-3 rounded-xl border border-[var(--border)] p-4"
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
      >
        <h2 className="text-sm font-medium">Group: {LABELS[mode] ?? mode}</h2>
        <p className="text-[11px] text-[var(--muted)]">Which libraries?</p>
        <ul className="flex flex-col gap-1">
          {roots.map((root) => (
            <li key={root}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={chosen.includes(root)}
                  onChange={() => toggle(root)}
                  aria-label={root}
                />
                <span className="flex-1 min-w-0 truncate" title={root}>
                  {root}
                </span>
                <span className="text-[11px] tabular-nums text-[var(--muted)]">
                  {filesInScope(files, [root]).length}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-[var(--border)] pt-3">
          <span className="text-[11px] tabular-nums text-[var(--muted)]">{total} files</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={close}
              className="px-3 py-1.5 rounded bg-[var(--elevated)] hover:bg-[var(--elevated-hover)] text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={total === 0}
              onClick={() => {
                const picked = [...chosen];
                close();
                onConfirm(mode, picked);
              }}
              className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-sm font-medium"
            >
              Group
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Wire the Toolbar and App**

In `src/components/Toolbar.tsx`, export the two runners so the panel can call them with a scope. Change `runGroup` and `runClientGroup` to take an explicit file list, and add the guard:

```tsx
  /** Ask which libraries first when more than one is open (§5). With one there is nothing to
   *  choose, so it runs straight through, exactly as it always did. */
  function beginGroup(mode: "visual" | "temporal" | "date" | "type") {
    if (!canGroup) return;
    if (useAppStore.getState().roots.length > 1) {
      useAppStore.getState().requestGroupScope(mode);
      return;
    }
    void runScoped(mode, files);
  }

  /** The one grouping code path: the toolbar's direct call and the pop-up's OK both land here. */
  async function runScoped(mode: "visual" | "temporal" | "date" | "type", subject: FileInfo[]) {
    if (subject.length === 0) return;
    if (mode === "date" || mode === "type") {
      applyGroups(mode === "date" ? groupByDate(subject, dateGroupSort) : groupByType(subject), mode);
      return;
    }
    setGrouping(true);
    setProgress({ done: 0, total: subject.length });
    try {
      const result =
        mode === "visual"
          ? await groupVisual(subject, settings.similarityThreshold, settings.hashAlgorithm)
          : await groupTemporal(subject, settings.timeWindowHours);
      applyGroups(result, mode);
    } catch (e) {
      // Esc during a run rejects with `cancelled`. That is the user's decision, not a failure:
      // leave whatever grouping was already applied exactly as it was and say nothing.
      if (!String(e).includes(GROUPING_CANCELLED)) throw e;
    } finally {
      setGrouping(false);
      setProgress(null);
    }
  }
```

Point every group button's `onClick` at `beginGroup(...)`, and `chooseDateOrder` at `runScoped("date", files)`. Export the scoped runner for `App` to hand the panel:

```tsx
/** Run a grouping over an explicit set of roots — the pop-up's OK path (§5). Kept as a module
 *  function taking the store as its only input so `App` can pass it straight to the panel. */
export async function runGroupOverRoots(
  mode: Exclude<GroupMode, "none">,
  roots: string[],
): Promise<void> {
  const st = useAppStore.getState();
  const subject = filesInScope(st.files, roots);
  if (subject.length === 0) return;
  if (mode === "date" || mode === "type") {
    st.applyGroups(
      mode === "date" ? groupByDate(subject, st.dateGroupSort) : groupByType(subject),
      mode,
    );
    return;
  }
  st.setGrouping(true);
  st.setGroupProgress({ done: 0, total: subject.length });
  try {
    const result =
      mode === "visual"
        ? await groupVisual(subject, st.settings.similarityThreshold, st.settings.hashAlgorithm)
        : await groupTemporal(subject, st.settings.timeWindowHours);
    useAppStore.getState().applyGroups(result, mode);
  } catch (e) {
    if (!String(e).includes(GROUPING_CANCELLED)) throw e;
  } finally {
    useAppStore.getState().setGrouping(false);
    useAppStore.getState().setGroupProgress(null);
  }
}
```

In `src/App.tsx`, mount the panel next to `<ConfirmDelete />`:

```tsx
      <GroupScopePanel onConfirm={(mode, roots) => void runGroupOverRoots(mode, roots).catch(() => {})} />
```

with imports for `GroupScopePanel` and `runGroupOverRoots`.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/groupScope.ts src/lib/groupScope.test.ts src/components/GroupScopePanel.tsx src/components/GroupScopePanel.test.tsx src/components/Toolbar.tsx src/store/useAppStore.ts src/App.tsx
git commit -m "feat(group): choose which libraries a grouping run covers

The pop-up appears only with 2+ libraries open. Out-of-scope files stay
visible and collect under the groups, because applyGroups already nulls
their groupId and the All view already ranks ungrouped last.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VySPUVYR3LsknyVxzaWrij"
```

---

### Task 13: Documentation and full verification

**Files:**
- Modify: `README.md`, `FEATURES.md`, `src/components/SettingsPanel.tsx` (the User Guide tab text)

- [ ] **Step 1: Update the in-app User Guide**

In `SettingsPanel.tsx`'s `tab === "guide"` block, replace the two stale lines:

- *"Scan one or more parent folders (Scan folder / Ctrl+O)."* → append: *"Add another library later with the blue + or Ctrl+Shift+O — the one you already have stays open."*
- *"Add target folders in the sidebar (New folder / Ctrl+N, or "Add existing folder…"). Each gets a number 1–9 for this session."* → *"Add target folders in the sidebar (New folder / Ctrl+N, or "Add existing folders…"). Each gets a key for this session — click the key chip to change it to any letter or symbol. There is no limit on how many."*
- *"Press a folder's number to move the focused file (or the whole selection) into it."* → *"Press a folder's key to move the focused file (or the whole selection) into it."*

Add one line to the "Selecting files" list: *"With several libraries open, Group asks which ones to cover."*

- [ ] **Step 2: Update README.md and FEATURES.md**

Locate the stale claims:

```bash
grep -n "1–9\|1-9\|nine\|9 " README.md FEATURES.md
```

Every hit is one of two claims. Rewrite them as:

- *"target folders, each bound to a number key 1–9"* → **"any number of target folders, each bound
  to a key you choose — a digit, a letter or a symbol. New folders take the next free key
  automatically; click a folder's key chip to change it."**
- *"scan a parent folder"* → **"scan one or more parent folders, and add more later with the blue
  + or Ctrl+Shift+O without closing what you already have open."**

Then add these two lines to the feature list in both files:

- **Sort target folders A→Z** — a sidebar toggle; the digit keys follow the new order, keys you set
  by hand stay put.
- **Scoped grouping** — with several libraries open, Group asks which ones to cover.

- [ ] **Step 3: Run everything**

```bash
npm test
npx tsc --noEmit
cd src-tauri && cargo test && cargo clippy -- -D warnings; cd ..
```

Expected: all green. Fix anything that is not before continuing.

- [ ] **Step 4: Confirm no `shortcut` survives**

```bash
grep -rn "shortcut" src/ src-tauri/src/ | grep -v "keyboard shortcut" | grep -v "^.*://"
```

Expected: only prose comments. Any `f.shortcut` or `shortcut:` is a miss — fix it.

- [ ] **Step 5: Commit**

```bash
git add README.md FEATURES.md src/components/SettingsPanel.tsx
git commit -m "docs: multi-library scanning, custom folder keys, A-Z, group scope

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VySPUVYR3LsknyVxzaWrij"
```

---

### Task 14: Manual pass in dev mode

**Not automatable — this is the user's checklist.** Run `npm run tauri dev` and walk it with them.

- [ ] **Step 1: Launch**

```bash
npm run tauri dev
```

- [ ] **Step 2: Walk the checklist**

1. Scan `D:\...` — files appear, sidebar shows the root.
2. Click the blue `+`, pick a second folder — **the first folder's files are still there**, both roots in the header (`+1 more`), new files appended.
3. `Ctrl+Shift+O` — the picker opens the same way.
4. Pick an already-scanned folder — "That folder is already scanned.", nothing re-walked.
5. Create 12 target folders — all 12 register; the 10th shows `0`, the 11th `Q`. No "All 9 keys used".
6. Press `Q` with a file focused — it files into the 11th folder.
7. Click a folder's key chip, press `F` — chip shows `F`; press `F` again with a file focused — it files there.
8. Click a chip and press `Ctrl+O` — refused, message names "Open / scan folder"; `Ctrl+O` still opens the picker.
9. Settings → Shortcuts → rebind "Move to trash" to `F` — refused, message names the folder.
10. Flip the sidebar A→Z toggle — folders re-sort by name; the hand-set `F` stays with its folder, the digits follow the new order.
11. Restart the app — A→Z is still on (it is persisted); target folders are session-only and are expected to be empty.
12. With two libraries open, click Group → Similar — the pop-up lists both with counts; uncheck one, Group; grouped files come first, the unchecked library's files sit under them ungrouped.
13. With one library open, click Group → Similar — no pop-up.
14. `Ctrl+R` — folder keys and the A→Z order survive.
15. Save a project, restart, open it — folders come back with keys.

- [ ] **Step 3: Fix whatever the walkthrough finds, then re-run Task 13 Step 3**

---

### Task 15: Build the installer and push

- [ ] **Step 1: Build**

```bash
npm run tauri build
```

Expected: the NSIS installer under the redirected target dir (see `docs/BUILD.md` — `target-dir` is redirected to `D:`).

- [ ] **Step 2: Smoke-test the built exe**

Follow the recorded procedure: launch the installed exe and take a PowerShell screenshot to catch a blank-window CSP failure before shipping. A blank window means the CSP or the asset protocol rejected the bundle — do not push a build that fails this.

- [ ] **Step 3: Resolve the pending `trash/` deletions**

`git status` carries 53 unstaged deletions under `trash/` from before this work. **Ask the user** whether to commit the removal or restore the directory — do not decide this unilaterally.

- [ ] **Step 4: Bump the version**

`0.2.0` → `0.3.0` in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`. Four features and a breaking project-format change is a minor bump, not a patch.

- [ ] **Step 5: Push**

```bash
git push origin main
```

- [ ] **Step 6: Tag the release**

```bash
git tag -a v0.3.0 -m "v0.3.0 — multi-library scanning, custom folder keys, A-Z sort, group scope"
git push origin v0.3.0
```
