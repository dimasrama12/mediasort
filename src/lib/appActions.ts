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
import { normalizePath } from "./paths";
import { keyRank } from "./keybindings";
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
 *  the folders from the backend) brought every one of them back — with their keys still wired to
 *  directories belonging to a library the user had just left.
 *
 *  Re-scanning the **same** root is not a new session, and keeping the targets across it is what
 *  makes the backend's exclusion work at all. The scan prunes registered target folders out of
 *  the walk, so a target sitting inside the root ("random/contoh 1") does not hand every filed
 *  photo back to the library — but on the one scan where that matters, the re-scan after filing,
 *  an unconditional clear left the registry empty and nothing to exclude. The keys also survive
 *  the re-scan, which is what the user expects of the same library. */
export async function scanFlow(): Promise<void> {
  const dirs = await pickFolders();
  if (!dirs) return;
  const s = useAppStore.getState();
  const rescan = sameLibrary(s.roots, dirs);
  // Captured before `startScan` wipes them, and put back after — a re-scan of the same library
  // keeps its targets on both sides of the IPC boundary.
  const keep = rescan ? s.folders : [];
  if (!rescan) await clearTargetFolders().catch(() => {});
  clearThumbnailMemo();
  s.setRoots(dirs);
  s.startScan();
  if (keep.length > 0) s.setFolders(keep);
  await scanFolders(dirs);
}

/** Add one or more libraries to the session without ending it (§2 — the blue `+`, Ctrl+Shift+O).
 *
 *  The difference from `scanFlow` is everything it does *not* do: no `clearTargetFolders`, because
 *  the targets belong to a session that is continuing; no `clearThumbnailMemo`, because the
 *  thumbnails already drawn are still of the same files. The backend needs no counterpart —
 *  `scan_folders` already grants access scope additively, and already prunes registered target
 *  folders out of the walk.
 *
 *  Roots are compared normalized, so picking `D:\FOTO` when `D:/foto` is open is recognised as the
 *  folder it is. Re-scanning an already-open library is a different request (that is Ctrl+R), so
 *  it says so rather than silently walking it twice. */
export async function addScanFlow(): Promise<void> {
  const dirs = await pickFolders();
  if (!dirs || dirs.length === 0) return;
  const st = useAppStore.getState();
  const open = new Set(st.roots.map(normalizePath));
  const fresh = dirs.filter((d) => !open.has(normalizePath(d)));
  if (fresh.length === 0) {
    st.setNotice(
      dirs.length === 1 ? "That folder is already scanned." : "Those folders are already scanned.",
    );
    return;
  }
  st.setNotice(null);
  st.startAddScan(fresh);
  await scanFolders(fresh);
}

/** Load a saved project and make it a **live** session again.
 *
 *  Restoring the store is only half of a project: the backend still has to be told what the
 *  session *is*. Without that its target-folder registry stays empty — so the `syncFolders` that
 *  follows the first move re-lists nothing straight over the sidebar and takes the folder keys
 *  with it — and neither the roots nor the folders are in the access scope, so the moves are
 *  refused before they get that far.
 *
 *  Folders are handed over **in key order** so the backend's "next free key" assignment reproduces
 *  the keys the project was saved with. A project written before keys existed has none at all, so
 *  every rank is Infinity and the sort is a no-op — which is right: the array is already in saved
 *  order, and `adopt_in` hands out 1, 2, 3… along it. An adoption that fails leaves the saved list
 *  in place: a stale sidebar is a much better answer than an empty one. */
export async function openProject(id: string): Promise<void> {
  const project = await loadProject(id);
  const st = useAppStore.getState();
  st.loadProjectData(project);
  const paths = [...project.folders]
    .sort((a, b) => keyRank(a.key) - keyRank(b.key))
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
