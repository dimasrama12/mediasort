//! Client-side "Group by" (§2 "Group By: Date, Type"). Unlike visual/temporal grouping (which
//! runs in Rust over pixel hashes / bursts), Date and Type are cheap metadata buckets computed in
//! the UI. They produce the same `FileGroup[]` shape so they flow through the existing
//! `applyGroups` store path, the sidebar Groups list, and project persistence unchanged.

import type { FileGroup, FileInfo } from "./types";

const fileTime = (f: FileInfo): number => f.dateTaken ?? f.modifiedAt;

/** Local calendar-day key, e.g. "2026-09-04", from a file's capture/mtime timestamp. */
export function dayKey(f: FileInfo): string {
  const d = new Date(fileTime(f) * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** How the dated groups are ordered (§4). Chronological is the default — a diary reads
 *  oldest-first — but "which day did I shoot the most?" is a different, equally real question. */
export type DateOrder = "chronological" | "volume";

/** Group files by calendar day. Every file lands in exactly one dated group.
 *  `order` picks between oldest-first (default) and biggest-day-first; ties inside a volume sort
 *  fall back to the date, so the order is total and never wobbles between renders. */
export function groupByDate(files: FileInfo[], order: DateOrder = "chronological"): FileGroup[] {
  const buckets = new Map<string, FileInfo[]>();
  for (const f of files) {
    const k = dayKey(f);
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(f);
  }
  const entries = [...buckets.entries()].sort((a, b) =>
    order === "volume"
      ? b[1].length - a[1].length || a[0].localeCompare(b[0])
      : a[0].localeCompare(b[0]),
  );
  return entries.map(([key, group]) => ({
    id: `date-${key}`,
    name: key,
    fileIds: group.map((f) => f.id),
    similarity: 0,
    timeSpan: key,
    groupType: "date" as const,
  }));
}

/** Group files by extension/type (largest bucket first, then alphabetical). */
export function groupByType(files: FileInfo[]): FileGroup[] {
  const buckets = new Map<string, FileInfo[]>();
  for (const f of files) {
    const k = f.extension.toLowerCase() || "(none)";
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(f);
  }
  return [...buckets.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([ext, group]) => ({
      id: `type-${ext}`,
      name: ext.toUpperCase(),
      fileIds: group.map((f) => f.id),
      similarity: 0,
      timeSpan: null,
      groupType: "type" as const,
    }));
}
