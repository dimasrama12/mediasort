# Full-Size Preview + Fullscreen Viewer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click any grid file to open a fullscreen viewer showing the pixel-exact original (image) or inline playback (video), with an always-visible close button + Esc and ←/→ navigation — the root-cause fix for v1 bug #5.

**Architecture:** The scanned source folders are granted to Tauri's asset protocol at scan time, so the frontend renders an original by pointing an `<img>`/`<video>` at `convertFileSrc(path)` (synchronous, no per-file IPC, no re-encode). A module-scoped `Preview` overlay reads a `previewId` from the Zustand store; `FileCard` clicks set it; keyboard and buttons drive close/next/prev. Unsupported formats and load errors fall back to a filename card.

**Tech Stack:** React 19 + TypeScript, Zustand, Tauri v2 asset protocol (`convertFileSrc`, `asset_protocol_scope`), Rust (`tauri::Manager`), Vitest + `@testing-library/react`.

**Spec:** [`../specs/2026-09-01-preview-fullscreen-design.md`](../specs/2026-09-01-preview-fullscreen-design.md) — the plan argues from the spec; executors read both.

## Global Constraints

- **Toolchain:** Rust **MSVC** (`stable-x86_64-pc-windows-msvc`, pinned via `rust-toolchain.toml`); build output at `D:/mediasort-target` (`.cargo/config.toml`); lib crate-type `rlib`-only.
- **Browser-native image formats (this slice):** `jpg jpeg png gif webp bmp` (lowercased comparison). **Browser-native video:** `mp4 webm mov`. Everything else — `heic heif svg tiff`, `mkv avi`, unknown, and any decode/playback failure — shows the **fallback card**, never an error, never a crash.
- **Delivery:** originals load by `asset://` URL via `convertFileSrc(path)` (synchronous, JS-side); the webview decodes natively. Source folders are granted to the asset scope at scan time. **No base64/image bytes over IPC. No network.**
- **Identity:** `FileInfo.id` is already `normalize_path(path)` (see `scan.rs`), stable and unique; `previewId` uses it. Navigation is index math over `files`, clamped at both ends.
- **Tests:** Rust via `cargo test`; frontend via Vitest. A task isn't done until its tests pass; the final visual task (Task 6) must be **run**.

---

## File Structure

**Created:**
- `src/lib/preview.ts` — `previewKind` format gate + `previewSrc` URL helper (pure).
- `src/lib/preview.test.ts` — Vitest for the gate/helper.
- `src/components/Preview.tsx` — the fullscreen overlay.
- `src/components/Preview.test.tsx` — Vitest for the overlay.

**Modified:**
- `src/store/useAppStore.ts` — add `previewId` + `openPreview`/`closePreview`/`previewNext`/`previewPrev`; clear on `startScan`/`reset`.
- `src/store/useAppStore.test.ts` — tests for the preview state.
- `src/components/FileCard.tsx` — make the card a `<button>` that opens the preview.
- `src/App.tsx` — render `<Preview />`.
- `src-tauri/src/scan.rs` — grant asset scope for each scanned root.

---

## Task 1: `preview.ts` — format gate + URL helper (TDD)

**Files:**
- Create: `src/lib/preview.ts`, `src/lib/preview.test.ts`

**Interfaces:**
- Consumes: `convertFileSrc` (`@tauri-apps/api/core`); `FileInfo` (`./types`).
- Produces: `type PreviewKind = "image" | "video" | "unsupported"`; `previewKind(file: FileInfo): PreviewKind`; `previewSrc(file: FileInfo): string`.

- [ ] **Step 1: Write the failing test** — `src/lib/preview.test.ts`

