import { expect, test } from "vitest";
import { sortFiles } from "./sort";
import type { FileInfo } from "./types";

const mk = (over: Partial<FileInfo>): FileInfo => ({
  id: over.name ?? "x",
  path: `C:/x/${over.name ?? "x"}`,
  name: "x",
  extension: "jpg",
  size: 0,
  modifiedAt: 0,
  dateTaken: null,
  fileType: "image",
  groupId: null,
  ...over,
});

test("sorts by name ascending and descending (numeric-aware)", () => {
  const files = [mk({ name: "b10.jpg" }), mk({ name: "b2.jpg" }), mk({ name: "a.jpg" })];
  expect(sortFiles(files, "name", "asc").map((f) => f.name)).toEqual(["a.jpg", "b2.jpg", "b10.jpg"]);
  expect(sortFiles(files, "name", "desc").map((f) => f.name)).toEqual(["b10.jpg", "b2.jpg", "a.jpg"]);
});

test("sorts by size numerically", () => {
  const files = [mk({ name: "big", size: 900 }), mk({ name: "small", size: 5 }), mk({ name: "mid", size: 100 })];
  expect(sortFiles(files, "size", "asc").map((f) => f.name)).toEqual(["small", "mid", "big"]);
});

test("date uses dateTaken when present, else mtime", () => {
  const files = [
    mk({ name: "exif", modifiedAt: 999, dateTaken: 10 }), // sorts by 10
    mk({ name: "mtime", modifiedAt: 50, dateTaken: null }), // sorts by 50
  ];
  expect(sortFiles(files, "date", "asc").map((f) => f.name)).toEqual(["exif", "mtime"]);
});

test("type sorts by extension then name", () => {
  const files = [
    mk({ name: "z.png", extension: "png" }),
    mk({ name: "a.png", extension: "png" }),
    mk({ name: "m.jpg", extension: "jpg" }),
  ];
  expect(sortFiles(files, "type", "asc").map((f) => f.name)).toEqual(["m.jpg", "a.png", "z.png"]);
});

test("sort is stable for equal keys and does not mutate the input", () => {
  const files = [mk({ name: "a", size: 1 }), mk({ name: "b", size: 1 }), mk({ name: "c", size: 1 })];
  const copy = [...files];
  expect(sortFiles(files, "size", "asc").map((f) => f.name)).toEqual(["a", "b", "c"]);
  expect(files).toEqual(copy); // untouched
});
