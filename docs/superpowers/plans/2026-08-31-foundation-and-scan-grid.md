# MediaSort v2 — Foundation & Scan/Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable MediaSort desktop app that lets you pick source folder(s), scans them for photos/videos on a background thread with streamed progress, and shows the results in a smooth virtualized grid.

**Architecture:** Tauri v2 (Rust) backend does the scanning off the UI thread and streams results via events; a React + Zustand frontend renders a TanStack-Virtual grid. All folder identity and cache keys flow through one `normalize_path()` function (prevents the v1 folder-dup/ghost bugs downstream). This plan delivers roadmap slices #1–#2 from `docs/DESIGN.md §12`.

**Tech Stack:** Rust (walkdir, kamadak-exif, serde, rayon), Tauri v2, React 19, TypeScript, Vite 7, Tailwind v4, Zustand, @tanstack/react-virtual, Vitest.

**Spec:** [`../../DESIGN.md`](../../DESIGN.md) and [`../../../PRD-MediaSort-v2.md`](../../../PRD-MediaSort-v2.md). The plan argues from these; executors read both.

## Global Constraints

- **Toolchain:** Rust **GNU** (`stable-x86_64-pc-windows-gnu`) for dev (MSVC deferred — insufficient C: space). Builds output to `D:/mediasort-target` via `.cargo/config.toml` (MinGW can't handle the space in the project path); lib crate-type is `rlib`-only. `cargo build` verified working on GNU.
- **Tauri v2**, Rust edition 2021. Crate = `mediasort`, lib = `mediasort_lib`.
- **Supported extensions** — photos: `jpg jpeg png gif webp bmp tiff heic heif svg`; video: `mp4 mkv mov avi webm`. (Lowercased comparison.)
- **No AI, no network.** No base64 image bytes over IPC — images will be delivered via the asset protocol in a later slice.
- **App-data namespace** `MediaSort`; product display name **MediaSort**.
- **Folder identity + cache keys** always go through `paths::normalize_path`.
- **Tests:** Rust logic via `cargo test`; store/UI logic via Vitest. A slice isn't done until its tests pass (and, if visual, it's been run).
- **Event names** (hyphenated, stable): `scan-progress`, `scan-file`, `scan-done`, `scan-error`.

---

## File Structure

**Created by this plan:**
- `src-tauri/src/paths.rs` — path normalization + app-data/cache dirs.
- `src-tauri/src/model.rs` — `FileInfo`, `FileType`, serde types shared over IPC.
- `src-tauri/src/scan.rs` — extension filter, recursive scan, `scan_folders` command, events, cancellation.
- `src/lib/types.ts` — TS mirror of the IPC types.
- `src/lib/commands.ts` — typed wrappers over `invoke`.
- `src/lib/events.ts` — typed wrappers over `listen`.
- `src/store/useAppStore.ts` — Zustand store (files slice for now).
- `src/store/useAppStore.test.ts` — Vitest for the store.
- `src/components/FileGrid.tsx` — virtualized grid.
- `src/components/Toolbar.tsx` — scan button + counts.
- `src/styles.css` — Tailwind entry (`@import "tailwindcss";`).

**Modified:**
- `src-tauri/Cargo.toml` — add scan/exif/parallel deps.
- `src-tauri/src/lib.rs` — module decls, managed state, register commands.
- `src-tauri/tauri.conf.json` — MediaSort naming, window size, dialog perms.
- `src-tauri/capabilities/default.json` — add dialog permission.
- `vite.config.ts` — Tailwind plugin + Vitest config.
- `package.json` — frontend deps + `test` script.
- `src/App.tsx`, `src/main.tsx` — replace demo with app shell.

---

## Task 1: Frontend foundation — naming, Tailwind, Vitest

**Files:**
- Modify: `src-tauri/tauri.conf.json`, `package.json`, `vite.config.ts`, `src/main.tsx`, `src/App.tsx`
- Create: `src/styles.css`, `src/App.test.tsx`

**Interfaces:**
- Produces: a Vitest-backed frontend that builds; `styles.css` importing Tailwind; app window titled "MediaSort".