```ts
import { expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
}));

import { previewKind, previewSrc } from "./preview";
import type { FileInfo } from "./types";

const mk = (over: Partial<FileInfo> = {}): FileInfo => ({
  id: "1", path: "C:/x/a.jpg", name: "a.jpg", extension: "jpg", size: 1,
  modifiedAt: 0, dateTaken: null, fileType: "image", groupId: null, ...over,
});

test("browser-native images are 'image' (case-insensitive)", () => {
  for (const e of ["jpg", "jpeg", "png", "gif", "webp", "bmp", "JPG", "PNG"])
    expect(previewKind(mk({ extension: e }))).toBe("image");
});

test("browser-native videos are 'video'", () => {
  for (const e of ["mp4", "webm", "mov", "MP4"])
    expect(previewKind(mk({ fileType: "video", extension: e }))).toBe("video");
});

test("deferred/unknown formats are 'unsupported'", () => {
  for (const e of ["heic", "heif", "svg", "tiff", "txt", ""])
    expect(previewKind(mk({ extension: e }))).toBe("unsupported");
  for (const e of ["mkv", "avi"])
    expect(previewKind(mk({ fileType: "video", extension: e }))).toBe("unsupported");
});

test("previewSrc wraps the path through convertFileSrc", () => {
  expect(previewSrc(mk({ path: "C:/x/a.jpg" }))).toContain("asset://");
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm test -- --run src/lib/preview.test.ts`
Expected: FAIL (`preview.ts` does not exist / no exports).

- [ ] **Step 3: Create `src/lib/preview.ts`**

```ts
import { convertFileSrc } from "@tauri-apps/api/core";
import type { FileInfo } from "./types";

const NATIVE_IMAGE = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"]);
const NATIVE_VIDEO = new Set(["mp4", "webm", "mov"]);

export type PreviewKind = "image" | "video" | "unsupported";

/** Decide how a file previews: inline image, inline video, or fallback card.
 * heic/heif/svg/tiff and mkv/avi are intentionally 'unsupported' this slice. */
export function previewKind(file: FileInfo): PreviewKind {
  const ext = file.extension.toLowerCase();
  if (file.fileType === "video") return NATIVE_VIDEO.has(ext) ? "video" : "unsupported";
  return NATIVE_IMAGE.has(ext) ? "image" : "unsupported";
}

/** Asset URL for the original file. Scope is granted at scan time (see scan.rs),
 * so this is synchronous — no per-file IPC. convertFileSrc stays JS-side. */
export const previewSrc = (file: FileInfo): string => convertFileSrc(file.path);
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npm test -- --run src/lib/preview.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/preview.ts src/lib/preview.test.ts
git commit -m "feat: preview format gate + asset-url helper with tests"
```

---

## Task 2: Store preview state (TDD)

**Files:**
- Modify: `src/store/useAppStore.ts`, `src/store/useAppStore.test.ts`

**Interfaces:**
- Consumes: existing `files: FileInfo[]`.
- Produces: `previewId: string | null`; `openPreview(id: string): void`; `closePreview(): void`; `previewNext(): void`; `previewPrev(): void`.

- [ ] **Step 1: Append failing tests to `src/store/useAppStore.test.ts`**

```ts
import { useAppStore } from "./useAppStore";
import type { FileInfo } from "../lib/types";

const mkf = (id: string): FileInfo => ({
  id, path: `C:/x/${id}.jpg`, name: `${id}.jpg`, extension: "jpg", size: 1,
  modifiedAt: 0, dateTaken: null, fileType: "image", groupId: null,
});

test("openPreview sets and closePreview clears previewId", () => {
  useAppStore.setState({ files: [mkf("a"), mkf("b")], previewId: null });
  useAppStore.getState().openPreview("a");
  expect(useAppStore.getState().previewId).toBe("a");
  useAppStore.getState().closePreview();
  expect(useAppStore.getState().previewId).toBeNull();
});

test("previewNext / previewPrev move and clamp at both ends", () => {
  useAppStore.setState({ files: [mkf("a"), mkf("b"), mkf("c")], previewId: "a" });
  useAppStore.getState().previewPrev(); // already first → clamp
  expect(useAppStore.getState().previewId).toBe("a");
  useAppStore.getState().previewNext();
  expect(useAppStore.getState().previewId).toBe("b");
  useAppStore.getState().previewNext();
  expect(useAppStore.getState().previewId).toBe("c");
  useAppStore.getState().previewNext(); // already last → clamp
  expect(useAppStore.getState().previewId).toBe("c");
});

test("reset clears previewId", () => {
  useAppStore.setState({ files: [mkf("a")], previewId: "a" });
  useAppStore.getState().reset();
  expect(useAppStore.getState().previewId).toBeNull();
});
```

