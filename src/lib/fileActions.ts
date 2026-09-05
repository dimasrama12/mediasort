//! File operations that more than one component fires: dropping a selection onto a sidebar
//! folder, and sending files back out of a folder into the library. Both are a `move_files` call
//! plus the matching store reducer; keeping them here stops the grid and the sidebar growing
//! near-identical copies of the same three lines.

import { listTargetFolders, moveFiles, trashFiles } from "./commands";
import { useAppStore } from "../store/useAppStore";
import type { FileInfo, FolderInfo } from "./types";

/** Re-read the target folders (and with them their **live** on-disk counts) after anything that
 *  changed what is inside one. The store keeps an optimistic count so the sidebar reacts on the
 *  same frame as the move; this is what makes that optimism converge on the truth — including
 *  after moves the store never saw, files dropped in by Explorer, and every `Ctrl+R`. */
export async function syncFolders(): Promise<void> {
  try {
    useAppStore.getState().setFolders(await listTargetFolders());
  } catch {
    /* a folder deleted underneath us must not break the operation that just succeeded */
  }
}

/** Move `files` into `folder` and update the grid, the undo stack and the folder's count.
 *  Used by both the 1–9 shortcuts' sibling path (drag-and-drop) and the sidebar drop target.
 *
 *  Works from either source: the scanned library, **or** another target folder being browsed
 *  (§2 folder-to-folder moves). The browse case takes the `completeMoveOut` path because the
 *  files live in `browseFiles`, not `files` — running the library reducer against them removed
 *  nothing and left the moved photos sitting in a folder they were no longer in. */
export async function moveToFolder(files: FileInfo[], folder: FolderInfo): Promise<void> {
  if (files.length === 0) return;
  const st = useAppStore.getState();
  const from = st.browseFolder;
  if (from && from.id === folder.id) return; // dropping a folder onto itself
  const ids = files.map((f) => f.id);
  const newPaths = await moveFiles(
    files.map((f) => f.path),
    folder.path,
  );
  if (from) st.completeMoveOut(ids, from.id, folder.id);
  else st.completeMoveMany(ids, folder.id, newPaths);
  await syncFolders();
}

/** Move `files` out of the target folder being browsed and back into the scanned library root
 *  (the ` shortcut, and the browse banner's button). No-op when nothing is being browsed or
 *  when there is no scanned root to return them to. */
export async function returnToLibrary(files: FileInfo[]): Promise<void> {
  const st = useAppStore.getState();
  const root = st.roots[0];
  if (files.length === 0 || !st.browseFolder || !root) return;
  const ids = files.map((f) => f.id);
  const newPaths = await moveFiles(
    files.map((f) => f.path),
    root,
  );
  st.completeReturn(ids, newPaths);
  await syncFolders();
}

/** Move `files` to the in-app trash and take them out of the grid, undoably. Shared by the
 *  Delete key and the right-click menu so both behave identically (§5). Only library files can
 *  be trashed — browsing a target folder is read-only, exactly as the keyboard path has it. */
export async function trashSelection(files: FileInfo[]): Promise<void> {
  const st = useAppStore.getState();
  if (files.length === 0 || st.browseFolder) return;
  const ids = files.map((f) => f.id);
  const items = await trashFiles(files.map((f) => f.path));
  st.completeTrash(ids, items);
}
