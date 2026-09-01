import { expect, test } from "vitest";
import { nextFocusIndex } from "./gridNav";

// Reason about a 10-item, 4-column grid: rows [0..3] [4..7] [8..9].
test("right/j moves by one and clamps at the last item", () => {
  expect(nextFocusIndex(0, "ArrowRight", 4, 10)).toBe(1);
  expect(nextFocusIndex(0, "j", 4, 10)).toBe(1);
  expect(nextFocusIndex(9, "ArrowRight", 4, 10)).toBe(9);
});

test("left/k moves by one and clamps at the first item", () => {
  expect(nextFocusIndex(5, "ArrowLeft", 4, 10)).toBe(4);
  expect(nextFocusIndex(5, "k", 4, 10)).toBe(4);
  expect(nextFocusIndex(0, "ArrowLeft", 4, 10)).toBe(0);
});

test("down moves by a row, staying put when no row below", () => {
  expect(nextFocusIndex(1, "ArrowDown", 4, 10)).toBe(5);
  expect(nextFocusIndex(8, "ArrowDown", 4, 10)).toBe(8); // 8+4=12 out of range
});

test("up moves by a row, staying put when no row above", () => {
  expect(nextFocusIndex(5, "ArrowUp", 4, 10)).toBe(1);
  expect(nextFocusIndex(1, "ArrowUp", 4, 10)).toBe(1); // 1-4=-3 out of range
});

test("no focus (-1) selects the first item; empty grid yields -1", () => {
  expect(nextFocusIndex(-1, "ArrowDown", 4, 10)).toBe(0);
  expect(nextFocusIndex(-1, "ArrowRight", 4, 0)).toBe(-1);
});
