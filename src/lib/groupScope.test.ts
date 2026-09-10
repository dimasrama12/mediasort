import { expect, test } from "vitest";
import { filesInScope } from "./groupScope";
import { normalizePath } from "./paths";
import type { FileInfo } from "./types";

const mk = (path: string): FileInfo => ({
  id: normalizePath(path),
  path,
  name: "x.jpg",
  extension: "jpg",
  size: 1,
  modifiedAt: 0,
  dateTaken: null,
  fileType: "image",
  groupId: null,
});

test("files under a root are in scope, whatever the case or separator", () => {
  const files = [mk("D:/foto/a.jpg"), mk("D:\\FOTO\\sub\\b.jpg")];
  expect(filesInScope(files, ["d:\\foto"]).map((f) => f.path)).toEqual([
    "D:/foto/a.jpg",
    "D:\\FOTO\\sub\\b.jpg",
  ]);
});

test("a sibling folder sharing a name prefix is not in scope", () => {
  // "D:\foto2024" starts with "d:\foto" as a *string*, but is a different folder.
  const files = [mk("D:/foto/a.jpg"), mk("D:/foto2024/b.jpg")];
  expect(filesInScope(files, ["D:/foto"]).map((f) => f.path)).toEqual(["D:/foto/a.jpg"]);
});

test("several roots union", () => {
  const files = [mk("D:/foto/a.jpg"), mk("E:/dcim/b.jpg"), mk("F:/other/c.jpg")];
  expect(filesInScope(files, ["D:/foto", "E:/dcim"])).toHaveLength(2);
});

test("no roots means nothing in scope", () => {
  expect(filesInScope([mk("D:/foto/a.jpg")], [])).toEqual([]);
});
