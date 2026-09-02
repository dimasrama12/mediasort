# Target Folders + Move-on-Keypress — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Map up to nine destination folders to number keys 1–9; pressing a number moves the focused file into that folder (focus advances), with Ctrl+Z to undo the last move — MediaSort's core one-pass sorting loop.

**Architecture:** Rust owns the target-folder list + 1–9 mapping (`folders.rs`, managed `Mutex<Vec<FolderInfo>>`) and the raw move (`fileops.rs`); the frontend mirrors folders into a Zustand slice and drives moves from the grid's keyboard handler. A minimal left `Sidebar` shows the key→folder legend and creates folders. Undo is a lean move-only stack in the store (no full command-pattern history yet).

**Tech Stack:** Rust + Tauri v2 (`std::fs`, serde), React 19 + TypeScript, Zustand, TanStack Virtual, Vitest + `@testing-library/react`, `cargo test` (+ `tempfile`).

**Spec:** [`../specs/2026-09-02-target-folders-move-on-keypress-design.md`](../specs/2026-09-02-target-folders-move-on-keypress-design.md) — the plan argues from the spec; executors read both.

## Global Constraints

- **Dedup by `normalize_path`** (`paths.rs`, `fn normalize_path(p: &str) -> String`): a re-created target path must reuse the existing entry — never a duplicate (v1 bug #1). This is the identity key for `FolderInfo.id`.
- **Keyboard:** bare `1`–`9` (no ctrl/alt/meta) move the focused file to that shortcut's folder; `Ctrl+Z` undoes the last move. **Inert while the Preview is open** (`previewId != null`) and **ignored while typing in an `INPUT`/`TEXTAREA`/contentEditable**.
- **No new Tauri fs capability** — moves/folder creation run in Rust `std::fs`, which capabilities don't gate. Destinations live under the scanned root (already asset-scoped in slice #4).
- **Session-only state** — target folders + undo stack are not persisted (that's slice 10). `serde(rename_all = "camelCase")` on all IPC structs (matches `FileInfo`).
- **Tests:** a task isn't done until its suite passes. Rust: `cargo test --manifest-path src-tauri/Cargo.toml`. Frontend: `npm test -- --run`. The final task is the manual run.
- **Unchanged:** `CARD` stays 160; #5a focus nav / #4 preview keys are preserved.

---

## File Structure

**Created:**
- `src-tauri/src/folders.rs` — `FolderState`, `create_folder`, `list_target_folders`, `upsert_target` core + tests.
- `src-tauri/src/fileops.rs` — `move_files` command + `move_one` core + tests.
- `src/components/Sidebar.tsx` — base path, New-folder control, 1–9 legend.
- `src/components/Sidebar.test.tsx` — Vitest for the sidebar.

**Modified:**
- `src-tauri/src/model.rs` — add `FolderInfo`.
- `src-tauri/src/lib.rs` — declare modules, `.manage` `FolderState`, register the three commands.
- `src/lib/types.ts` — add `FolderInfo`.
- `src/lib/commands.ts` — `createFolder`, `listTargetFolders`, `moveFiles`.
- `src/store/useAppStore.ts` — `folders`/`roots`/`moveHistory` state + `setRoots`/`setFolders`/`upsertFolder`/`completeMove`/`completeUndo`; clear on `startScan`/`reset`.
- `src/store/useAppStore.test.ts` — reducer tests.
- `src/components/Toolbar.tsx` — `setRoots(dirs)` before `startScan`.
- `src/components/FileGrid.tsx` — extend the keydown handler with 1–9 move + Ctrl+Z + form-field guard.
- `src/components/FileGrid.test.tsx` — move/undo keyboard tests.
- `src/App.tsx` — sidebar layout.

---

## Task 1: `model.rs` — `FolderInfo` (TDD)

**Files:**
- Modify: `src-tauri/src/model.rs`

**Interfaces:**
- Produces: `FolderInfo { id, name, path, shortcut: u8, file_count: u32 }`, serde `camelCase`.

- [ ] **Step 1: Add a failing serialization test** — append inside `model.rs`'s existing `#[cfg(test)] mod tests { ... }`:

```rust
    #[test]
    fn folderinfo_serializes_camelcase() {
        let f = FolderInfo {
            id: "d:\\a\\family".into(),
            name: "family".into(),
            path: "D:\\a\\family".into(),
            shortcut: 1,
            file_count: 3,
        };
        let j = serde_json::to_string(&f).unwrap();
        assert!(j.contains("\"fileCount\":3"));
        assert!(j.contains("\"shortcut\":1"));
    }
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cargo test --manifest-path src-tauri/Cargo.toml folderinfo_serializes_camelcase`
Expected: FAIL (compile error — `FolderInfo` undefined).

- [ ] **Step 3: Add the struct** — after the `FileInfo` struct in `model.rs`:

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FolderInfo {
    pub id: String,        // = normalize_path(path) — stable, unique, the dedup key
    pub name: String,      // leaf folder name (display)
    pub path: String,      // absolute path (as created)
    pub shortcut: u8,      // 1..=9
    pub file_count: u32,   // files moved into it this session
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cargo test --manifest-path src-tauri/Cargo.toml folderinfo_serializes_camelcase`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/model.rs
git commit -m "feat: FolderInfo model (camelCase serde)"
```

---

## Task 2: `folders.rs` — target-folder registry (TDD)

**Files:**
- Create: `src-tauri/src/folders.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `crate::model::FolderInfo`, `crate::paths::normalize_path`.
- Produces: `FolderState(pub Mutex<Vec<FolderInfo>>)`; `upsert_target(list: &mut Vec<FolderInfo>, base: &str, name: &str) -> Result<FolderInfo, String>`; commands `create_folder(state, base, name) -> Result<FolderInfo, String>`, `list_target_folders(state) -> Result<Vec<FolderInfo>, String>`.

- [ ] **Step 1: Create `src-tauri/src/folders.rs`** with the core + tests:

```rust
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
```

- [ ] **Step 2: Declare the module in `lib.rs`** — add `mod folders;` with the other `mod` lines (keep alphabetical: after `mod fileops;` once Task 3 lands, but adding it now is fine):

```rust
mod folders;
```

- [ ] **Step 3: Run — expect PASS** (the module compiles and its tests run once declared)

Run: `cargo test --manifest-path src-tauri/Cargo.toml folders`
Expected: 5 passed.

- [ ] **Step 4: Wire the commands + state in `lib.rs`** — add `.manage(folders::FolderState::default())` after the existing `.manage(scan::ScanState::default())`, and add the two commands to `generate_handler!`:

```rust
            folders::create_folder,
            folders::list_target_folders,
```

- [ ] **Step 5: Run — expect PASS** (whole crate still compiles + tests green)

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all green (existing + 5 new).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/folders.rs src-tauri/src/lib.rs
git commit -m "feat: folders.rs target registry (dedup by normalize_path, 1-9 shortcuts)"
```

---

## Task 3: `fileops.rs` — move files (TDD)

**Files:**
- Create: `src-tauri/src/fileops.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: `move_one(src: &str, dest_dir: &str) -> Result<PathBuf, String>`; command `move_files(paths: Vec<String>, dest: String) -> Result<Vec<String>, String>`.

- [ ] **Step 1: Create `src-tauri/src/fileops.rs`** with the core + tests:

```rust
//! File moves for target-folder sorting: rename fast-path, cross-volume
//! copy-then-delete fallback, `_N` collision suffix.

use std::path::{Path, PathBuf};

/// Move one file into `dest_dir`, returning its new absolute path.
pub fn move_one(src: &str, dest_dir: &str) -> Result<PathBuf, String> {
    let src_path = Path::new(src);
    let file_name = src_path
        .file_name()
        .ok_or_else(|| format!("no file name in {src}"))?;
    let dest_dir_path = Path::new(dest_dir);
    std::fs::create_dir_all(dest_dir_path).map_err(|e| e.to_string())?;

    let mut target = dest_dir_path.join(file_name);
    if target.exists() {
        let stem = src_path.file_stem().unwrap_or_default().to_string_lossy().to_string();
        let ext = src_path.extension().map(|e| e.to_string_lossy().to_string());
        let mut n = 1;
        loop {
            let candidate = dest_dir_path.join(match &ext {
                Some(e) => format!("{stem}_{n}.{e}"),
                None => format!("{stem}_{n}"),
            });
            if !candidate.exists() {
                target = candidate;
                break;
            }
            n += 1;
        }
    }

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
}
```

- [ ] **Step 2: Declare + wire in `lib.rs`** — add `mod fileops;` with the other modules, and add `fileops::move_files,` to `generate_handler!`.

- [ ] **Step 3: Run — expect PASS**

Run: `cargo test --manifest-path src-tauri/Cargo.toml fileops`
Expected: 2 passed.

- [ ] **Step 4: Run the whole crate — expect PASS**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/fileops.rs src-tauri/src/lib.rs
git commit -m "feat: fileops.rs move_files (rename + _N collision + cross-volume fallback)"
```

---

## Task 4: Store folders slice + roots capture (TDD)

**Files:**
- Modify: `src/lib/types.ts`, `src/store/useAppStore.ts`, `src/store/useAppStore.test.ts`, `src/components/Toolbar.tsx`

**Interfaces:**
- Produces (TS): `FolderInfo`; store `folders: FolderInfo[]`, `roots: string[]`, `moveHistory: MoveRecord[]`, and actions `setRoots`, `setFolders`, `upsertFolder`, `completeMove(index, folderId, toPath)`, `completeUndo(backPath)`.

- [ ] **Step 1: Add the `FolderInfo` type** — append to `src/lib/types.ts`:

```ts
export interface FolderInfo {
  id: string;
  name: string;
  path: string;
  shortcut: number; // 1..9
  fileCount: number;
}
```

- [ ] **Step 2: Append failing store tests** — `src/store/useAppStore.test.ts` (reuses the file's existing `mk(id)` helper + vitest imports; add a local `mkFolder`):

```ts
import type { FolderInfo } from "../lib/types";

const mkFolder = (id: string, shortcut: number): FolderInfo => ({
  id, name: id, path: `C:/base/${id}`, shortcut, fileCount: 0,
});

test("completeMove removes the file, advances focus, bumps count, records history", () => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], folders: [mkFolder("fam", 1)], focusedId: "a", moveHistory: [] });
  useAppStore.getState().completeMove(0, "fam", "C:/base/fam/a.jpg");
  const s = useAppStore.getState();
  expect(s.files.map((f) => f.id)).toEqual(["b", "c"]);
  expect(s.focusedId).toBe("b");
  expect(s.folders[0].fileCount).toBe(1);
  expect(s.moveHistory).toHaveLength(1);
  expect(s.moveHistory[0].fromIndex).toBe(0);
});

test("completeMove on the last file focuses the new last", () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], folders: [mkFolder("fam", 1)], focusedId: "b", moveHistory: [] });
  useAppStore.getState().completeMove(1, "fam", "C:/base/fam/b.jpg");
  expect(useAppStore.getState().focusedId).toBe("a");
});

test("completeMove emptying the grid clears focus", () => {
  useAppStore.setState({ files: [mk("a")], folders: [mkFolder("fam", 1)], focusedId: "a", moveHistory: [] });
  useAppStore.getState().completeMove(0, "fam", "C:/base/fam/a.jpg");
  expect(useAppStore.getState().focusedId).toBeNull();
});

test("completeUndo re-inserts at original index, refocuses, decrements count", () => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], folders: [mkFolder("fam", 1)], focusedId: "a", moveHistory: [] });
  useAppStore.getState().completeMove(0, "fam", "C:/base/fam/a.jpg");
  useAppStore.getState().completeUndo("C:/x/a.jpg");
  const s = useAppStore.getState();
  expect(s.files.map((f) => f.id)).toEqual(["a", "b", "c"]);
  expect(s.focusedId).toBe("a");
  expect(s.folders[0].fileCount).toBe(0);
  expect(s.moveHistory).toHaveLength(0);
});

test("upsertFolder replaces by id and stays sorted by shortcut", () => {
  useAppStore.setState({ folders: [] });
  useAppStore.getState().upsertFolder(mkFolder("b", 2));
  useAppStore.getState().upsertFolder(mkFolder("a", 1));
  expect(useAppStore.getState().folders.map((f) => f.shortcut)).toEqual([1, 2]);
  useAppStore.getState().upsertFolder({ ...mkFolder("a", 1), fileCount: 5 });
  expect(useAppStore.getState().folders.find((f) => f.id === "a")!.fileCount).toBe(5);
  expect(useAppStore.getState().folders).toHaveLength(2); // replaced, not duplicated
});

test("setRoots records; startScan clears folders/history but keeps roots; reset clears roots", () => {
  useAppStore.getState().setRoots(["C:/x"]);
  useAppStore.setState({ folders: [mkFolder("fam", 1)], moveHistory: [{ file: mk("a"), folderId: "fam", fromDir: "C:/x", toPath: "C:/base/fam/a.jpg", fromIndex: 0 }] });
  useAppStore.getState().startScan();
  expect(useAppStore.getState().roots).toEqual(["C:/x"]);
  expect(useAppStore.getState().folders).toEqual([]);
  expect(useAppStore.getState().moveHistory).toEqual([]);
  useAppStore.getState().reset();
  expect(useAppStore.getState().roots).toEqual([]);
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `npm test -- --run src/store/useAppStore.test.ts`
Expected: FAIL (`completeMove` etc. are not functions).

- [ ] **Step 4: Implement the slice** — edit `src/store/useAppStore.ts`:

Add the import and a `MoveRecord` type + `dirname` helper at the top (after the existing `import type { FileInfo }`):

```ts
import type { FileInfo, FolderInfo } from "../lib/types";

interface MoveRecord {
  file: FileInfo;
  folderId: string;
  fromDir: string;
  toPath: string;
  fromIndex: number;
}

const dirname = (p: string) => {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(0, i) : p;
};
```

Add to the `AppState` interface:

```ts
  folders: FolderInfo[];
  roots: string[];
  moveHistory: MoveRecord[];
  setRoots: (roots: string[]) => void;
  setFolders: (folders: FolderInfo[]) => void;
  upsertFolder: (f: FolderInfo) => void;
  completeMove: (index: number, folderId: string, toPath: string) => void;
  completeUndo: (backPath: string) => void;
```

Add to the initial state: `folders: [], roots: [], moveHistory: [],`. Add `folders: [], moveHistory: [],` to the `set({...})` in **`startScan`** (leave `roots` alone). Add `folders: [], moveHistory: [], roots: [],` to the `set({...})` in **`reset`**. Then add the actions:

```ts
  setRoots: (roots) => set({ roots }),
  setFolders: (folders) => set({ folders }),
  upsertFolder: (f) =>
    set((s) => ({
      folders: [...s.folders.filter((x) => x.id !== f.id), f].sort(
        (a, b) => a.shortcut - b.shortcut,
      ),
    })),
  completeMove: (index, folderId, toPath) =>
    set((s) => {
      const file = s.files[index];
      if (!file) return {};
      const files = s.files.filter((_, i) => i !== index);
      const focusIdx = Math.min(index, files.length - 1);
      const focusedId = focusIdx >= 0 ? files[focusIdx].id : null;
      const folders = s.folders.map((f) =>
        f.id === folderId ? { ...f, fileCount: f.fileCount + 1 } : f,
      );
      const record: MoveRecord = { file, folderId, fromDir: dirname(file.path), toPath, fromIndex: index };
      return { files, focusedId, folders, moveHistory: [...s.moveHistory, record] };
    }),
  completeUndo: (backPath) =>
    set((s) => {
      const record = s.moveHistory[s.moveHistory.length - 1];
      if (!record) return {};
      const restored = { ...record.file, path: backPath };
      const at = Math.min(record.fromIndex, s.files.length);
      const files = [...s.files.slice(0, at), restored, ...s.files.slice(at)];
      const folders = s.folders.map((f) =>
        f.id === record.folderId ? { ...f, fileCount: Math.max(0, f.fileCount - 1) } : f,
      );
      return { files, focusedId: restored.id, folders, moveHistory: s.moveHistory.slice(0, -1) };
    }),
```

- [ ] **Step 5: Run — expect PASS**

Run: `npm test -- --run src/store/useAppStore.test.ts`
Expected: all green (existing store/preview/focus tests + the 6 new).

- [ ] **Step 6: Capture roots in `Toolbar.tsx`** — pull `setRoots` from the store and call it before `startScan`:

```tsx
  const { scanning, files, scanned, startScan, setRoots } = useAppStore();

  async function onScan() {
    const dirs = await pickFolders();
    if (!dirs) return;
    setRoots(dirs);
    startScan();
    await scanFolders(dirs);
  }
```

- [ ] **Step 7: Run the full suite — expect PASS**

Run: `npm test -- --run`
Expected: all green (Toolbar wiring is covered by the store's `setRoots` test + the manual run).

- [ ] **Step 8: Commit**

```bash
git add src/lib/types.ts src/store/useAppStore.ts src/store/useAppStore.test.ts src/components/Toolbar.tsx
git commit -m "feat: store folders slice (folders/roots/moveHistory + move/undo reducers)"
```

---

## Task 5: Command wrappers + Sidebar + layout (TDD)

**Files:**
- Create: `src/components/Sidebar.tsx`, `src/components/Sidebar.test.tsx`
- Modify: `src/lib/commands.ts`, `src/App.tsx`

**Interfaces:**
- Consumes: `useAppStore` (`folders`, `roots`, `upsertFolder`); `createFolder` from `commands`.
- Produces: `createFolder(base, name) -> Promise<FolderInfo>`, `listTargetFolders() -> Promise<FolderInfo[]>`, `moveFiles(paths, dest) -> Promise<string[]>`; `<Sidebar />`.

- [ ] **Step 1: Add the command wrappers** — append to `src/lib/commands.ts` (add the type import at the top):

```ts
import type { FolderInfo } from "./types";

export const createFolder = (base: string, name: string): Promise<FolderInfo> =>
  invoke<FolderInfo>("create_folder", { base, name });

export const listTargetFolders = (): Promise<FolderInfo[]> =>
  invoke<FolderInfo[]>("list_target_folders");

export const moveFiles = (paths: string[], dest: string): Promise<string[]> =>
  invoke<string[]>("move_files", { paths, dest });
```

- [ ] **Step 2: Write failing Sidebar tests** — `src/components/Sidebar.test.tsx`:

```tsx
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/commands", () => ({
  createFolder: vi.fn(async (_base: string, name: string) => ({
    id: name.toLowerCase(), name, path: `C:/base/${name}`, shortcut: 1, fileCount: 0,
  })),
}));

import { Sidebar } from "./Sidebar";
import { createFolder } from "../lib/commands";
import { useAppStore } from "../store/useAppStore";
import type { FolderInfo } from "../lib/types";

const mkFolder = (id: string, shortcut: number): FolderInfo => ({
  id, name: id, path: `C:/base/${id}`, shortcut, fileCount: 0,
});

afterEach(cleanup);

test("renders the 1-9 legend from the store", () => {
  useAppStore.setState({ folders: [mkFolder("fam", 1), mkFolder("work", 2)], roots: ["C:/base"] });
  render(<Sidebar />);
  expect(screen.getByText("fam")).toBeInTheDocument();
  expect(screen.getByText("work")).toBeInTheDocument();
});

test("New folder creates via command and adds it to the store", async () => {
  useAppStore.setState({ folders: [], roots: ["C:/base"] });
  render(<Sidebar />);
  fireEvent.click(screen.getByText("New folder"));
  fireEvent.change(screen.getByPlaceholderText("Folder name"), { target: { value: "Keep" } });
  fireEvent.keyDown(screen.getByPlaceholderText("Folder name"), { key: "Enter" });
  await waitFor(() => expect(createFolder).toHaveBeenCalledWith("C:/base", "Keep"));
  await waitFor(() => expect(useAppStore.getState().folders.map((f) => f.name)).toContain("Keep"));
});

test("New folder is disabled once nine folders exist", () => {
  const nine = Array.from({ length: 9 }, (_, i) => mkFolder(`f${i}`, i + 1));
  useAppStore.setState({ folders: nine, roots: ["C:/base"] });
  render(<Sidebar />);
  expect(screen.getByText("All 9 keys used")).toBeDisabled();
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `npm test -- --run src/components/Sidebar.test.tsx`
Expected: FAIL (no `Sidebar`).

- [ ] **Step 4: Create `src/components/Sidebar.tsx`:**

```tsx
import { useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { createFolder } from "../lib/commands";

export function Sidebar() {
  const folders = useAppStore((s) => s.folders);
  const roots = useAppStore((s) => s.roots);
  const upsertFolder = useAppStore((s) => s.upsertFolder);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const base = roots[0] ?? "";
  const full = folders.length >= 9;

  async function onCreate() {
    const trimmed = name.trim();
    if (!trimmed || !base) return;
    try {
      upsertFolder(await createFolder(base, trimmed));
      setName("");
      setAdding(false);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <aside className="w-56 shrink-0 border-r border-neutral-800 bg-neutral-900 flex flex-col overflow-auto">
      <div className="p-2 text-[11px] text-neutral-500 truncate" title={base}>
        {base || "No folder scanned"}
      </div>
      <ul className="flex-1">
        {folders.map((f) => (
          <li key={f.id} className="flex items-center gap-2 px-2 py-1 text-sm text-neutral-200">
            <kbd className="w-5 h-5 grid place-items-center rounded bg-neutral-800 text-xs">{f.shortcut}</kbd>
            <span className="flex-1 truncate" title={f.path}>{f.name}</span>
            <span className="text-neutral-500 text-xs">{f.fileCount}</span>
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="p-2 flex flex-col gap-1">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCreate();
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder="Folder name"
            className="px-2 py-1 rounded bg-neutral-800 text-sm outline-none"
          />
          {error && <span className="text-red-400 text-xs">{error}</span>}
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          disabled={full || !base}
          className="m-2 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-sm"
        >
          {full ? "All 9 keys used" : "New folder"}
        </button>
      )}
    </aside>
  );
}
```

- [ ] **Step 5: Run — expect PASS**

Run: `npm test -- --run src/components/Sidebar.test.tsx`
Expected: 3 passed.

- [ ] **Step 6: Add the sidebar to `App.tsx`** — import `Sidebar` and wrap the grid:

```tsx
import { Sidebar } from "./components/Sidebar";
```
```tsx
      <Toolbar />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <FileGrid />
      </div>
      <Preview />
```

- [ ] **Step 7: Run the full suite — expect PASS** (App now renders the Sidebar too)

Run: `npm test -- --run`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/lib/commands.ts src/components/Sidebar.tsx src/components/Sidebar.test.tsx src/App.tsx
git commit -m "feat: Sidebar target-folder legend + New folder, wired into App"
```

---

## Task 6: `FileGrid` — move-on-keypress + undo (TDD)

**Files:**
- Modify: `src/components/FileGrid.tsx`, `src/components/FileGrid.test.tsx`

**Interfaces:**
- Consumes: `useAppStore` (`folders`, `moveHistory`, `completeMove`, `completeUndo`); `moveFiles` from `commands`.
- Produces: keyboard 1–9 move + Ctrl+Z undo (no new exported symbols).

- [ ] **Step 1: Add failing tests** — update `src/components/FileGrid.test.tsx`. Add a `moveFiles` mock alongside the existing `useThumbnail` mock, extend `beforeEach` to reset the new state + clear mocks, and add the tests:

```tsx
vi.mock("../lib/commands", () => ({
  moveFiles: vi.fn(async (paths: string[], dest: string) => [
    `${dest}/${paths[0].split(/[\\/]/).pop()}`,
  ]),
}));
```

Extend the existing `beforeEach` to:

```tsx
beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ files: [], focusedId: null, previewId: null, folders: [], moveHistory: [] });
});
```

Add (import `moveFiles` and `waitFor`):

```tsx
import { moveFiles } from "../lib/commands";