Note: if the test file lacks a top-of-file `import { expect, test } from "vitest";`, add it (match the existing style — Vitest globals may already be enabled).

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- --run src/store/useAppStore.test.ts`
Expected: FAIL (`openPreview` is not a function / `previewId` undefined).

- [ ] **Step 3: Edit `src/store/useAppStore.ts`**

Add `previewId` and the four actions to the `AppState` interface:
```ts
  previewId: string | null;
  openPreview: (id: string) => void;
  closePreview: () => void;
  previewNext: () => void;
  previewPrev: () => void;
```

Change the store factory to take `get` and implement them. Replace the `create<AppState>((set) => ({ ... }))` body with:
```ts
export const useAppStore = create<AppState>((set, get) => ({
  files: [],
  scanning: false,
  scanned: 0,
  previewId: null,
  startScan: () => set({ scanning: true, files: [], scanned: 0, previewId: null }),
  addFiles: (batch) => set((s) => ({ files: [...s.files, ...batch] })),
  finishScan: (total) => set({ scanning: false, scanned: total }),
  reset: () => set({ files: [], scanning: false, scanned: 0, previewId: null }),
  openPreview: (id) => set({ previewId: id }),
  closePreview: () => set({ previewId: null }),
  previewNext: () => {
    const { files, previewId } = get();
    const i = files.findIndex((f) => f.id === previewId);
    if (i < 0 || i >= files.length - 1) return;
    set({ previewId: files[i + 1].id });
  },
  previewPrev: () => {
    const { files, previewId } = get();
    const i = files.findIndex((f) => f.id === previewId);
    if (i <= 0) return;
    set({ previewId: files[i - 1].id });
  },
}));
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- --run src/store/useAppStore.test.ts`
Expected: all green (the new 3 plus any existing store tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/useAppStore.ts src/store/useAppStore.test.ts
git commit -m "feat: store preview state (open/close/next/prev with clamping)"
```

---

## Task 3: `Preview.tsx` overlay (TDD)

**Files:**
- Create: `src/components/Preview.tsx`, `src/components/Preview.test.tsx`

**Interfaces:**
- Consumes: `useAppStore` (`previewId`, `files`, `closePreview`, `previewNext`, `previewPrev`); `previewKind`, `previewSrc` (`../lib/preview`).
- Produces: `export function Preview(): JSX.Element | null`.

- [ ] **Step 1: Write failing tests** — `src/components/Preview.test.tsx`

```tsx
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
}));

import { Preview } from "./Preview";
import { useAppStore } from "../store/useAppStore";
import type { FileInfo } from "../lib/types";

const img = (id: string): FileInfo => ({
  id, path: `C:/x/${id}.jpg`, name: `${id}.jpg`, extension: "jpg", size: 1,
  modifiedAt: 0, dateTaken: null, fileType: "image", groupId: null,
});
const vid = (id: string): FileInfo => ({ ...img(id), path: `C:/x/${id}.mp4`, name: `${id}.mp4`, extension: "mp4", fileType: "video" });
const heic = (id: string): FileInfo => ({ ...img(id), extension: "heic", name: `${id}.heic` });

beforeEach(() => useAppStore.setState({ files: [], previewId: null }));
afterEach(cleanup);

test("renders nothing when no preview is open", () => {
  const { container } = render(<Preview />);
  expect(container.firstChild).toBeNull();
});

test("renders an <img> with an asset src for an image", () => {
  useAppStore.setState({ files: [img("a")], previewId: "a" });
  render(<Preview />);
  const el = document.querySelector("img");
  expect(el).not.toBeNull();
  expect(el!.getAttribute("src")).toContain("asset://");
});

test("renders a <video> for a video file", () => {
  useAppStore.setState({ files: [vid("v")], previewId: "v" });
  render(<Preview />);
  expect(document.querySelector("video")).not.toBeNull();
});

test("shows the fallback card for an unsupported format", () => {
  useAppStore.setState({ files: [heic("h")], previewId: "h" });
  render(<Preview />);
  expect(screen.queryByText(/not available/i)).not.toBeNull();
});

test("the close button closes the preview", () => {
  useAppStore.setState({ files: [img("a")], previewId: "a" });
  render(<Preview />);
  fireEvent.click(screen.getByLabelText("Close"));
  expect(useAppStore.getState().previewId).toBeNull();
});

test("Escape closes the preview", () => {
  useAppStore.setState({ files: [img("a")], previewId: "a" });
  render(<Preview />);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(useAppStore.getState().previewId).toBeNull();
});

test("ArrowRight navigates to the next file", () => {
  useAppStore.setState({ files: [img("a"), img("b")], previewId: "a" });
  render(<Preview />);
  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(useAppStore.getState().previewId).toBe("b");
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- --run src/components/Preview.test.tsx`
Expected: FAIL (`Preview` does not exist).

