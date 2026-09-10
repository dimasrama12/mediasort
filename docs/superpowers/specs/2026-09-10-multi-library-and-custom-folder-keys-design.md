# Multi-library scanning and custom folder keys — design

**Date:** 2026-09-10
**Status:** approved, not yet implemented

Four related changes to MediaSort v0.2.0:

1. **Multi-folder scanning** — add a folder to the scan without losing the one already open.
2. **Custom target-folder keys** — any single key, not just `1`–`9`, and no cap on folder count.
3. **A→Z toggle** — sort target folders by name, re-keying as it goes.
4. **Group scope** — when several libraries are open, choose which ones a grouping run covers.

(2) is the foundation: it changes `FolderInfo`, which crosses the IPC boundary and is baked into
saved project files. (1), (3) and (4) build on it.

---

## 1. The folder-key model

### Why it changes

`FolderInfo.shortcut` is a `u8` constrained to `1..=9`, and that constraint is enforced in three
separate places (`upsert_target`, `add_existing_in`, and the sidebar's `full` flag). It is both the
folder's keyboard trigger and its display order, so neither can move without the other. Supporting
letters and symbols means the trigger stops being a number, and supporting more than nine folders
means the trigger stops being the order.

### The struct

```rust
pub struct FolderInfo {
    pub id: String,       // = normalize_path(path) — unchanged
    pub name: String,
    pub path: String,
    /// The single key that files into this folder: "1", "F", ";", "Shift+:".
    /// "" means the folder has no keyboard trigger (drag-and-drop still works).
    pub key: String,
    /// True when the user set this key by hand. The A→Z re-key leaves these alone.
    pub key_custom: bool,
    pub file_count: u32,
}
```

`shortcut` is removed outright rather than kept alongside `key`. Two parallel notions of "the key"
would have to be reconciled in the sidebar, the grid handler, project save/load and the A→Z
re-keying — four chances to disagree, which is the shape of every folder bug this codebase has
already fixed once.

### Key strings are keybinding combos

A key is stored in exactly the canonical form `src/lib/keybindings.ts::eventToCombo()` already
produces: modifiers in fixed order (`Ctrl`, `Alt`, `Shift`, `Meta`), single characters
upper-cased, named keys verbatim. `"1"`, `"F"`, `";"`, `"Shift+:"`.

This is the point of the whole design. Folder keys and app shortcuts become directly comparable
strings, so "does this conflict?" is `actionForCombo(bindings, combo) != null` — a lookup, not a
guess. Display reuses `formatCombo()`.

### Auto-assignment

```
POOL = 1 2 3 4 5 6 7 8 9 0
       Q W E R T Y U I O P A S D F G H J K L Z X C V B N M
       ; ' , . / - =
```

`next_free_key(list, reserved) -> String` returns the first pool entry that is neither already a
folder's key nor in `reserved`. **Pool exhausted returns `""`** — the folder is still created and
still accepts drops; it just has no keystroke. Erroring instead would reintroduce the cap through
the back door.

Letters that collide with a default binding (`B` trash, `T` trash panel) are *not* stripped from
the pool statically. They are filtered at assignment time by `reserved`, which tracks the user's
*current* bindings — a user who rebinds `trash` off `B` should get `B` back. `J` and `K` are
different: they are grid navigation, not a binding, so they are filtered via `FIXED_KEYS` below and
are never available at all.

### ReservedKeys

```rust
pub struct ReservedKeys(pub Mutex<Vec<String>>);   // folders.rs, beside FolderState
```

Managed state, seeded at startup with the default global bindings so it is never empty even if the
frontend never calls in. The frontend replaces it via a new `set_reserved_keys(keys)` command:

- once from `App.tsx` after settings load, and
- from `SettingsPanel` after every capture, every per-action reset, and "Reset all shortcuts".

It holds only `scope: "global"` combos. Preview-scope actions (rotate, zoom) fire only while the
full-screen preview is open, where folder keys are inert anyway, so reserving `L`, `R`, `+`, `-`,
`0` would cost five pool entries to prevent a collision that cannot happen.

### Fixed keys

Structural keys are never assignable and never reserved-by-binding, because they are not bindings:
`J`, `K`, `Enter`, `Escape`, `Space`, the four arrows, `Ctrl+Z`, `Ctrl+Y`, `Ctrl+Shift+Z`. They
live in one exported `FIXED_KEYS` list in `keybindings.ts`, are appended to what
`set_reserved_keys` sends, and are checked by the capture UI so the refusal message can name them.

### Migrating saved projects

A project written by v0.2.0 has `"shortcut": 3` and no `"key"`. Serde ignores unknown fields, so
the folder loads with `key: ""` and `key_custom: false`. `openProject` already sorts folders before
handing them to `adopt_session`, and `adopt_in` already assigns in the order it receives — so the
survivors take `1`, `2`, `3`… in their saved order, reproducing the numbering the project was saved
with.

The sort key in `openProject` changes from `a.shortcut - b.shortcut` to array order for legacy
projects (every `key` is `""`) and to pool-rank order for new ones. One helper, `keyRank(key)`,
returns the pool index or `Infinity`.

**This is a one-way format change.** Projects saved by the new build carry `key`/`keyCustom` and
no `shortcut`; opened in v0.2.0 they would fail to deserialize `shortcut`. Acceptable: the app is
single-user and the installer replaces in place. Noted here so it is not a surprise later.

---

## 2. Multi-folder scanning

### The action

New rebindable action in `ACTIONS`:

```ts
{ id: "addScanFolder", label: "Add folder to the scan", scope: "global", defaults: ["Ctrl+Shift+O"] }
```

`Ctrl+Shift+O` is free — checked against all 23 existing defaults (`Ctrl+O`, `Ctrl+N`, `Delete`,
`B`, `Shift+Delete`, `` ` ``, `Shift+R`, `Ctrl+A`, `Ctrl+H`, `[`, `]`, `T`, `Ctrl+,`, `Ctrl+'`,
`Ctrl+R`, `F5`, `Alt+X`, `Ctrl+F`, `L`, `R`, `+`, `=`, `-`, `0`).

### The flow

`src/lib/appActions.ts` gains `addScanFlow()`, sitting beside the existing `scanFlow()`:

```
dirs = await pickFolders()          -> null/[] cancels
fresh = dirs not already in roots   (normalizePath compare)
if fresh is empty                   -> notice "Already scanned." and stop
st.startAddScan(fresh)
await scanFolders(fresh)
```

It deliberately does **not** call `clearTargetFolders()` (the targets belong to the session, which
is continuing) and **not** `clearThumbnailMemo()` (existing thumbnails are still valid). The
backend needs no change: `scan_folders` already grants access scope additively and already prunes
registered target folders out of the walk.

### The reducer

`startAddScan(newRoots)` keeps files, target folders and their keys, undo/redo, `query`, selection
and focus. It changes:

```
roots:    [...roots, ...newRoots]
scanning: true
scanBase: files.length            // so `scanned` accumulates
groups: [], groupMode: "none", activeGroupId: null
files:  every file's groupId -> null
```

Groups are cleared because a half-grouped library misleads: the sidebar would say "Group 3 — 47
files" while 180 newly-added photos that belong in it sit under "Ungrouped".

Two supporting changes:

- **`addFiles` dedupes by id.** Today it is `[...s.files, ...batch]`. The backend dedupes within
  one run via its own `seen` set, but not across runs — adding `D:\foto` when `D:\foto\2024` is
  already scanned would list those files twice.
- **`scanned` accumulates.** `finishScan(total)` becomes `scanned: s.scanBase + total`, with
  `scanBase: 0` set by `startScan` and `files.length` by `startAddScan`.

### The button

A round blue `+` pinned bottom-left inside the grid area (`FileGrid`), 36px,
`title="Add folder to the scan (Ctrl+Shift+O)"`, `aria-label="Add folder to the scan"`. Hidden
while `scanning`. Shown even with nothing scanned yet — on an empty app it simply performs a first
scan, which is the harmless reading.

It is positioned `absolute bottom-4 left-4` over the scroll container, not in flow, so it does not
move with the thumbnails.

### Sidebar header

The grey path line at the top of the sidebar shows `roots[0]` and nothing else. It becomes
`D:\foto\2024  +1 more` when `roots.length > 1`, with all roots joined by newlines in the `title`.
No list, no per-root controls — those were considered and dropped as unnecessary UI.

### Known limitation

`returnToLibrary()` (the `` ` `` key) moves files out of a browsed target folder back into
`roots[0]`. With several roots the file's origin root is not recorded anywhere — `completeMove`
keeps only the destination — so it stays `roots[0]`. Documented rather than fixed: recording origin
per file is a larger change than this feature warrants, and `roots[0]` is the folder the user
scanned first, which is the best available guess.

---

## 3. Custom keys and conflict rules

### Assigning

The `<kbd>` chip in each sidebar folder row becomes a button. Click → the chip reads `…` and the
next keypress is captured (capture-phase listener, exactly as `SettingsPanel`'s shortcut capture
works, so it beats every app handler). `Escape` cancels. A folder with no key shows `—`.

The captured combo is validated **before** the IPC call, and a refusal shows an inline message
naming the reason:

| Condition | Message |
|---|---|
| bound to a global action | `Ctrl+O is already "Open / scan folder".` |
| held by another folder | `; is already "Foto Lama".` |
| in `FIXED_KEYS` | `Enter is reserved by the app.` |

On success, `set_folder_key(id, key)` sets `key` and `key_custom: true` and returns the refreshed
list. A separate "clear key" affordance is not added; re-assigning is the common case, and a
folder with no key is reachable by drag-and-drop.

### Matching

In `FileGrid`'s key handler the digit block

```ts
if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key >= "1" && e.key <= "9") {
  const folder = folders.find((f) => f.shortcut === Number(e.key));
```

becomes

```ts
const combo = eventToCombo(e);
const folder = combo ? folders.find((f) => f.key !== "" && f.key === combo) : undefined;
if (folder) { ... }
```

in the **same position** — after the rebindable-action switch. That ordering is the real guarantee:
app shortcuts are matched first, so even a conflict that somehow reached the registry can never
shadow one. Everything downstream (browsing-a-target no-op, selection-else-focused, the failure
notice) is unchanged.

### The reverse direction

`SettingsPanel`'s capture currently strips the captured combo from every other *action*. It gains
the symmetric folder check: if the combo is a folder's key, the capture is refused and names the
folder. Rebinding an action must not silently kill a folder key.

### Sorting for display

`upsertFolder`'s `sort((a, b) => a.shortcut - b.shortcut)` becomes `keyRank(a.key) -
keyRank(b.key)`, where `keyRank` is the pool index (`Infinity` for `""` and for custom keys outside
the pool, which then sort last in insertion order — a stable sort preserves it).

---

## 4. A→Z toggle

### Setting

`AppSettings` gains `sortFoldersAlphabetically: bool` (Rust: `sort_folders_alphabetically`,
`#[serde(default)]`), default `false`. Back-compat is free: an older `settings.json` without the
key loads on `false`, which is today's behaviour.

### The switch

A small labelled toggle sitting directly above the folder list in the expanded sidebar:
`A→Z` + a switch, `aria-label="Sort target folders alphabetically"`. Hidden when the sidebar is
collapsed and when there are no folders.

Flipping it persists the setting (via the existing `save_settings`) and then calls a new
`reorder_folders()` command, which takes no arguments — it reads the freshly-saved flag from
`SettingsState`, applies the ordering and returns the updated list. Saving before reordering is
what makes the two agree.

### apply_order

```
apply_order(list, alphabetical, reserved):
    if not alphabetical: return                 // insertion order, keys untouched
    sort list by name.to_lowercase()
    taken = { f.key for f in list if f.key_custom }
    pool  = POOL minus taken minus reserved
    for f in list where not f.key_custom:
        f.key = pool.next() or ""
```

Custom keys stay glued to their folder and are removed from the pool, so a non-custom folder can
never be handed a key a custom one already holds.

Called at the end of every mutating command — `create_folder`, `add_existing_folders`,
`add_existing_folder`, `rename_folder`, `delete_folder`, `set_folder_key`, `adopt_session` — reading
the flag from `SettingsState` the way `scan_folders` already reads `scan_subfolders`.

`list_target_folders` **does not** call it. A listing that silently re-keys folders as a side
effect would fire on every `Ctrl+R` and every post-move `syncFolders()`, which is precisely the
class of surprise this codebase has already been bitten by. It sorts for display only.

### Delete

`delete_in`'s "renumber the survivors to a contiguous `1..N`" is kept but generalised: after a
delete, non-custom folders are re-keyed from the pool in their current order, custom ones are left
alone. Digits stay gapless, hand-set keys stay where the user put them.

---

## 5. Group scope pop-up

### When

Clicking Similar / Time / Date / Type opens the pop-up **only when `roots.length > 1`**. One
library scanned means there is nothing to choose, and a modal that always says the same thing is a
modal people learn to dismiss without reading.

### The panel

New `src/components/GroupScopePanel.tsx`, following `ConfirmDelete`'s shape (scrim, `role="dialog"`,
`useFocusTrap`, `useClickOutside`, Esc cancels):

```
┌ Group: Similar ───────────────────┐
│ Which libraries?                  │
│  ☑ D:\foto\2024              400  │
│  ☑ E:\dcim\camera            180  │
│  ☐ F:\backup\hp              920  │
│                    total: 580     │
│              [Cancel]  [Group]    │
└───────────────────────────────────┘
```

Counts are derived from `files`, not read from disk. "Group" is disabled when nothing is checked.

### State and flow

```
groupScopeMode: "visual" | "temporal" | "date" | "type" | null   // null = closed
groupRoots: string[]                                             // remembered for the session
```

`groupRoots` defaults to all roots and is re-seeded with any newly added root, so an added library
is included by default rather than silently skipped.

The Toolbar's `runGroup` / `runClientGroup` gain one guard at the top: `roots.length > 1` →
`st.requestGroupScope(mode)` and return. The panel's Group button calls the same two functions with
the chosen roots, so there is exactly one grouping code path.

Scoping is a filter applied to `files` before the grouping call:

```ts
const inScope = (f: FileInfo) =>
  roots.some((r) => f.id === normalizePath(r) || f.id.startsWith(normalizePath(r) + "\\"));
```

`f.id` is already the normalized path, so no per-file normalization is needed.

### Effect on the grid

None beyond the grouping itself. `applyGroups` already sets `groupId: null` on every file absent
from the result, and `applyGroupView`'s "All" already ranks ungrouped files after every real group.
So out-of-scope files stay visible and collect below the groups — which is the chosen behaviour.

---

## Testing

Vitest, alongside the existing per-module test files:

- `keybindings.test.ts` — `Ctrl+Shift+O` is unique among defaults; `FIXED_KEYS` overlaps no default.
- `folderKeys.test.ts` (new) — `keyRank` ordering; the three conflict rules, each with its message.
- `useAppStore.test.ts` — `startAddScan` keeps files/folders/undo and clears groups; `addFiles`
  dedupes by id; `scanned` accumulates across two runs.
- `groupScope.test.ts` (new) — `inScope` matches files under a root, excludes siblings whose path
  merely shares a prefix (`D:\foto2024` vs `D:\foto`), and handles a root that is itself a file's dir.
- `Sidebar.test.tsx` — the A→Z toggle renders and calls through; the key chip captures and refuses.

Rust `#[cfg(test)]` in `folders.rs`:

- `next_free_key` skips taken and reserved keys, and returns `""` on an exhausted pool.
- more than nine folders can be registered (the cap is really gone).
- `apply_order` alphabetical re-keys non-custom folders and leaves custom ones untouched.
- `set_folder_key` rejects a key another folder holds.
- a project JSON carrying `"shortcut": 3` and no `"key"` deserializes and adopts onto a real key.

Then `npm run tauri dev` for a manual pass, `npm run tauri build` for the installer, then commit
and push.

## Files touched

| File | Change |
|---|---|
| `src-tauri/src/model.rs` | `FolderInfo`: `shortcut` → `key` + `key_custom`; `AppSettings.sort_folders_alphabetically` |
| `src-tauri/src/folders.rs` | pool, `next_free_key`, `apply_order`, `set_folder_key`, `reorder_folders`, cap removal |
| `src-tauri/src/folders.rs` | also: `ReservedKeys` managed state, beside `FolderState` |
| `src-tauri/src/lib.rs` | register `set_reserved_keys`, `set_folder_key`, `reorder_folders`; manage `ReservedKeys` |
| `src/lib/types.ts` | `FolderInfo.key`/`keyCustom`; `AppSettings.sortFoldersAlphabetically` |
| `src/lib/keybindings.ts` | `addScanFolder` action, `FIXED_KEYS`, `keyRank`, `POOL` |
| `src/lib/commands.ts` | `setReservedKeys`, `setFolderKey`, `reorderFolders` |
| `src/lib/appActions.ts` | `addScanFlow` |
| `src/store/useAppStore.ts` | `startAddScan`, `scanBase`, `addFiles` dedupe, group-scope state |
| `src/components/FileGrid.tsx` | `addScanFolder` case, combo-based folder match, floating `+` |
| `src/components/Sidebar.tsx` | key chip capture, A→Z toggle, multi-root header, cap removal |
| `src/components/SettingsPanel.tsx` | folder-key conflict check, `setReservedKeys` calls |
| `src/components/Toolbar.tsx` | group-scope guard |
| `src/components/GroupScopePanel.tsx` | new |
| `src/App.tsx` | mount `GroupScopePanel`, initial `setReservedKeys` |
