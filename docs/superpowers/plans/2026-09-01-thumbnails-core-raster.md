# Core Raster Thumbnails — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show crisp, cached image thumbnails in the virtualized grid, delivered by Tauri's asset protocol — the root-cause fix for v1 bug #4.

**Architecture:** Rust generates JPEG thumbnails to an on-disk cache keyed by `blake3(normalized_path | mtime | size)`; the frontend requests them lazily per visible cell via `ensure_thumbnail`, which returns the cache file path, and `commands.ts` turns that into an `asset://` URL with `convertFileSrc` so WebView2 fetches/decodes/caches the image natively — no base64, no IPC image bytes. Generation is bounded by a 4-permit semaphore and written atomically (temp-then-rename).

**Tech Stack:** Rust (`image` 0.25 Lanczos3, `blake3`, tokio `Semaphore`), Tauri v2 asset protocol, React 19 + TypeScript, Zustand, Vitest, `@testing-library/react`.

**Spec:** [`../specs/2026-09-01-thumbnails-core-raster-design.md`](../specs/2026-09-01-thumbnails-core-raster-design.md) — the plan argues from the spec; executors read both.

## Global Constraints

- **Toolchain:** Rust **MSVC** (`stable-x86_64-pc-windows-msvc`, pinned via `rust-toolchain.toml`); build output at `D:/mediasort-target` (`.cargo/config.toml`); lib crate-type `rlib`-only.
- **Supported raster formats (this slice):** `jpg jpeg png gif webp bmp tiff` (lowercased comparison). `heic heif svg` and **all** video → filename-card placeholder, never generated here.
- **Cache key:** `blake3("{normalized_path}|{mtime}|{size}")` hex → filename `{key}.jpg` under `app_data_dir()/thumbnails/`. Persists across sessions; mtime/size change ⇒ new key ⇒ regenerate.
- **Thumbnail image:** single base size **512 px longest edge**, JPEG quality **80**, **never upscale** (keep original size when smaller), convert to RGB8 (JPEG has no alpha).
- **Delivery:** `ensure_thumbnail(path)` returns the cache **file path**; `commands.ts` wraps it through `convertFileSrc` into the asset URL. Lazy, one request per visible cell.
- **Concurrency/correctness:** tokio `Semaphore` (4 permits) around generation; write to a `.tmp` sibling then `fs::rename` (atomic).
- **No base64 image bytes over IPC. No network.**
- **Folder/cache identity always flows through `paths::normalize_path`.**
- **Tests:** Rust logic via `cargo test`; the frontend hook via Vitest. A task isn't done until its tests pass (and, for the final visual task, it's been run).

---

## File Structure

**Created:**
- `src-tauri/src/thumbnail.rs` — cache key, raster gate, JPEG generation, sync core, `ThumbState`, the two commands.
- `src/lib/useThumbnail.ts` — per-file thumbnail hook with a module-level memo + in-flight dedupe.
- `src/lib/useThumbnail.test.ts` — Vitest for the hook.
- `src/components/FileCard.tsx` — one grid cell: image / loading / placeholder-or-error.

**Modified:**
- `src-tauri/Cargo.toml` — add `blake3`, `image`, `tokio` (sync); add `protocol-asset` to `tauri` features.
- `src-tauri/src/lib.rs` — `mod thumbnail;`, resolve+manage `ThumbState` in `setup`, register commands.
- `src-tauri/tauri.conf.json` — enable the asset protocol scoped to the cache dir.
- `src/lib/commands.ts` — add `ensureThumbnail`, `clearThumbnailCache`.
- `src/components/FileGrid.tsx` — render `<FileCard>` per cell instead of the inline name card.

---

## Task 1: Cache key + raster gate (pure, TDD)

**Files:**
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`
- Create: `src-tauri/src/thumbnail.rs`

**Interfaces:**
- Produces: `pub fn thumb_cache_key(normalized_path: &str, mtime: i64, size: u64) -> String`; `pub fn is_raster_supported(ext: &str) -> bool`.

- [ ] **Step 1: Add `blake3` to `Cargo.toml`**

Under `[dependencies]` add:
```toml
blake3 = "1"
```

- [ ] **Step 2: Create `src-tauri/src/thumbnail.rs` with the two helpers**

```rust
//! Thumbnail generation + on-disk cache (asset-protocol delivery).

