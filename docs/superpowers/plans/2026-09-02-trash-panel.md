# Trash Panel (Slice #6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete media files to an app-managed trash (`Del`), browse them in a first-class TrashPanel (`T`), restore any item (collision-suffixed), and empty the trash to the OS Recycle Bin — closing v1 bug #3.

**Architecture:** New Rust `trash.rs` ports `source/trash.go` (files-only) as pure `*_in(trash_dir, …)` helpers + 5 thin `#[tauri::command]`s over a `TrashState(Mutex<PathBuf>)`. `model.rs` gains `TrashItem`/`TrashStats`. Frontend adds a store trash slice, `commands.ts` wrappers, a `TrashPanel.tsx` overlay, and `FileGrid` `Del`/`T` wiring. Trash is undone by **Restore in the panel**, not `Ctrl+Z` (that's slice 9).

**Tech Stack:** Rust (`std::fs`, `serde`, `serde_json`, `tempfile` dev-dep, new `trash` crate), Tauri v2 commands/state; React 18 + TS, Zustand, Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-09-02-trash-panel-design.md`

## Global Constraints

- **Files-only** (v1 folder-trash deferred); `TrashItem` = `{ id, originalPath, trashPath, name, size, deletedAt }` (serde `camelCase`).
- **Pure helpers take an explicit `trash_dir: &Path`** so tests only touch a `tempdir`. Commands resolve the real dir from `TrashState` (set in `lib.rs` to `app_data_dir()/trash`).
- **Empty→Recycle Bin is command-only glue** via the `trash` crate; the unit-tested `empty_in` hard-removes + resets metadata. Never touch the real Recycle Bin from a unit test.
- **Del obeys #5d precedence:** selection non-empty → trash the selection; else the focused file. Restore lands the file back on disk, not into the live grid.
- Test gate before merge: backend `cargo test --manifest-path src-tauri/Cargo.toml` + frontend `npm test -- --run`. Branch `trash-panel`, merged to `main` with `--ff-only`, never pushed.
- Metadata file `<trash_dir>/trash.json` = JSON map `id → TrashItem`; missing/corrupt ⇒ `{}`.

---

### Task 1: `TrashItem` + `TrashStats` types

**Files:**
- Modify: `src-tauri/src/model.rs`
- Test: same file (`#[cfg(test)] mod tests`)

**Interfaces:**
- Produces: `TrashItem { id, original_path, trash_path, name, size: u64, deleted_at: i64 }` and `TrashStats { count: u32, total_size: u64 }`, both `#[derive(Serialize, Deserialize, Clone, Debug)] #[serde(rename_all = "camelCase")]`.

- [ ] **Step 1: Write the failing test** — add to `model.rs` tests:

```rust
#[test]
fn trashitem_and_stats_serialize_camelcase() {
    let it = TrashItem {
        id: "trash_1_b.jpg".into(),
        original_path: "D:\\a\\b.jpg".into(),
        trash_path: "D:\\app\\trash\\trash_1_b.jpg".into(),
        name: "b.jpg".into(),
        size: 10,
        deleted_at: 123,
    };
    let j = serde_json::to_string(&it).unwrap();
    assert!(j.contains("\"originalPath\":\"D:\\\\a\\\\b.jpg\""));
    assert!(j.contains("\"trashPath\":"));
    assert!(j.contains("\"deletedAt\":123"));
    let s = TrashStats { count: 2, total_size: 20 };
    let js = serde_json::to_string(&s).unwrap();
    assert!(js.contains("\"totalSize\":20"));
}
```

- [ ] **Step 2: Run to verify it fails** — `cargo test --manifest-path src-tauri/Cargo.toml model::` → FAIL (types undefined).

- [ ] **Step 3: Implement** — append to `model.rs` (before `#[cfg(test)]`):

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrashItem {
    pub id: String,
    pub original_path: String,
    pub trash_path: String,
    pub name: String,
    pub size: u64,
    pub deleted_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrashStats {
    pub count: u32,
    pub total_size: u64,
}
```

- [ ] **Step 4: Run to verify it passes** — `cargo test --manifest-path src-tauri/Cargo.toml model::` → PASS.

- [ ] **Step 5: Commit** — `git add src-tauri/src/model.rs && git commit -m "feat: TrashItem/TrashStats IPC types"`

---

### Task 2: trash metadata helpers + `trash_files_in`

**Files:**
- Create: `src-tauri/src/trash.rs`
- Test: same file
- Modify: `src-tauri/src/lib.rs` (add `mod trash;` so it compiles)

**Interfaces:**
- Produces: `metadata_path(&Path) -> PathBuf`, `load_metadata(&Path) -> BTreeMap<String, TrashItem>`, `save_metadata(&Path, &BTreeMap<String, TrashItem>) -> Result<(), String>`, and `trash_files_in(trash_dir: &Path, paths: &[String]) -> Result<Vec<TrashItem>, String>`.

- [ ] **Step 1: Write the failing test** — create `trash.rs` with the module doc + this test:

```rust
//! App-managed trash (files-only): move-to-trash, restore, list, empty, stats.
//! Ported from v1 `source/trash.go`. Pure `*_in` helpers take an explicit
//! `trash_dir` so tests touch only a tempdir; commands resolve the real dir.

use crate::model::{TrashItem, TrashStats};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

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
        // metadata persisted, keyed by id
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
}
```

- [ ] **Step 2: Run to verify it fails** — add `mod trash;` to `lib.rs` (after `mod thumbnail;`), then `cargo test --manifest-path src-tauri/Cargo.toml trash::` → FAIL (helpers undefined).

- [ ] **Step 3: Implement** — add above the tests in `trash.rs`:

```rust
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
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)
}

