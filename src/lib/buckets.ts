//! Show/hide buckets for the Date and Type sorts (§5). When you sort by type you are almost
//! always about to say "just the JPGs, please"; same for a single day when sorting by date. Each
//! distinct value becomes a toggle, and hidden values are filtered out of the visible set.
//!
//! Keys are namespaced (`type:png`, `date:2026-09-04`) so one `hiddenBuckets` list can hold both
//! kinds at once without a png/2026 collision, and switching sort back and forth remembers what
//! you had hidden.

import type { FileInfo } from "./types";
import { dayKey } from "./clientGroup";

export type BucketKind = "date" | "type";

/** The bucket a file falls into for `kind`. */
export function bucketValue(file: FileInfo, kind: BucketKind): string {
  return kind === "type" ? file.extension.toLowerCase() || "(none)" : dayKey(file);
}

/** Namespaced key stored in `hiddenBuckets`. */
export const bucketKey = (kind: BucketKind, value: string): string => `${kind}:${value}`;

export interface Bucket {
  key: string; // namespaced, matches hiddenBuckets entries
  value: string; // raw value
  label: string; // display text
  count: number;
}

/** Every distinct bucket in `files`, ordered the way the matching sort orders them: types by
 *  extension, dates chronologically. */
export function bucketsOf(files: FileInfo[], kind: BucketKind): Bucket[] {
  const counts = new Map<string, number>();
  for (const f of files) {
    const v = bucketValue(f, kind);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([value, count]) => ({
      key: bucketKey(kind, value),
      value,
      label: kind === "type" ? value.toUpperCase() : value,
      count,
    }));
}

/** Drop files whose bucket is hidden. Only the bucket kind matching the active sort is applied,
 *  so hiding "png" while sorting by date never silently removes files you can't see a toggle for. */
export function applyBucketVisibility(
  files: FileInfo[],
  kind: BucketKind | null,
  hidden: string[],
): FileInfo[] {
  if (!kind || hidden.length === 0) return files;
  const hiddenSet = new Set(hidden);
  if (![...hiddenSet].some((k) => k.startsWith(`${kind}:`))) return files;
  return files.filter((f) => !hiddenSet.has(bucketKey(kind, bucketValue(f, kind))));
}