/// Stable per-file cache identity. Any change to path, mtime, or size yields a
/// new key (and therefore a new cache file), so staleness is impossible.
pub fn thumb_cache_key(normalized_path: &str, mtime: i64, size: u64) -> String {
    let data = format!("{normalized_path}|{mtime}|{size}");
    blake3::hash(data.as_bytes()).to_hex().to_string()
}

/// Formats decodable by the `image` crate in this slice. heic/heif/svg/video
/// are intentionally excluded (own follow-on plans).
pub fn is_raster_supported(ext: &str) -> bool {
    matches!(
        ext.to_lowercase().as_str(),
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "tiff"
    )
}
```

- [ ] **Step 3: Declare the module in `src-tauri/src/lib.rs`**

With the other `mod` lines (above `greet`), add:
```rust
mod thumbnail;
```

- [ ] **Step 4: Append failing tests to `thumbnail.rs`**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_is_stable_and_change_sensitive() {
        let base = thumb_cache_key(r"d:\a\b.jpg", 100, 2048);
        assert_eq!(base, thumb_cache_key(r"d:\a\b.jpg", 100, 2048));
        assert_ne!(base, thumb_cache_key(r"d:\a\b.jpg", 101, 2048)); // mtime
        assert_ne!(base, thumb_cache_key(r"d:\a\b.jpg", 100, 4096)); // size
        assert_ne!(base, thumb_cache_key(r"d:\a\c.jpg", 100, 2048)); // path
    }

    #[test]
    fn raster_gate_matches_supported_only() {
        for e in ["jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "JPG", "PNG"] {
            assert!(is_raster_supported(e), "{e} should be supported");
        }
        for e in ["heic", "heif", "svg", "mp4", "txt", ""] {
            assert!(!is_raster_supported(e), "{e} should not be supported");
        }
    }
}
```

- [ ] **Step 5: Run — expect PASS**

Run: `cargo test --manifest-path src-tauri/Cargo.toml thumbnail`
Expected: 2 passed. (Downloads `blake3` on first run.)

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: thumbnail cache key + raster-format gate with tests"
```

---

## Task 2: `generate_thumbnail` (TDD)

**Files:**
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/thumbnail.rs`

**Interfaces:**
- Produces: `pub fn generate_thumbnail(src: &Path, dst: &Path, max_edge: u32) -> Result<(), String>` — decode, downscale-to-fit (never upscale) with Lanczos3, write JPEG q80 atomically.

- [ ] **Step 1: Add `image` to `Cargo.toml`**

Under `[dependencies]` add:
```toml
image = "0.25"
```

- [ ] **Step 2: Add the import + function to `thumbnail.rs`** (top of file, below the doc comment)

```rust
use std::path::Path;

/// Decode `src`, fit it within `max_edge` (preserving aspect, never upscaling),
/// and write a JPEG to `dst`. Writes to a temp sibling then renames, so a crash
/// mid-encode never leaves a half-written cache file.
pub fn generate_thumbnail(src: &Path, dst: &Path, max_edge: u32) -> Result<(), String> {
    let img = image::open(src).map_err(|e| format!("decode {}: {e}", src.display()))?;
    let scaled = if img.width().max(img.height()) <= max_edge {
        img
    } else {
        img.resize(max_edge, max_edge, image::imageops::FilterType::Lanczos3)
    };
    let rgb = scaled.to_rgb8();

    let tmp = dst.with_extension("tmp");
    {
        let file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        let mut enc =
            image::codecs::jpeg::JpegEncoder::new_with_quality(std::io::BufWriter::new(file), 80);
        enc.encode_image(&rgb).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, dst).map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 3: Add failing tests inside the existing `mod tests`**

```rust
    #[test]
    fn downscales_large_preserving_aspect() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("big.png");
        image::RgbImage::from_pixel(1000, 500, image::Rgb([10, 20, 30]))
            .save(&src)
            .unwrap();
        let dst = dir.path().join("t.jpg");
        generate_thumbnail(&src, &dst, 512).unwrap();
        let t = image::open(&dst).unwrap();
        assert_eq!((t.width(), t.height()), (512, 256)); // 2:1 preserved
    }

    #[test]
    fn does_not_upscale_small_images() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("small.png");
        image::RgbImage::from_pixel(100, 80, image::Rgb([1, 2, 3]))
            .save(&src)
            .unwrap();
        let dst = dir.path().join("t.jpg");
        generate_thumbnail(&src, &dst, 512).unwrap();
        let t = image::open(&dst).unwrap();
        assert_eq!((t.width(), t.height()), (100, 80));
    }
