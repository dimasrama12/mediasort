# Slice 7 — Grouping (visual pHash/dHash + temporal, sidebar indicators)

Roadmap: DESIGN.md §12.7 · Module: DESIGN.md §6.5 · Model: §4 (`GroupType`, `FileGroup`).

Autonomous overnight build — decisions default to the lean "option 1" and are recorded here
(no interactive brainstorm; user asleep). Supersedes nothing; extends prior slices.

## Goal

Let the user surface **near-duplicate** photos (visual) and **burst/session** clusters
(temporal), with each file's group shown as an indicator in the grid and the set of groups
summarised in the sidebar. Grouping is an explicit, user-triggered action with two modes —
never the confusing v1 "single blob" auto-merge (that hierarchical `AIGroupFiles` path is
**dropped**, per §6.5).

## Decisions (option-1 defaults)

1. **Hash = hand-rolled dHash (64-bit) via the existing `image` crate**, not the `image_hasher`
   crate. Rationale: `image_hasher` pins its own `image` version and risks a resolver conflict
   with our pinned `image = 0.25` (limited features); a self-implemented dHash is ~15 lines,
   deterministic, and unit-testable with synthetic PNGs. §6.5 names dHash the default and pHash
   the *option* — DCT-based pHash is deferred to a later optional sub-slice. Both are perceptual
   hashes; "pHash" in the §12 headline is shorthand for perceptual hashing.
   - dHash: decode → `to_luma8` → `resize_exact(9, 8, Triangle)` → for each of 8 rows compare the
     8 adjacent horizontal pairs (left > right ⇒ 1) → 64 bits.
2. **`similarity = 100 - distance*100/64`** (v1's scale, §6.5). Hamming distance via `count_ones`.
3. **Visual clustering = greedy** (v1 `GroupByVisualSimilarity`, minus the merge tiers): for each
   not-yet-grouped file in scan order, open a group, absorb every later ungrouped file with
   `similarity >= threshold`; keep the group only if `len >= min_size`. `similarity` field = the
   group's average pairwise similarity to the seed.
4. **Temporal grouping = sort + gap-split**: sort by timestamp asc, start a new group whenever the
   gap to the previous file exceeds `window_hours`; keep groups with `len >= min_size`.
   `time_span` = `"YYYY-MM-DD HH:MM – YYYY-MM-DD HH:MM"` (UTC, via a tiny civil-date function — no
   `chrono` dep).
5. **Timestamp source = `date_taken` if present else `modified_at`.** `date_taken` is still `None`
   until the optional #7d EXIF sub-slice, so temporal grouping runs on mtime today — functional,
   just coarser. Documented; not a blocker.
6. **Defaults** (from §4 `AppSettings`): `similarity_threshold = 80`, `time_window_hours = 1.0`,
   `min_group_size = 2`. Passed as command args this slice (settings module is slice 10); the
   frontend hard-codes these defaults for now.
7. **Only images are visually hashed** (videos/undecodable files are skipped, like v1). Temporal
   grouping applies to **all** files.
8. **Group ids are per-run, sequential** (`visual-1`, `temporal-1`, …). Assigning `FileInfo.groupId`
   onto files (for grid indicators) happens in the frontend store (#7c) from the returned groups —
   the backend returns pure `FileGroup[]` and does not mutate `FileInfo`.

## Backend surface (`grouping.rs`)

Pure, IO-free, unit-tested core (clustering never touches the filesystem):

```rust
pub fn dhash(path: &Path) -> Option<u64>;              // decode+hash; None if undecodable
pub fn hamming(a: u64, b: u64) -> u32;                 // (a ^ b).count_ones()
pub fn similarity(a: u64, b: u64) -> u32;              // 100 - distance*100/64
pub fn cluster_visual(items: &[Hashed], threshold: u32, min_size: usize) -> Vec<FileGroup>;
pub fn group_temporal(items: &[Timed], window_hours: f64, min_size: usize) -> Vec<FileGroup>;
fn fmt_utc(secs: i64) -> String;                       // "YYYY-MM-DD HH:MM", civil algorithm
```

`Hashed { id, hash }`, `Timed { id, timestamp }` are the pure inputs the commands assemble.

## Model additions (`model.rs` + `src/lib/types.ts`)

```rust
pub enum GroupType { Visual, Temporal }                // serde lowercase
pub struct FileGroup {                                  // serde camelCase
  pub id: String, pub name: String, pub file_ids: Vec<String>,
  pub similarity: f32, pub time_span: Option<String>, pub group_type: GroupType,
}
```

## IPC (#7b)

`group_visual(files: Vec<FileInfo>, threshold: u32) -> Vec<FileGroup>` (hashes on a background
thread with `group-progress {done,total}` events, then clusters). `group_temporal(files, hours) ->
Vec<FileGroup>` (cheap; no progress). Passing full `FileInfo` (not just ids, as the §5 table
sketched) avoids a re-stat and gives the backend `file_type` + timestamps directly — documented
deviation.

## Frontend (#7c)

Store `groups: FileGroup[]` + `groupMode: 'none'|'visual'|'temporal'` + a reducer that stamps
`groupId` onto each file from the active groups (and clears it otherwise). Toolbar "Group" control
(visual / temporal / clear). Grid `FileCard` shows a small group badge/left-border when `groupId`
is set. Sidebar gains a collapsible "Groups" section listing each group (name, type icon, count,
similarity% or time span); clicking a group focuses its first file.

## Acceptance

- Backend: identical images ⇒ distance 0 / similarity 100 and land in one visual group; an inverted
  image is far and excluded at threshold 80. Temporal: files within the window cluster; a gap larger
  than the window splits them; singletons are dropped at `min_size = 2`. `fmt_utc(0) == "1970-01-01 00:00"`.
- Frontend: triggering visual/temporal grouping stamps `groupId`s and populates the sidebar; "clear"
  removes all indicators. All existing tests stay green.
- Gate: `cargo test` + `npm test -- --run` green before each sub-slice merges `--ff-only` to `main`.
