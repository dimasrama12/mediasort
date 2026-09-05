//! Marquee (rubber-band) selection geometry (§3).
//!
//! The grid drives this with live DOM rectangles, which jsdom can't produce; keeping the maths
//! here — pure, in viewport coordinates, with no React and no DOM — is what makes the behaviour
//! testable at all. The component is then only responsible for reading rectangles and calling in.

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** How far the pointer must travel before a press becomes a drag. Below this a press is a click
 *  (which clears the selection); without it, every click would flash a 1px selection box. */
export const DRAG_THRESHOLD = 5;

/** Normalized rectangle spanned by two points, in any drag direction. */
export function rectFromPoints(ax: number, ay: number, bx: number, by: number): Rect {
  return {
    left: Math.min(ax, bx),
    top: Math.min(ay, by),
    right: Math.max(ax, bx),
    bottom: Math.max(ay, by),
  };
}

/** Has the pointer moved far enough (Chebyshev distance) to count as a drag? */
export function exceedsThreshold(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  threshold = DRAG_THRESHOLD,
): boolean {
  return Math.abs(bx - ax) >= threshold || Math.abs(by - ay) >= threshold;
}

/** Do two rectangles overlap at all? Touching edges don't count — a marquee dragged exactly along
 *  a tile's border shouldn't grab it. */
export function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Ids of every tile the marquee touches, in the order the tiles were given (= render order). */
export function idsInRect(tiles: { id: string; rect: Rect }[], marquee: Rect): string[] {
  return tiles.filter((t) => intersects(t.rect, marquee)).map((t) => t.id);
}

/** What the selection becomes while a marquee is being dragged.
 *
 *  * `replace` — a plain drag: exactly what the box covers.
 *  * `add` — Ctrl/Shift held: the selection the drag started from, plus what the box covers.
 *
 *  `add` keeps the base ids in their original order and appends new hits, so a subsequent
 *  Shift+Arrow still walks a sane sequence. */
export function mergeSelection(
  base: string[],
  hits: string[],
  mode: "replace" | "add",
): string[] {
  if (mode === "replace") return hits;
  const seen = new Set(base);
  return [...base, ...hits.filter((id) => !seen.has(id))];
}