```

- [ ] **Step 4: Run — expect PASS**

Run: `cargo test --manifest-path src-tauri/Cargo.toml thumbnail`
Expected: 4 passed. (Downloads `image` on first run; test build uses the existing `tempfile` dev-dep.)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: generate_thumbnail (Lanczos3, JPEG q80, atomic, no upscale)"
```

---

## Task 3: `ensure_thumbnail_sync` core (TDD)

**Files:**
- Modify: `src-tauri/src/thumbnail.rs`

**Interfaces:**
- Consumes: `thumb_cache_key`, `is_raster_supported`, `generate_thumbnail`, `crate::paths::normalize_path`.
- Produces: `pub fn ensure_thumbnail_sync(cache_dir: &Path, path: &str) -> Result<PathBuf, String>` — the synchronous cache-or-generate core the async command wraps.

- [ ] **Step 1: Widen the path import**

Change the existing `use std::path::Path;` (from Task 2) to:
```rust
use std::path::{Path, PathBuf};
```

- [ ] **Step 2: Add the sync core** (below `generate_thumbnail`)

```rust
/// Return the cache path for `path`'s thumbnail, generating it if absent.
/// Rejects non-raster inputs (the frontend already gates, this is defense).
pub fn ensure_thumbnail_sync(cache_dir: &Path, path: &str) -> Result<PathBuf, String> {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    if !is_raster_supported(ext) {
        return Err(format!("unsupported thumbnail type: {ext}"));
    }
    let norm = crate::paths::normalize_path(path);
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let key = thumb_cache_key(&norm, mtime, meta.len());
    let dst = cache_dir.join(format!("{key}.jpg"));
    if dst.exists() {
        return Ok(dst);
    }
    generate_thumbnail(Path::new(path), &dst, 512)?;
    Ok(dst)
}
```

- [ ] **Step 3: Add failing tests inside `mod tests`**

```rust
    #[test]
    fn generates_then_hits_cache() {
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("cache");
        std::fs::create_dir(&cache).unwrap();
        let src = dir.path().join("a.png");
        image::RgbImage::from_pixel(640, 480, image::Rgb([9, 9, 9]))
            .save(&src)
            .unwrap();

        let p1 = ensure_thumbnail_sync(&cache, src.to_str().unwrap()).unwrap();
        assert!(p1.exists());
        let t = image::open(&p1).unwrap();
        assert!(t.width().max(t.height()) <= 512);

        let p2 = ensure_thumbnail_sync(&cache, src.to_str().unwrap()).unwrap();
        assert_eq!(p1, p2);
        assert_eq!(std::fs::read_dir(&cache).unwrap().count(), 1); // cache hit, no dup
    }

    #[test]
    fn rejects_unsupported_and_missing() {
        let dir = tempfile::tempdir().unwrap();
        let txt = dir.path().join("note.txt");
        std::fs::write(&txt, b"x").unwrap();
        assert!(ensure_thumbnail_sync(dir.path(), txt.to_str().unwrap()).is_err());
        assert!(ensure_thumbnail_sync(dir.path(), dir.path().join("gone.png").to_str().unwrap()).is_err());
    }
```

- [ ] **Step 4: Run — expect PASS**

Run: `cargo test --manifest-path src-tauri/Cargo.toml thumbnail`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: ensure_thumbnail_sync cache-or-generate core with tests"
```

---

## Task 4: Commands + state + wiring + asset protocol (compile-verified)

**Files:**
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/thumbnail.rs`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`

**Interfaces:**
- Consumes: `ensure_thumbnail_sync`, Tauri `State`/`Manager`, tokio `Semaphore`.
- Produces: managed `pub struct ThumbState`; `#[tauri::command] async fn ensure_thumbnail(state, path: String) -> Result<String, String>`; `#[tauri::command] async fn clear_thumbnail_cache(state) -> Result<(), String>`.

