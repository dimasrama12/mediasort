import { expect, test } from "vitest";
import {
  DRAG_THRESHOLD,
  exceedsThreshold,
  idsInRect,
  intersects,
  mergeSelection,
  rectFromPoints,
  type Rect,
} from "./marquee";

const r = (left: number, top: number, right: number, bottom: number): Rect => ({
  left,
  top,
  right,
  bottom,
});

test("rectFromPoints normalizes whichever way the drag went", () => {
  const expected = r(10, 20, 40, 60);
  expect(rectFromPoints(10, 20, 40, 60)).toEqual(expected); // down-right
  expect(rectFromPoints(40, 60, 10, 20)).toEqual(expected); // up-left
  expect(rectFromPoints(40, 20, 10, 60)).toEqual(expected); // down-left
  expect(rectFromPoints(10, 60, 40, 20)).toEqual(expected); // up-right
});

test("exceedsThreshold ignores a jittery click but catches a real drag", () => {
  expect(exceedsThreshold(100, 100, 100, 100)).toBe(false);
  expect(exceedsThreshold(100, 100, 100 + DRAG_THRESHOLD - 1, 100)).toBe(false);
  expect(exceedsThreshold(100, 100, 100 + DRAG_THRESHOLD, 100)).toBe(true);
  expect(exceedsThreshold(100, 100, 100, 100 - DRAG_THRESHOLD)).toBe(true); // either axis, either way
});

test("intersects is true on overlap and false on a mere touch", () => {
  const box = r(0, 0, 10, 10);
  expect(intersects(box, r(5, 5, 15, 15))).toBe(true); // corner overlap
  expect(intersects(box, r(2, 2, 4, 4))).toBe(true); // fully contained
  expect(intersects(r(2, 2, 4, 4), box)).toBe(true); // containment is symmetric
  expect(intersects(box, r(10, 0, 20, 10))).toBe(false); // edges touching only
  expect(intersects(box, r(11, 11, 20, 20))).toBe(false); // clear miss
});

test("idsInRect picks the tiles the band covers, in render order", () => {
  const tiles = [
    { id: "a", rect: r(0, 0, 50, 50) },
    { id: "b", rect: r(60, 0, 110, 50) },
    { id: "c", rect: r(120, 0, 170, 50) },
    { id: "d", rect: r(0, 60, 50, 110) },
  ];
  // A band across the top row, stopping short of "c".
  expect(idsInRect(tiles, r(10, 10, 100, 40))).toEqual(["a", "b"]);
  // A tall band down the left edge takes both rows.
  expect(idsInRect(tiles, r(5, 5, 20, 200))).toEqual(["a", "d"]);
  expect(idsInRect(tiles, r(500, 500, 600, 600))).toEqual([]);
});

test("mergeSelection replaces by default and unions when additive", () => {
  expect(mergeSelection(["x", "y"], ["a", "b"], "replace")).toEqual(["a", "b"]);
  expect(mergeSelection(["x", "y"], ["a", "b"], "add")).toEqual(["x", "y", "a", "b"]);
  // No duplicates when the band sweeps back over something already selected.
  expect(mergeSelection(["x", "y"], ["y", "z"], "add")).toEqual(["x", "y", "z"]);
  expect(mergeSelection([], [], "replace")).toEqual([]);
});
