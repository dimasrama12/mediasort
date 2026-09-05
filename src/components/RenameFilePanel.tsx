import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { useFocusTrap } from "../lib/useFocusTrap";
import { renameFiles } from "../lib/commands";
import { dirname } from "../lib/paths";

/** Split "holiday.jpg" into ["holiday", "jpg"]. A leading dot is part of the name, not an
 *  extension, so ".gitignore" renames as a whole. */
export function splitName(name: string): [string, string] {
  const i = name.lastIndexOf(".");
  return i > 0 ? [name.slice(0, i), name.slice(i + 1)] : [name, ""];
}

/** Windows rejects these outright; catching them here turns a backend error into a hint you can
 *  act on while you are still typing. */
const ILLEGAL = /[\\/:*?"<>|]/;

/**
 * Rename one file.
 *
 * The batch renamer next door numbers a whole selection to a pattern, which is the wrong tool
 * when a single photo just has the wrong name. This edits the base name and leaves the extension
 * alone — changing `.jpg` to `.png` renames the file without re-encoding anything, so it is not
 * an offer this dialog should be making.
 */
export function RenameFilePanel() {
  const renameFileId = useAppStore((s) => s.renameFileId);
  const files = useAppStore((s) => s.files);
  const closeRenameFile = useAppStore((s) => s.closeRenameFile);
  const completeRename = useAppStore((s) => s.completeRename);

  // Library files only. Everything inside a target folder is read-only here, exactly as it is
  // for trashing and batch renaming — the menu disables the entry rather than offering a rename
  // that the grid could not show you the result of.
  const file = files.find((f) => f.id === renameFileId);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useFocusTrap(renameFileId != null, cardRef);

  // Open with the base name in the box and selected, so typing replaces it — and the extension
  // stays visible next to the field rather than inside it, where it is one keystroke from being
  // deleted by accident.
  useEffect(() => {
    if (!file) return;
    setValue(splitName(file.name)[0]);
    setError(null);
    setBusy(false);
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, [file?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (renameFileId == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRenameFile();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [renameFileId, closeRenameFile]);

  if (renameFileId == null || !file) return null;

  const ext = splitName(file.name)[1];
  const trimmed = value.trim();
  const invalid = trimmed.length === 0 || ILLEGAL.test(trimmed);
  const target = ext ? `${trimmed}.${ext}` : trimmed;

  const onApply = async () => {
    if (busy || invalid || target === file.name) return closeRenameFile();
    setBusy(true);
    setError(null);
    try {
      const to = `${dirname(file.path)}\\${target}`;
      const [after] = await renameFiles([{ from: file.path, to }]);
      completeRename([file.id], [after]); // also closes this dialog, and is undoable with Ctrl+Z
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
      setBusy(false);
    }
  };

  return (
    <div className="anim-fade absolute inset-0 z-[55] flex items-center justify-center bg-[var(--scrim)]">
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-file-title"
        className="surface edge-lit flex w-[420px] flex-col gap-3 rounded-xl border border-[var(--border)] p-4"
      >
        <h2 id="rename-file-title" className="text-sm font-medium">
          Rename file
        </h2>
        <div className="flex items-center gap-1.5">
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void onApply();
            }}
            aria-label="New file name"
            aria-invalid={invalid}
            className="min-w-0 flex-1 rounded bg-[var(--elevated)] px-2 py-1.5 text-sm outline-none"
          />
          {ext && <span className="shrink-0 text-sm text-[var(--muted)]">.{ext}</span>}
        </div>
        {ILLEGAL.test(trimmed) && (
          <span className="text-xs text-red-400">
            A file name cannot contain \ / : * ? " &lt; &gt; |
          </span>
        )}
        {error && <span className="text-xs text-red-400">{error}</span>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => closeRenameFile()}
            className="press rounded-md bg-[var(--elevated)] px-3 py-1.5 text-sm hover:bg-[var(--elevated-hover)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || invalid}
            onClick={() => void onApply()}
            className="press rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-40"
          >
            {busy ? "Renaming…" : "Rename"}
          </button>
        </div>
      </div>
    </div>
  );
}
