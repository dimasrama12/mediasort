# MediaSort — UI/UX review and security audit

Two independent reviews of the Tauri + React codebase as it stands after the current feature
batch (marquee selection, trash refactor, contextual grouping, EXIF viewer, custom context menu).

Findings carry a severity and a specific file. Nothing here is speculative about behaviour that
was not read in the source.

---

## Implementation status (2026-09-05)

Everything in **B2 Remediation order** is now in the code, plus the A5 quick wins:

| # | Fix | Where it landed |
|---|---|---|
| 1 | Trash id validated against the trash directory | `trash.rs::id_is_bare` + a canonicalised containment check in `restore_in`; `restore_refuses_a_traversal_id` covers it |
| 2 | Strict CSP (with a permissive `devCsp` so `tauri dev` still hot-reloads) | `tauri.conf.json` |
| 3 | Session path allowlist on every **mutating** command | new `guard.rs`; called from `move_files`, `delete_files_permanently`, `batch_rename`, `rename_files`, `trash_files`, `restore_from_trash`, `rotate_image` |
| 4 | Header dimension check + `image::Limits` before every decode | `media.rs::decode_any` / `decode_with_limits`, **and** `wic.rs` — the WIC fallback was the way around the check, since a file the Rust decoder refuses falls through to it |
| 5 | `decode_preview` downscales to 2048 px; `read_data_url` capped at 24 MB | `media.rs` |
| 6 | Atomic writes for `trash.json` and `settings.json` | `fileops.rs::write_atomic`, used by both |
| 7 | `create_new(true)` + bounded retries for collisions | `fileops.rs::reserve_target`, `trash.rs::restore_in` |
| 8 | Per-path lock for `rotate_image` | `media.rs::PathLock` |

**Deliberately narrower than the finding:** #3 gates the commands that *change* files, not the
read-only ones (`ensure_thumbnail`, `read_exif`, `decode_preview`). A read primitive is a much
smaller blast radius than an unlink primitive, and gating the read paths risks a blank thumbnail
on a path nobody remembered to grant — a visible regression traded for a marginal gain. The read
paths are bounded by #4 and #5 instead. The scope is also *additive* across scans rather than
cleared on `startScan` as A-B1 suggests: undo has to be able to put a file back into the previous
root an hour later.

From Part A: A5 1–7 are all done (Empty Trash confirmed through `ConfirmDelete`; the thumbnail
memo is capped at 3 000 entries with insertion-order eviction; `aria-live` on both progress
readouts; Enter opens the preview; the group badge carries its number; `useFocusTrap` is applied
to all five modals; `role="listbox"` on the trash and `role="grid"`/`gridcell` + `aria-selected`
on the grid). A1.7 (`decoding="async"`, `loading="lazy"`) and A3.4–A3.8 are done. A4.1, A4.2,
A4.5 and A4.6 are done; A4.4 is moot — the contextual grouping it refers to was removed (see
below).

**Not done, and why:** A1.2 (thumbnail request cancellation), A1.3 (normalising the store to
`Record<id, FileInfo>`), A1.5/A1.6, A2's store slicing, and A4.3 (stable group ids across
re-grouping) are all real but are refactors of working code rather than fixes to broken code.

The contextual grouping this document reviews **no longer exists**: union-find over a soft link
rule put 1 089 of 1 090 files into one group on a real folder, so `group_visual` is back to
greedy seed-based clustering on the perceptual hash alone. `cluster_visual_never_chains_a_gradient_into_one_blob`
is the regression test.

---

# Part A — UI/UX and frontend engineering

## A1. Rendering 1 000+ items

### A1.1 What already works

- **Row virtualization** (`@tanstack/react-virtual` in `FileGrid.tsx`) with `overscan: 8`, and an
  explicit `rowVirtualizer.measure()` when geometry changes. Only ~15 rows are ever mounted.
