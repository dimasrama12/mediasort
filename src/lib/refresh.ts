//! Ctrl+R (§5): refresh what the app *derives* from disk, without touching what the user has set
//! up. A webview's own Ctrl+R reloads the page, which threw away the scan, the undo stack, the
//! target folders and the folder you were browsing — a "refresh" that lost everything. This
//! replaces it: the open folder stays open, the library stays scanned, and everything read from
//! the filesystem is read again.

import { listFolderFiles, listTargetFolders, listTrash } from "./commands";
import { clearThumbnailMemo } from "./useThumbnail";
import { useAppStore } from "../store/useAppStore";

/** Re-read the target folders, the browsed folder's contents and the trash, and drop cached
 *  thumbnails so files edited outside the app show their current pixels. Every part is
 *  best-effort and independent: a folder that has since been deleted must not stop the rest. */
export async function refreshApp(): Promise<void> {
  const st = useAppStore.getState();
  st.closeContextMenu();
  clearThumbnailMemo();

  const browsed = st.browseFolder;
  await Promise.allSettled([
    listTargetFolders().then((folders) => useAppStore.getState().setFolders(folders)),
    browsed
      ? listFolderFiles(browsed.path).then((files) => useAppStore.getState().setBrowseFiles(files))
      : Promise.resolve(),
    st.trashOpen
      ? listTrash().then((items) => useAppStore.getState().setTrashItems(items))
      : Promise.resolve(),
  ]);

  // Bumped last, so anything keyed on it re-mounts against already-refreshed state.
  useAppStore.getState().bumpRefresh();
}
