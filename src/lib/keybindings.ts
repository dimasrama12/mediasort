//! Customizable keybindings (§1). Actions map to one or more canonical combo strings; the user
//! can rebind them in Settings and the map is persisted (settings.json). This module is the single
//! source of truth for the *defaults* and for turning a KeyboardEvent into a comparable combo — it
//! deliberately imports nothing app-specific so it stays trivially testable and cycle-free.

/** Every rebindable action. `global` actions fire from the file view; `preview` actions only while
 *  the full-screen preview is open (image rotation). */
export type ActionId =
  | "scanFolder"
  | "addScanFolder"
  | "trash"
  | "batchRename"
  | "toggleSidebar"
  | "gridView"
  | "listView"
  | "openSettings"
  | "selectAll"
  | "newFolder"
  | "toggleTrash"
  | "deletePermanently"
  | "returnToLibrary"
  | "exitApp"
  | "focusSearch"
  | "refresh"
  | "toggleSettingsDouble"
  | "rotateLeft"
  | "rotateRight"
  | "zoomIn"
  | "zoomOut"
  | "zoomReset";

export type KeyScope = "global" | "preview";

export interface ActionMeta {
  id: ActionId;
  label: string;
  scope: KeyScope;
  defaults: string[];
}

/** Ordered so the Settings editor and combo-resolution iterate deterministically. */
export const ACTIONS: ActionMeta[] = [
  { id: "scanFolder", label: "Open / scan folder", scope: "global", defaults: ["Ctrl+O"] },
  {
    id: "addScanFolder",
    label: "Add folder to the scan",
    scope: "global",
    defaults: ["Ctrl+Shift+O"],
  },
  { id: "newFolder", label: "New target folder", scope: "global", defaults: ["Ctrl+N"] },
  { id: "trash", label: "Move to trash", scope: "global", defaults: ["Delete", "B"] },
  { id: "deletePermanently", label: "Delete permanently", scope: "global", defaults: ["Shift+Delete"] },
  { id: "returnToLibrary", label: "Return files to the library", scope: "global", defaults: ["`"] },
  { id: "batchRename", label: "Batch rename", scope: "global", defaults: ["Shift+R"] },
  { id: "selectAll", label: "Select all", scope: "global", defaults: ["Ctrl+A"] },
  { id: "toggleSidebar", label: "Toggle sidebar", scope: "global", defaults: ["Ctrl+H"] },
  { id: "gridView", label: "Grid view", scope: "global", defaults: ["["] },
  { id: "listView", label: "List view", scope: "global", defaults: ["]"] },
  { id: "toggleTrash", label: "Open trash", scope: "global", defaults: ["T"] },
  { id: "openSettings", label: "Open settings", scope: "global", defaults: ["Ctrl+,"] },
  {
    id: "toggleSettingsDouble",
    label: "Toggle settings (press twice, quickly)",
    scope: "global",
    defaults: ["Ctrl+'"],
  },
  { id: "refresh", label: "Refresh the view", scope: "global", defaults: ["Ctrl+R", "F5"] },
  { id: "exitApp", label: "Exit application", scope: "global", defaults: ["Alt+X"] },
  { id: "focusSearch", label: "Focus search box", scope: "global", defaults: ["Ctrl+F"] },
  { id: "rotateLeft", label: "Rotate left (in preview)", scope: "preview", defaults: ["L"] },
  { id: "rotateRight", label: "Rotate right (in preview)", scope: "preview", defaults: ["R"] },
  { id: "zoomIn", label: "Zoom in (in preview)", scope: "preview", defaults: ["+", "="] },
  { id: "zoomOut", label: "Zoom out (in preview)", scope: "preview", defaults: ["-"] },
  { id: "zoomReset", label: "Reset zoom (in preview)", scope: "preview", defaults: ["0"] },
];

export type Keybindings = Record<string, string[]>;

/** The factory-default binding map (action id → combos). */
export const DEFAULT_KEYBINDINGS: Keybindings = Object.fromEntries(
  ACTIONS.map((a) => [a.id, [...a.defaults]]),
);

/** Fill any actions missing from a stored/partial map with their defaults (stored wins per action).
 *  Keeps the rest of the app able to assume every action has a binding. */
export function bindingsWithDefaults(stored: Keybindings | undefined | null): Keybindings {
  return { ...DEFAULT_KEYBINDINGS, ...(stored ?? {}) };
}