> Precondition: the background `npm install` from scaffolding has finished. Verify with `npm ls react` (should resolve, no "missing").

- [ ] **Step 1: Add frontend dependencies**

Run:
```bash
npm install zustand @tanstack/react-virtual @tauri-apps/plugin-dialog
npm install -D tailwindcss @tailwindcss/vite vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 2: Wire Tailwind v4 + Vitest into `vite.config.ts`**

Replace `vite.config.ts` with:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["@testing-library/jest-dom/vitest"],
  },
});
```

- [ ] **Step 3: Create `src/styles.css` and import it**

`src/styles.css`:
```css
@import "tailwindcss";
```
Change `src/main.tsx` to import styles and drop StrictMode double-invoke noise later if needed:
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 4: Add `test` script to `package.json`**

In `"scripts"` add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Replace `src/App.tsx` with a minimal Tailwind shell**

```tsx
function App() {
  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center">
      <h1 className="text-2xl font-semibold tracking-tight">MediaSort</h1>
    </main>
  );
}
export default App;
```

- [ ] **Step 6: Write a smoke test `src/App.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders the app name", () => {
  render(<App />);
  expect(screen.getByText("MediaSort")).toBeInTheDocument();
});
```

- [ ] **Step 7: Run the test — expect PASS**

Run: `npm test`
Expected: 1 passed. (If jsdom/matcher errors appear, confirm Step 2 `setupFiles` and deps from Step 1.)

- [ ] **Step 8: Rename the app to MediaSort in `tauri.conf.json`**

Set `"productName": "MediaSort"`, and under `app.windows[0]` set `"title": "MediaSort"`, `"width": 1280`, `"height": 800`, and add `"minWidth": 900`, `"minHeight": 600`.

- [ ] **Step 9: Verify the frontend builds**

Run: `npm run build`
Expected: `tsc` + `vite build` succeed, `dist/` produced.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: frontend foundation (Tailwind v4, Vitest, MediaSort shell)"
```

---

## Task 2: Backend dependencies + module skeleton

**Files:**
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`
- Create: `src-tauri/src/paths.rs`, `src-tauri/src/model.rs`, `src-tauri/src/scan.rs` (stubs)

**Interfaces:**
- Produces: compiling crate with `mod paths; mod model; mod scan;` declared.

> Precondition: MSVC C++ Build Tools installed (`link.exe` discoverable). Verify: `cargo --version` then a scratch `cargo build` in Step 4.

- [ ] **Step 1: Add dependencies to `src-tauri/Cargo.toml`**

Under `[dependencies]` (keep the existing tauri/serde lines), add:
```toml
walkdir = "2"
rayon = "1"
kamadak-exif = "0.5"
blake3 = "1"
dirs = "5"
```
Add `tauri` features for the dialog plugin later; for now also add:
```toml
tauri-plugin-dialog = "2"
```

- [ ] **Step 2: Create stub modules**

`src-tauri/src/paths.rs`:
```rust
//! Path normalization and app-data/cache directories.
```
`src-tauri/src/model.rs`:
```rust
//! Shared IPC data types.
```
`src-tauri/src/scan.rs`:
```rust
//! Folder scanning: extension filter, recursive walk, streamed command.
```

- [ ] **Step 3: Declare modules in `src-tauri/src/lib.rs`**

At the top of `lib.rs`, above the `greet` fn, add:
```rust
mod model;
mod paths;
mod scan;
```

- [ ] **Step 4: Verify the crate compiles**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: success (downloads crates on first run). If `link.exe`/MSVC errors appear, MSVC Build Tools are not installed — stop and resolve before continuing.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: backend deps + module skeleton"
```

---

## Task 3: `normalize_path` (the linchpin) — TDD

**Files:**
- Modify: `src-tauri/src/paths.rs`
- Test: inline `#[cfg(test)]` in `paths.rs`