const fam = { id: "fam", name: "fam", path: "C:/base/fam", shortcut: 1, fileCount: 0 };

test("a mapped digit moves the focused file to that folder", async () => {
  useAppStore.setState({ files: [mk("a"), mk("b"), mk("c")], folders: [fam], focusedId: "a" });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "1" });
  await waitFor(() => expect(moveFiles).toHaveBeenCalledWith(["C:/x/a.jpg"], "C:/base/fam"));
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["b", "c"]));
  expect(useAppStore.getState().focusedId).toBe("b");
  expect(useAppStore.getState().folders[0].fileCount).toBe(1);
});

test("an unmapped digit does nothing", () => {
  useAppStore.setState({ files: [mk("a")], folders: [], focusedId: "a" });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "5" });
  expect(moveFiles).not.toHaveBeenCalled();
  expect(useAppStore.getState().files).toHaveLength(1);
});

test("Ctrl+Z moves the last-moved file back", async () => {
  useAppStore.setState({ files: [mk("a"), mk("b")], folders: [fam], focusedId: "a" });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "1" });
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["b"]));
  fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["a", "b"]));
  expect(useAppStore.getState().focusedId).toBe("a");
});

test("digits are inert while the preview is open", () => {
  useAppStore.setState({ files: [mk("a")], folders: [fam], focusedId: "a", previewId: "a" });
  render(<FileGrid />);
  fireEvent.keyDown(window, { key: "1" });
  expect(moveFiles).not.toHaveBeenCalled();
});
```

*(Note: the mock uses `mk(id)`'s path `C:/x/<id>.jpg` from the existing helper.)*

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- --run src/components/FileGrid.test.tsx`
Expected: FAIL (digits don't move; `moveFiles` never called).

- [ ] **Step 3: Replace `src/components/FileGrid.tsx`** with the extended handler:

```tsx
import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAppStore } from "../store/useAppStore";
import { FileCard } from "./FileCard";
import { nextFocusIndex } from "../lib/gridNav";
import { moveFiles } from "../lib/commands";

const CARD = 160; // px cell size

export function FileGrid() {
  const files = useAppStore((s) => s.files);
  const focusedId = useAppStore((s) => s.focusedId);
  const setFocus = useAppStore((s) => s.setFocus);
  const openPreview = useAppStore((s) => s.openPreview);
  const completeMove = useAppStore((s) => s.completeMove);
  const completeUndo = useAppStore((s) => s.completeUndo);
  const parentRef = useRef<HTMLDivElement>(null);
  const columns = Math.max(1, Math.floor((parentRef.current?.clientWidth ?? 1200) / CARD));
  const rows = Math.ceil(files.length / columns);

  const rowVirtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CARD,
    overscan: 6,
  });

  // Default focus to the first file once results exist.
  useEffect(() => {
    if (files.length > 0 && useAppStore.getState().focusedId == null) {
      setFocus(files[0].id);
    }
  }, [files, setFocus]);

  // Keyboard: focus nav (#5a) + move-on-keypress / undo (#5b). Inert while the
  // Preview owns the keyboard, and ignored while typing in a form field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const { files, focusedId, previewId, folders, moveHistory } = useAppStore.getState();
      if (previewId != null) return; // Preview owns Esc / ←/→

      // Undo the last move (Ctrl+Z) — works even if the grid just emptied.
      if (e.ctrlKey && (e.key === "z" || e.key === "Z")) {
        const top = moveHistory[moveHistory.length - 1];
        if (top) {
          e.preventDefault();
          void moveFiles([top.toPath], top.fromDir)
            .then(([backPath]) => completeUndo(backPath))
            .catch(() => {});
        }
        return;
      }

      if (files.length === 0) return;

      // Move the focused file to target folder N (bare 1–9).
      if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key >= "1" && e.key <= "9") {
        const folder = folders.find((f) => f.shortcut === Number(e.key));
        const index = files.findIndex((f) => f.id === focusedId);
        if (folder && index >= 0) {
          e.preventDefault();
          const path = files[index].path;
          void moveFiles([path], folder.path)
            .then(([newPath]) => completeMove(index, folder.id, newPath))
            .catch(() => {});
        }
        return;
      }

      // Open the focused file (F / Enter).
      if (e.key === "f" || e.key === "F" || e.key === "Enter") {
        if (focusedId != null) {
          openPreview(focusedId);
          e.preventDefault();
        }
        return;
      }

      // Arrow / vim focus movement.
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "j", "k"].includes(e.key)) {
        const cols = Math.max(1, Math.floor((parentRef.current?.clientWidth ?? 0) / CARD));
        const cur = files.findIndex((f) => f.id === focusedId);
        const next = nextFocusIndex(cur, e.key, cols, files.length);
        if (next >= 0 && files[next]) setFocus(files[next].id);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setFocus, openPreview, completeMove, completeUndo]);

  // Keep the focused cell in view.
  useEffect(() => {
    if (focusedId == null) return;
    const idx = files.findIndex((f) => f.id === focusedId);
    if (idx < 0) return;
    const cols = Math.max(1, Math.floor((parentRef.current?.clientWidth ?? 0) / CARD));
    try {
      rowVirtualizer.scrollToIndex(Math.floor(idx / cols));
    } catch {
      // virtualizer not laid out yet (e.g. jsdom) — scroll is best-effort
    }
  }, [focusedId, files, rowVirtualizer]);

  return (
    <div ref={parentRef} className="flex-1 overflow-auto">
      <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
        {rowVirtualizer.getVirtualItems().map((vr) => {
          const start = vr.index * columns;
          const cells = files.slice(start, start + columns);
          return (
            <div
              key={vr.key}
              className="absolute left-0 flex gap-2 px-2"
              style={{ top: vr.start, height: CARD, width: "100%" }}
            >
              {cells.map((f) => (
                <FileCard key={f.id} file={f} focused={f.id === focusedId} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- --run src/components/FileGrid.test.tsx`
Expected: all green (the #5a focus tests + the 4 new).

- [ ] **Step 5: Run the full suite — expect PASS**

Run: `npm test -- --run`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/components/FileGrid.tsx src/components/FileGrid.test.tsx
git commit -m "feat: move focused file with keys 1-9 + Ctrl+Z undo in the grid"
```

---

## Task 7: Full suites + manual acceptance

**Files:** none (verification only).

- [ ] **Step 1: Backend suite — expect PASS**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all green (model, paths, scan, folders, fileops).

- [ ] **Step 2: Frontend suite — expect PASS**

Run: `npm test -- --run`
Expected: all green.

- [ ] **Step 3: Run the app**

Run: `npm run tauri dev`

- [ ] **Step 4: Verify manually**

- Scan a folder → the sidebar shows the base path; first cell ringed (#5a).
- **New folder** ×3 (e.g. Keep / Family / Junk) → legend shows `① Keep ② Family ③ Junk`.
- Focus a file, press **1** → it moves into Keep, leaves the grid, focus advances, the legend count ticks to `(1)`.
- **Ctrl+Z** → the file returns to its slot with focus; count back to `(0)`.
- Typing a folder name that contains a digit or `f` does **not** move/open anything (form-field guard).
- Open the Preview (F) → **1–9 / Ctrl+Z stay quiet**; close → they resume.
- Confirm on disk: files really moved into the target folders; no duplicate folders on repeated creates.

- [ ] **Step 5: Commit (only if the run needed tweaks)**

```bash
git add -A && git commit -m "chore: target-folders slice manual-run verification"
```

---

## Self-Review

**Spec coverage (spec §§2–11):**
- `FolderInfo` model + camelCase → Task 1. ✓
- Backend-authoritative folders, dedup by `normalize_path`, 1–9 assignment, `list_target_folders` → Task 2. ✓
- `move_files` rename + `_N` collision + cross-volume → Task 3. ✓
- Store `folders`/`roots`/`moveHistory` + `completeMove`/`completeUndo`, clear-on-scan/reset, `roots` capture → Task 4. ✓
- Command wrappers, Sidebar legend + New-folder (+9 cap), App layout → Task 5. ✓
- Keyboard 1–9 move + Ctrl+Z undo, Preview-guard + form-field guard → Task 6. ✓
- Focus-advance / empty-grid / undo-reinsert edge cases → Task 4 reducer tests. ✓
- Manual acceptance + both suites → Task 7. ✓
- Deferred (rename/delete, multi-select, redo/full history, persistence, polished sidebar) → not implemented, by design. ✓

**Placeholder scan:** no TBD/TODO; every code step is complete. The cross-volume copy-then-delete branch is deliberately covered by the manual run (single-volume unit tests can't force `EXDEV`), noted in spec §11 — not a placeholder.

**Type consistency:** `FolderInfo` fields (`id`/`name`/`path`/`shortcut`/`fileCount`) identical across Rust (`u8`/`u32`) and TS (`number`) and every consumer; `completeMove(index, folderId, toPath)` / `completeUndo(backPath)` called with those exact signatures in Task 6; `moveFiles(paths, dest) -> string[]` and `createFolder(base, name) -> FolderInfo` consistent between `commands.ts` (Task 5) and callers (Tasks 5–6); `MoveRecord` shape (`file`/`folderId`/`fromDir`/`toPath`/`fromIndex`) consistent between the store (Task 4) and the Ctrl+Z handler (Task 6); `normalize_path(&str)`, `FolderState`, and the `State<'_, FolderState>` command pattern match `scan.rs`/`paths.rs`. ✓