- **Fixed column counts** (9 with the sidebar, 10 without) with widths derived from the measured
  container, so there is no per-tile layout thrash on resize — one `ResizeObserver`, one width
  in state.
- **Thumbnail work is bounded twice**: a module-level promise memo in `useThumbnail.ts` collapses
  duplicate requests, and `ThumbState`'s `Semaphore::new(4)` (`thumbnail.rs`) caps concurrent
  backend decodes. On-disk thumbnails are keyed by blake3 of `path|mtime|size`, so they are
  never stale and never regenerated needlessly.

### A1.2 Problems worth fixing

| # | Severity | Issue |
|---|---|---|
| 1 | Medium | **The thumbnail memo grows without bound.** `resolved` and `inflight` in `useThumbnail.ts` are plain `Map`s that only ever grow. A session that scrolls a 50 000-file library retains 50 000 URL strings plus keys — tens of MB of JS heap that is never reclaimed. **Fix:** a small LRU (2–3 k entries) or a `Map` capped by insertion order. |
| 2 | Medium | **No request cancellation or prioritisation.** Flicking the scrollbar mounts and unmounts hundreds of tiles; every one fires `ensureThumbnail`, and the 4-permit backend queue then works through requests for rows that scrolled off screen minutes ago. **Fix:** drop requests whose tile has unmounted (an `AbortController`-style generation counter), or prioritise by distance from the viewport. |
| 3 | Medium | **Every store mutation copies the whole `files` array.** `applyRotation`, `applyGroups`, `clearGroups` and `completeRename` all run `s.files.map(...)` — O(n) allocations per single-file change. At 50 000 files a rotation copies 50 000 object references. **Fix:** normalise to `Record<id, FileInfo>` + an `ids: string[]` order array, or adopt Immer's structural sharing. |
| 4 | Low-Medium | **`visible` recomputes on any `files` identity change.** The `useMemo` in `FileGrid.tsx` chains filter → bucket → sort → group view; since (3) replaces the array on every mutation, this whole chain re-runs after each trash/move/rotate. Fixing (3) fixes most of this. |
| 5 | Low-Medium | **`setVisibleIds` runs in an effect after render**, so selection state is one render behind the grid on the frame a filter changes. It is idempotent and guarded, but deriving `visibleIds` during render (or in the same selector) would remove the class of bug entirely. |
| 6 | Low | **Marquee selection only sees mounted rows.** `onGridMouseDown` queries `[data-file-id]` from the DOM, so a band dragged past the viewport edge does not select rows that are not rendered. It is honest behaviour (you can only sweep what you can see) but a fast drag plus autoscroll would surprise. **Fix:** compute hits from row/column geometry — the grid already knows `columns`, `cw`, `ch` and `GAP` — and add edge auto-scroll during a drag. |
| 7 | Low | **Images lack `decoding="async"`, intrinsic dimensions, and `content-visibility`.** Adding `decoding="async"` plus explicit width/height on the tile `<img>` removes main-thread decode stalls and layout shift during fast scroll. |
| 8 | Low | **The whole grid remounts on Ctrl+R** (`key={refreshNonce}`). Correct and cheap at the scale of one virtualized viewport, but it also discards scroll position. Worth a comment or a scroll-restore if refresh becomes frequent. |

## A2. State management

- **Good:** one Zustand store, actions colocated with the state they mutate, no context nesting,
  reducers pure enough to unit-test directly (53 tests do exactly that).
- **Good:** `visibleIds` as the single source of truth for what a range selection walks — this is
  what keeps Shift+click honest under sorting and grouping.
- **Watch:** the store is now ~35 state fields and ~60 actions in one flat object. Selection,
  trash, grouping, modals and history are independent concerns; slicing the store (Zustand
  supports composed slices) would make each testable in isolation and stop `reset()`/`startScan()`
  from having to remember every new transient field — a real hazard, since each new feature has
  needed both to be updated by hand.
