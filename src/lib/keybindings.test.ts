import { expect, test } from "vitest";
import {
  ACTIONS,
  DOUBLE_TAP_MS,
  FIXED_KEYS,
  KEY_POOL,
  isDoubleTap,
  DEFAULT_KEYBINDINGS,
  actionForCombo,
  bindingsWithDefaults,
  eventToCombo,
  formatCombo,
  keyRank,
  matchAction,
  reservedKeys,
} from "./keybindings";

test("eventToCombo builds canonical strings with fixed modifier order", () => {
  expect(eventToCombo({ key: "o", ctrlKey: true })).toBe("Ctrl+O");
  expect(eventToCombo({ key: "R", shiftKey: true })).toBe("Shift+R");
  expect(eventToCombo({ key: "r" })).toBe("R");
  expect(eventToCombo({ key: " " })).toBe("Space");
  expect(eventToCombo({ key: ",", ctrlKey: true })).toBe("Ctrl+,");
  expect(eventToCombo({ key: "x", altKey: true })).toBe("Alt+X");
  expect(eventToCombo({ key: "[" })).toBe("[");
  expect(eventToCombo({ key: "Delete" })).toBe("Delete");
});

test("eventToCombo orders Ctrl+Alt+Shift+Meta consistently", () => {
  expect(eventToCombo({ key: "a", ctrlKey: true, shiftKey: true })).toBe("Ctrl+Shift+A");
  expect(eventToCombo({ key: "z", ctrlKey: true, altKey: true, shiftKey: true })).toBe(
    "Ctrl+Alt+Shift+Z",
  );
});

test("eventToCombo returns empty for a bare modifier press", () => {
  expect(eventToCombo({ key: "Control", ctrlKey: true })).toBe("");
  expect(eventToCombo({ key: "Shift", shiftKey: true })).toBe("");
});

test("defaults cover every action and match the spec bindings", () => {
  expect(Object.keys(DEFAULT_KEYBINDINGS).sort()).toEqual(ACTIONS.map((a) => a.id).sort());
  expect(DEFAULT_KEYBINDINGS.scanFolder).toEqual(["Ctrl+O"]);
  expect(DEFAULT_KEYBINDINGS.trash).toEqual(["Delete", "B"]);
  expect(DEFAULT_KEYBINDINGS.refresh).toEqual(["Ctrl+R", "F5"]);
  expect(DEFAULT_KEYBINDINGS.toggleSettingsDouble).toEqual(["Ctrl+'"]);
  expect(DEFAULT_KEYBINDINGS.batchRename).toEqual(["Shift+R"]);
  expect(DEFAULT_KEYBINDINGS.exitApp).toEqual(["Alt+X"]);
});

test("bindingsWithDefaults fills gaps but lets stored overrides win per action", () => {
  const merged = bindingsWithDefaults({ scanFolder: ["Ctrl+P"] });
  expect(merged.scanFolder).toEqual(["Ctrl+P"]); // override
  expect(merged.trash).toEqual(["Delete", "B"]); // default still present
  expect(bindingsWithDefaults(null).trash).toEqual(["Delete", "B"]);
});

test("matchAction resolves within a scope only", () => {
  const b = DEFAULT_KEYBINDINGS;
  expect(matchAction(b, { key: "o", ctrlKey: true }, "global")).toBe("scanFolder");
  // Space is no longer bound to anything (§1): the preview opens on double-click.
  expect(matchAction(b, { key: " " }, "global")).toBeNull();
  expect(matchAction(b, { key: "r", ctrlKey: true }, "global")).toBe("refresh");
  expect(matchAction(b, { key: "F5" }, "global")).toBe("refresh");
  expect(matchAction(b, { key: "'", ctrlKey: true }, "global")).toBe("toggleSettingsDouble");
  expect(matchAction(b, { key: "Delete" }, "global")).toBe("trash");
  expect(matchAction(b, { key: "b" }, "global")).toBe("trash"); // second combo for the action
  // Bare "R" is a preview-only action, so it must NOT match in the global scope.
  expect(matchAction(b, { key: "r" }, "global")).toBeNull();
  expect(matchAction(b, { key: "r" }, "preview")).toBe("rotateRight");
  expect(matchAction(b, { key: "l" }, "preview")).toBe("rotateLeft");
});

