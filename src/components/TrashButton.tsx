import { useEffect } from "react";
import { useAppStore } from "../store/useAppStore";
import { listTrash } from "../lib/commands";

/** Lid, bin, two ribs. Stroked at 1.6 so it sits at the same visual weight as the rest of the
 *  chrome instead of blotting the corner the way the 🗑 emoji did. */
function TrashIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 5.5h13" />
      <path d="M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5" />
      <path d="M5.5 5.5 6.2 16a1 1 0 0 0 1 .9h5.6a1 1 0 0 0 1-.9l.7-10.5" />
      <path d="M8.6 8.8v5M11.4 8.8v5" />
    </svg>
  );
}

/**
 * The trash, parked in the bottom-right corner.
 *
 * It used to sit at the foot of the sidebar, which meant it disappeared whenever the sidebar was
 * collapsed for grid width — the state you are in when you are deleting fast. Down here it is in
 * the same place whatever else is open, out of the way of the 1–9 folder list, and it carries the
 * one fact worth carrying: how much is still recoverable.
 */
export function TrashButton() {
  const trashOpen = useAppStore((s) => s.trashOpen);
  const toggleTrash = useAppStore((s) => s.toggleTrash);
  const trashItems = useAppStore((s) => s.trashItems);
  const setTrashItems = useAppStore((s) => s.setTrashItems);
  const refreshNonce = useAppStore((s) => s.refreshNonce);

  // Re-read on mount, on every Ctrl+R, and whenever the panel closes (a restore or an empty
  // happened behind it), so the count is never stale.
  useEffect(() => {
    void listTrash()
      .then(setTrashItems)
      .catch(() => {});
  }, [refreshNonce, trashOpen, setTrashItems]);

  const count = trashItems.length;
  const label = `Trash — ${count} item${count === 1 ? "" : "s"} (T)`;

  return (
    <button
      type="button"
      onClick={toggleTrash}
      aria-label={label}
      aria-pressed={trashOpen}
      title={label}
      className={`press fixed bottom-4 right-4 z-30 flex h-9 items-center gap-1.5 rounded-full border border-[var(--border)] px-3 text-sm shadow-[var(--shadow-2)] ${
        trashOpen
          ? "bg-[var(--accent)] text-white"
          : "bg-[var(--panel)] text-[var(--text)] hover:bg-[var(--elevated)]"
      }`}
    >
      <TrashIcon />
      <span className="tabular-nums">{count > 999 ? "999+" : count}</span>
    </button>
  );
}
