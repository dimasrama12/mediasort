//! Cross-component app actions that don't belong to any one panel: the scanning flow and closing
//! the window. Window calls are dynamically imported so this module stays importable under
//! jsdom/tests, where `@tauri-apps/api/window` has no host to talk to.

import {
  adoptSession,
  cancelScan,
  clearTargetFolders,
  loadProject,
  pickFolders,
  scanFolders,
} from "./commands";
import { clearThumbnailMemo } from "./useThumbnail";
import { useAppStore } from "../store/useAppStore";

/** Do `next` and `prev` name the same set of root folders? Order is irrelevant — the OS picker
 *  hands them back in whatever order the user clicked. */
function sameLibrary(prev: string[], next: string[]): boolean {
  if (prev.length === 0 || prev.length !== next.length) return false;
  const a = [...prev].sort();
  const b = [...next].sort();
  return a.every((r, i) => r === b[i]);
}

/** Pick parent folders, reset the session, and kick off a streaming scan (§2 multi-folder scan).
 *
 *  Scanning a **different** root starts a new sorting session, so the previous session's target
 *  folders are cleared on both sides of the IPC boundary. The store drops them in `startScan`;
 *  without the backend call the registry kept holding them and the next `Ctrl+R` (which re-lists
 *  the folders from the backend) brought every one of them back — with 1–9 shortcuts still wired
 *  to directories belonging to a library the user had just left.
 *
 *  Re-scanning the **same** root is not a new session, and keeping the targets across it is what
 *  makes the backend's exclusion work at all. The scan prunes registered target folders out of
 *  the walk, so a target sitting inside the root ("random/contoh 1") does not hand every filed
 *  photo back to the library — but on the one scan where that matters, the re-scan after filing,
 *  an unconditional clear left the registry empty and nothing to exclude. The shortcuts also
 *  survive the re-scan, which is what the user expects of the same library. */
export async function scanFlow(): Promise<void> {
  const dirs = await pickFolders();
  if (!dirs) return;
  const s = useAppStore.getState();
  const rescan = sameLibrary(s.roots, dirs);
  // Captured before `startScan` wipes them, and put back after — a re-scan of the same library
  // keeps its 1–9 targets on both sides of the IPC boundary.
  const keep = rescan ? s.folders : [];
  if (!rescan) await clearTargetFolders().catch(() => {});
  clearThumbnailMemo();
  s.setRoots(dirs);
  s.startScan();
  if (keep.length > 0) s.setFolders(keep);
  await scanFolders(dirs);
}

/** Load a saved project and make it a **live** session again.
 *
 *  Restoring the store is only half of a project: the backend still has to be told what the
 *  session *is*. Without that its target-folder registry stays empty — so the `syncFolders` that
 *  follows the first move re-lists nothing straight over the sidebar and takes the 1–9 shortcuts
 *  with it — and neither the roots nor the folders are in the access scope, so the moves are
 *  refused before they get that far.
 *
 *  Folders are handed over **in shortcut order** so the backend's "lowest free slot" assignment
 *  reproduces the numbering the project was saved with. An adoption that fails leaves the saved
 *  list in place: a stale sidebar is a much better answer than an empty one. */
export async function openProject(id: string): Promise<void> {
  const project = await loadProject(id);
  const st = useAppStore.getState();
  st.loadProjectData(project);
  const paths = [...project.folders]
    .sort((a, b) => a.shortcut - b.shortcut)
    .map((f) => f.path);
  try {
    st.setFolders(await adoptSession(project.roots, paths));
  } catch {
    /* keep the folders the project restored */
  }
}

/** Abort the running scan (Esc, §2). Safe to call when nothing is scanning. */
export async function abortScan(): Promise<void> {
  await cancelScan().catch(() => {});
}

/** Close the main window (`Alt+X`). This fires the close hook that empties the scratch disk. */
export async function exitApp(): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  } catch {
    /* not running under Tauri (tests/browser) */
  }
}
