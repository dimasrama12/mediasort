import { describe, expect, test } from "vitest";
import { focusAfterRemoval } from "./afterRemoval";

/** `alive` for a plain "everything except these ids survived" removal. */
const survives = (gone: string[]) => (id: string) => !gone.includes(id);

describe("focusAfterRemoval", () => {
  test("the next file slides into the removed slot", () => {
    expect(focusAfterRemoval(["a", "b", "c", "d"], ["b"], survives(["b"]))).toBe("c");
  });

  test("removing the first file lands on the new first", () => {
    expect(focusAfterRemoval(["a", "b", "c"], ["a"], survives(["a"]))).toBe("b");
  });

  test("removing the last file steps back to the new last", () => {
    expect(focusAfterRemoval(["a", "b", "c"], ["c"], survives(["c"]))).toBe("b");
  });

  test("a removed run takes the first survivor after it", () => {
    const gone = ["b", "c", "d"];
    expect(focusAfterRemoval(["a", "b", "c", "d", "e"], gone, survives(gone))).toBe("e");
  });

  test("a removed run reaching the end steps back over the whole run", () => {
    const gone = ["c", "d", "e"];
    expect(focusAfterRemoval(["a", "b", "c", "d", "e"], gone, survives(gone))).toBe("b");
  });

  test("a scattered selection lands after the FIRST removed slot, not the last", () => {
    const gone = ["b", "d"];
    expect(focusAfterRemoval(["a", "b", "c", "d", "e"], gone, survives(gone))).toBe("c");
  });

  test("emptying the list yields null", () => {
    const gone = ["a", "b"];
    expect(focusAfterRemoval(["a", "b"], gone, survives(gone))).toBeNull();
  });

  test("a partial removal keeps the cursor on the file that survived it", () => {
    // The backend could not touch "b" (locked), so "b" is still the right place to be.
    expect(focusAfterRemoval(["a", "b", "c"], ["b"], survives([]))).toBe("b");
  });

  test("returns undefined when no removed id was on screen", () => {
    // The file was filtered out of the visible set, so the visible order says nothing useful.
    expect(focusAfterRemoval(["a", "b"], ["z"], survives(["z"]))).toBeUndefined();
  });

  test("returns undefined when no render order has been published", () => {
    expect(focusAfterRemoval([], ["a"], survives(["a"]))).toBeUndefined();
  });

  test("skips ghosts left over from an earlier removal", () => {
    // "b" is already gone from an earlier delete the grid has not re-rendered past yet.
    const gone = ["b", "c"];
    expect(focusAfterRemoval(["a", "b", "c", "d"], ["c"], survives(gone))).toBe("d");
  });

  test("the visible order is the sorted order, not the scan order (the reported bug)", () => {
    // Scan order is a,b,c…; sorted-by-name the grid shows z,y,x,w. Trashing the second tile
    // must land on the third tile as rendered — not on whatever sits at raw index 1.
    const visible = ["z", "y", "x", "w"];
    expect(focusAfterRemoval(visible, ["y"], survives(["y"]))).toBe("x");
  });
});
