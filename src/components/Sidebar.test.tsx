import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/commands", () => ({
  createFolder: vi.fn(async (_base: string, name: string) => ({
    id: name.toLowerCase(),
    name,
    path: `C:/base/${name}`,
    shortcut: 1,
    fileCount: 0,
  })),
}));

import { Sidebar } from "./Sidebar";
import { createFolder } from "../lib/commands";
import { useAppStore } from "../store/useAppStore";
import type { FolderInfo } from "../lib/types";

const mkFolder = (id: string, shortcut: number): FolderInfo => ({
  id,
  name: id,
  path: `C:/base/${id}`,
  shortcut,
  fileCount: 0,
});

afterEach(cleanup);

test("renders the 1-9 legend from the store", () => {
  useAppStore.setState({ folders: [mkFolder("fam", 1), mkFolder("work", 2)], roots: ["C:/base"] });
  render(<Sidebar />);
  expect(screen.getByText("fam")).toBeInTheDocument();
  expect(screen.getByText("work")).toBeInTheDocument();
});

test("New folder creates via command and adds it to the store", async () => {
  useAppStore.setState({ folders: [], roots: ["C:/base"] });
  render(<Sidebar />);
  fireEvent.click(screen.getByText("New folder"));
  fireEvent.change(screen.getByPlaceholderText("Folder name"), { target: { value: "Keep" } });
  fireEvent.keyDown(screen.getByPlaceholderText("Folder name"), { key: "Enter" });
  await waitFor(() => expect(createFolder).toHaveBeenCalledWith("C:/base", "Keep"));
  await waitFor(() => expect(useAppStore.getState().folders.map((f) => f.name)).toContain("Keep"));
});

test("New folder is disabled once nine folders exist", () => {
  const nine = Array.from({ length: 9 }, (_, i) => mkFolder(`f${i}`, i + 1));
  useAppStore.setState({ folders: nine, roots: ["C:/base"] });
  render(<Sidebar />);
  expect(screen.getByText("All 9 keys used")).toBeDisabled();
});
