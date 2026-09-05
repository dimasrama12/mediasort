import { expect, test } from "vitest";
import { applyGroupView } from "./groupView";
import { GROUP_COLORS, groupColor, groupIndexMap } from "./groupColors";
import type { FileGroup, FileInfo } from "./types";

const mk = (id: string, groupId: string | null): FileInfo => ({
  id, path: `C:/x/${id}.jpg`, name: `${id}.jpg`, extension: "jpg", size: 1,
  modifiedAt: 0, dateTaken: null, fileType: "image", groupId,
});

const g = (id: string, fileIds: string[]): FileGroup => ({
  id, name: id, fileIds, similarity: 0, timeSpan: null, groupType: "visual",
});

const groups = [g("g1", ["a", "d"]), g("g2", ["b"]), g("g3", ["c"])];
// Deliberately interleaved, as a name/date sort would leave them.
const files = [mk("b", "g2"), mk("c", "g3"), mk("a", "g1"), mk("z", null), mk("d", "g1")];

test("All orders every file by group, ungrouped last, stable within a group", () => {
  expect(applyGroupView(files, groups, null).map((f) => f.id)).toEqual(["a", "d", "b", "c", "z"]);
});

test("selecting one group shows only that group", () => {
  expect(applyGroupView(files, groups, "g1").map((f) => f.id)).toEqual(["a", "d"]);
  expect(applyGroupView(files, groups, "g2").map((f) => f.id)).toEqual(["b"]);
});

test("a stale group id degrades to All rather than emptying the grid", () => {
  expect(applyGroupView(files, groups, "gone")).toHaveLength(files.length);
});

test("with no groups the incoming order is untouched", () => {
  expect(applyGroupView(files, [], null)).toBe(files);
  expect(applyGroupView(files, [], "g1")).toBe(files);
});

test("seven badge colours cycle, so group 8 reuses group 1's", () => {
  expect(GROUP_COLORS).toHaveLength(7);
  expect(groupColor(0)).toBe(groupColor(7));
  expect(groupColor(1)).toBe(groupColor(8));
  expect(groupColor(116)).toBe(groupColor(116 % 7));
  expect(new Set([0, 1, 2, 3, 4, 5, 6].map(groupColor)).size).toBe(7);
});

test("an unknown group index still gets a colour instead of undefined", () => {
  expect(groupColor(-1)).toBe(GROUP_COLORS[0]);
  expect(groupColor(NaN)).toBe(GROUP_COLORS[0]);
});

test("groupIndexMap maps each group to its position", () => {
  const m = groupIndexMap(groups);
  expect(m.get("g1")).toBe(0);
  expect(m.get("g3")).toBe(2);
  expect(m.get("nope")).toBeUndefined();
});