- [ ] **Step 3: Create `src/components/Preview.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { previewKind, previewSrc } from "../lib/preview";

export function Preview() {
  const previewId = useAppStore((s) => s.previewId);
  const files = useAppStore((s) => s.files);
  const closePreview = useAppStore((s) => s.closePreview);
  const previewNext = useAppStore((s) => s.previewNext);
  const previewPrev = useAppStore((s) => s.previewPrev);
  const [errored, setErrored] = useState(false);

  // Reset the load-error flag whenever the shown file changes.
  useEffect(() => setErrored(false), [previewId]);

  // Global keys while open: Esc closes, arrows / j / k navigate.
  useEffect(() => {
    if (previewId == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePreview();
      else if (e.key === "ArrowRight" || e.key === "j") previewNext();
      else if (e.key === "ArrowLeft" || e.key === "k") previewPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewId, closePreview, previewNext, previewPrev]);

  if (previewId == null) return null;
  const file = files.find((f) => f.id === previewId);
  if (!file) return null;

  const kind = previewKind(file);
  const showFallback = kind === "unsupported" || errored;
  const src = previewSrc(file);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={closePreview}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute top-3 right-4 z-10 text-3xl leading-none text-neutral-200 hover:text-white"
        onClick={(e) => { e.stopPropagation(); closePreview(); }}
      >
        ✕
      </button>
      <button
        type="button"
        aria-label="Previous"
        className="absolute left-3 z-10 px-2 text-4xl text-neutral-300 hover:text-white"
        onClick={(e) => { e.stopPropagation(); previewPrev(); }}
      >
        ‹
      </button>
      <button
        type="button"
        aria-label="Next"
        className="absolute right-3 z-10 px-2 text-4xl text-neutral-300 hover:text-white"
        onClick={(e) => { e.stopPropagation(); previewNext(); }}
      >
        ›
      </button>

      <div className="max-h-[95vh] max-w-[95vw]" onClick={(e) => e.stopPropagation()}>
        {showFallback ? (
          <div className="rounded border border-neutral-700 bg-neutral-800 px-8 py-10 text-center">
            <div className="truncate text-sm text-neutral-200">{file.name}</div>
            <div className="mt-2 text-xs text-neutral-400">
              Preview not available for .{file.extension.toLowerCase()} yet
            </div>
          </div>
        ) : kind === "video" ? (
          <video
            src={src}
            controls
            autoPlay
            className="max-h-[95vh] max-w-[95vw]"
            onError={() => setErrored(true)}
          />
        ) : (
          <img
            src={src}
            alt={file.name}
            className="max-h-[95vh] max-w-[95vw] object-contain"
            onError={() => setErrored(true)}
          />
        )}
      </div>
    </div>
  );
}
```

