//! Keeping the sidebar's group counts honest (§1 "real-time group count").
//!
//! Group membership is stored twice: `FileGroup.fileIds` (what the sidebar counts, and what gets
//! persisted with a project) and `FileInfo.groupId` (what the grid's group view reads). Every
//! reducer that takes files out of the library — move to a target folder, trash, permanent
//! delete — filtered `files` and left `fileIds` untouched, so a group whose 99 files had all been
//! moved still advertised 99 in the sidebar until a full re-scan rebuilt the groups.
//!
//! Rather than teach each of the ~8 removal/restore reducers to prune, `fileIds` is reconciled
//! against the live `files` array in one place (the store's `set` wrapper). `groupId` travels
//! with the file for free — it is part of the record that gets filtered out and re-inserted — so
//! it is the side of the pair that is always right, and this module makes the other side agree.

import type { FileGroup, FileInfo } from "./types";

/**
 * `groups` with every `fileIds` list reconciled against the files actually in the library.
 *
 * Files that left are filtered out (the count decrements; a fully emptied group stays listed at
 * 0 rather than vanishing), and files that came back — an undone trash/move, or a "return to
 * library" that re-mints the id from the new path — are appended. Existing order is preserved so
 * a no-op reconcile is genuinely a no-op.
 *
 * Identity is deliberate: unchanged groups keep their object identity and an entirely unchanged
 * list returns the very same array, so this can run on every file mutation without churning
 * React through a re-render of the sidebar.
 */
export function syncGroupMembership(groups: FileGroup[], files: FileInfo[]): FileGroup[] {
  if (groups.length === 0) return groups;

  // Live membership, keyed by group. Built once per reconcile — O(files), not O(files × groups).
  const live = new Map<string, string[]>();
  for (const f of files) {
    if (f.groupId == null) continue;
    const ids = live.get(f.groupId);
    if (ids) ids.push(f.id);
    else live.set(f.groupId, [f.id]);
  }

  let changed = false;
  const next = groups.map((g) => {
    const ids = live.get(g.id) ?? [];
    const alive = new Set(ids);
    const kept = g.fileIds.filter((id) => alive.has(id));
    // Unchanged means both directions: nothing dropped out of `fileIds` (kept === fileIds) and
    // nothing new to add (kept === live). `kept` is a subset of `ids` by construction, so the
    // second test alone would never notice a removal.
    if (kept.length === g.fileIds.length && kept.length === ids.length) return g;
    const known = new Set(kept);
    changed = true;
    return { ...g, fileIds: [...kept, ...ids.filter((id) => !known.has(id))] };
  });
  return changed ? next : groups;
}
