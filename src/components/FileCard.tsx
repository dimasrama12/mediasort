import type { FileInfo } from "../lib/types";
import { useThumbnail } from "../lib/useThumbnail";
import { useFileSelection } from "../lib/useFileSelection";
import { groupColor } from "../lib/groupColors";
import { SelectedCheck } from "./SelectedCheck";

export function FileCard({
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

  // Selection is the checkmark in the corner and nothing else — no tint, no glow, no lift. A
  // wash over the photo changed the colours of the thing you are trying to judge, which is the
  // one job a photo grid has. The ring is the *keyboard cursor*, a different question ("where
  // am I?") that still needs an answer.
  const border = focused
    ? "border-[var(--accent)] ring-1 ring-[var(--accent)]"
    : "border-[var(--border)]";

  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      // The grid owns the geometry (it divides the container into exactly 9 or 10 columns —
      // §2), so the tile fills whatever cell it is handed instead of pinning its own px size.
      className={`tile relative flex h-full w-full min-w-0 items-end overflow-hidden rounded-md border bg-[var(--elevated)] text-left ${border}`}
      title={file.path}
    >
      {file.groupId && (
        <span
          data-testid="group-badge"
          title={`Group ${(groupIndex ?? 0) + 1}`}
          aria-label={`In group ${(groupIndex ?? 0) + 1}`}
          className="absolute left-1 top-1 z-20 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-bold leading-none text-black/80 ring-1 ring-black/50"
          style={{ backgroundColor: groupColor(groupIndex ?? 0) }}
        >
          {/* The number as well as the hue: seven colours cannot name 117 groups, and a hue on
              its own says nothing at all to a colour-blind user. */}
          {(groupIndex ?? 0) + 1}
        </span>
      )}
      {selected && <SelectedCheck />}
      {status === "ready" && url && (
        <img
          src={url}
          alt={file.name}
          // `async` decoding keeps a fast scroll off the main thread; `lazy` means a tile that
          // scrolls past before it paints never costs a fetch at all.
          decoding="async"
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {status === "loading" && <span className="shimmer absolute inset-0" aria-hidden />}
      {status === "placeholder" && (
        <span className="absolute inset-0 grid place-items-center text-2xl text-[var(--muted)]" aria-hidden>
          {file.fileType === "video" ? "▶" : "🖼"}
        </span>
      )}
      {status === "error" && (
        <span className="absolute inset-0 grid place-items-center text-lg text-[var(--muted)]" aria-hidden>
          ⚠
        </span>
      )}
      <span className="relative z-10 w-full truncate bg-gradient-to-t from-black/75 to-transparent px-1 pb-0.5 pt-2 text-[10px] leading-tight text-white">
        {file.name}
      </span>
    </button>
  );
}