**Interfaces:**
- Produces: `pub fn normalize_path(p: &str) -> String` — absolute, cleaned, Windows-canonical key (lowercased drive letter, `\` separators, no trailing separator). Later tasks call this for folder identity and cache keys.

- [ ] **Step 1: Write failing tests**

Append to `paths.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lowercases_drive_and_normalizes_separators() {
        assert_eq!(normalize_path(r"C:/Users/Me/Pics"), r"c:\users\me\pics");
    }
    #[test]
    fn strips_trailing_separator() {
        assert_eq!(normalize_path(r"D:\Photos\"), r"d:\photos");
    }
    #[test]
    fn collapses_mixed_and_duplicate_separators() {
        assert_eq!(normalize_path(r"D:\a//b\\c"), r"d:\a\b\c");
    }
    #[test]
    fn same_folder_two_spellings_one_key() {
        assert_eq!(normalize_path(r"C:\A\B"), normalize_path(r"c:/a/b/"));
    }
}
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cargo test --manifest-path src-tauri/Cargo.toml normalize`
Expected: FAIL (`normalize_path` not found).

- [ ] **Step 3: Implement `normalize_path`**

Add to `paths.rs` (above the tests):
```rust
/// Normalize a path into a stable identity key on Windows:
/// lowercase drive letter, backslash separators, collapsed duplicates,
/// no trailing separator. Case of the rest is lowered for a case-insensitive FS.
pub fn normalize_path(p: &str) -> String {
    let unified = p.replace('/', "\\");
    // Collapse duplicate separators.
    let mut parts: Vec<&str> = unified.split('\\').filter(|s| !s.is_empty()).collect();
    // Rebuild; lowercase everything (Windows FS is case-insensitive).
    for part in parts.iter_mut() {
        // parts are &str; we lowercase during join below
        let _ = part;
    }
    let joined = parts
        .iter()
        .map(|s| s.to_lowercase())
        .collect::<Vec<_>>()
        .join("\\");
    joined
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `cargo test --manifest-path src-tauri/Cargo.toml normalize`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: normalize_path with tests (prevents folder-dup bug at the root)"
```

---

## Task 4: Shared model types — TDD

**Files:**
- Modify: `src-tauri/src/model.rs`

**Interfaces:**
- Produces:
  - `pub enum FileType { Image, Video }` with `pub fn from_extension(ext: &str) -> Option<FileType>`
  - `pub struct FileInfo { id, path, name, extension, size: u64, modified_at: i64, date_taken: Option<i64>, file_type: FileType, group_id: Option<String> }` — `#[derive(Serialize, Deserialize, Clone, Debug)]`, `#[serde(rename_all = "camelCase")]`.
- Consumes: nothing.

- [ ] **Step 1: Write failing tests**

Append to `model.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_known_extensions() {
        assert_eq!(FileType::from_extension("jpg"), Some(FileType::Image));
        assert_eq!(FileType::from_extension("HEIC"), Some(FileType::Image));
        assert_eq!(FileType::from_extension("svg"), Some(FileType::Image));
        assert_eq!(FileType::from_extension("mp4"), Some(FileType::Video));
        assert_eq!(FileType::from_extension("txt"), None);
    }

    #[test]
    fn fileinfo_serializes_camelcase() {
        let f = FileInfo {
            id: "d:\\a\\b.jpg".into(), path: "D:\\a\\b.jpg".into(),
            name: "b.jpg".into(), extension: "jpg".into(), size: 10,
            modified_at: 1, date_taken: None, file_type: FileType::Image, group_id: None,
        };
        let j = serde_json::to_string(&f).unwrap();
        assert!(j.contains("\"modifiedAt\":1"));
        assert!(j.contains("\"fileType\":\"image\""));
    }
}
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cargo test --manifest-path src-tauri/Cargo.toml model`
Expected: FAIL (types not defined).

- [ ] **Step 3: Implement types**

Prepend to `model.rs`:
```rust
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileType { Image, Video }

impl FileType {
    pub fn from_extension(ext: &str) -> Option<FileType> {
        match ext.to_lowercase().as_str() {
            "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "tiff" | "heic" | "heif" | "svg" => Some(FileType::Image),
            "mp4" | "mkv" | "mov" | "avi" | "webm" => Some(FileType::Video),
            _ => None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub id: String,
    pub path: String,
    pub name: String,
    pub extension: String,
    pub size: u64,
    pub modified_at: i64,
    pub date_taken: Option<i64>,
    pub file_type: FileType,
    pub group_id: Option<String>,
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cargo test --manifest-path src-tauri/Cargo.toml model`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: shared FileInfo/FileType model with serde tests"
```

---

## Task 5: Recursive scan core — TDD

**Files:**
- Modify: `src-tauri/src/scan.rs`
- Test: inline `#[cfg(test)]` with `tempfile`

**Interfaces:**
- Consumes: `model::{FileInfo, FileType}`, `paths::normalize_path`.
- Produces:
  - `pub fn is_supported(ext: &str) -> bool`
  - `pub fn build_file_info(path: &std::path::Path) -> Option<FileInfo>` (returns `None` for unsupported / stat failure)
  - `pub fn scan_paths_collect(roots: &[String]) -> Vec<FileInfo>` (recursive, synchronous core used by the command and by tests)

- [ ] **Step 1: Add `tempfile` dev-dependency**

In `src-tauri/Cargo.toml` add:
```toml
[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 2: Write failing tests**

Append to `scan.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn filters_to_supported_media() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.jpg"), b"x").unwrap();
        fs::write(dir.path().join("b.MP4"), b"x").unwrap();
        fs::write(dir.path().join("c.txt"), b"x").unwrap();
        let sub = dir.path().join("sub");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("d.png"), b"x").unwrap();

        let root = dir.path().to_string_lossy().to_string();
        let mut got = scan_paths_collect(&[root]);
        got.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

        let names: Vec<_> = got.iter().map(|f| f.name.clone()).collect();
        assert_eq!(names, vec!["a.jpg", "b.MP4", "d.png"]);
        assert!(got.iter().all(|f| f.id == super::super::paths::normalize_path(&f.path)));
    }
}
```

- [ ] **Step 3: Run — expect FAIL**

Run: `cargo test --manifest-path src-tauri/Cargo.toml scan`
Expected: FAIL (functions undefined).

- [ ] **Step 4: Implement the scan core**

Prepend to `scan.rs`:
```rust
use crate::model::{FileInfo, FileType};
use crate::paths::normalize_path;
use std::path::Path;
use walkdir::WalkDir;

