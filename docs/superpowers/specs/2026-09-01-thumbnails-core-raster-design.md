# MediaSort v2 — Slice #3a: Core Raster Thumbnails — Design Spec

**Date:** 2026-09-01
**Status:** Draft for plan
**Grounded in:** `DESIGN.md` §2.1 (asset protocol, not base64), §6.3–6.4 (thumbnail/preview), §9 (capabilities); fixes v1 **bug #4** (blurry, janky previews).
**Scoping note:** DESIGN bundles HEIC + SVG + video into slice #3. This spec covers only the low-risk, pure-Rust **raster** path; the native/external decoders are split into follow-on plans so they can't block the win.

---

## 1. Goal

Show crisp, cached image thumbnails in the virtualized grid, delivered by Tauri's asset protocol — the root-cause fix for v1 bug #4, where base64-over-IPC + a fixed 200px thumbnail upscaled by CSS caused both jank and blur.

## 2. Scope

**In:**
- Thumbnails for the seven `image`-crate raster formats: `jpg jpeg png gif webp bmp tiff`.
- On-disk cache keyed to survive edits and persist across sessions.
- Asset-protocol delivery — no IPC bytes, no base64.
- Lazy, viewport-driven generation: only cells you scroll to are generated.
- Graceful degradation: not-yet-supported types (`heic/heif`, `svg`, video) and decode failures fall back to today's filename card.

