//! Plain-text rendering of an EXIF payload (§6) — what the "Copy to Clipboard" button puts on
//! the clipboard. Kept out of the component so the exact output is pinned by tests rather than
//! by reading JSX.

import type { ExifData } from "./types";

/** Human file size, matching the units the rest of the app uses for a single file. */
export function fileSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** The file's own facts, shown above the EXIF table and copied with it. */
export function fileFacts(data: ExifData): { label: string; value: string }[] {
  const facts = [
    { label: "File", value: data.name },
    { label: "Path", value: data.path },
    { label: "Size", value: fileSize(data.size) },
  ];
  if (data.width != null && data.height != null) {
    facts.push({ label: "Dimensions", value: `${data.width} × ${data.height}` });
  }
  if (data.modifiedAt > 0) {
    facts.push({ label: "Modified", value: new Date(data.modifiedAt * 1000).toLocaleString() });
  }
  return facts;
}

/** The whole payload as `Label: value` lines: file facts first, then every EXIF field, grouped
 *  under its IFD. Copies cleanly into a note, an issue, or a message. */
export function exifToText(data: ExifData): string {
  const lines = fileFacts(data).map((f) => `${f.label}: ${f.value}`);
  if (data.entries.length === 0) {
    lines.push("", "No EXIF metadata in this file.");
    return lines.join("\n");
  }
  let ifd: string | null = null;
  for (const e of data.entries) {
    if (e.ifd !== ifd) {
      ifd = e.ifd;
      lines.push("", `[${ifd}]`);
    }
    lines.push(`${e.tag}: ${e.value}`);
  }
  return lines.join("\n");
}