pub fn is_supported(ext: &str) -> bool {
    FileType::from_extension(ext).is_some()
}

pub fn build_file_info(path: &Path) -> Option<FileInfo> {
    let ext = path.extension()?.to_string_lossy().to_string();
    let file_type = FileType::from_extension(&ext)?;
    let meta = std::fs::metadata(path).ok()?;
    let modified_at = meta
        .modified().ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let path_str = path.to_string_lossy().to_string();
    Some(FileInfo {
        id: normalize_path(&path_str),
        path: path_str,
        name: path.file_name()?.to_string_lossy().to_string(),
        extension: ext.to_lowercase(),
        size: meta.len(),
        modified_at,
        date_taken: None, // EXIF wired in a later slice
        file_type,
        group_id: None,
    })
}

pub fn scan_paths_collect(roots: &[String]) -> Vec<FileInfo> {
    let mut out = Vec::new();
    for root in roots {
        for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                if let Some(fi) = build_file_info(entry.path()) {
                    out.push(fi);
                }
            }
        }
    }
    out
}
```

- [ ] **Step 5: Run — expect PASS**

Run: `cargo test --manifest-path src-tauri/Cargo.toml scan`
Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: recursive media scan core with tempfile tests"
```

---

## Task 6: `scan_folders` command with streamed events + cancellation

**Files:**
- Modify: `src-tauri/src/scan.rs`, `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `scan_paths_collect`/`build_file_info`, Tauri `AppHandle`, `Emitter`.
- Produces:
  - managed `struct ScanState { cancel: std::sync::atomic::AtomicBool }`
  - `#[tauri::command] async fn scan_folders(app, state, paths: Vec<String>) -> Result<(), String>`
  - `#[tauri::command] fn cancel_scan(state)`
  - Events: `scan-file` (`Vec<FileInfo>` batch), `scan-progress` (`{ done: usize }`), `scan-done` (`{ total: usize }`), `scan-error` (`String`).

