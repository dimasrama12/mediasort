import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GroupScopePanel } from "./GroupScopePanel";
import { useAppStore } from "../store/useAppStore";
import { normalizePath } from "../lib/paths";
import type { FileInfo } from "../lib/types";

afterEach(() => {
  cleanup();
  useAppStore.getState().reset();
});

const mk = (path: string): FileInfo => ({
  id: normalizePath(path),
  path,
  name: "x.jpg",
  extension: "jpg",
  size: 1,
  modifiedAt: 0,
  dateTaken: null,
  fileType: "image",
  groupId: null,
});

const open = () =>
  act(() => {
    useAppStore.setState({
      roots: ["D:/foto", "E:/dcim"],
      files: [mk("D:/foto/a.jpg"), mk("D:/foto/b.jpg"), mk("E:/dcim/c.jpg")],
      groupRoots: ["D:/foto", "E:/dcim"],
      groupScopeMode: "visual",
    });
  });

test("it lists every root with its file count and the running total", () => {
  open();
  render(<GroupScopePanel onConfirm={vi.fn()} />);
  expect(screen.getByText("D:/foto")).toBeInTheDocument();
  expect(screen.getByText("E:/dcim")).toBeInTheDocument();
  expect(screen.getByText(/3 files/)).toBeInTheDocument();
});

test("unchecking a root lowers the total and confirms with the rest", () => {
  open();
  const onConfirm = vi.fn();
  render(<GroupScopePanel onConfirm={onConfirm} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "E:/dcim" }));
  expect(screen.getByText(/2 files/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^group$/i }));
  expect(onConfirm).toHaveBeenCalledWith("visual", ["D:/foto"]);
});

test("Group is disabled when nothing is checked", () => {
  open();
  render(<GroupScopePanel onConfirm={vi.fn()} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "D:/foto" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "E:/dcim" }));
  expect(screen.getByRole("button", { name: /^group$/i })).toBeDisabled();
});

test("Cancel closes without grouping", () => {
  open();
  const onConfirm = vi.fn();
  render(<GroupScopePanel onConfirm={onConfirm} />);
  fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
  expect(onConfirm).not.toHaveBeenCalled();
  expect(useAppStore.getState().groupScopeMode).toBeNull();
});

test("it renders nothing when no grouping was asked for", () => {
  const { container } = render(<GroupScopePanel onConfirm={vi.fn()} />);
  expect(container).toBeEmptyDOMElement();
});