- [ ] **Step 1: Add `tokio` (sync) and the `protocol-asset` tauri feature to `Cargo.toml`**

Change the `tauri` dependency line to:
```toml
tauri = { version = "2", features = ["protocol-asset"] }
```
And under `[dependencies]` add:
```toml
tokio = { version = "1", features = ["sync"] }
```

- [ ] **Step 2: Add state + commands to `thumbnail.rs`** (append)

```rust
use tauri::State;
use tokio::sync::Semaphore;

/// Managed state: resolved cache dir + a small permit pool that bounds how many
/// CPU-bound generations run at once (keeps the app responsive under fast scroll).
pub struct ThumbState {
    pub cache_dir: PathBuf,
    pub sem: Semaphore,
}

impl ThumbState {
    pub fn new(cache_dir: PathBuf) -> Self {
        Self { cache_dir, sem: Semaphore::new(4) }
    }
}

#[tauri::command]
pub async fn ensure_thumbnail(
    state: State<'_, ThumbState>,
    path: String,
) -> Result<String, String> {
    let _permit = state.sem.acquire().await.map_err(|e| e.to_string())?;
    let cache_dir = state.cache_dir.clone();
    let dst = tauri::async_runtime::spawn_blocking(move || ensure_thumbnail_sync(&cache_dir, &path))
        .await
        .map_err(|e| e.to_string())??;
    Ok(dst.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn clear_thumbnail_cache(state: State<'_, ThumbState>) -> Result<(), String> {
    let dir = state.cache_dir.clone();
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 3: Resolve + manage state and register commands in `lib.rs`**

Add `use tauri::Manager;` at the top. Insert a `.setup(...)` before `.invoke_handler(...)` and extend the handler:
```rust
        .setup(|app| {
            let cache_dir = app
                .path()
                .app_data_dir()
                .expect("resolve app_data_dir")
                .join("thumbnails");
            std::fs::create_dir_all(&cache_dir).ok();
            app.manage(thumbnail::ThumbState::new(cache_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            scan::scan_folders,
            scan::cancel_scan,
            thumbnail::ensure_thumbnail,
            thumbnail::clear_thumbnail_cache
        ])
```

- [ ] **Step 4: Enable the asset protocol in `tauri.conf.json`**

Replace the `app.security` object with:
```json
    "security": {
      "csp": null,
      "assetProtocol": {
        "enable": true,
        "scope": ["$APPDATA/thumbnails/*"]
      }
    }
```

- [ ] **Step 5: Verify the crate compiles**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: success (downloads `tokio`). If unused-import warnings appear, remove them. End-to-end asset loading is verified by the manual run in Task 6 — if a thumbnail later fails to load, the likely fix is broadening the Step-4 scope to `["$APPDATA/**"]` (still app-data-only).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: ensure_thumbnail/clear_thumbnail_cache commands + asset protocol"
```

---

## Task 5: Frontend command wrappers + `useThumbnail` hook (TDD)

**Files:**
- Modify: `src/lib/commands.ts`
- Create: `src/lib/useThumbnail.ts`, `src/lib/useThumbnail.test.ts`

**Interfaces:**
- Consumes: `invoke`, `convertFileSrc` (`@tauri-apps/api/core`); `FileInfo` (`./types`).
- Produces: `ensureThumbnail(path: string): Promise<string>`; `clearThumbnailCache(): Promise<void>`; `useThumbnail(file: FileInfo): { url: string | null; status: "loading" | "ready" | "error" | "placeholder" }`; `__clearThumbnailMemo()` (test helper).

- [ ] **Step 1: Add the wrappers to `src/lib/commands.ts`**

Change the core import to include `convertFileSrc`, and append:
```ts
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
// ...existing scanFolders/cancelScan/pickFolders...

export const ensureThumbnail = async (path: string): Promise<string> =>
  convertFileSrc(await invoke<string>("ensure_thumbnail", { path }));

export const clearThumbnailCache = (): Promise<void> =>
  invoke<void>("clear_thumbnail_cache");
```

- [ ] **Step 2: Create the hook `src/lib/useThumbnail.ts`**

```ts
import { useEffect, useState } from "react";
import type { FileInfo } from "./types";
import { ensureThumbnail } from "./commands";

export type ThumbStatus = "loading" | "ready" | "error" | "placeholder";

// Module-level memo: survives cell unmount/remount as the grid virtualizes,
// so a file is never generated or invoked twice.
const resolved = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

const PLACEHOLDER_EXT = new Set(["heic", "heif", "svg"]);
function isPlaceholder(file: FileInfo): boolean {
  return file.fileType === "video" || PLACEHOLDER_EXT.has(file.extension.toLowerCase());
}

/** Test-only: reset the module memo between tests. */
export function __clearThumbnailMemo(): void {
  resolved.clear();
  inflight.clear();
}

export function useThumbnail(file: FileInfo): { url: string | null; status: ThumbStatus } {
  const placeholder = isPlaceholder(file);
  const cached = resolved.get(file.id) ?? null;
  const [url, setUrl] = useState<string | null>(cached);
  const [status, setStatus] = useState<ThumbStatus>(
    placeholder ? "placeholder" : cached ? "ready" : "loading",
  );

  useEffect(() => {
    if (placeholder) {
      setStatus("placeholder");
      setUrl(null);
      return;
    }
    const hit = resolved.get(file.id);
    if (hit) {
      setUrl(hit);
      setStatus("ready");
      return;
    }

    let active = true;
    let p = inflight.get(file.id);
    if (!p) {
      p = ensureThumbnail(file.path).then((u) => {
        resolved.set(file.id, u);
        inflight.delete(file.id);
        return u;
      });
      inflight.set(file.id, p);
    }
    setStatus("loading");
    p.then((u) => {
      if (active) {
        setUrl(u);
        setStatus("ready");
      }
    }).catch(() => {
      inflight.delete(file.id);
      if (active) {
        setStatus("error");
        setUrl(null);
      }
    });
    return () => {
      active = false;
    };
  }, [file.id, file.path, placeholder]);

  return { url, status };
}
```

- [ ] **Step 3: Write failing tests `src/lib/useThumbnail.test.ts`**

```ts
import { beforeEach, expect, test, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue("C:/cache/abc.jpg"),
  convertFileSrc: vi.fn((p: string) => `asset://localhost/${encodeURIComponent(p)}`),
}));