/** Normalize a KeyboardEvent's key to a stable token: letters upper-cased, Space named, everything
 *  else (named keys, punctuation, digits) taken verbatim from `event.key`. */
function normalizeKey(key: string): string {
  if (key === " " || key === "Spacebar") return "Space";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/** Turn a KeyboardEvent into a canonical combo string, e.g. "Ctrl+O", "Shift+R", "Ctrl+,",
 *  "Delete", "Space", "[". Modifier order is fixed (Ctrl, Alt, Shift, Meta). Returns "" when the
 *  event is a bare modifier press (nothing to bind to yet). */
export function eventToCombo(e: {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}): string {
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return "";
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");
  parts.push(normalizeKey(e.key));
  return parts.join("+");
}

/** Human-friendly rendering of a canonical combo (spaces around the `+`). */
export function formatCombo(combo: string): string {
  return combo.split("+").join(" + ");
}

/** Resolve which action a KeyboardEvent triggers, limited to `scope`. First match by ACTIONS order;
 *  combos are unique across actions in the defaults, so this is unambiguous unless the user creates
 *  a conflict (in which case earlier ACTIONS win). Returns null if nothing matches. */
export function matchAction(
  bindings: Keybindings,
  e: Parameters<typeof eventToCombo>[0],
  scope: KeyScope,
): ActionId | null {
  const combo = eventToCombo(e);
  if (!combo) return null;
  for (const a of ACTIONS) {
    if (a.scope !== scope) continue;
    if ((bindings[a.id] ?? []).includes(combo)) return a.id;
  }
  return null;
}

/** The action id (if any) currently bound to `combo`, for conflict detection in the editor. */
export function actionForCombo(bindings: Keybindings, combo: string): ActionId | null {
  for (const a of ACTIONS) {
    if ((bindings[a.id] ?? []).includes(combo)) return a.id;
  }
  return null;
}

/** How close together two presses must be to count as a double-tap (§1). 400 ms is the same
 *  order as a mouse double-click: comfortably repeatable, but a deliberate second press a beat
 *  later still reads as two separate taps. */
export const DOUBLE_TAP_MS = 400;

/** Is `now` a second tap following `last`? `last` is the previous press's timestamp, or null when
 *  there was none. Pure so the App-level handler stays a two-liner and this stays testable. */
export function isDoubleTap(last: number | null, now: number, windowMs = DOUBLE_TAP_MS): boolean {
  return last != null && now - last <= windowMs && now >= last;
}

/** Every key the app can hand to a target folder, in the order it hands them out.
 *  Mirrored **verbatim** from `src-tauri/src/folders.rs::KEY_POOL` — same arrangement as
 *  `paths.ts` mirroring `paths.rs`: two copies, one order, a test on each side pinning it. */
export const KEY_POOL = "1234567890QWERTYUIOPASDFGHJKLZXCVBNM;',./-=";

/** Where `key` sits in the pool, for sorting the sidebar. Keys outside the pool (a hand-set
 *  combo like "Shift+:") and the empty key sort last, in whatever order they arrived — the
 *  callers use a stable sort, so that is insertion order. */
export function keyRank(key: string): number {
  const i = key.length === 1 ? KEY_POOL.indexOf(key) : -1;
  return i < 0 ? Number.POSITIVE_INFINITY : i;
}

/** Keys the app's structure owns, which are therefore never assignable to a target folder and
 *  never appear in the binding editor: grid navigation, the modal verbs, and undo/redo. They are
 *  not bindings — there is no action to rebind them off — so they are listed rather than derived. */
export const FIXED_KEYS: string[] = [
  "J",
  "K",
  "Enter",
  "Escape",
  "Space",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Ctrl+Z",
  "Ctrl+Y",
  "Ctrl+Shift+Z",
];

/** Every key a target folder must not be given: the combos the user's **global** actions occupy,
 *  plus `FIXED_KEYS`.
 *
 *  Preview-scope actions (rotate, zoom) are deliberately excluded. They fire only while the
 *  full-screen preview is open, and the preview returns before the grid's folder-key lookup is
 *  ever reached — so reserving `L`, `R`, `+`, `-`, `0` would cost five pool entries to prevent a
 *  collision that cannot happen. */
export function reservedKeys(bindings: Keybindings): string[] {
  const out = new Set<string>(FIXED_KEYS);
  for (const a of ACTIONS) {
    if (a.scope !== "global") continue;
    for (const c of bindings[a.id] ?? []) out.add(c);
  }
  return [...out];
}
