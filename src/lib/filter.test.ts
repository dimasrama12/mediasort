import { expect, test } from "vitest";
import { filterFiles } from "./filter";
import type { FileInfo } from "./types";

const mk = (name: string): FileInfo => ({
  id: name,
  path: name,
  name,
  extension: "jpg",
  size: 1,
  modifiedAt: 0,
  dateTaken: null,
  fileType: "image",
  groupId: null,
});

test("a blank query returns all files", () => {
  const files = [mk("a.jpg"), mk("b.png")];
  expect(filterFiles(files, "")).toHaveLength(2);
  expect(filterFiles(files, "   ")).toHaveLength(2);
});

test("case-insensitive substring match on name", () => {
  const files = [mk("Vacation.jpg"), mk("work.png"), mk("VACprep.gif")];
  expect(filterFiles(files, "vac").map((f) => f.name)).toEqual(["Vacation.jpg", "VACprep.gif"]);
});

test("no match returns an empty list", () => {
  expect(filterFiles([mk("a.jpg")], "zzz")).toHaveLength(0);
});
