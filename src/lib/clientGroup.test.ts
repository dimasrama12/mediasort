import { expect, test } from "vitest";
import { dayKey, groupByDate, groupByType } from "./clientGroup";
import type { FileInfo } from "./types";

const mk = (over: Partial<FileInfo>): FileInfo => ({
  id: over.id ?? over.name ?? "x",
  path: `C:/x/${over.name ?? "x"}`,
  name: over.name ?? "x",
  extension: "jpg",
  size: 0,
  modifiedAt: 0,
  dateTaken: null,
  fileType: "image",
  groupId: null,
  ...over,
});

// A fixed local-noon timestamp avoids the group flipping across a day boundary in any timezone.
const noonOf = (y: number, m: number, d: number) => Math.floor(new Date(y, m - 1, d, 12).getTime() / 1000);

test("groupByType buckets by extension, largest first, every file placed", () => {
  const files = [
    mk({ id: "1", extension: "jpg" }),
    mk({ id: "2", extension: "png" }),
    mk({ id: "3", extension: "jpg" }),
    mk({ id: "4", extension: "mp4" }),
    mk({ id: "5", extension: "jpg" }),
  ];
  const groups = groupByType(files);
  expect(groups.map((g) => g.name)).toEqual(["JPG", "MP4", "PNG"]); // 3, 1, 1 → ties alpha
  expect(groups[0].fileIds).toEqual(["1", "3", "5"]);
  expect(groups[0].groupType).toBe("type");
  expect(groups.flatMap((g) => g.fileIds)).toHaveLength(5);
});

test("groupByDate buckets by calendar day, chronological", () => {
  const files = [
    mk({ id: "b", dateTaken: noonOf(2026, 9, 4) }),
    mk({ id: "a", dateTaken: noonOf(2026, 9, 1) }),
    mk({ id: "c", dateTaken: noonOf(2026, 9, 4) }),
  ];
  const groups = groupByDate(files);
  expect(groups.map((g) => g.name)).toEqual(["2026-09-01", "2026-09-04"]);
  expect(groups[1].fileIds).toEqual(["b", "c"]);
  expect(groups[1].groupType).toBe("date");
  expect(groups[1].timeSpan).toBe("2026-09-04");
});

test("dayKey falls back to mtime when there is no EXIF date", () => {
  expect(dayKey(mk({ dateTaken: null, modifiedAt: noonOf(2026, 1, 15) }))).toBe("2026-01-15");
});

test("groupByDate can order the days by volume instead (§4)", () => {
  const files = [
    mk({ id: "a1", dateTaken: noonOf(2026, 9, 1) }),
    mk({ id: "b1", dateTaken: noonOf(2026, 9, 2) }),
    mk({ id: "b2", dateTaken: noonOf(2026, 9, 2) }),
    mk({ id: "b3", dateTaken: noonOf(2026, 9, 2) }),
    mk({ id: "c1", dateTaken: noonOf(2026, 9, 3) }),
    mk({ id: "c2", dateTaken: noonOf(2026, 9, 3) }),
  ];
  // Default is unchanged: oldest day first.
  expect(groupByDate(files).map((g) => g.name)).toEqual([
    "2026-09-01",
    "2026-09-02",
    "2026-09-03",
  ]);
  // By volume the busiest day leads, and the group keeps its own date as its name.
  const byVolume = groupByDate(files, "volume");
  expect(byVolume.map((g) => g.name)).toEqual(["2026-09-02", "2026-09-03", "2026-09-01"]);
  expect(byVolume.map((g) => g.fileIds.length)).toEqual([3, 2, 1]);
  expect(byVolume.flatMap((g) => g.fileIds)).toHaveLength(6);
});

test("equal-sized days fall back to the date, so the volume order is stable", () => {
  const files = [
    mk({ id: "late", dateTaken: noonOf(2026, 9, 9) }),
    mk({ id: "early", dateTaken: noonOf(2026, 9, 2) }),
  ];
  expect(groupByDate(files, "volume").map((g) => g.name)).toEqual(["2026-09-02", "2026-09-09"]);
});
