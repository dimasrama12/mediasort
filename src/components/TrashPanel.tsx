import { useEffect } from "react";
import { useAppStore } from "../store/useAppStore";
import { listTrash, restoreFromTrash, emptyTrash } from "../lib/commands";

const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

export function TrashPanel() {
  const trashOpen = useAppStore((s) => s.trashOpen);
  const trashItems = useAppStore((s) => s.trashItems);
  const setTrashItems = useAppStore((s) => s.setTrashItems);
  const closeTrash = useAppStore((s) => s.closeTrash);

  const refresh = () => void listTrash().then(setTrashItems).catch(() => {});

  useEffect(() => {
    if (trashOpen) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trashOpen]);

  useEffect(() => {
    if (!trashOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeTrash();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [trashOpen, closeTrash]);

  if (!trashOpen) return null;

  const onRestore = (id: string, dest: string) =>
    void restoreFromTrash(id, dest).then(refresh).catch(() => {});
  const onEmpty = () => void emptyTrash().then(refresh).catch(() => {});

  return (
    <div className="absolute inset-0 z-40 flex justify-end bg-black/50">
      <div className="w-[380px] h-full bg-[var(--panel)] border-l border-[var(--border)] flex flex-col">
        <header className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
          <h2 className="text-sm font-medium">Trash ({trashItems.length})</h2>
          <button
            type="button"
            onClick={closeTrash}
            className="text-[var(--muted)] hover:text-[var(--text)]"
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-auto">
          {trashItems.length === 0 ? (
            <p className="p-4 text-sm text-[var(--muted)]">Trash is empty.</p>
          ) : (
            trashItems.map((it) => (
              <div
                key={it.id}
                className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-[var(--text)]" title={it.originalPath}>
                    {it.name}
                  </div>
                  <div className="text-[11px] text-[var(--muted)]">{kb(it.size)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => onRestore(it.id, it.originalPath)}
                  className="rounded bg-[var(--elevated-hover)] px-2 py-1 text-xs hover:bg-[var(--elevated-hover)]"
                >
                  Restore
                </button>
              </div>
            ))
          )}
        </div>
        <footer className="p-3 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={onEmpty}
            className="w-full rounded bg-red-600/80 px-3 py-2 text-sm hover:bg-red-600 disabled:opacity-40"
            disabled={trashItems.length === 0}
          >
            Empty Trash
          </button>
        </footer>
      </div>
    </div>
  );
}
