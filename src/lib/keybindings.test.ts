import { expect, test } from "vitest";
import {
  ACTIONS,
  DOUBLE_TAP_MS,
  isDoubleTap,
  DEFAULT_KEYBINDINGS,
  actionForCombo,
  bindingsWithDefaults,
  eventToCombo,
  formatCombo,
  matchAction,
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
