//! The rules that decide whether a target folder may take a key (§3).
//!
//! Kept out of `keybindings.ts` on purpose: that module deliberately imports nothing
//! app-specific so it stays trivially testable, and these rules need `FolderInfo`.
//!
//! Note what is *not* here: nothing prevents a conflict from existing in the registry, because
//! the registry is not the enforcement point. `FileGrid` matches rebindable actions **before** it
//! looks a folder key up, so an app shortcut wins whatever the registry says. These rules exist
//! so the user is told at the moment they choose, rather than discovering a dead key later.

import type { FolderInfo } from "./types";
import type { Keybindings } from "./keybindings";
import { ACTIONS, FIXED_KEYS, formatCombo } from "./keybindings";

/** Why `combo` cannot be given to the folder `selfId`, as a message to show — or `null` if it
 *  can. `selfId` is excluded from the folder check so re-confirming a folder's own key is fine. */
export function keyConflict(
  combo: string,
  bindings: Keybindings,
  folders: FolderInfo[],
  selfId: string,
): string | null {
  if (!combo) return "That key cannot be used.";

  if (FIXED_KEYS.includes(combo)) {
    return `${formatCombo(combo)} is reserved by the app.`;
  }

  // Global scope only: a preview-scope binding fires only while the preview is open, where
  // folder keys are never read, so claiming one costs nothing.
  for (const a of ACTIONS) {
    if (a.scope !== "global") continue;
    if ((bindings[a.id] ?? []).includes(combo)) {
      return `${formatCombo(combo)} is already "${a.label}".`;
    }
  }

  const other = folders.find((f) => f.id !== selfId && f.key !== "" && f.key === combo);
  if (other) return `${formatCombo(combo)} is already "${other.name}".`;

  return null;
}
