import { expect, test } from "vitest";
import { cellWidth, gridColumns } from "./FileGrid";
import { formatBytes } from "./Toolbar";

test("the grid is 10 wide with the sidebar closed and 9 with it open", () => {
  expect(gridColumns(false, true)).toBe(10);
  expect(gridColumns(false, false)).toBe(9);
});

test("list view is three columns either way", () => {
  expect(gridColumns(true, true)).toBe(3);
  expect(gridColumns(true, false)).toBe(3);
});

test("cells divide the container so a full row leaves no gap on the right", () => {
  const gap = 6;
  for (const [w, cols] of [[1240, 10], [1024, 9], [1920, 10], [700, 9]] as const) {
    const cw = cellWidth(w, cols);
    const used = cols * cw + (cols - 1) * gap + 2 * gap;
    expect(used).toBeLessThanOrEqual(w);
    expect(w - used).toBeLessThan(cols); // at most a sub-pixel of rounding per column
  }
});

test("cells stay usable even in an absurdly narrow window", () => {
  expect(cellWidth(120, 10)).toBeGreaterThanOrEqual(48);
  expect(cellWidth(0, 9)).toBeGreaterThanOrEqual(48);
});

test("total size reads in GB, MB or KB as appropriate", () => {
  expect(formatBytes(0)).toBe("0 MB");
  expect(formatBytes(1024 * 512)).toBe("512 KB");
  expect(formatBytes(1024 ** 2 * 3.5)).toBe("3.5 MB");
  expect(formatBytes(1024 ** 2 * 250)).toBe("250 MB");
  expect(formatBytes(1024 ** 3 * 1.5)).toBe("1.50 GB");
  expect(formatBytes(1024 ** 3 * 42)).toBe("42.0 GB");
});
