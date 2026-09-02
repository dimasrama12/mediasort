import type { FileInfo } from "./types";

/** Case-insensitive substring filter on file name. A blank query returns all files. */
export function filterFiles(files: FileInfo[], query: string): FileInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return files;
  return files.filter((f) => f.name.toLowerCase().includes(q));
}
