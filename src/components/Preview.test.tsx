import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => ""),
  convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
}));

vi.mock("../lib/commands", () => ({
  rotateImage: vi.fn(async () => ({ modifiedAt: 1700, size: 42 })),
  decodePreview: vi.fn(async () => "data:image/png;base64,AAAA"),
  openInDefaultApp: vi.fn(async () => {}),
  // Filing a photo from inside the viewer goes through fileActions.moveToFolder.
  moveFiles: vi.fn(async (paths: string[], dest: string) =>
    paths.map((p) => `${dest}/${p.split("/").pop()}`),
  ),
  listTargetFolders: vi.fn(async () => useAppStore.getState().folders),
  trashFiles: vi.fn(async () => []),
}));

import { Preview } from "./Preview";
import { rotateImage, decodePreview, openInDefaultApp, moveFiles } from "../lib/commands";
import { useAppStore } from "../store/useAppStore";
import type { FileInfo } from "../lib/types";

const img = (id: string): FileInfo => ({
  id, path: `C:/x/${id}.jpg`, name: `${id}.jpg`, extension: "jpg", size: 1,
  modifiedAt: 0, dateTaken: null, fileType: "image", groupId: null,
});
const vid = (id: string): FileInfo => ({ ...img(id), path: `C:/x/${id}.mp4`, name: `${id}.mp4`, extension: "mp4", fileType: "video" });
const heic = (id: string): FileInfo => ({ ...img(id), path: `C:/x/${id}.heic`, name: `${id}.heic`, extension: "heic" });
const odd = (id: string): FileInfo => ({ ...img(id), path: `C:/x/${id}.psd`, name: `${id}.psd`, extension: "psd" });

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    files: [], previewId: null, visibleIds: [], browseFolder: null, browseFiles: [],
    folders: [], selectedIds: [], focusedId: null, undoStack: [], redoStack: [],
  });
});
afterEach(cleanup);

test("renders nothing when no preview is open", () => {
  const { container } = render(<Preview />);
  expect(container.firstChild).toBeNull();
});

test("renders an <img> with an asset src for an image", () => {
  useAppStore.setState({ files: [img("a")], previewId: "a" });
  render(<Preview />);
  const el = document.querySelector("img");
  expect(el).not.toBeNull();
  expect(el!.getAttribute("src")).toContain("asset://");
});

test("renders a <video> for a video file", () => {
  useAppStore.setState({ files: [vid("v")], previewId: "v" });
  render(<Preview />);
  expect(document.querySelector("video")).not.toBeNull();
});

test("a HEIC is decoded in Rust and shown as a data URL", async () => {
  useAppStore.setState({ files: [heic("h")], previewId: "h" });
  render(<Preview />);
  await waitFor(() => expect(decodePreview).toHaveBeenCalledWith("C:/x/h.heic"));
  await waitFor(() =>
    expect(document.querySelector("img")!.getAttribute("src")).toBe("data:image/png;base64,AAAA"),
  );
});

test("an unknown format offers to open in the default app", () => {
  useAppStore.setState({ files: [odd("o")], previewId: "o" });
  render(<Preview />);
  fireEvent.click(screen.getByText("Open in default app"));
  expect(openInDefaultApp).toHaveBeenCalledWith("C:/x/o.psd");
});

test("a video the webview cannot play falls back to the default app", async () => {
  const mkv: FileInfo = { ...vid("m"), path: "C:/x/m.mkv", name: "m.mkv", extension: "mkv" };
  useAppStore.setState({ files: [mkv], previewId: "m" });
  render(<Preview />);
  fireEvent.error(document.querySelector("video")!);
  await waitFor(() => expect(screen.getByText("Open in default app")).toBeTruthy());
});

test("the close button closes the preview", () => {
  useAppStore.setState({ files: [img("a")], previewId: "a" });
  render(<Preview />);
  fireEvent.click(screen.getByLabelText("Close"));
  expect(useAppStore.getState().previewId).toBeNull();
});

test("Escape closes the preview", () => {
  useAppStore.setState({ files: [img("a")], previewId: "a" });
  render(<Preview />);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(useAppStore.getState().previewId).toBeNull();
});

test("ArrowRight navigates to the next file", () => {
  useAppStore.setState({ files: [img("a"), img("b")], previewId: "a" });
  render(<Preview />);
  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(useAppStore.getState().previewId).toBe("b");
});

test("navigation follows the grid's visible order, not the scan order", () => {
  useAppStore.setState({
    files: [img("a"), img("b"), img("c")],
    visibleIds: ["c", "a", "b"],
    previewId: "c",
  });
  render(<Preview />);
  fireEvent.keyDown(window, { key: "ArrowRight" });
  expect(useAppStore.getState().previewId).toBe("a");
});