import { invoke } from "@tauri-apps/api/core";
import { useThumbnail, __clearThumbnailMemo } from "./useThumbnail";
import type { FileInfo } from "./types";

const mk = (over: Partial<FileInfo> = {}): FileInfo => ({
  id: "1", path: "C:/x/a.jpg", name: "a.jpg", extension: "jpg", size: 1,
  modifiedAt: 0, dateTaken: null, fileType: "image", groupId: null, ...over,
});

beforeEach(() => {
  __clearThumbnailMemo();
  vi.clearAllMocks();
});

test("raster file resolves to a ready thumbnail url", async () => {
  const { result } = renderHook(() => useThumbnail(mk()));
  expect(result.current.status).toBe("loading");
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(result.current.url).toContain("asset://");
  expect(invoke).toHaveBeenCalledTimes(1);
});

test("video and heic/svg are placeholders and never invoke", () => {
  const v = renderHook(() => useThumbnail(mk({ id: "v", fileType: "video", extension: "mp4" })));
  const h = renderHook(() => useThumbnail(mk({ id: "h", extension: "heic" })));
  expect(v.result.current.status).toBe("placeholder");
  expect(h.result.current.status).toBe("placeholder");
  expect(invoke).not.toHaveBeenCalled();
});

test("memo cache: two mounts of one file invoke once", async () => {
  const f = mk({ id: "same" });
  const a = renderHook(() => useThumbnail(f));
  await waitFor(() => expect(a.result.current.status).toBe("ready"));
  a.unmount();
  const b = renderHook(() => useThumbnail(f));
  await waitFor(() => expect(b.result.current.status).toBe("ready"));
  expect(invoke).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test`
Expected: all green — the 3 new hook tests plus the existing App/store suites (App renders an empty grid, so no thumbnail invokes fire there).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: ensureThumbnail wrapper + useThumbnail hook with tests"
```

---

## Task 6: `FileCard` + grid wiring + manual run

**Files:**
- Create: `src/components/FileCard.tsx`
- Modify: `src/components/FileGrid.tsx`

**Interfaces:**
- Consumes: `useThumbnail`, `FileInfo`.
- Produces: a grid whose cells show real thumbnails, with graceful loading/placeholder/error states.

- [ ] **Step 1: Create `src/components/FileCard.tsx`**

```tsx
import type { FileInfo } from "../lib/types";
import { useThumbnail } from "../lib/useThumbnail";

export function FileCard({ file }: { file: FileInfo }) {
  const { url, status } = useThumbnail(file);
  return (
    <div
      className="w-[152px] h-[150px] rounded bg-neutral-800 border border-neutral-700 overflow-hidden relative flex items-end"
      title={file.path}
    >
      {status === "ready" && url && (
        <img src={url} alt={file.name} className="absolute inset-0 w-full h-full object-cover" />
      )}
      {status === "loading" && <div className="absolute inset-0 animate-pulse bg-neutral-700/40" />}
      <span className="relative z-10 w-full truncate p-1 text-[11px] text-neutral-200 bg-gradient-to-t from-black/70 to-transparent">
        {file.name}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Render `<FileCard>` in `src/components/FileGrid.tsx`**

Add the import and replace the inline cell `<div>…</div>` (the one keyed by `f.id`) with the card:
```tsx
import { FileCard } from "./FileCard";
// ...
              {cells.map((f) => (
                <FileCard key={f.id} file={f} />
              ))}
```

- [ ] **Step 3: Verify tests still pass**

Run: `npm test`
Expected: all green (no regressions; empty-grid App test unaffected).

- [ ] **Step 4: Run the app and verify manually**

Run: `npm run tauri dev`
Verify:
- Scan a folder of JP/PNG images → cells fill with **sharp thumbnails**; scrolling 1,000+ stays smooth; the filename stays legible over each image.
- Close and reopen the app, scan again → thumbnails appear **instantly** (served from cache).
- Edit/replace a file (or `copy /b file.jpg +,,` to bump its mtime) → its thumbnail **regenerates** on next view.
- A folder containing a `.mp4`/`.heic`/`.svg` → those cells show the **filename card** (no image, no error).
- If any thumbnail fails to load (broken image), broaden the Task 4 Step-4 asset scope to `["$APPDATA/**"]` and re-run.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: FileCard thumbnails wired into the virtualized grid"
```

---

## Self-Review

**Spec coverage (spec §§2–8):**
- Raster formats jpg…tiff → Task 1 (`is_raster_supported`), Task 2/3 (decode/generate). ✓
- Cache key `blake3(path|mtime|size)`, `{key}.jpg`, persistence, auto-invalidation → Task 1 + Task 3. ✓
- Lazy asset-protocol delivery, path→`convertFileSrc` URL → Task 4 (command returns path) + Task 5 (wrapper). ✓
- 512px base, never upscale, JPEG q80, RGB8 → Task 2. ✓
- Concurrency (4-permit semaphore), atomic writes → Task 2 (rename) + Task 4 (semaphore). ✓
- Graceful placeholder/error for heic/svg/video → Task 5 (hook gating) + Task 6 (card). ✓
- Capabilities/asset protocol enabled + scoped → Task 4. ✓
- Testing: cargo (key/generate/sync core) + Vitest (hook gating, memo dedupe) + manual run → Tasks 1–3, 5, 6. ✓
- Deferred items (HEIC/SVG/video/tiering/prefetch) → not implemented, by design. ✓

**Placeholder scan:** no TBD/TODO; every code step is complete. The Task 4/6 asset-scope note is a concrete verify-and-adjust with an exact fallback value, not a placeholder. ✓

**Type consistency:** `thumb_cache_key`, `is_raster_supported`, `generate_thumbnail`, `ensure_thumbnail_sync`, `ThumbState`, `ensure_thumbnail`, `clear_thumbnail_cache` used with identical signatures across tasks; TS `ensureThumbnail`/`clearThumbnailCache`/`useThumbnail`/`ThumbStatus` consistent between Task 5 and Task 6. Command name `ensure_thumbnail`/`clear_thumbnail_cache` matches between Rust (Task 4) and the TS wrapper (Task 5). ✓