- [ ] **Step 1: Implement the command + state in `scan.rs`**

Append:
```rust
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct ScanState {
    pub cancel: AtomicBool,
}

#[derive(Serialize, Clone)]
struct Progress { done: usize }
#[derive(Serialize, Clone)]
struct Done { total: usize }

#[tauri::command]
pub async fn scan_folders(
    app: AppHandle,
    state: State<'_, ScanState>,
    paths: Vec<String>,
) -> Result<(), String> {
    state.cancel.store(false, Ordering::SeqCst);

    let mut batch: Vec<FileInfo> = Vec::with_capacity(100);
    let mut done = 0usize;

    for root in &paths {
        for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
            if state.cancel.load(Ordering::SeqCst) {
                app.emit("scan-done", Done { total: done }).ok();
                return Ok(());
            }
            if entry.file_type().is_file() {
                if let Some(fi) = build_file_info(entry.path()) {
                    batch.push(fi);
                    done += 1;
                    if batch.len() >= 100 {
                        app.emit("scan-file", batch.clone()).map_err(|e| e.to_string())?;
                        app.emit("scan-progress", Progress { done }).ok();
                        batch.clear();
                    }
                }
            }
        }
    }
    if !batch.is_empty() {
        app.emit("scan-file", batch.clone()).map_err(|e| e.to_string())?;
    }
    app.emit("scan-progress", Progress { done }).ok();
    app.emit("scan-done", Done { total: done }).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn cancel_scan(state: State<'_, ScanState>) {
    state.cancel.store(true, Ordering::SeqCst);
}
```

- [ ] **Step 2: Register state, plugin, and commands in `lib.rs`**

Update `run()` in `lib.rs`:
```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(scan::ScanState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            scan::scan_folders,
            scan::cancel_scan
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Add the dialog permission to `capabilities/default.json`**

Set `permissions` to:
```json
["core:default", "opener:default", "dialog:default"]
```

- [ ] **Step 4: Verify compile**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: success. (Fixes any unused-import warnings.)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: scan_folders command with streamed events + cancellation"
```

---

## Task 7: Frontend types, command/event wrappers, Zustand store — TDD

**Files:**
- Create: `src/lib/types.ts`, `src/lib/commands.ts`, `src/lib/events.ts`, `src/store/useAppStore.ts`, `src/store/useAppStore.test.ts`

**Interfaces:**
- Produces:
  - `types.ts`: `type FileType = "image" | "video"`; `interface FileInfo { id; path; name; extension; size; modifiedAt; dateTaken: number | null; fileType: FileType; groupId: string | null }`
  - `commands.ts`: `scanFolders(paths: string[]): Promise<void>`, `cancelScan(): Promise<void>`, `pickFolders(): Promise<string[] | null>`
  - `events.ts`: `onScanFile(cb)`, `onScanProgress(cb)`, `onScanDone(cb)` returning unlisten fns
  - `useAppStore`: state `{ files: FileInfo[]; scanning: boolean; scanned: number }`, actions `addFiles`, `startScan`, `finishScan`, `reset`
- Consumes: `@tauri-apps/api/core`, `@tauri-apps/api/event`, `@tauri-apps/plugin-dialog`, `zustand`.

- [ ] **Step 1: Create `src/lib/types.ts`**

```ts
export type FileType = "image" | "video";
export interface FileInfo {
  id: string;
  path: string;
  name: string;
  extension: string;
  size: number;
  modifiedAt: number;
  dateTaken: number | null;
  fileType: FileType;
  groupId: string | null;
}
```

- [ ] **Step 2: Create `src/lib/commands.ts`**

```ts
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export const scanFolders = (paths: string[]) => invoke<void>("scan_folders", { paths });
export const cancelScan = () => invoke<void>("cancel_scan");

export async function pickFolders(): Promise<string[] | null> {
  const res = await open({ directory: true, multiple: true });
  if (res == null) return null;
  return Array.isArray(res) ? res : [res];
}
```