fn now_millis() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
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
        let base = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
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
```

- [ ] **Step 4: Run to verify it passes** — `cargo test --manifest-path src-tauri/Cargo.toml trash::` → PASS (both tests).

- [ ] **Step 5: Commit** — `git add src-tauri/src/trash.rs src-tauri/src/lib.rs && git commit -m "feat: trash.rs metadata helpers + trash_files_in (port v1)"`

---

### Task 3: `list_trash_in` + `stats_in`

**Files:** Modify + Test: `src-tauri/src/trash.rs`

**Interfaces:**
- Consumes: `load_metadata`, `trash_files_in`.
- Produces: `list_trash_in(trash_dir: &Path) -> Result<Vec<TrashItem>, String>` (newest-first by `deleted_at`, skips `trash.json`, falls back to a synthetic item for entries lacking metadata); `stats_in(trash_dir: &Path) -> Result<TrashStats, String>`.

- [ ] **Step 1: Write the failing test** — add tests:

```rust
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
    // newest-first: b was trashed last
    assert!(list[0].deleted_at >= list[1].deleted_at);
    let stats = stats_in(&trash_dir).unwrap();
    assert_eq!(stats.count, 2);
    assert_eq!(stats.total_size, 5);
}
```

- [ ] **Step 2: Run to verify it fails** — `cargo test --manifest-path src-tauri/Cargo.toml trash::list_and_stats` → FAIL.

- [ ] **Step 3: Implement**:

```rust
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
    Ok(TrashStats { count: items.len() as u32, total_size })
}
```

- [ ] **Step 4: Run to verify it passes** — `cargo test --manifest-path src-tauri/Cargo.toml trash::` → PASS.

- [ ] **Step 5: Commit** — `git add src-tauri/src/trash.rs && git commit -m "feat: list_trash_in + stats_in"`

---

### Task 4: `restore_in`

**Files:** Modify + Test: `src-tauri/src/trash.rs`

**Interfaces:**
- Produces: `restore_in(trash_dir: &Path, id: &str, dest_path: &str) -> Result<String, String>` — moves `trash_dir/id` back to `dest_path` (rename → copy+remove), suffixing `<stem>_restored_N.<ext>` when `dest_path` exists; removes `id` from metadata; returns the final path. Unknown id ⇒ `Err`.

- [ ] **Step 1: Write the failing test**:

```rust
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
    fs::write(&root.path().join("b.jpg"), b"x").unwrap();
    let items2 = trash_files_in(&trash_dir, &[root.path().join("b.jpg").to_string_lossy().to_string()]).unwrap();
    let taken = src.to_string_lossy().to_string(); // a.jpg exists
    let back2 = restore_in(&trash_dir, &items2[0].id, &taken).unwrap();
    assert!(back2.ends_with("a_restored_1.jpg"), "got {back2}");
}

