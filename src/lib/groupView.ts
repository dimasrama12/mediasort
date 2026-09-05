//! "All" vs. a single group (§5). Grouping used to only tag tiles with a badge; the grid still
//! showed one flat list in sort order, so the groups were invisible as *blocks*. This module turns
//! the group list into a view:
//!
//!   * **All** — every file, but reordered so group 1's files come first, then group 2's, and so
//!     on, with anything ungrouped last. Within a group the incoming (sorted) order is kept.
//!   * **one group** — only that group's files.

import type { FileGroup, FileInfo } from "./types";

/** Reorder/filter `files` (already filtered + sorted) for the active group selection.
 *  `activeGroupId === null` means "All"; an id that no longer exists degrades to "All". */
export function applyGroupView(
  files: FileInfo[],
  groups: FileGroup[],
  activeGroupId: string | null,
): FileInfo[] {
  if (groups.length === 0) return files;
  if (activeGroupId != null && groups.some((g) => g.id === activeGroupId)) {
    return files.filter((f) => f.groupId === activeGroupId);
  }
  const order = new Map(groups.map((g, i) => [g.id, i]));
  // Ungrouped files sort after every real group rather than being dropped — "All" means all.
  const rank = (f: FileInfo): number =>
    (f.groupId != null ? order.get(f.groupId) : undefined) ?? groups.length;
  return files
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i)
    .map((x) => x.f);
}