- [ ] **Step 3: Create `src/lib/events.ts`**

```ts
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { FileInfo } from "./types";

export const onScanFile = (cb: (files: FileInfo[]) => void): Promise<UnlistenFn> =>
  listen<FileInfo[]>("scan-file", (e) => cb(e.payload));
export const onScanProgress = (cb: (done: number) => void): Promise<UnlistenFn> =>
  listen<{ done: number }>("scan-progress", (e) => cb(e.payload.done));
export const onScanDone = (cb: (total: number) => void): Promise<UnlistenFn> =>
  listen<{ total: number }>("scan-done", (e) => cb(e.payload.total));
```

- [ ] **Step 4: Write failing store test `src/store/useAppStore.test.ts`**

```ts
import { beforeEach, expect, test } from "vitest";
import { useAppStore } from "./useAppStore";
import type { FileInfo } from "../lib/types";

const mk = (id: string): FileInfo => ({
  id, path: id, name: id, extension: "jpg", size: 1,
  modifiedAt: 0, dateTaken: null, fileType: "image", groupId: null,
});

beforeEach(() => useAppStore.getState().reset());

test("startScan clears files and sets scanning", () => {
  useAppStore.getState().addFiles([mk("a")]);
  useAppStore.getState().startScan();
  expect(useAppStore.getState().scanning).toBe(true);
  expect(useAppStore.getState().files).toHaveLength(0);
});

test("addFiles appends and finishScan stops scanning", () => {
  useAppStore.getState().startScan();
  useAppStore.getState().addFiles([mk("a"), mk("b")]);
  useAppStore.getState().addFiles([mk("c")]);
  useAppStore.getState().finishScan(3);
  const s = useAppStore.getState();
  expect(s.files.map((f) => f.id)).toEqual(["a", "b", "c"]);
  expect(s.scanning).toBe(false);
  expect(s.scanned).toBe(3);
});
```

- [ ] **Step 5: Run — expect FAIL**

Run: `npm test`
Expected: FAIL (`useAppStore` not found).

- [ ] **Step 6: Implement `src/store/useAppStore.ts`**

```ts
import { create } from "zustand";
import type { FileInfo } from "../lib/types";

interface AppState {
  files: FileInfo[];
  scanning: boolean;
  scanned: number;
  startScan: () => void;
  addFiles: (batch: FileInfo[]) => void;
  finishScan: (total: number) => void;
  reset: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  files: [],
  scanning: false,
  scanned: 0,
  startScan: () => set({ scanning: true, files: [], scanned: 0 }),
  addFiles: (batch) => set((s) => ({ files: [...s.files, ...batch] })),
  finishScan: (total) => set({ scanning: false, scanned: total }),
  reset: () => set({ files: [], scanning: false, scanned: 0 }),
}));
```

- [ ] **Step 7: Run — expect PASS**

Run: `npm test`
Expected: all passing (App smoke test + 2 store tests).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: frontend IPC wrappers + Zustand store with tests"
```

---

## Task 8: Toolbar + virtualized grid, wired to scan events

**Files:**
- Create: `src/components/Toolbar.tsx`, `src/components/FileGrid.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useAppStore`, `commands.ts`, `events.ts`.
- Produces: an app that scans a chosen folder and renders a virtualized grid of filenames (thumbnails come in the next slice).

- [ ] **Step 1: Create `src/components/Toolbar.tsx`**

```tsx
import { pickFolders, scanFolders, cancelScan } from "../lib/commands";
import { useAppStore } from "../store/useAppStore";

