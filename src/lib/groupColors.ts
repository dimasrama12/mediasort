//! Per-group badge colors (§5). A group's dot used to be amber for every group, which made a
//! screen full of tiles from six different groups unreadable. Seven distinct hues, cycled by
//! group index, keep neighbouring groups visually separable even at 117 groups — the point is
//! "these two tiles are in *different* groups", not "this exact hue means group 43".

/** Seven hues picked to stay distinguishable on both the light and dark surfaces. */
export const GROUP_COLORS = [
  "#fbbf24", // amber
  "#38bdf8", // sky
  "#a78bfa", // violet
  "#34d399", // emerald
  "#fb7185", // rose
  "#fb923c", // orange
  "#22d3ee", // cyan
] as const;

/** Color for the `index`-th group, cycling every 7. Negative/unknown indexes fall back to slot 0. */
export function groupColor(index: number): string {
  if (!Number.isFinite(index) || index < 0) return GROUP_COLORS[0];
  return GROUP_COLORS[Math.floor(index) % GROUP_COLORS.length];
}

/** groupId → its position in the group list, so the grid can color a tile in O(1). */
export function groupIndexMap(groups: { id: string }[]): Map<string, number> {
  return new Map(groups.map((g, i) => [g.id, i]));
}