Note: `onError` is the runtime safety net (an original that WebView2 can't decode, or a deleted file) — it swaps to the fallback card. jsdom does not fire image load events, so it is covered by the Task 6 manual run, not a unit test.

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- --run src/components/Preview.test.tsx`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/components/Preview.tsx src/components/Preview.test.tsx
git commit -m "feat: fullscreen Preview overlay (close/nav/fallback) with tests"
```

---

## Task 4: `FileCard` opens preview + `App` renders it (TDD)

**Files:**
- Modify: `src/components/FileCard.tsx`, `src/App.tsx`
- Create: `src/components/FileCard.test.tsx`

**Interfaces:**
- Consumes: `useAppStore` (`openPreview`); `Preview` (`./components/Preview`).
- Produces: a clickable card and an app that mounts the overlay. No new exported symbols.

- [ ] **Step 1: Write the failing test** — `src/components/FileCard.test.tsx`

```tsx
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// Stub the thumbnail hook so the card renders without touching Tauri.
vi.mock("../lib/useThumbnail", () => ({
  useThumbnail: () => ({ url: null, status: "placeholder" }),
}));

import { FileCard } from "./FileCard";
import { useAppStore } from "../store/useAppStore";
import type { FileInfo } from "../lib/types";

const file: FileInfo = {
  id: "x1", path: "C:/x/a.jpg", name: "a.jpg", extension: "jpg", size: 1,
  modifiedAt: 0, dateTaken: null, fileType: "image", groupId: null,
};

afterEach(cleanup);

test("clicking a card opens that file's preview", () => {
  useAppStore.setState({ previewId: null });
  render(<FileCard file={file} />);
  fireEvent.click(screen.getByRole("button"));
  expect(useAppStore.getState().previewId).toBe("x1");
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- --run src/components/FileCard.test.tsx`
Expected: FAIL (no `button` role — the card is still a `<div>`).

- [ ] **Step 3: Modify `src/components/FileCard.tsx`**

Read the current file. Add the store import near the top:
```tsx
import { useAppStore } from "../store/useAppStore";
```
Inside the component body (above the `return`), add:
```tsx
  const openPreview = useAppStore((s) => s.openPreview);
```
Turn the card's **outer element** into a button: change the outer `<div ... title={file.path}>` opening tag to
```tsx
    <button
      type="button"
      onClick={() => openPreview(file.id)}
      title={file.path}
```
keep the existing `className` but append `text-left` to it, and change that element's matching closing `</div>` to `</button>`. Leave the thumbnail `<img>`/placeholder/filename children exactly as they are.

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- --run src/components/FileCard.test.tsx`
Expected: 1 passed.

- [ ] **Step 5: Render `<Preview />` in `src/App.tsx`**

Add the import:
```tsx
import { Preview } from "./components/Preview";
```
Render it as the last child inside `<main>`, after `<FileGrid />`:
```tsx
      <Toolbar />
      <FileGrid />
      <Preview />
```

- [ ] **Step 6: Run the full frontend suite — expect PASS**

Run: `npm test -- --run`
Expected: all green — the new preview/store/card tests plus the existing App/store/thumbnail suites (App still renders an empty grid; `Preview` returns `null` with no `previewId`, so App behavior is unchanged).

- [ ] **Step 7: Commit**

```bash
git add src/components/FileCard.tsx src/components/FileCard.test.tsx src/App.tsx
git commit -m "feat: open fullscreen preview on card click; mount Preview in App"
```

---

## Task 5: Grant asset scope for scanned roots (compile-verified)

**Files:**
- Modify: `src-tauri/src/scan.rs`

**Interfaces:**
- Consumes: the `app: AppHandle` already passed to `scan_folders`; Tauri's `Manager::asset_protocol_scope`.
- Produces: at scan start, every scanned root is allowed by the asset protocol so its originals load via `asset://`.

- [ ] **Step 1: Import the `Manager` trait**

In `src-tauri/src/scan.rs`, change the Tauri use line (currently `use tauri::{AppHandle, Emitter, State};`) to:
```rust
use tauri::{AppHandle, Emitter, Manager, State};
```

- [ ] **Step 2: Grant scope at the top of `scan_folders`**

Immediately after `state.cancel.store(false, Ordering::SeqCst);`, before building the batch, add:
```rust
    // Let the webview load originals under these roots via the asset protocol
    // (full-res preview + inline video). Best-effort: a failed grant only means
    // that file falls back to the filename card, never a crash.
    for root in &paths {
        let _ = app.asset_protocol_scope().allow_directory(root, true);
    }
```

- [ ] **Step 3: Verify the crate compiles**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: success.
If the API name differs on Tauri 2.11, adjust to the crate's asset-scope accessor — the intent is "add each `root` (recursive) to the asset protocol scope." The likely alternatives are `allow_directory(root, /*recursive*/ true)` returning `tauri::Result<()>` (current assumption) or granting per the `tauri::scope::fs::Scope` returned by `asset_protocol_scope()`. This is the one version-sensitive detail flagged in spec §9; the manual run in Task 6 is its end-to-end acceptance ("an original loads via `asset://`").

- [ ] **Step 4: Verify backend tests still pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 13 passed (unchanged — this is a runtime side effect with no new unit surface).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/scan.rs
git commit -m "feat: grant asset-protocol scope for scanned roots (preview originals)"
```

---

## Task 6: Manual run + acceptance (bug #5)

**Files:** none (verification only).

- [ ] **Step 1: Confirm both suites are green**

Run: `npm test -- --run` then `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: all green.

- [ ] **Step 2: Run the app**

Run: `npm run tauri dev`

- [ ] **Step 3: Verify manually**

- Scan a folder of JPG/PNG → click a photo → it opens **fullscreen and pixel-sharp** (matches the original; no blur, no upscale).
- The **✕ button closes** the viewer; **Esc closes** it; clicking the dark backdrop closes it — **v1 bug #5 fixed**.
- **→/←** (and J/K) step through files without leaving fullscreen; the first/last file clamps.
- An **MP4/WebM plays inline** with transport controls.
- A **HEIC / SVG / MKV** file, or a file deleted after scan, shows the **fallback card** — no crash, grid still works.

- [ ] **Step 4: Commit (if any tweaks were needed during the run)**

```bash
git add -A && git commit -m "chore: preview slice manual-run verification"
```

(If the run needed no changes, skip this commit.)

---

## Self-Review

**Spec coverage (spec §§2–8):**
- Click-to-open fullscreen overlay → Task 4 (`FileCard` button) + Task 3 (`Preview`). ✓
- Pixel-exact originals for jpg/jpeg/png/gif/webp/bmp via asset protocol → Task 1 (`previewKind`/`previewSrc`) + Task 5 (scope). ✓
- Inline `<video>` for mp4/webm/mov → Task 1 gate + Task 3 (`<video controls autoPlay>`). ✓
- Always-visible ✕ + Esc (bug #5) + ←/→/J/K nav + backdrop close → Task 3. ✓
- Runtime asset scope for scanned roots → Task 5. ✓
- Graceful fallback for heic/heif/svg/tiff, mkv/avi, unreadable → Task 1 (`unsupported`) + Task 3 (fallback card + `onError`). ✓
- Testing: Vitest (gate, store nav+clamp, overlay render/close/nav/fallback, card click) + manual run → Tasks 1–4, 6. ✓
- Deferred (multi-select, HEIC/SVG/TIFF decoders, `preview.rs`/`get_preview_url`, ffmpeg, zoom/pan) → not implemented, by design. ✓

**Placeholder scan:** no TBD/TODO; every code step is complete. The Task 5 Step-3 note is a concrete verify-and-adjust with the exact intent and likely alternatives, matching how slice #3a handled its asset-scope detail — not a placeholder. ✓

**Type consistency:** `PreviewKind`, `previewKind`, `previewSrc` (Task 1) used unchanged in Task 3; store `previewId`/`openPreview`/`closePreview`/`previewNext`/`previewPrev` (Task 2) consumed with identical names in Tasks 3–4; `FileInfo` fields (`id`, `path`, `name`, `extension`, `fileType`) match `src/lib/types.ts`; `FileInfo.id === normalize_path(path)` matches `scan.rs`. Rust `asset_protocol_scope().allow_directory(root, true)` uses the `Manager` trait imported in Task 5 Step 1. ✓