export function Toolbar() {
  const { scanning, files, scanned, startScan } = useAppStore();
  async function onScan() {
    const dirs = await pickFolders();
    if (!dirs) return;
    startScan();
    await scanFolders(dirs);
  }
  return (
    <header className="flex items-center gap-3 px-4 h-12 border-b border-neutral-800 bg-neutral-900">
      <button
        onClick={onScan}
        disabled={scanning}
        className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm font-medium"
      >
        {scanning ? "Scanning…" : "Scan folder"}
      </button>
      {scanning && (
        <button onClick={() => cancelScan()} className="px-3 py-1.5 rounded bg-neutral-700 text-sm">
          Cancel
        </button>
      )}
      <span className="text-sm text-neutral-400 ml-auto">
        {scanning ? `${files.length} found…` : `${scanned} items`}
      </span>
    </header>
  );
}
```

- [ ] **Step 2: Create `src/components/FileGrid.tsx` (TanStack Virtual)**

```tsx
import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAppStore } from "../store/useAppStore";

const CARD = 160; // px cell size (thumbnail slice will fill these)

export function FileGrid() {
  const files = useAppStore((s) => s.files);
  const parentRef = useRef<HTMLDivElement>(null);
  const columns = Math.max(1, Math.floor((parentRef.current?.clientWidth ?? 1200) / CARD));
  const rows = Math.ceil(files.length / columns);

  const rowVirtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CARD,
    overscan: 6,
  });

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
                <div
                  key={f.id}
                  className="w-[152px] h-[150px] rounded bg-neutral-800 border border-neutral-700 overflow-hidden flex items-end p-1"
                  title={f.path}
                >
                  <span className="text-[11px] text-neutral-300 truncate w-full">{f.name}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire events + layout in `src/App.tsx`**

```tsx
import { useEffect } from "react";
import { Toolbar } from "./components/Toolbar";
import { FileGrid } from "./components/FileGrid";
import { onScanFile, onScanDone } from "./lib/events";
import { useAppStore } from "./store/useAppStore";

function App() {
  const { addFiles, finishScan } = useAppStore();
  useEffect(() => {
    const unlisteners = Promise.all([
      onScanFile((batch) => addFiles(batch)),
      onScanDone((total) => finishScan(total)),
    ]);
    return () => {
      unlisteners.then((fns) => fns.forEach((f) => f()));
    };
  }, [addFiles, finishScan]);

  return (
    <main className="h-screen flex flex-col bg-neutral-950 text-neutral-100">
      <Toolbar />
      <FileGrid />
    </main>
  );
}
export default App;
```

- [ ] **Step 4: Verify tests still pass**

Run: `npm test`
Expected: all green (no regressions).

- [ ] **Step 5: Run the app and verify manually**

Run: `npm run tauri dev`
Verify:
- Window titled **MediaSort** opens.
- "Scan folder" → OS folder picker; choose a folder with images/videos.
- Counter climbs during scan; grid fills with filenames; scrolling is smooth on a large folder (test on 1,000+ files).
- "Cancel" stops an in-progress scan.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: toolbar + virtualized grid wired to streamed scan"
```

---

## Self-Review

**Spec coverage (DESIGN §12 slices #1–2, PRD §3.1):**
- Scaffold + Tailwind + Zustand + tests → Task 1, 2. ✓
- Background scan, streamed, non-freezing, thousands of files → Task 5, 6, 8. ✓
- Virtualized grid, only-visible rendering → Task 8. ✓
- `normalize_path` foundation for later folder-dedup bug fix → Task 3. ✓
- Multi-folder select → Task 7 (`pickFolders` multiple:true), Task 8. ✓
- EXIF `dateTaken` is intentionally deferred (set to `None`/`null`) to the grouping slice — noted in Task 5 Step 4.

**Deferred to later plans (by design):** thumbnails/asset protocol (slice 3), selection/fullscreen/video (slice 4), target folders/keys (slice 5), trash (slice 6), grouping/EXIF (slice 7), rename/search (slice 8), undo/redo (slice 9), projects/settings/theme (slice 10), packaging (slice 11).

**Placeholder scan:** no TBDs; every code step has real content. ✓

**Type consistency:** Rust `FileInfo` (`#[serde(rename_all="camelCase")]`, `FileType` lowercase) ↔ TS `FileInfo`/`FileType` match field-for-field; event payloads (`scan-file: FileInfo[]`, `scan-progress:{done}`, `scan-done:{total}`) match `events.ts`. ✓
