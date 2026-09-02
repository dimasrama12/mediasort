import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/commands", () => ({
  listProjects: vi.fn(async () => [{ id: "p1", name: "Trip", savedAt: 1000, fileCount: 3 }]),
  saveProject: vi.fn(async () => {}),
  loadProject: vi.fn(async () => ({
    id: "p1",
    name: "Trip",
    savedAt: 1000,
    roots: ["C:/x"],
    files: [],
    folders: [],
    groups: [],
  })),
  deleteProject: vi.fn(async () => {}),
}));

import { ProjectsPanel } from "./ProjectsPanel";
import { saveProject, loadProject, deleteProject } from "../lib/commands";
import { useAppStore } from "../store/useAppStore";
import type { FileInfo } from "../lib/types";

const mk = (id: string): FileInfo => ({
  id,
  path: `C:/root/${id}.jpg`,
  name: `${id}.jpg`,
  extension: "jpg",
  size: 1,
  modifiedAt: 0,
  dateTaken: null,
  fileType: "image",
  groupId: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ projectsOpen: true, roots: ["C:/root"], files: [mk("a")], folders: [], groups: [] });
});
afterEach(cleanup);

test("lists saved projects", async () => {
  render(<ProjectsPanel />);
  await waitFor(() => expect(screen.getByText("Trip")).toBeTruthy());
});

test("Save builds a project from the store and persists", async () => {
  render(<ProjectsPanel />);
  fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "My Session" } });
  fireEvent.click(screen.getByText("Save"));
  await waitFor(() => expect(saveProject).toHaveBeenCalled());
  const arg = vi.mocked(saveProject).mock.calls[0][0];
  expect(arg.name).toBe("My Session");
  expect(arg.roots).toEqual(["C:/root"]);
  expect(arg.files.map((f) => f.id)).toEqual(["a"]);
});

test("Load hydrates the store from the loaded project", async () => {
  render(<ProjectsPanel />);
  await waitFor(() => screen.getByText("Load"));
  fireEvent.click(screen.getByText("Load"));
  await waitFor(() => expect(loadProject).toHaveBeenCalledWith("p1"));
  await waitFor(() => expect(useAppStore.getState().roots).toEqual(["C:/x"]));
});

test("Delete removes the project", async () => {
  render(<ProjectsPanel />);
  await waitFor(() => screen.getByLabelText("Delete Trip"));
  fireEvent.click(screen.getByLabelText("Delete Trip"));
  await waitFor(() => expect(deleteProject).toHaveBeenCalledWith("p1"));
});