test("R rotates the actual file on disk, not just the view", async () => {
  useAppStore.setState({ files: [img("a")], previewId: "a" });
  render(<Preview />);
  fireEvent.keyDown(window, { key: "R" });
  await waitFor(() => expect(rotateImage).toHaveBeenCalledWith("C:/x/a.jpg", 90));
  // The reload is cache-busted, so the webview refetches the rewritten file.
  await waitFor(() =>
    expect(document.querySelector("img")!.getAttribute("src")).toContain("?v=1700"),
  );
});

test("L rotates the other way", async () => {
  useAppStore.setState({ files: [img("a")], previewId: "a" });
  render(<Preview />);
  fireEvent.keyDown(window, { key: "L" });
  await waitFor(() => expect(rotateImage).toHaveBeenCalledWith("C:/x/a.jpg", -90));
});

test("a failed rotation surfaces the reason and leaves the image alone", async () => {
  vi.mocked(rotateImage).mockRejectedValueOnce("rotating .webp in place isn't supported");
  useAppStore.setState({ files: [img("a")], previewId: "a" });
  render(<Preview />);
  fireEvent.keyDown(window, { key: "R" });
  await waitFor(() => expect(screen.getByText(/isn't supported/)).toBeTruthy());
  // Still keyed on the *unchanged* mtime, so no refetch was forced.
  expect(document.querySelector("img")!.getAttribute("src")).toContain("?v=0");
});

test("the zoom buttons scale the image and reset returns to 100%", () => {
  useAppStore.setState({ files: [img("a")], previewId: "a" });
  render(<Preview />);
  fireEvent.click(screen.getByLabelText("Zoom in"));
  expect(document.querySelector("img")!.style.transform).toContain("scale(1.25)");
  fireEvent.click(screen.getByLabelText("Zoom out"));
  expect(document.querySelector("img")!.style.transform).toContain("scale(1)");
  fireEvent.click(screen.getByLabelText("Zoom in"));
  fireEvent.click(screen.getByLabelText("Reset zoom"));
  expect(document.querySelector("img")!.style.transform).toContain("scale(1)");
});

test("+ / - / 0 zoom from the keyboard", () => {
  useAppStore.setState({ files: [img("a")], previewId: "a" });
  render(<Preview />);
  fireEvent.keyDown(window, { key: "+" });
  expect(document.querySelector("img")!.style.transform).toContain("scale(1.25)");
  fireEvent.keyDown(window, { key: "0" });
  expect(document.querySelector("img")!.style.transform).toContain("scale(1)");
});

test("zoom is clamped: 800% at the top, and 100% is the floor (\u00a71)", () => {
  useAppStore.setState({ files: [img("a")], previewId: "a" });
  render(<Preview />);
  for (let i = 0; i < 40; i++) fireEvent.click(screen.getByLabelText("Zoom in"));
  expect(screen.getByLabelText("Reset zoom").textContent).toBe("800%");
  // Zooming out stops at 100% — shrinking the photo below the size the window already shows it
  // at only ever produced a stamp floating in a black field.
  for (let i = 0; i < 60; i++) fireEvent.click(screen.getByLabelText("Zoom out"));
  expect(screen.getByLabelText("Reset zoom").textContent).toBe("100%");
});

test("the zoom-out button is disabled once the image is back at 100%", () => {
  useAppStore.setState({ files: [img("a")], previewId: "a" });
  render(<Preview />);
  expect((screen.getByLabelText("Zoom out") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("Zoom in"));
  expect((screen.getByLabelText("Zoom out") as HTMLButtonElement).disabled).toBe(false);
});

test("the - key cannot shrink the image below 100% either", () => {
  useAppStore.setState({ files: [img("a")], previewId: "a" });
  render(<Preview />);
  fireEvent.keyDown(window, { key: "-" });
  expect(document.querySelector("img")!.style.transform).toContain("scale(1)");
});

test("the preview reads from the browsed folder when one is open", () => {
  const inFolder = { ...img("z"), path: "C:/base/fam/z.jpg" };
  useAppStore.setState({
    files: [],
    browseFolder: { id: "fam", name: "fam", path: "C:/base/fam", key: "1", keyCustom: false, fileCount: 1 },
    browseFiles: [inFolder],
    previewId: "z",
  });
  render(<Preview />);
  expect(document.querySelector("img")!.getAttribute("src")).toContain("fam");
});

/* ------------------------------------------------------------------------------------------
 * The "This machine has no codec for .png" regression.
 *
 * Every browser engine on earth decodes PNG. When the <img> failed it was never the codec: it
 * was the *asset URL* (a directory the asset protocol was never granted, a path it mangles, a
 * file being rewritten underneath). Sending the user out to another application over that is
 * the wrong answer, so a failed load now falls through to the Rust decoder first.
 * ---------------------------------------------------------------------------------------- */

const png = (id: string): FileInfo => ({
  ...img(id),
  path: `C:/x/${id}.png`,
  name: `${id}.png`,
  extension: "png",
});

test("a PNG whose asset URL fails is decoded in Rust, not handed to another app", async () => {
  useAppStore.setState({ files: [png("a")], previewId: "a" });
  render(<Preview />);

  fireEvent.error(document.querySelector("img")!);

  await waitFor(() => expect(decodePreview).toHaveBeenCalledWith("C:/x/a.png"));
  await waitFor(() =>
    expect(document.querySelector("img")!.getAttribute("src")).toBe("data:image/png;base64,AAAA"),
  );
  // ...and the modal that used to appear here does not.
  expect(screen.queryByText(/no codec/i)).toBeNull();
  // The escape hatch belongs to the fallback card and nowhere else, so a picture that renders
  // fine never offers it.
  expect(screen.queryByText("Open in default app")).toBeNull();
  expect(screen.queryByText(/could not be decoded/i)).toBeNull();
});

test("only a still that BOTH decoders refuse falls back to the default app", async () => {
  vi.mocked(decodePreview).mockRejectedValueOnce(new Error("corrupt"));
  useAppStore.setState({ files: [png("b")], previewId: "b" });
  render(<Preview />);

  fireEvent.error(document.querySelector("img")!);

  await waitFor(() => expect(screen.getByText(/could not be decoded/i)).toBeTruthy());
  // The wording no longer blames a missing codec for a format the webview decodes natively.
  expect(screen.queryByText(/no codec for .png/i)).toBeNull();
});

/* ------------------------------------------------------------------------------------------
 * Filing from inside the viewer (§3). Deciding where a photo goes is what the preview is *for*,
 * and it used to be the one place you could not act on that decision.
 * ---------------------------------------------------------------------------------------- */

const fam = { id: "fam", name: "Family", path: "C:/base/fam", key: "1", keyCustom: false, fileCount: 0 };
const trip = { id: "trip", name: "Trip", path: "C:/base/trip", key: "2", keyCustom: false, fileCount: 0 };

test("an image that renders has no open-in-default-app control", () => {
  useAppStore.setState({ files: [img("a")], previewId: "a" });
  render(<Preview />);
  expect(screen.queryByLabelText("Open in default app")).toBeNull();
  expect(screen.queryByText("Open in default app")).toBeNull();
});

test("the toolbar offers one button per target folder", () => {
  useAppStore.setState({ files: [img("a")], previewId: "a", folders: [fam, trip] });
  render(<Preview />);
  expect(screen.getByRole("button", { name: "Move to Family" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Move to Trip" })).toBeTruthy();
});

test("clicking a folder files the photo and moves the viewer onto the next one", async () => {
  useAppStore.setState({
    files: [img("a"), img("b")],
    visibleIds: ["a", "b"],
    previewId: "a",
    folders: [fam],
  });
  render(<Preview />);
  fireEvent.click(screen.getByRole("button", { name: "Move to Family" }));

  await waitFor(() => expect(moveFiles).toHaveBeenCalledWith(["C:/x/a.jpg"], "C:/base/fam"));
  await waitFor(() => expect(useAppStore.getState().files.map((f) => f.id)).toEqual(["b"]));
  // The viewer stays open on what took its place, instead of shutting because the file it was
  // showing no longer exists.
  expect(useAppStore.getState().previewId).toBe("b");
});

test("the digit shortcuts file the photo from in here too", async () => {
  useAppStore.setState({
    files: [img("a"), img("b")],
    visibleIds: ["a", "b"],
    previewId: "a",
    folders: [fam, trip],
  });
  render(<Preview />);
  fireEvent.keyDown(window, { key: "2" });
  await waitFor(() => expect(moveFiles).toHaveBeenCalledWith(["C:/x/a.jpg"], "C:/base/trip"));
});

test("filing the last photo closes the viewer — there is nothing behind it", async () => {
  useAppStore.setState({ files: [img("a")], visibleIds: ["a"], previewId: "a", folders: [fam] });
  render(<Preview />);
  fireEvent.click(screen.getByRole("button", { name: "Move to Family" }));
  await waitFor(() => expect(useAppStore.getState().previewId).toBeNull());
});

test("an unbound digit does nothing", () => {
  useAppStore.setState({ files: [img("a")], visibleIds: ["a"], previewId: "a", folders: [fam] });
  render(<Preview />);
  fireEvent.keyDown(window, { key: "7" }); // no folder holds the key "7"
  expect(moveFiles).not.toHaveBeenCalled();
  expect(useAppStore.getState().previewId).toBe("a");
});
