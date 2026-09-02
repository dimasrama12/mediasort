import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { saveProject, loadProject, listProjects, deleteProject } from "../lib/commands";
import type { Project, ProjectSummary } from "../lib/types";

export function ProjectsPanel() {
  const projectsOpen = useAppStore((s) => s.projectsOpen);
  const closeProjects = useAppStore((s) => s.closeProjects);
  const loadProjectData = useAppStore((s) => s.loadProjectData);
  const [list, setList] = useState<ProjectSummary[]>([]);
  const [name, setName] = useState("");

  const refresh = () => void listProjects().then(setList).catch(() => {});

  useEffect(() => {
    if (projectsOpen) refresh();
  }, [projectsOpen]);

  useEffect(() => {
    if (!projectsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeProjects();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [projectsOpen, closeProjects]);

  if (!projectsOpen) return null;

  const onSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const s = useAppStore.getState();
    const project: Project = {
      id: `${Date.now()}`,
      name: trimmed,
      savedAt: Date.now(),
      roots: s.roots,
      files: s.files,
      folders: s.folders,
      groups: s.groups,
    };
    void saveProject(project)
      .then(() => {
        setName("");
        refresh();
      })
      .catch(() => {});
  };

  const onLoad = (id: string) =>
    void loadProject(id).then(loadProjectData).catch(() => {});
  const onDelete = (id: string) =>
    void deleteProject(id).then(refresh).catch(() => {});

  return (
    <div className="absolute inset-0 z-40 flex justify-end bg-black/50">
      <div className="w-[380px] h-full bg-[var(--panel)] border-l border-[var(--border)] flex flex-col">
        <header className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
          <h2 className="text-sm font-medium">Projects</h2>
          <button
            type="button"
            onClick={closeProjects}
            aria-label="Close"
            className="text-[var(--muted)] hover:text-[var(--text)]"
          >
            ✕
          </button>
        </header>

        <div className="p-3 flex gap-2 border-b border-[var(--border)]">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSave()}
            placeholder="Save current session as…"
            aria-label="Project name"
            className="flex-1 min-w-0 px-2 py-1 rounded bg-[var(--elevated)] text-sm outline-none"
          />
          <button
            type="button"
            onClick={onSave}
            disabled={!name.trim()}
            className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-sm"
          >
            Save
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {list.length === 0 ? (
            <p className="p-4 text-sm text-[var(--muted)]">No saved projects yet.</p>
          ) : (
            list.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-[var(--text)]">{p.name}</div>
                  <div className="text-[11px] text-[var(--muted)]">
                    {p.fileCount} files · {new Date(p.savedAt).toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onLoad(p.id)}
                  className="rounded bg-[var(--elevated-hover)] px-2 py-1 text-xs hover:bg-[var(--elevated-hover)]"
                >
                  Load
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(p.id)}
                  aria-label={`Delete ${p.name}`}
                  className="text-[var(--muted)] hover:text-red-400 text-xs px-1"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
