//! Client-side file sorting for the grid/list (§2 "Sort By: Name, Date, Type, Size"). Pure and
//! stable so the view order is deterministic and unit-testable. Sorting never mutates the store's
//! `files`; the view derives its order from this on render.

import type { FileInfo } from "./types";

export type SortBy = "name" | "date" | "type" | "size";
export type SortDir = "asc" | "desc";

/** Timestamp a file sorts by: EXIF capture time when known, else filesystem mtime. */
const fileTime = (f: FileInfo): number => f.dateTaken ?? f.modifiedAt;

/** Return a new array sorted by `by`/`dir`. Ties break on name then original index so the sort is
 *  stable and total (no wobble between renders). `dir` flips the primary comparison only. */
export function sortFiles(files: FileInfo[], by: SortBy, dir: SortDir): FileInfo[] {
  const sign = dir === "desc" ? -1 : 1;
  const withIndex = files.map((f, i) => ({ f, i }));
  const primary = (a: FileInfo, b: FileInfo): number => {
    switch (by) {
      case "name":
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      case "date":
        return fileTime(a) - fileTime(b);
      case "size":
        return a.size - b.size;
      case "type": {
        const t = a.extension.toLowerCase().localeCompare(b.extension.toLowerCase());
        return t !== 0 ? t : a.name.localeCompare(b.name, undefined, { numeric: true });
      }
    }
  };
  withIndex.sort((x, y) => {
    const p = primary(x.f, y.f) * sign;
    if (p !== 0) return p;
    // Stable tiebreaker keeps equal elements in their original relative order.
    const n = x.f.name.localeCompare(y.f.name, undefined, { numeric: true, sensitivity: "base" });
    return n !== 0 ? n : x.i - y.i;
  });
  return withIndex.map((x) => x.f);
}