- **Watch:** three separate "nonce" fields (`newFolderRequested`, `searchRequested`,
  `refreshNonce`) implement cross-component commands through state. It works, but a tiny event
  emitter would express the intent more directly than a counter nobody reads the value of.

## A3. Accessibility

| # | Severity | Issue |
|---|---|---|
| 1 | Medium | **No focus trap in any modal.** Settings, Rename, Projects, EXIF and Confirm-Delete all render over the app; Tab walks straight out into the grid behind them. Only `ConfirmDelete` moves focus in (its cancel button). **Fix:** a shared `useFocusTrap(ref, active)` — focus first element on open, cycle Tab within, restore focus to the trigger on close. |
| 2 | Medium | **The grid has no grid semantics.** Tiles are `<button>`s (keyboard-reachable, good) but there is no `role="grid"`/`role="row"`/`role="gridcell"`, no `aria-selected`, and no `aria-multiselectable`. A screen reader hears a long undifferentiated list of buttons and is never told what is selected. |
| 3 | Medium | **Trash rows use `role="option"` without a `role="listbox"` parent.** That combination is invalid; the container needs `role="listbox"` and `aria-multiselectable="true"`. |
| 4 | Low-Medium | **Group identity is colour-only.** `groupColor(groupIndex)` paints a dot; there is no text or shape alternative, so the grouping is invisible to a colour-blind user. The `title`/`aria-label` says "In group visual-3", which is an id, not a name. **Fix:** show the group's number in the badge. |
| 5 | Low-Medium | **Progress is not announced.** "Scanning…", "Hashing 412 / 1100" and the group-progress bar have no `aria-live="polite"`, so a screen-reader user gets no feedback during the longest operations in the app. |
| 6 | Low | **The `✦` Settings tab has no accessible name** — its label is a glyph. Add `aria-label`. |
| 7 | Low | **No `prefers-reduced-motion` handling.** The preview's `transition: transform 0.12s`, the progress bar's width transition and `animate-pulse` placeholders should all be disabled under that query. |
| 8 | Low | **Icon-only controls in the toolbar** (`↶ ↷ ⊞ ≣ ⏱ # ✎ ⛁ ⚙`) carry `aria-label` and `title` — good — but the new date-order segment reads "⏱"/"#" visually with no legend. A one-word text label ("Oldest" / "Busiest") would be clearer for everyone, not only assistive tech. |

## A4. User flow

1. **`Empty Trash` is irreversible and unconfirmed.** `Shift+Delete` on a single file opens
   `ConfirmDelete` with a file list and a "cannot be undone" warning; emptying the entire trash —
   strictly more destructive — is one click with no confirmation. This is the clearest
   inconsistency in the app. Route it through the same dialog.
2. **Preview discoverability regressed with the Space binding removed.** Double-click is now the
   only way in from the keyboard-less path, and nothing on screen says so. `Enter` on the focused
   tile costs nothing and restores a keyboard route without reintroducing Space.
3. **Group ids are not stable across re-grouping.** Ordering by volume renumbers `visual-N`, so a
   project saved before this change references ids that mean something different now. Groups
   round-trip through `project.rs` — worth either versioning the project format or deriving ids
   from content rather than position.
4. **The contextual grouping has no visible controls.** Palette gate, aspect tolerance and the
   72-hour context window are compile-time constants in `grouping.rs`. The Settings panel exposes
   `similarityThreshold` and `timeWindowHours`; the new context window is the one knob most likely
   to need tuning per library, and it is unreachable.
5. **`minGroupSize` in Settings is dead.** `MIN_GROUP_SIZE` is hard-coded to 1 in `grouping.rs`
   (deliberately — so no file is ever dropped), but the setting still renders and still persists.
   Remove the control or wire it to something.
6. **Right-click "Delete" means trash, not delete.** Correct and undoable, but the label is
   ambiguous next to `Shift+Delete`'s permanent delete. "Move to Trash" would remove all doubt.
7. **`Ctrl+'` twice is undiscoverable** without opening the Shortcuts tab. It is in there, which is
   the right place — worth one line in the User Guide too.

