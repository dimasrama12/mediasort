//! Where the cursor lands after files leave the grid.
//!
//! Every "these files are gone" reducer used to re-home the cursor with the removed file's index
//! in the raw `files` array — the scan order. Under any other sort (Name, Date, Type, Size) that
//! index has nothing to do with what is on screen, so trashing the second tile could drop the
//! cursor twenty tiles away. The arithmetic has to happen in the order the grid is actually
//! rendering, which the grid publishes as `visibleIds`.

/**
 * The id that should take the cursor after `removedIds` leave the list.
 *
 * The survivor that slides into the first removed slot wins, so trashing tile 2 of 26 leaves the
 * cursor on whatever is now tile 2. When the removed run reaches the end of the list there is
 * nothing after it to slide up, so the cursor steps back to the new last file instead.
 *
 * `alive` is the only test applied to a candidate: a removal can be partial (the backend skips a
 * locked file), and a file that is still there is still a place the cursor can sit — even if it
 * was one of the ones we asked to remove.
 *
 * @param visibleIds render order at the moment of removal (the store's `visibleIds`)
 * @param removedIds the ids leaving the list
 * @param alive      is this id still present after the removal?
 * @returns the id to put the cursor on, `null` when nothing is left, or `undefined` when
 *          `visibleIds` says nothing about this removal and the caller should fall back.
 */
export function focusAfterRemoval(
  visibleIds: readonly string[],
  removedIds: readonly string[],
  alive: (id: string) => boolean,
): string | null | undefined {
  const removed = new Set(removedIds);
  const at = visibleIds.findIndex((id) => removed.has(id));
  if (at < 0) return undefined; // nothing removed was on screen — the caller knows better
  for (let i = at; i < visibleIds.length; i++) if (alive(visibleIds[i])) return visibleIds[i];
  for (let i = at - 1; i >= 0; i--) if (alive(visibleIds[i])) return visibleIds[i];
  return null;
}