**Out — each becomes its own later plan:**
- HEIC/HEIF via `libheif` — opens with the native-build spike (DESIGN §13.3).
- SVG via `resvg`.
- Video-frame thumbnails via runtime-detected `ffmpeg` (video cells show the filename card for now).
- Size-tiering (256/512), the `thumb://ready` prefetch event, the thumbnail-size/zoom setting.
- Full-res preview and original-file asset scope (slice #4).

## 3. Success criteria

1. Scrolling a raster folder shows sharp thumbnails; enlarging the window keeps them crisp (512px base ≫ ~150px card).
2. No main-thread jank on 1,000+ files (verified by running the app).
3. Thumbnails persist across restarts — a cached file loads instantly.
4. Editing a file (mtime/size change) regenerates its thumbnail automatically.
5. HEIC/SVG/video and unreadable files never error the grid; they show the filename card.
6. `cargo test` and Vitest suites are green.

## 4. Backend

### 4.1 New module `src-tauri/src/thumbnail.rs`

**Pure helpers (unit-tested):**
- `fn thumb_cache_key(normalized_path: &str, mtime: i64, size: u64) -> String` — `blake3` of `"{normalized_path}|{mtime}|{size}"`, hex. Stable per file; any change yields a new key and therefore a new cache file (invalidation is implicit — no separate staleness check).
- `fn is_raster_supported(ext: &str) -> bool` — true only for the seven formats (lowercased); false for heic/heif/svg/video/unknown.
- `fn generate_thumbnail(src: &Path, dst: &Path, max_edge: u32) -> Result<(), ThumbError>`:
  - `image::open(src)?`.
  - If the longest edge ≤ `max_edge`, keep the original size — **never upscale**; otherwise `resize(max_edge, max_edge, FilterType::Lanczos3)` (fits the box, preserves aspect).
  - Convert to RGB8 (JPEG has no alpha; transparent regions render on black), encode JPEG q≈80.
  - Write to a `.tmp` sibling, then `fs::rename` onto `dst` — atomic, so a crash mid-generation never leaves a half file.

**Managed state:** `struct ThumbState { cache_dir: PathBuf, sem: tokio::sync::Semaphore }`, `sem` = 4 permits. `cache_dir` resolved once in `setup` from `app.path().app_data_dir()?.join("thumbnails")`, created if missing.

**Commands:**
- `#[tauri::command] async fn ensure_thumbnail(state, path: String) -> Result<String, String>`
  1. `norm = normalize_path(&path)`.
  2. `stat` → `mtime`, `size` (error → `Err`).
  3. `key = thumb_cache_key(&norm, mtime, size)`; `dst = cache_dir.join(format!("{key}.jpg"))`.
  4. If `dst` exists → return its path string immediately (cache hit).
  5. Else acquire a semaphore permit, `spawn_blocking(|| generate_thumbnail(&src, &dst, 512))`, await, return the `dst` path string (`Err(String)` on failure).
  - Returns the **absolute cache-file path**, not a URL — the URL is built JS-side (see §5.1).
- `#[tauri::command] async fn clear_thumbnail_cache(state) -> Result<(), String>` — remove and recreate `cache_dir`.

`ensure_thumbnail` assumes a supported raster file; the frontend gates which files call it (§5.2), so no "unsupported" return variant is needed and DESIGN's `ensure_thumbnail(path) -> url` contract is preserved by the TS wrapper.

### 4.2 `src-tauri/src/lib.rs`
Resolve `ThumbState` in `.setup(...)` (needs `&App` for the path), `app.manage(...)` it, and register `thumbnail::ensure_thumbnail` + `thumbnail::clear_thumbnail_cache` in the invoke handler alongside the existing scan commands.

### 4.3 `src-tauri/Cargo.toml`
Add `image = "0.25"` (default codecs cover all seven formats) and `blake3 = "1"`. Concurrency uses tokio's `Semaphore`, already available via Tauri — no new async or `rayon` dependency. Tests synthesize inputs with the `image` crate itself, so no dev-dep beyond the existing `tempfile`.

## 5. Frontend

### 5.1 `src/lib/commands.ts`
- `ensureThumbnail(path: string): Promise<string>` = `convertFileSrc(await invoke<string>("ensure_thumbnail", { path }))`. `convertFileSrc` (from `@tauri-apps/api/core`) turns the returned cache path into the platform asset URL; keeping it JS-side avoids hand-building `http://asset.localhost/...` in Rust, which is fragile across platforms/versions.
- `clearThumbnailCache(): Promise<void>` = `invoke("clear_thumbnail_cache")`.

### 5.2 `src/lib/useThumbnail.ts` (new hook)
`useThumbnail(file: FileInfo): { url: string | null; status: 'loading' | 'ready' | 'error' | 'placeholder' }`
- If `file.fileType === 'video'` or `file.extension ∈ {heic, heif, svg}` → return `{ url: null, status: 'placeholder' }` immediately and **never invoke**.
- Otherwise: on mount, read the module cache; hit → `ready`; miss → `loading`, call `ensureThumbnail(file.path)`, then `ready` / `error`.
- **Module-level caches** survive cell unmount/remount: `resolved: Map<id, url>` and `inflight: Map<id, Promise<url>>` — so the same file never generates twice, even under fast scrolling.

### 5.3 `src/components/FileGrid.tsx`
Render each cell by status:
- `ready` → `<img src={url}>`, `object-cover` filling the 152×150 cell, filename kept as a bottom gradient overlay (`title={f.path}`).
- `loading` → the current neutral card with a subtle `animate-pulse`.
- `placeholder` / `error` → **exactly today's filename card**, so video/HEIC/SVG look unchanged until their slices land.

## 6. Capabilities / config
- `tauri.conf.json` → `app.security.assetProtocol = { enable: true, scope: [<thumbnails cache dir>] }`. Scope covers only the cache dir; originals stay out until the preview slice. The exact scope syntax (glob vs `$APPDATA` variable) is verified against the running Tauri 2.11 during implementation — see §9.
- `capabilities/default.json` — add whatever asset permission the version requires, alongside the existing `core:default`, `opener:default`, `dialog:default`.

## 7. Concurrency, correctness, performance
- Semaphore (4 permits) caps simultaneous CPU-bound generations, keeping the app responsive under fast scroll.
- Atomic temp-then-rename writes prevent partial cache files.
- In-flight dedupe on the JS side (`inflight` map) plus idempotent Rust generation (last-writer-wins via rename) makes concurrent requests for one file safe.
- Lazy generation means a 50,000-file folder costs nothing until scrolled; WebView2 caches decoded asset images natively.

## 8. Testing
**`cargo test` (`thumbnail.rs`, `tempfile` + `image`-synthesized inputs):**
- key is stable for identical inputs and differs when `mtime` or `size` changes.
- `generate_thumbnail` downscales a >512 image to fit 512 preserving aspect, does **not** upscale a <512 image, and emits a decodable JPEG.
- `is_raster_supported` truth table: jpg/png/webp/… true; heic/svg/mp4/txt false.

**Vitest:**
- `useThumbnail` gating: raster → calls `ensureThumbnail` (mocked) and resolves to `ready`; heic/svg/video → `placeholder` with `ensureThumbnail` never called.
- module cache: two mounts of the same id trigger one invoke.

**Manual (run the app):** scroll a real photo folder — thumbnails crisp and smooth on 1,000+; restart → instant from cache; touch a file → it regenerates; a folder containing a video/HEIC/SVG → those cells show filename cards with no errors.

## 9. Risks / open items
- **Asset-protocol scope syntax** is the one version-sensitive detail. It is well-documented (not a spike) and is verified first in implementation; "images actually load via `asset://`" is its acceptance point.
- The cache lives under Tauri's identifier-based app-data path (`…\com.dimasrama.mediasort\thumbnails`), a minor deviation from DESIGN's literal `%APPDATA%\MediaSort`; the future settings `cache_path` can override it.

## 10. Deferred (explicitly not in this slice)
HEIC/HEIF (+ build spike), SVG, video-frame thumbnails/ffmpeg, size-tiering, `thumb://ready` prefetch, thumbnail-size/zoom setting, full-res preview and source-folder asset scope.
