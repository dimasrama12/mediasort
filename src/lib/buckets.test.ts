import { expect, test } from "vitest";
import { applyBucketVisibility, bucketKey, bucketValue, bucketsOf } from "./buckets";
import type { FileInfo } from "./types";

const mk = (name: string, ext: string, secs = 0): FileInfo => ({
  id: name, path: `C:/x/${name}`, name, extension: ext, size: 1,
  modifiedAt: secs, dateTaken: null, fileType: "image", groupId: null,
});

// 2021-01-01 and 2021-01-03 in local time, taken from local midnight so the day key is stable
// wherever this runs.
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime() / 1000;

const files = [
  mk("a.png", "png", day(2021, 1, 1)),
  mk("b.jpg", "jpg", day(2021, 1, 1)),
  mk("c.jpg", "jpg", day(2021, 1, 3)),
];

test("type buckets are the distinct extensions, counted", () => {
  const got = bucketsOf(files, "type");
  expect(got.map((b) => [b.label, b.count])).toEqual([
    ["JPG", 2],
    ["PNG", 1],
  ]);
  expect(got[0].key).toBe("type:jpg");
});

test("date buckets are calendar days in chronological order", () => {
  const got = bucketsOf(files, "date");
  expect(got).toHaveLength(2);
  expect(got[0].value < got[1].value).toBe(true);
  expect(got[0].count).toBe(2);
});

test("hiding a type removes exactly those files", () => {
  const got = applyBucketVisibility(files, "type", ["type:png"]);
  expect(got.map((f) => f.name)).toEqual(["b.jpg", "c.jpg"]);
});

test("hiding every type leaves nothing, and clearing brings it all back", () => {
  expect(applyBucketVisibility(files, "type", ["type:png", "type:jpg"])).toHaveLength(0);
  expect(applyBucketVisibility(files, "type", [])).toHaveLength(3);
});

test("a hidden bucket from the other kind is ignored", () => {
  // You can't see the png toggle while sorting by date, so it must not silently filter there.
  expect(applyBucketVisibility(files, "date", ["type:png"])).toHaveLength(3);
  expect(applyBucketVisibility(files, null, ["type:png"])).toHaveLength(3);
});

test("keys are namespaced so a date and a type can never collide", () => {
  expect(bucketKey("type", "png")).not.toBe(bucketKey("date", "png"));
  expect(bucketValue(mk("x.JPG", "JPG"), "type")).toBe("jpg");
});
