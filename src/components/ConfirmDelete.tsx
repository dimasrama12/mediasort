import { useEffect, useRef } from "react";
import { useAppStore } from "../store/useAppStore";
import { useFocusTrap } from "../lib/useFocusTrap";
import { deleteFilesPermanently, emptyTrash, listTrash } from "../lib/commands";

/** The one confirmation dialog for irreversible deletion.
 *
 *  Two callers, one surface:
 *  - **`Shift+Delete`** on a selection — skips both the app trash and the OS recycle bin.
 *  - **Empty Trash** — strictly *more* destructive than deleting one file, and until now the
 *    only destructive action in the app that fired off a single unguarded click.
 *
 *  Enter confirms, Esc cancels, and the cancel button takes focus so a stray Enter is harmless. */
export function ConfirmDelete() {
  const pending = useAppStore((s) => s.pendingDelete);
  const cancel = useAppStore((s) => s.cancelPermanentDelete);
  const complete = useAppStore((s) => s.completePermanentDelete);
  const setTrashItems = useAppStore((s) => s.setTrashItems);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  useFocusTrap(pending != null, cardRef);

  useEffect(() => {
    if (pending) cancelRef.current?.focus();
  }, [pending]);

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        void run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function run() {
    const p = useAppStore.getState().pendingDelete;
    if (!p) return;
    try {
      if (p.kind === "trash") {
        await emptyTrash();
        setTrashItems(await listTrash().catch(() => []));
        cancel();
      } else {
        complete(await deleteFilesPermanently(p.paths));
      }
    } catch {
      cancel();
    }
  }

  if (!pending) return null;
  const n = pending.names.length;
  const isTrash = pending.kind === "trash";

  return (
    <div
      className="anim-fade fixed inset-0 z-[60] grid place-items-center bg-[var(--scrim)] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-delete-title"
    >
      <div
        ref={cardRef}
        className="surface edge-lit w-full max-w-sm rounded-xl border border-[var(--border)] p-4"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-red-500/15 text-lg text-red-400"
          >
            {isTrash ? "🗑" : "⚠"}
          </span>
          <div className="min-w-0">
            <h2 id="confirm-delete-title" className="text-base font-medium text-[var(--text)]">
              {isTrash
                ? `Empty the trash — ${n} file${n > 1 ? "s" : ""}?`
                : `Delete ${n} file${n > 1 ? "s" : ""} permanently?`}
            </h2>
            <p className="mt-1 text-[13px] text-[var(--muted)]">
              {isTrash
                ? "Everything in the trash goes to the Recycle Bin and stops being restorable from here. It cannot be undone."
                : "This bypasses the Recycle Bin and the app trash. It cannot be undone."}
            </p>
          </div>
        </div>
        <ul className="mt-3 max-h-32 overflow-auto rounded-md bg-[var(--elevated)] px-2 py-1 text-xs text-[var(--muted)]">
          {pending.names.slice(0, 8).map((name, i) => (
            <li key={`${name}-${i}`} className="truncate">
              {name}
            </li>
          ))}
          {n > 8 && <li className="italic">…and {n - 8} more</li>}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => cancel()}
            className="press px-3 py-1.5 rounded-md bg-[var(--elevated)] hover:bg-[var(--elevated-hover)] text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void run()}
            className="press px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-500 text-sm font-medium text-white"
          >
            {isTrash ? "Empty trash" : "Delete permanently"}
          </button>
        </div>
      </div>
    </div>
  );
}