#[test]
fn restore_unknown_id_errors() {
    let root = tempdir().unwrap();
    let trash_dir = root.path().join("trash");
    fs::create_dir_all(&trash_dir).unwrap();
    assert!(restore_in(&trash_dir, "nope", &root.path().join("x.jpg").to_string_lossy()).is_err());
}
```

- [ ] **Step 2: Run to verify it fails** — `cargo test --manifest-path src-tauri/Cargo.toml trash::restore` → FAIL.

- [ ] **Step 3: Implement**:

```rust
/// Restore `trash_dir/id` to `dest_path`, suffixing `_restored_N` on collision.
pub fn restore_in(trash_dir: &Path, id: &str, dest_path: &str) -> Result<String, String> {
    let entry = trash_dir.join(id);
    if !entry.exists() {
        return Err("item not found in trash".to_string());
    }
    let mut target = PathBuf::from(dest_path);
    if target.exists() {
        let dir = target.parent().map(|p| p.to_path_buf()).unwrap_or_default();
        let stem = target.file_stem().unwrap_or_default().to_string_lossy().to_string();
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
```

- [ ] **Step 4: Run to verify it passes** — `cargo test --manifest-path src-tauri/Cargo.toml trash::` → PASS.

- [ ] **Step 5: Commit** — `git add src-tauri/src/trash.rs && git commit -m "feat: restore_in (collision-suffixed restore)"`

---

### Task 5: `empty_in`

**Files:** Modify + Test: `src-tauri/src/trash.rs`

**Interfaces:**
- Produces: `empty_in(trash_dir: &Path) -> Result<(), String>` — removes every entry except `trash.json`, then writes `{}` to `trash.json`.

- [ ] **Step 1: Write the failing test**:

```rust
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
```

- [ ] **Step 2: Run to verify it fails** — `cargo test --manifest-path src-tauri/Cargo.toml trash::empty` → FAIL.

- [ ] **Step 3: Implement**:

```rust
/// Hard-remove every trash entry (except trash.json) and reset the metadata.
/// The recycle-bin hop lives in the `empty_trash` command, not here.
pub fn empty_in(trash_dir: &Path) -> Result<(), String> {
    if let Ok(rd) = std::fs::read_dir(trash_dir) {
        for entry in rd.flatten() {
            if entry.file_name() == std::ffi::OsStr::new("trash.json") {
                continue;
            }
            let p = entry.path();
            let _ = if p.is_dir() { std::fs::remove_dir_all(&p) } else { std::fs::remove_file(&p) };
        }
    }
    save_metadata(trash_dir, &BTreeMap::new())
}
```

- [ ] **Step 4: Run to verify it passes** — `cargo test --manifest-path src-tauri/Cargo.toml trash::` → PASS.

- [ ] **Step 5: Commit** — `git add src-tauri/src/trash.rs && git commit -m "feat: empty_in (clear trash + metadata)"`

---

### Task 6: commands + `trash` crate + `lib.rs` wiring

**Files:**
- Modify: `src-tauri/src/trash.rs` (add `TrashState` + 5 commands), `src-tauri/src/lib.rs` (manage state + register), `src-tauri/Cargo.toml` (add `trash`).

**Interfaces:**
- Produces commands: `trash_files(state, paths: Vec<String>) -> Vec<TrashItem>`, `restore_from_trash(state, id: String, dest: String) -> ()`, `list_trash(state) -> Vec<TrashItem>`, `empty_trash(state) -> ()`, `trash_stats(state) -> TrashStats`; `TrashState(pub Mutex<PathBuf>)` with `TrashState::new(PathBuf)`.

- [ ] **Step 1: Add the dependency** — in `src-tauri/Cargo.toml` under `[dependencies]`, add `trash = "5"`. Run `cargo build --manifest-path src-tauri/Cargo.toml` once to fetch/compile it (verifies the dep resolves on MSVC before wiring).

- [ ] **Step 2: Implement `TrashState` + commands** — add to `trash.rs` (above `#[cfg(test)]`):

```rust
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
) -> Result<(), String> {
    restore_in(&dir_of(&state)?, &id, &dest).map(|_| ())
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
```

- [ ] **Step 3: Wire `lib.rs`** — in `setup`, after the thumbnail block, add:

```rust
            let trash_dir = app.path().app_data_dir().expect("resolve app_data_dir").join("trash");
            std::fs::create_dir_all(&trash_dir).ok();
            app.manage(trash::TrashState::new(trash_dir));
```

and add to `generate_handler![…]` (after `fileops::move_files`): `, trash::trash_files, trash::list_trash, trash::restore_from_trash, trash::trash_stats, trash::empty_trash`.

- [ ] **Step 4: Verify the whole backend compiles + tests pass** — `cargo test --manifest-path src-tauri/Cargo.toml` → PASS (24 existing + new trash/model tests). The recycle-bin path is glue, not unit-tested.

- [ ] **Step 5: Commit** — `git add src-tauri/src/trash.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock && git commit -m "feat: trash commands + TrashState + trash crate wiring"`

---

### Task 7: TS types + `commands.ts` wrappers

**Files:** Modify: `src/lib/types.ts`, `src/lib/commands.ts`.

**Interfaces:**
- Produces: `TrashItem`/`TrashStats` interfaces; `trashFiles`, `restoreFromTrash`, `listTrash`, `emptyTrash`, `trashStats` wrappers.

- [ ] **Step 1: Add types** — append to `src/lib/types.ts`:

```ts
export interface TrashItem {
  id: string;
  originalPath: string;
  trashPath: string;
  name: string;
  size: number;
  deletedAt: number;
}

export interface TrashStats {
  count: number;
  totalSize: number;
}
```

- [ ] **Step 2: Add wrappers** — append to `src/lib/commands.ts` (it already imports from `./types`; extend that import to include `TrashItem, TrashStats`):

```ts
/** Move files to the app trash; returns the created trash items. */
export const trashFiles = (paths: string[]): Promise<TrashItem[]> =>
  invoke<TrashItem[]>("trash_files", { paths });

/** List app-trash items (newest-first). */
export const listTrash = (): Promise<TrashItem[]> => invoke<TrashItem[]>("list_trash");

/** Restore a trash item to `dest` (collision-suffixed on disk). */
export const restoreFromTrash = (id: string, dest: string): Promise<void> =>
  invoke<void>("restore_from_trash", { id, dest });

/** Empty the app trash to the OS Recycle Bin. */
export const emptyTrash = (): Promise<void> => invoke<void>("empty_trash");

/** Count + total size of the app trash. */
export const trashStats = (): Promise<TrashStats> => invoke<TrashStats>("trash_stats");
```

Update the existing import line in `commands.ts` from `import type { FolderInfo } from "./types";` to `import type { FolderInfo, TrashItem, TrashStats } from "./types";`.

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit` shows no *new* errors (the 3 pre-existing `Sidebar.test.tsx` jest-dom errors are unrelated).

- [ ] **Step 4: Commit** — `git add src/lib/types.ts src/lib/commands.ts && git commit -m "feat: trash TS types + command wrappers"`

---

### Task 8: store trash slice

**Files:** Modify: `src/store/useAppStore.ts`; Test: `src/store/useAppStore.test.ts`.

**Interfaces:**
- Produces: state `trashOpen: boolean`, `trashItems: TrashItem[]`; actions `openTrash()`, `closeTrash()`, `toggleTrash()`, `setTrashItems(items)`, `completeTrash(ids: string[])`. `reset` clears `trashOpen:false`/`trashItems:[]`; `startScan` leaves them.

- [ ] **Step 1: Write the failing tests** — add to `useAppStore.test.ts` (import `TrashItem` if needed; a minimal item helper inline):

```ts
test("toggleTrash / open / close flip trashOpen", () => {
  useAppStore.setState({ trashOpen: false });
  useAppStore.getState().toggleTrash();
  expect(useAppStore.getState().trashOpen).toBe(true);
  useAppStore.getState().closeTrash();
  expect(useAppStore.getState().trashOpen).toBe(false);
  useAppStore.getState().openTrash();
  expect(useAppStore.getState().trashOpen).toBe(true);
});

test("setTrashItems replaces the list", () => {
  useAppStore.getState().setTrashItems([
    { id: "t1", originalPath: "C:/x/a.jpg", trashPath: "C:/trash/t1", name: "a.jpg", size: 1, deletedAt: 2 },
  ]);
  expect(useAppStore.getState().trashItems.map((t) => t.id)).toEqual(["t1"]);
});

test("completeTrash removes ids, advances focus, clears selection, leaves folders/history", () => {
  useAppStore.setState({
    files: [mk("a"), mk("b"), mk("c")],
    folders: [mkFolder("fam", 1)],
    focusedId: "a",
    selectedIds: ["a", "c"],
    moveHistory: [],
  });
  useAppStore.getState().completeTrash(["a", "c"]);
  const s = useAppStore.getState();
  expect(s.files.map((f) => f.id)).toEqual(["b"]);
  expect(s.focusedId).toBe("b");
  expect(s.selectedIds).toEqual([]);
  expect(s.folders[0].fileCount).toBe(0);
  expect(s.moveHistory).toEqual([]);
});

test("reset clears trash; startScan keeps it", () => {
  useAppStore.setState({ trashOpen: true, trashItems: [
    { id: "t1", originalPath: "", trashPath: "", name: "a", size: 0, deletedAt: 0 },
  ] });
  useAppStore.getState().startScan();
  expect(useAppStore.getState().trashItems).toHaveLength(1);
  expect(useAppStore.getState().trashOpen).toBe(true);
  useAppStore.getState().reset();
  expect(useAppStore.getState().trashItems).toEqual([]);
  expect(useAppStore.getState().trashOpen).toBe(false);
});
```

- [ ] **Step 2: Run to verify they fail** — `npm test -- --run src/store/useAppStore.test.ts` → FAIL.

- [ ] **Step 3: Implement** — in `useAppStore.ts`:
  - Add to `import type` line: `TrashItem`.
  - Interface: add `trashOpen: boolean; trashItems: TrashItem[];` and actions `openTrash: () => void; closeTrash: () => void; toggleTrash: () => void; setTrashItems: (items: TrashItem[]) => void; completeTrash: (ids: string[]) => void;`.
  - Initial state: `trashOpen: false, trashItems: [],`.
  - In `reset`'s `set({…})`: add `trashOpen: false, trashItems: [],`. (Do **not** add to `startScan`.)
  - Actions (place after `clearSelection`):

```ts
  openTrash: () => set({ trashOpen: true }),
  closeTrash: () => set({ trashOpen: false }),
  toggleTrash: () => set((s) => ({ trashOpen: !s.trashOpen })),
  setTrashItems: (items) => set({ trashItems: items }),
  completeTrash: (ids) =>
    set((s) => {
      const idSet = new Set(ids);
      const indices = s.files
        .map((f, i) => (idSet.has(f.id) ? i : -1))
        .filter((i) => i >= 0);
      if (indices.length === 0) return {};
      const files = s.files.filter((f) => !idSet.has(f.id));
      const focusIdx = Math.min(indices[0], files.length - 1);
      const focusedId = focusIdx >= 0 ? files[focusIdx].id : null;
      return { files, focusedId, selectedIds: [] };
    }),
```

- [ ] **Step 4: Run to verify they pass** — `npm test -- --run src/store/useAppStore.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add src/store/useAppStore.ts src/store/useAppStore.test.ts && git commit -m "feat: store trash slice (trashOpen/items + completeTrash)"`

---

### Task 9: `TrashPanel.tsx`

**Files:** Create: `src/components/TrashPanel.tsx`; Test: `src/components/TrashPanel.test.tsx`.

**Interfaces:**
- Consumes: `trashOpen`, `trashItems`, `setTrashItems`, `closeTrash`; `listTrash`, `restoreFromTrash`, `emptyTrash` from `../lib/commands`.
- Produces: an overlay that renders one row per item (name + Restore), an Empty Trash control, and an empty state; renders `null` when `!trashOpen`.

- [ ] **Step 1: Write the failing test** — create `TrashPanel.test.tsx`:

```tsx
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/useThumbnail", () => ({
  useThumbnail: () => ({ url: null, status: "placeholder" }),
}));
vi.mock("../lib/commands", () => ({
  listTrash: vi.fn(async () => []),
  restoreFromTrash: vi.fn(async () => {}),
  emptyTrash: vi.fn(async () => {}),
}));