## A5. Quick wins, in order of value per hour

1. Confirm `Empty Trash` (reuse `ConfirmDelete`). — *~30 min*
2. Cap the thumbnail memo with an LRU. — *~30 min*
3. `aria-live` on the scan/group progress readouts. — *~20 min*
4. `Enter` opens the preview on the focused tile. — *~15 min*
5. Group number inside the colour badge. — *~20 min*
6. Shared `useFocusTrap` across the five modals. — *~2 h*
7. `role="listbox"` on the trash list, grid roles on the grid. — *~1 h*

---

# Part B — Security audit

## B0. Threat model

MediaSort is a local, offline desktop app. There is no server, no authentication, no remote
content, and every command runs with the invoking user's own privileges — so "privilege
escalation" is not the risk. The realistic threats are:

- **T1 — Malicious media files.** The user sorts photos from anywhere: downloads, someone else's
  camera card, a shared drive. Every parser in the app (image decoders, EXIF, WIC) consumes
  attacker-authored bytes.
- **T2 — Renderer compromise.** Anything that gets script running in the webview inherits the full
  IPC surface, which today can move, rename and permanently delete arbitrary files anywhere on
  disk.
- **T3 — Resource exhaustion.** A crafted or merely enormous file that makes the app allocate
  until the machine swaps.
- **T4 — Data loss through non-atomic writes** — not an attacker, but the same blast radius.

The findings below are ordered by how much they enlarge the blast radius of T1–T4.

## B1. Findings

### 🔴 HIGH — `restore_from_trash` will move any file on disk to any destination

`src-tauri/src/trash.rs::restore_in` builds its source path as `trash_dir.join(id)` and then
`rename`s it to `dest_path` — both `id` and `dest` arriving verbatim from the frontend:

```rust
pub fn restore_in(trash_dir: &Path, id: &str, dest_path: &str) -> Result<String, String> {
    let entry = trash_dir.join(id);
    if !entry.exists() { return Err("item not found in trash".to_string()); }
    // ... renames `entry` to `dest_path`
```

The only check is *existence*, never *membership*. An `id` of `..\..\..\Users\Me\Documents\tax.pdf`
escapes the trash directory, and `dest` chooses where the file lands. That is an arbitrary file
move primitive reachable from one `invoke` call.

**Fix:** look the id up in `load_metadata(trash_dir)` and refuse anything that is not a key of the
map; separately, reject any `id` containing a path separator or `..`. The codebase already has the
right pattern one module over — `project.rs::sanitize` (`file_for` strips every character that is
not alphanumeric, `-` or `_`, with a dedicated `id_is_sanitized_against_traversal` test). Apply the
same discipline here.

### 🟠 MEDIUM-HIGH — No path confinement on any file-mutating command

Every one of these accepts absolute paths straight from the webview and acts on them with no
allowlist:

| Command | File | Effect |
|---|---|---|
| `move_files` | `fileops.rs` | move anything anywhere |
| `delete_files_permanently` | `fileops.rs` | unlink any file (directories correctly refused) |
| `batch_rename`, `rename_files` | `fileops.rs` | rename anything |
| `trash_files` | `trash.rs` | move anything into app data |
| `rotate_image` | `media.rs` | rewrite any image file in place |
| `read_image_data_url`, `decode_preview`, `read_exif` | `media.rs`, `exifdata.rs` | read any file the user can read |
| `ensure_thumbnail` | `thumbnail.rs` | read + decode any raster file |

Under T2 this is the whole filesystem. The app already knows exactly which paths are legitimate:
the scan roots (`ScanState`/`setRoots`) and the registered target folders (`FolderState`), which is
precisely the set it grants to the asset protocol in `scan.rs`.

