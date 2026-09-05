import type { FileInfo } from "../lib/types";
import { useThumbnail } from "../lib/useThumbnail";
import { useFileSelection } from "../lib/useFileSelection";
import { groupColor } from "../lib/groupColors";
import { SelectedCheck } from "./SelectedCheck";

const fmtSize = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const fmtDate = (f: FileInfo): string => {
  const secs = f.dateTaken ?? f.modifiedAt;
  if (!secs) return "";
  return new Date(secs * 1000).toLocaleDateString();
};

/** Compact list-view row: small thumbnail + name + type + size + date. Same selection semantics
 *  as the grid tile (via useFileSelection). Kept dense because list view packs three of these
 *  side by side (§2), so each row only gets a third of the window. */
export function FileRow({
  file,
  focused = false,
  selected = false,
  groupIndex = null,
}: {
  file: FileInfo;
  focused?: boolean;
  selected?: boolean;
  /** Position of this file's group in the group list — drives the badge color (§5). */
  groupIndex?: number | null;
}) {
  const { url, status } = useThumbnail(file);
  const { onClick, onDoubleClick } = useFileSelection(file);

  // A row is a line of text, not a photo, so a tint still reads here where it did not on a
  // tile — but it uses the accent token like everything else, and the same corner tick as the
  // grid so the two views agree about what "picked" looks like.
  const ring = focused ? "ring-1 ring-inset ring-[var(--accent)]" : "";
  const bg = selected ? "bg-[var(--accent-faint)]" : "hover:bg-[var(--elevated)]";

  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title={file.path}
      className={`press flex h-full w-full items-center gap-2 border-b border-[var(--border)] px-2 text-left ${bg} ${ring}`}
    >
      <span className="relative w-8 h-8 shrink-0 rounded overflow-hidden bg-[var(--elevated)]">
        {file.groupId && (
          <span
            data-testid="group-badge"
            aria-label={`In group ${(groupIndex ?? 0) + 1}`}
            title={`Group ${(groupIndex ?? 0) + 1}`}
            // The number, not just the hue — seven colours cannot name a hundred groups, and a
            // colour on its own carries nothing for a colour-blind reader.
            className="absolute left-0 top-0 z-10 grid h-3 min-w-3 place-items-center rounded-br rounded-tl px-0.5 text-[8px] font-bold leading-none text-black/80 ring-1 ring-black/50"
            style={{ backgroundColor: groupColor(groupIndex ?? 0) }}
          >
            {(groupIndex ?? 0) + 1}
          </span>
        )}
        {status === "ready" && url && (
          <img
            src={url}
            alt={file.name}
            decoding="async"
            loading="lazy"
            className="h-full w-full object-cover"
          />
        )}
        {status === "loading" && <span className="shimmer absolute inset-0" aria-hidden />}
        {selected && <SelectedCheck small />}
      </span>
      <span className="flex-1 min-w-0 truncate text-[13px] text-[var(--text)]">{file.name}</span>
      <span className="w-12 shrink-0 text-right text-[11px] uppercase text-[var(--muted)]">
        {file.extension}
      </span>
      <span className="w-16 shrink-0 text-right text-[11px] text-[var(--muted)]">
        {fmtSize(file.size)}
      </span>
      <span className="hidden xl:inline w-20 shrink-0 text-right text-[11px] text-[var(--muted)]">
        {fmtDate(file)}
      </span>
    </button>
  );
}
