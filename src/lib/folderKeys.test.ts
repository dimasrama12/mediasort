import { expect, test } from "vitest";
import { keyConflict } from "./folderKeys";
import { DEFAULT_KEYBINDINGS } from "./keybindings";
import type { FolderInfo } from "./types";

const folder = (id: string, name: string, key: string): FolderInfo => ({
  id,
  name,
  path: `C:/base/${id}`,
  key,
  keyCustom: true,
  fileCount: 0,
});

const folders = [folder("fam", "Family", "1"), folder("lama", "Foto Lama", ";")];

test("a free key has no conflict", () => {
  expect(keyConflict("W", DEFAULT_KEYBINDINGS, folders, "fam")).toBeNull();
});

test("a key bound to a global action is refused, naming the action", () => {
  const msg = keyConflict("Ctrl+O", DEFAULT_KEYBINDINGS, folders, "fam");
  expect(msg).toContain("Open / scan folder");
  expect(msg).toContain("Ctrl + O");
});

test("a key another folder holds is refused, naming that folder", () => {
  const msg = keyConflict(";", DEFAULT_KEYBINDINGS, folders, "fam");
  expect(msg).toContain("Foto Lama");
});

test("re-confirming the key a folder already holds is not a conflict", () => {
  expect(keyConflict("1", DEFAULT_KEYBINDINGS, folders, "fam")).toBeNull();
});

test("a structurally fixed key is refused as reserved", () => {
  expect(keyConflict("Enter", DEFAULT_KEYBINDINGS, folders, "fam")).toContain("reserved");
  expect(keyConflict("J", DEFAULT_KEYBINDINGS, folders, "fam")).toContain("reserved");
});

test("a preview-scope binding is free for a folder to take", () => {
  // L is rotate-left, but only inside the preview, which returns before folder keys are read.
  expect(keyConflict("L", DEFAULT_KEYBINDINGS, folders, "fam")).toBeNull();
});

test("a key freed by a rebind becomes available", () => {
  const rebound = { ...DEFAULT_KEYBINDINGS, trash: ["Ctrl+Backspace"] };
  expect(keyConflict("B", DEFAULT_KEYBINDINGS, folders, "fam")).toContain("Move to trash");
  expect(keyConflict("B", rebound, folders, "fam")).toBeNull();
});

test("an empty combo is refused rather than silently accepted", () => {
  expect(keyConflict("", DEFAULT_KEYBINDINGS, folders, "fam")).not.toBeNull();
});