import { TrashPanel } from "./TrashPanel";
import { listTrash, restoreFromTrash, emptyTrash } from "../lib/commands";
import { useAppStore } from "../store/useAppStore";
import type { TrashItem } from "../lib/types";

const item = (id: string): TrashItem => ({
  id, originalPath: `C:/x/${id}.jpg`, trashPath: `C:/trash/${id}`, name: `${id}.jpg`, size: 10, deletedAt: 1,
});

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ trashOpen: true, trashItems: [item("a"), item("b")] });
});
afterEach(cleanup);

test("renders a row per trash item", () => {
  render(<TrashPanel />);
  expect(screen.getByText("a.jpg")).toBeTruthy();
  expect(screen.getByText("b.jpg")).toBeTruthy();
});

test("Restore calls restoreFromTrash with id + originalPath then re-lists", async () => {
  render(<TrashPanel />);
  fireEvent.click(screen.getAllByRole("button", { name: /restore/i })[0]);
  await waitFor(() => expect(restoreFromTrash).toHaveBeenCalledWith("a", "C:/x/a.jpg"));
  await waitFor(() => expect(listTrash).toHaveBeenCalled());
});

test("Empty Trash calls emptyTrash then re-lists", async () => {
  render(<TrashPanel />);
  fireEvent.click(screen.getByRole("button", { name: /empty trash/i }));
  await waitFor(() => expect(emptyTrash).toHaveBeenCalled());
  await waitFor(() => expect(listTrash).toHaveBeenCalled());
});