test("actionForCombo finds conflicts and formatCombo renders nicely", () => {
  expect(actionForCombo(DEFAULT_KEYBINDINGS, "Ctrl+O")).toBe("scanFolder");
  expect(actionForCombo(DEFAULT_KEYBINDINGS, "Ctrl+Q")).toBeNull();
  expect(formatCombo("Ctrl+O")).toBe("Ctrl + O");
});

test("no action is bound to Space any more", () => {
  const bound = Object.values(DEFAULT_KEYBINDINGS).flat();
  expect(bound).not.toContain("Space");
});

test("isDoubleTap only accepts a second press inside the window", () => {
  expect(isDoubleTap(null, 1000)).toBe(false); // nothing to pair with
  expect(isDoubleTap(1000, 1000 + DOUBLE_TAP_MS)).toBe(true); // the edge still counts
  expect(isDoubleTap(1000, 1000 + DOUBLE_TAP_MS + 1)).toBe(false); // a beat too slow
  expect(isDoubleTap(1000, 1010)).toBe(true);
  // A clock that jumped backwards must not read as an instant double-tap.
  expect(isDoubleTap(1000, 900)).toBe(false);
});

test("every default combo is unique across actions", () => {
  const seen = new Map<string, string>();
  for (const a of ACTIONS) {
    for (const c of a.defaults) {
      expect(seen.has(c), `${c} is on both ${seen.get(c)} and ${a.id}`).toBe(false);
      seen.set(c, a.id);
    }
  }
});

test("addScanFolder defaults to Ctrl+Shift+O", () => {
  expect(DEFAULT_KEYBINDINGS.addScanFolder).toEqual(["Ctrl+Shift+O"]);
  expect(
    matchAction(DEFAULT_KEYBINDINGS, { key: "O", ctrlKey: true, shiftKey: true }, "global"),
  ).toBe("addScanFolder");
});

test("Ctrl+Shift+O does not fire the plain scan action", () => {
  expect(matchAction(DEFAULT_KEYBINDINGS, { key: "O", ctrlKey: true }, "global")).toBe("scanFolder");
});

test("reservedKeys covers global bindings and the fixed keys, not preview ones", () => {
  const r = reservedKeys(DEFAULT_KEYBINDINGS);
  expect(r).toContain("Ctrl+O");
  expect(r).toContain("B"); // trash, a global default
  expect(r).toContain("J"); // grid nav, structural
  expect(r).toContain("Ctrl+Z"); // undo, structural
  expect(r).not.toContain("L"); // rotate-left is preview-scope: inert while the grid has focus
});

test("reservedKeys follows a rebind, freeing the key that was let go", () => {
  const rebound = { ...DEFAULT_KEYBINDINGS, trash: ["Ctrl+Backspace"] };
  const r = reservedKeys(rebound);
  expect(r).toContain("Ctrl+Backspace");
  expect(r).not.toContain("B"); // B is free again, so a folder may claim it
});

test("no fixed key is also a default binding", () => {
  const defaults = new Set(ACTIONS.flatMap((a) => a.defaults));
  for (const k of FIXED_KEYS) expect(defaults.has(k), `${k} is both fixed and bound`).toBe(false);
});

test("keyRank orders the pool and sinks anything outside it", () => {
  expect(keyRank("1")).toBe(0);
  expect(keyRank("0")).toBe(9);
  expect(keyRank("Q")).toBe(10);
  expect(keyRank("")).toBe(Number.POSITIVE_INFINITY);
  expect(keyRank("Shift+:")).toBe(Number.POSITIVE_INFINITY);
  expect(keyRank("1")).toBeLessThan(keyRank("Q"));
});

test("KEY_POOL matches the Rust copy in folders.rs", () => {
  // Pinned literal: if you change one side, this test makes you change the other.
  expect(KEY_POOL).toBe("1234567890QWERTYUIOPASDFGHJKLZXCVBNM;',./-=");
  expect(new Set(KEY_POOL).size).toBe(KEY_POOL.length);
});
