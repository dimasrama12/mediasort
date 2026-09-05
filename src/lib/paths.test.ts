import { expect, test } from "vitest";
import { dirname, normalizePath } from "./paths";

// These mirror `src-tauri/src/paths.rs::normalize_path` case for case. If one side ever drifts,
// a returned file's id would stop matching the id the backend mints for the same path.
test("normalizePath lowercases and turns forward slashes into backslashes", () => {
  expect(normalizePath("C:/Users/Me/Pics")).toBe(String.raw`c:\users\me\pics`);
});

test("normalizePath collapses duplicate and trailing separators", () => {
  expect(normalizePath(String.raw`D:\a//b\\c`)).toBe(String.raw`d:\a\b\c`);
  expect(normalizePath("D:\\Photos\\")).toBe(String.raw`d:\photos`);
});

test("two spellings of the same folder produce one key", () => {
  expect(normalizePath(String.raw`C:\A\B`)).toBe(normalizePath("c:/a/b/"));
});

test("dirname takes the parent, whichever separator was used", () => {
  expect(dirname(String.raw`C:\base\fam\a.jpg`)).toBe(String.raw`C:\base\fam`);
  expect(dirname("C:/base/fam/a.jpg")).toBe("C:/base/fam");
  expect(dirname("a.jpg")).toBe("a.jpg");
});