**Fix:** keep a session allowlist of canonicalised root prefixes in Tauri managed state; add one
`fn ensure_allowed(path: &Path) -> Result<PathBuf, String>` that canonicalises (resolving symlinks
and `..`) and checks the prefix; call it at the top of every command in the table. Roughly 40 lines
plus one call per command, and it makes the HIGH finding above unreachable even if the id check
were ever removed.

### 🟠 MEDIUM — Content Security Policy is disabled

`src-tauri/tauri.conf.json` sets `"csp": null`. That switches off the one control that would stop
injected script from reaching the IPC bridge, and it is the multiplier on every finding above.

**Fix:** a strict policy, e.g.

```json
"csp": "default-src 'self'; img-src 'self' asset: http://asset.localhost data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ipc: http://ipc.localhost; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
```

`style-src 'unsafe-inline'` is needed for the inline `style` attributes the virtualizer and the
preview transform rely on; `data:` in `img-src` is needed for `decode_preview` and the Settings
portrait. Verify against the running app — a broken CSP fails silently and visibly.

### 🟠 MEDIUM — Unbounded memory on the preview and data-URL paths

- `media.rs::decode_preview` decodes a full-resolution image and returns it as a **base64 PNG data
  URL over IPC**. A 6000×4000 photo is ~72 MB of raw RGBA, a lossless PNG of it can be tens of MB,
  and base64 adds 33 % — all of it serialised into a JSON string, copied through the IPC channel,
  and held again as a JS string. One HEIC preview can cost hundreds of MB across the boundary.
  **Fix:** downscale to the window's needs (2 048 px longest edge is generous) before encoding, and
  emit JPEG or WebP rather than PNG for photographic content.
- `media.rs::read_data_url` reads an entire file into memory and base64s it with no size cap. It is
  only used for the Settings portrait today, but the command takes an arbitrary path.
  **Fix:** cap at a few MB and return a clear error past it.

### 🟠 MEDIUM — Decompression bombs and concurrent full-size decodes

`grouping.rs::feature_all` runs up to 8 threads, each holding a fully decoded `DynamicImage`.
Eight 8000×6000 RGBA images is ~1.5 GB resident. Nothing checks declared dimensions before
decoding, so a crafted PNG/TIFF advertising 60 000×60 000 will attempt a ~14 GB allocation
(T1 + T3).

**Fix, in order:**
1. Call `image::image_dimensions` (a header read, already used in `exifdata.rs`) and reject or skip
   anything beyond a sane pixel budget before decoding.
2. Set `image::io::Limits` on the reader (`max_alloc`) so the crate enforces the budget itself.
3. Make the worker count a function of a *pixel* budget rather than a fixed `clamp(1, 8)`.

The same applies to `thumbnail.rs::generate_thumbnail`, which is bounded to 4 concurrent decodes by
its semaphore but has no per-image ceiling.

### 🟡 LOW-MEDIUM — EXIF handling (largely addressed in this batch)

`exifdata.rs` treats EXIF as hostile by design: `sanitize` strips control characters and collapses
whitespace, values are capped at 512 characters, the entry count is capped at 400, and `unquote`
normalises the crate's ASCII rendering. Values reach the DOM as React text nodes, so they are
escaped, and `kamadak-exif` is pure Rust with no `unsafe` parsing path.

Residual notes:
- Filenames and paths also flow into `title` attributes throughout the app. React escapes them, so
  this is defence-in-depth rather than a live issue, but a filename is attacker-controlled too.
- GPS tags are shown verbatim. If a "share" or "export" feature ever lands, EXIF location data
  should be strippable — a photo's coordinates are the most sensitive field in the file.

### 🟡 LOW — Non-atomic writes to app state

`trash.rs::save_metadata` and `settings.rs` write with `std::fs::write`, which truncates first. A
crash or power loss mid-write leaves a truncated `trash.json` — and since `load_metadata` falls
back to `BTreeMap::new()` on a parse error, the app comes back up with an **empty trash index while
the files are still on disk**: every trashed file becomes unrecoverable through the UI.

