//! Which files a grouping run covers (§5).
//!
//! With several libraries open, "Group: Similar" over all of them is rarely what is wanted — a
//! phone dump and a scanned photo album have nothing to say to each other. The pop-up asks; this
//! module answers "is this file under one of the chosen roots?".

import type { FileInfo } from "./types";
import { normalizePath } from "./paths";

/** The files sitting under any of `roots`. `f.id` is already the normalized path (minted in Rust
 *  at scan time), so only the roots need normalizing here.
 *
 *  The separator in the prefix test is load-bearing: without it `D:\foto2024` would count as
 *  inside `D:\foto`, because one string does start with the other. */
export function filesInScope(files: FileInfo[], roots: string[]): FileInfo[] {
  if (roots.length === 0) return [];
  const prefixes = roots.map(normalizePath);
  return files.filter((f) => prefixes.some((p) => f.id === p || f.id.startsWith(p + "\\")));
}
