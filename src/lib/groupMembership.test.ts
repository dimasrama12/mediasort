import { expect, test } from "vitest";
import { syncGroupMembership } from "./groupMembership";
import type { FileGroup, FileInfo } from "./types";

const mk = (id: string, groupId: string | null): FileInfo => ({
  id,
  path: `C:/x/${id}`,
  name: id,
  extension: "jpg",
  size: 0,
  modifiedAt: 0,
  dateTaken: null,
  fileType: "image",
  groupId,
});

const grp = (id: string, fileIds: string[]): FileGroup => ({
  id,
  name: id,
  fileIds,
  similarity: 0,
  timeSpan: null,
  groupType: "visual",
});

test("drops files that left the library and leaves the others alone", () => {
  const groups = [grp("g1", ["a", "b", "c"]), grp("g2", ["d", "e"])];
  const files = [mk("a", "g1"), mk("c", "g1"), mk("d", "g2"), mk("e", "g2")];
  const next = syncGroupMembership(groups, files);
  expect(next[0].fileIds).toEqual(["a", "c"]);
  expect(next[1]).toBe(groups[1]); // untouched group keeps its identity
});

test("a fully emptied group stays listed at zero", () => {
  const groups = [grp("g1", ["a", "b"]), grp("g2", ["c"])];
  const next = syncGroupMembership(groups, [mk("c", "g2")]);
  expect(next).toHaveLength(2);
  expect(next[0].fileIds).toEqual([]);
});

test("no membership change returns the identical array", () => {
  const groups = [grp("g1", ["a", "b"])];
  expect(syncGroupMembership(groups, [mk("a", "g1"), mk("b", "g1")])).toBe(groups);
});

test("order in files does not count as a change", () => {
  const groups = [grp("g1", ["a", "b"])];
  expect(syncGroupMembership(groups, [mk("b", "g1"), mk("a", "g1")])).toBe(groups);
});

test("restored files rejoin their group, keeping the surviving order", () => {
  const groups = [grp("g1", ["a", "b", "c"])];
  const moved = syncGroupMembership(groups, [mk("b", "g1")]);
  expect(moved[0].fileIds).toEqual(["b"]);
  const undone = syncGroupMembership(moved, [mk("a", "g1"), mk("b", "g1"), mk("c", "g1")]);
  expect(undone[0].fileIds).toEqual(["b", "a", "c"]);
  expect(undone[0].fileIds).toHaveLength(3);
});

test("a file returned under a new id rejoins by its groupId", () => {
  const groups = [grp("g1", ["a", "b"])];
  // "Return to library" re-mints the id from the new path but carries groupId across.
  const next = syncGroupMembership(groups, [mk("a", "g1"), mk("b-returned", "g1")]);
  expect(next[0].fileIds).toEqual(["a", "b-returned"]);
});

test("ungrouped files and unknown group ids are ignored", () => {
  const groups = [grp("g1", ["a"])];
  const next = syncGroupMembership(groups, [mk("a", "g1"), mk("z", null), mk("q", "gone")]);
  expect(next).toBe(groups);
});

test("no groups is a no-op", () => {
  const groups: FileGroup[] = [];
  expect(syncGroupMembership(groups, [mk("a", null)])).toBe(groups);
});