**Fix:** write to a temp sibling and `rename` over the target — exactly what
`thumbnail.rs::generate_thumbnail` already does for cache files.

### 🟡 LOW — TOCTOU and unbounded loops in collision resolution

`fileops.rs::resolve_collision` and `trash.rs::restore_in` both probe `exists()` and then create
the file — a race if anything else touches the directory in between, and an unbounded
`loop { n += 1 }` if a directory somehow contains every candidate name.

**Fix:** create with `OpenOptions::new().create_new(true)` and retry on `AlreadyExists`; cap the
attempts and fail cleanly.

### 🟡 LOW — In-place rotation has no concurrency guard and loses quality

`media.rs::rotate_image` decodes, rotates and re-encodes over the original via temp + rename. Two
rapid `R` presses can overlap on the same path, and each JPEG round-trip is generational quality
loss on the user's original file.

**Fix:** a per-path mutex (or an in-flight set) in managed state; and for JPEG specifically, prefer
a lossless transform, or at minimum re-encode at a high fixed quality and say so in the UI.

### 🟡 LOW — Asset-protocol scope is broad and permanent for the session

`scan.rs` grants `allow_directory(root, true)` — recursive — for every scanned root, and
`list_folder_files`/`file_infos` add more as the user browses. Scope is never revoked, so by the
end of a long session the webview can read a large part of the disk. This is inherent to how the
app shows originals, but it deserves to be a conscious decision rather than an accident: grant
non-recursively where possible (`file_infos` already does) and consider clearing scope on
`startScan`.

### ℹ️ INFO — Things that are already right

- `paths.rs::normalize_path` gives one canonical identity key, which is what makes folder dedup and
  cache keys correct rather than accidental.
- `delete_permanently_in` refuses directories outright and reports back exactly which paths went,
  so the UI can never claim a deletion that did not happen.
- `project.rs` sanitises ids against traversal *and tests it* — the model the trash module should
  follow.
- Thumbnails are written temp-then-rename, so a crash never leaves a half-image in the cache.
- The capability set in `capabilities/default.json` is minimal and was trimmed of the fullscreen
  permission when it stopped being needed.

## B2. Remediation order

| Priority | Fix | File | Effort |
|---|---|---|---|
| 1 | Validate the trash id against `trash.json` | `trash.rs` | ~15 min |
| 2 | Enable a strict CSP | `tauri.conf.json` | ~1 h incl. verification |
| 3 | Path allowlist helper + call it in every mutating command | new `guard.rs`, then `fileops.rs`, `media.rs`, `trash.rs`, `thumbnail.rs`, `exifdata.rs` | ~3 h |
| 4 | Dimension check + `image::Limits` before every decode | `media.rs`, `grouping.rs`, `thumbnail.rs` | ~2 h |
| 5 | Downscale `decode_preview`; cap `read_data_url` | `media.rs` | ~1 h |
| 6 | Atomic writes for `trash.json` and `settings.json` | `trash.rs`, `settings.rs` | ~30 min |
| 7 | `create_new(true)` + bounded retries for collisions | `fileops.rs`, `trash.rs` | ~1 h |
| 8 | Per-path lock for `rotate_image` | `media.rs` | ~1 h |

## B3. Ongoing

- **`cargo audit` / `cargo deny` in CI.** The dependency surface (`image`, `windows`,
  `kamadak-exif`, `trash`, `walkdir`, `blake3`) is small and well chosen, but image decoders are
  where CVEs live; this app's entire T1 exposure sits in that crate graph.
- **Fuzz the parsers you own.** `exifdata::sanitize`, `paths::normalize_path`,
  `fileops::plan_batch_rename` and `scan::parse_exif_datetime` are pure functions over hostile
  input — ideal `cargo-fuzz` targets, and cheap ones.
- **Keep the `*_in` / pure-function split.** Nearly every security-relevant behaviour in this
  codebase is already reachable from a unit test without touching the real filesystem. That is the
  single biggest reason these fixes are small.
