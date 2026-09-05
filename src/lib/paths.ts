//! Path identity, mirroring `src-tauri/src/paths.rs::normalize_path`.
//!
//! A file's `id` is its normalized path, minted in Rust at scan time. Any place the frontend
//! moves a file to a *new* path and keeps it in the grid (returning files from a target folder
//! to the library) has to mint the same key, or the id would stop matching what the backend
//! would produce and every cache keyed on it would quietly diverge.

/** Normalize a Windows path into the stable identity key: `/` → `\`, collapse duplicate and
 *  trailing separators, lowercase (the Windows filesystem is case-insensitive). */
export function normalizePath(p: string): string {
  return p
    .replace(/\//g, "\\")
    .split("\\")
    .filter((s) => s.length > 0)
    .map((s) => s.toLowerCase())
    .join("\\");
}

/** The directory part of a path, or the path itself when it has no separator. */
export function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(0, i) : p;
}
