/** Next focus index for an arrow/vim key in a `columns`-wide grid of `count`
 * items. Left/right (k/j) move by one and clamp to the ends; up/down move by a
 * row and stay put when there is no neighboring row. `current < 0` (no focus)
 * focuses the first item; an empty grid yields -1. */
export function nextFocusIndex(
  current: number,
  key: string,
  columns: number,
  count: number,
): number {
  if (count === 0) return -1;
  if (current < 0) return 0;
  switch (key) {
    case "ArrowRight":
    case "j":
      return Math.min(current + 1, count - 1);
    case "ArrowLeft":
    case "k":
      return Math.max(current - 1, 0);
    case "ArrowDown": {
      const t = current + columns;
      return t <= count - 1 ? t : current;
    }
    case "ArrowUp": {
      const t = current - columns;
      return t >= 0 ? t : current;
    }
    default:
      return current;
  }
}
