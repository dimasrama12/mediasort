import { expect, test } from "vitest";
import { exifToText, fileFacts, fileSize } from "./exifText";
import type { ExifData } from "./types";

const base: ExifData = {
  path: "C:/photos/a.jpg",
  name: "a.jpg",
  size: 2048,
  modifiedAt: 0,
  width: 4000,
  height: 3000,
  hasExif: true,
  entries: [
    { tag: "Make", ifd: "Primary", value: "Canon" },
    { tag: "ExposureTime", ifd: "Primary", value: "1/125 s" },
    { tag: "Compression", ifd: "Thumbnail", value: "JPEG" },
  ],
};

test("fileSize switches units at the right boundaries", () => {
  expect(fileSize(0)).toBe("0 B");
  expect(fileSize(1023)).toBe("1023 B");
  expect(fileSize(1024)).toBe("1.0 KB");
  expect(fileSize(1024 * 1024)).toBe("1.0 MB");
});

test("fileFacts always carries the file's own identity", () => {
  const labels = fileFacts(base).map((f) => f.label);
  expect(labels).toEqual(["File", "Path", "Size", "Dimensions"]);
  expect(fileFacts(base)[3].value).toBe("4000 × 3000");
});

test("fileFacts omits dimensions the backend couldn't read, and a zero mtime", () => {
  const labels = fileFacts({ ...base, width: null, height: null }).map((f) => f.label);
  expect(labels).toEqual(["File", "Path", "Size"]);
  // A real mtime does show up.
  const dated = fileFacts({ ...base, modifiedAt: 1_600_000_000 }).map((f) => f.label);
  expect(dated).toContain("Modified");
});

test("exifToText groups the fields under their IFD", () => {
  const text = exifToText(base);
  expect(text).toContain("File: a.jpg");
  expect(text).toContain("[Primary]");
  expect(text).toContain("Make: Canon");
  expect(text).toContain("ExposureTime: 1/125 s");
  expect(text).toContain("[Thumbnail]");
  // The header appears once per IFD, not once per field.
  expect(text.split("[Primary]")).toHaveLength(2);
});

test("exifToText says so plainly when there is no metadata", () => {
  const text = exifToText({ ...base, hasExif: false, entries: [] });
  expect(text).toContain("No EXIF metadata in this file.");
  expect(text).toContain("File: a.jpg"); // the file's own facts are still worth copying
});