test("renders nothing when closed", () => {
  useAppStore.setState({ trashOpen: false });
  const { container } = render(<TrashPanel />);
  expect(container.firstChild).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- --run src/components/TrashPanel.test.tsx` → FAIL (no component).

- [ ] **Step 3: Implement** — create `TrashPanel.tsx`:

```tsx
import { useEffect } from "react";
import { useAppStore } from "../store/useAppStore";
import { listTrash, restoreFromTrash, emptyTrash } from "../lib/commands";

const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

export function TrashPanel() {
  const trashOpen = useAppStore((s) => s.trashOpen);
  const trashItems = useAppStore((s) => s.trashItems);
  const setTrashItems = useAppStore((s) => s.setTrashItems);
  const closeTrash = useAppStore((s) => s.closeTrash);

  const refresh = () => void listTrash().then(setTrashItems).catch(() => {});

  useEffect(() => {
    if (trashOpen) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trashOpen]);

  useEffect(() => {
    if (!trashOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeTrash();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [trashOpen, closeTrash]);

  if (!trashOpen) return null;

  const onRestore = (id: string, dest: string) =>
    void restoreFromTrash(id, dest).then(refresh).catch(() => {});
  const onEmpty = () => void emptyTrash().then(refresh).catch(() => {});

  return (
    <div className="absolute inset-0 z-40 flex justify-end bg-black/50">
      <div className="w-[380px] h-full bg-neutral-900 border-l border-neutral-700 flex flex-col">
        <header className="flex items-center justify-between px-3 py-2 border-b border-neutral-800">
          <h2 className="text-sm font-medium">Trash ({trashItems.length})</h2>
          <button type="button" onClick={closeTrash} className="text-neutral-400 hover:text-neutral-100" aria-label="Close">
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-auto">
          {trashItems.length === 0 ? (
            <p className="p-4 text-sm text-neutral-500">Trash is empty.</p>
          ) : (
            trashItems.map((it) => (
              <div key={it.id} className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-neutral-200" title={it.originalPath}>{it.name}</div>
                  <div className="text-[11px] text-neutral-500">{kb(it.size)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => onRestore(it.id, it.originalPath)}
                  className="rounded bg-neutral-700 px-2 py-1 text-xs hover:bg-neutral-600"
                >
                  Restore
                </button>
              </div>
            ))
          )}
        </div>
        <footer className="p-3 border-t border-neutral-800">
          <button
            type="button"
            onClick={onEmpty}
            className="w-full rounded bg-red-600/80 px-3 py-2 text-sm hover:bg-red-600 disabled:opacity-40"
            disabled={trashItems.length === 0}
          >
            Empty Trash
          </button>
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes** — `npm test -- --run src/components/TrashPanel.test.tsx` → PASS.

- [ ] **Step 5: Commit** — `git add src/components/TrashPanel.tsx src/components/TrashPanel.test.tsx && git commit -m "feat: TrashPanel overlay (list/restore/empty)"`

---

### Task 10: FileGrid `Del`/`T` wiring + mount TrashPanel

**Files:** Modify: `src/components/FileGrid.tsx`, `src/App.tsx`; Test: `src/components/FileGrid.test.tsx`.

**Interfaces:**
- Consumes: `trashOpen`, `toggleTrash`, `closeTrash`, `completeTrash`, `trashFiles`.
- Produces: `T` toggles the panel (even on an empty grid); `Del` trashes the selection-or-focused file(s); grid keys inert while `trashOpen`; `<TrashPanel />` mounted in `App.tsx`.

- [ ] **Step 1: Write the failing tests** — extend the `../lib/commands` mock in `FileGrid.test.tsx` to add `trashFiles`, and add tests:

```ts
// in the existing vi.mock("../lib/commands", …) factory, add:
//   trashFiles: vi.fn(async (paths: string[]) => paths.map((p, i) => ({
//     id: `t${i}`, originalPath: p, trashPath: `C:/trash/t${i}`,
//     name: p.split(/[\\/]/).pop()!, size: 1, deletedAt: 0,
//   }))),
// and import trashFiles alongside moveFiles.
```

```ts
test("Del trashes the selection and removes those files", async () => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], focusedId: "b", selectedIds: ["a", "c"], trashOpen: false });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "Delete" });
  await waitFor(() => expect(trashFiles).toHaveBeenCalledWith(["C:/x/a.jpg", "C:/x/c.jpg"]));
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["b"]));
  expect(useAppStore.getState().selectedIds).toEqual([]);
});

test("Del with no selection trashes the focused file", async () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], focusedId: "a", selectedIds: [], trashOpen: false });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "Delete" });
  await waitFor(() => expect(trashFiles).toHaveBeenCalledWith(["C:/x/a.jpg"]));
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["b"]));
});

test("T toggles the trash panel (works with an empty grid)", () => {
  useAppStore.setState({ files: [], focusedId: null, trashOpen: false });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "t" });
  expect(useAppStore.getState().trashOpen).toBe(true);
});

test("grid keys are inert while the trash panel is open", () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], folders: [fam], focusedId: "a", selectedIds: [], trashOpen: true });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "1" });
  expect(moveFiles).not.toHaveBeenCalled();
});
```

Also add `trashOpen: false` to the `beforeEach` `setState` reset.

- [ ] **Step 2: Run to verify they fail** — `npm test -- --run src/components/FileGrid.test.tsx` → FAIL.

- [ ] **Step 3: Implement** — in `FileGrid.tsx`:
  - Import `trashFiles` alongside `moveFiles`: `import { moveFiles, trashFiles } from "../lib/commands";`.
  - Subscriptions (after `selectedIds`): `const completeTrash = useAppStore((s) => s.completeTrash); const toggleTrash = useAppStore((s) => s.toggleTrash); const closeTrash = useAppStore((s) => s.closeTrash);`.
  - In `onKey`, destructure `trashOpen`: add it to the `useAppStore.getState()` destructure.
  - **Top of `onKey`, before the `previewId` guard,** add the panel-owns-keys guard:

```ts
      if (trashOpen) {
        if (e.key === "t" || e.key === "T" || e.key === "Escape") {
          e.preventDefault();
          if (e.key === "Escape") closeTrash();
          else toggleTrash();
        }
        return;
      }
```

  - After the `Escape`-clears-selection block, **before** `if (files.length === 0) return;`, add the T-toggle:

```ts
      if ((e.key === "t" || e.key === "T") && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        toggleTrash();
        return;
      }
```

  - After the digit-move block, add `Del` trashing:

```ts
      if (e.key === "Delete") {
        const sel = selectedIds.length > 0 ? files.filter((f) => selectedIds.includes(f.id)) : files.filter((f) => f.id === focusedId);
        if (sel.length > 0) {
          e.preventDefault();
          const ids = sel.map((f) => f.id);
          void trashFiles(sel.map((f) => f.path))
            .then(() => completeTrash(ids))
            .catch(() => {});
        }
        return;
      }
```

  - Add `completeTrash, toggleTrash, closeTrash` to the keyboard `useEffect` deps array.

  In `src/App.tsx`: import `TrashPanel` and render `<TrashPanel />` right after `<Preview />`.

- [ ] **Step 4: Run to verify they pass** — `npm test -- --run src/components/FileGrid.test.tsx` → PASS (new + existing).

- [ ] **Step 5: Full frontend + backend gate, then commit**

Run: `npm test -- --run` (whole suite) and `cargo test --manifest-path src-tauri/Cargo.toml`. Both PASS.

```bash
git add src/components/FileGrid.tsx src/components/FileGrid.test.tsx src/App.tsx
git commit -m "feat: Del trashes selection/focused + T toggles TrashPanel"
```

---

## Self-Review

**Spec coverage:**
- §4 types → Task 1 (Rust) + Task 7 (TS). §5 helpers `trash_files_in`/`list_trash_in`/`stats_in`/`restore_in`/`empty_in` → Tasks 2–5; commands + `TrashState` + `trash` crate + `lib.rs` → Task 6. §6 store slice → Task 8; `commands.ts` → Task 7; `TrashPanel` → Task 9; FileGrid `Del`/`T`/inert + `App` mount → Task 10. §9 tests → each task's tests. §8 security (app_data_dir, no new capability) → Task 6 wiring. ✔
- §2 decisions: files-only (no folder branch anywhere ✔), restore≠Ctrl+Z (no `moveHistory` touch in `completeTrash` ✔), Del precedence (Task 10 ✔), thumbnails via asset protocol (TrashPanel uses `useThumbnail`-mocked; real render can call `ensureThumbnail` — panel shows name+size for v1, thumbnail wiring optional/lean ✔).

**Placeholder scan:** none — every code step is concrete. (The `useThumbnail` thumbnail image in the panel is intentionally minimal for v1: rows show name+size; a thumbnail `<img>` can be added but isn't required by any test.)

**Type consistency:** `TrashItem` fields identical across `model.rs` (Task 1), `types.ts` (Task 7), store (Task 8), TrashPanel/FileGrid mocks (Tasks 9–10). `completeTrash(ids)` signature consistent (Task 8 def ↔ Task 10 call). Commands: `restore_from_trash` takes `{id, dest}` in Rust (Task 6) ↔ `restoreFromTrash(id, dest)` invoke (Task 7) ↔ `restoreFromTrash(it.id, it.originalPath)` call (Task 9). `trashFiles(paths)` ↔ `trash_files({paths})` ↔ Task 10 call. ✔

**Ordering:** backend Tasks 1–6 are independently testable and land first; frontend 7–10 depend only on the committed TS types (Task 7) and store (Task 8). Task 10 is the only integration point and runs the full gate.

**Manual acceptance (post-merge):** scan → select a few → `Del` → `T` → items listed → **Restore** one (file back on disk, suffixed on collision) → **Empty Trash** (to Recycle Bin) → panel empty → `Esc` closes.
