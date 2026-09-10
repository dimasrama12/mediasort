//! "Which libraries?" (§5).
//!
//! Once more than one library is open, a grouping run over all of them is rarely what is meant —
//! a phone dump and a scanned album have nothing to say to each other. With a single library
//! there is nothing to choose, so the Toolbar never opens this: a modal that always says the same
//! thing is a modal people learn to dismiss without reading.

import { useRef } from "react";
import { useAppStore } from "../store/useAppStore";
import { useClickOutside } from "../lib/useClickOutside";
import { useFocusTrap } from "../lib/useFocusTrap";
import { filesInScope } from "../lib/groupScope";
import type { GroupMode } from "../store/useAppStore";

const LABELS: Record<string, string> = {
  visual: "Similar",
  temporal: "Time",
  date: "Date",
  type: "Type",
};

export function GroupScopePanel({
  onConfirm,
}: {
  onConfirm: (mode: Exclude<GroupMode, "none">, roots: string[]) => void;
}) {
  const mode = useAppStore((s) => s.groupScopeMode);
  const roots = useAppStore((s) => s.roots);
  const files = useAppStore((s) => s.files);
  const chosen = useAppStore((s) => s.groupRoots);
  const setGroupRoots = useAppStore((s) => s.setGroupRoots);
  const close = useAppStore((s) => s.closeGroupScope);
  const cardRef = useRef<HTMLDivElement>(null);

  useClickOutside(mode != null, cardRef, close);
  useFocusTrap(mode != null, cardRef);

  if (mode == null) return null;

  const total = filesInScope(files, chosen).length;
  const toggle = (root: string) =>
    setGroupRoots(chosen.includes(root) ? chosen.filter((r) => r !== root) : [...chosen, root]);

  return (
    <div className="anim-fade absolute inset-0 z-40 flex items-center justify-center bg-[var(--scrim)]">
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Group: ${LABELS[mode] ?? mode}`}
        className="surface edge-lit flex w-[380px] flex-col gap-3 rounded-xl border border-[var(--border)] p-4"
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
      >
        <h2 className="text-sm font-medium">Group: {LABELS[mode] ?? mode}</h2>
        <p className="text-[11px] text-[var(--muted)]">Which libraries?</p>
        <ul className="flex flex-col gap-1">
          {roots.map((root) => (
            <li key={root}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={chosen.includes(root)}
                  onChange={() => toggle(root)}
                  aria-label={root}
                />
                <span className="flex-1 min-w-0 truncate" title={root}>
                  {root}
                </span>
                <span className="text-[11px] tabular-nums text-[var(--muted)]">
                  {filesInScope(files, [root]).length}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-[var(--border)] pt-3">
          <span className="text-[11px] tabular-nums text-[var(--muted)]">{total} files</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={close}
              className="px-3 py-1.5 rounded bg-[var(--elevated)] hover:bg-[var(--elevated-hover)] text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={total === 0}
              onClick={() => {
                const picked = [...chosen];
                close();
                onConfirm(mode, picked);
              }}
              className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-sm font-medium"
            >
              Group
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
