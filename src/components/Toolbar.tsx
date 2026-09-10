import { useEffect, useMemo, useRef, useState } from "react";
import { groupVisual, groupTemporal, cancelGrouping } from "../lib/commands";
import { groupByDate, groupByType } from "../lib/clientGroup";
import { scanFlow } from "../lib/appActions";
import { useAppStore } from "../store/useAppStore";
import type { DateGroupSort, GroupMode } from "../store/useAppStore";
import { filesInScope } from "../lib/groupScope";
import type { FileInfo } from "../lib/types";
import { GROUPING_CANCELLED } from "../lib/commands";
import { abortScan } from "../lib/appActions";
import { onGroupProgress } from "../lib/events";
import { undo, redo } from "../lib/history";
import { bucketsOf } from "../lib/buckets";
import type { SortBy } from "../lib/sort";

const SORTS: { value: SortBy; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "date", label: "Date" },
  { value: "type", label: "Type" },
  { value: "size", label: "Size" },
];

const GROUPS = [
  { id: "visual", label: "Similar" },
  { id: "temporal", label: "Time" },
  { id: "date", label: "Date" },
  { id: "type", label: "Type" },
] as const;

/** Human-readable total for the whole open folder (§3): GB once it's worth it, else MB/KB. */
export function formatBytes(n: number): string {
  if (n <= 0) return "0 MB";
  const gb = n / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`;
  const mb = n / 1024 ** 2;
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/* ---------------------------------------------------------------------------------------------
 * Toolbar building blocks. The bar used to be a flat run of a dozen differently-shaped buttons
 * separated by ad-hoc borders. Three primitives — a segmented control, an icon button, and a
 * labelled cluster — give every control the same 28px height, the same radius and the same
 * spacing, so related things read as related.
 * ------------------------------------------------------------------------------------------- */

const CONTROL = "h-7 inline-flex items-center justify-center rounded-md text-sm transition-colors";

/** A labelled group of controls, separated from its neighbours by one hairline. */
function Cluster({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 shrink-0 pl-2 ml-1 border-l border-[var(--border)]">
      {label && (
        <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)] select-none">
          {label}
        </span>
      )}
      {children}
    </div>
  );
}

/** Segmented control: one rounded shell, dividers between the options inside it. */
function Segmented({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center h-7 rounded-md bg-[var(--elevated)] p-0.5 gap-0.5">
      {children}
    </div>
  );
}

function Seg({
  active = false,
  disabled = false,
  onClick,
  title,
  label,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      aria-pressed={active}
      className={`h-6 px-2 rounded inline-flex items-center justify-center text-sm transition-colors disabled:opacity-40 ${
        active
          ? "bg-[var(--accent)] text-white shadow-sm"
          : "text-[var(--text)] hover:bg-[var(--elevated-hover)]"
      }`}
    >
      {children}
    </button>
  );
}

function IconButton({
  onClick,
  title,
  label,
  disabled = false,
  children,
}: {
  onClick: () => void;
  title: string;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      className={`${CONTROL} w-7 bg-[var(--elevated)] hover:bg-[var(--elevated-hover)] disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

export function Toolbar() {
  const scanning = useAppStore((s) => s.scanning);
  const files = useAppStore((s) => s.files);
  const groupMode = useAppStore((s) => s.groupMode);
  const groups = useAppStore((s) => s.groups);
  const applyGroups = useAppStore((s) => s.applyGroups);
  const clearGroups = useAppStore((s) => s.clearGroups);
  const query = useAppStore((s) => s.query);
  const setQuery = useAppStore((s) => s.setQuery);
  const openRename = useAppStore((s) => s.openRename);
  const openSettings = useAppStore((s) => s.openSettings);
  const openProjects = useAppStore((s) => s.openProjects);
  const settings = useAppStore((s) => s.settings);
  const undoStack = useAppStore((s) => s.undoStack);
  const redoStack = useAppStore((s) => s.redoStack);
  const viewMode = useAppStore((s) => s.viewMode);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const sortBy = useAppStore((s) => s.sortBy);
  const sortDir = useAppStore((s) => s.sortDir);
  const setSort = useAppStore((s) => s.setSort);
  const hiddenBuckets = useAppStore((s) => s.hiddenBuckets);
  const toggleBucket = useAppStore((s) => s.toggleBucket);
  const showAllBuckets = useAppStore((s) => s.showAllBuckets);
  const browseFolder = useAppStore((s) => s.browseFolder);
  const browseFiles = useAppStore((s) => s.browseFiles);
  const searchRequested = useAppStore((s) => s.searchRequested);
  const dateGroupSort = useAppStore((s) => s.dateGroupSort);
  const setDateGroupSort = useAppStore((s) => s.setDateGroupSort);
  // Grouping state lives in the store, not here: the window-level Esc handler has to be able to
  // see that a run is in flight and abort it, and it has no way to reach into this component.
  const grouping = useAppStore((s) => s.grouping);
  const setGrouping = useAppStore((s) => s.setGrouping);
  const progress = useAppStore((s) => s.groupProgress);
  const setProgress = useAppStore((s) => s.setGroupProgress);
  const [bucketsOpen, setBucketsOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const bucketsRef = useRef<HTMLDivElement>(null);

  // Ctrl+F (routed through the store nonce, since the grid owns the keyboard) puts the cursor in
  // the search box and selects what's there, so you can just start typing over the old query.
  useEffect(() => {
    if (searchRequested === 0) return;
    searchRef.current?.focus();
    searchRef.current?.select();
  }, [searchRequested]);

  // Visual grouping hashes every photo, which on a 1000-file folder takes real time. Without a
  // readout it looked like the app had stopped — the reason grouping was reported as "truncated".
  useEffect(() => {
    const un = onGroupProgress((done, total) => setProgress({ done, total }));
    return () => {
      void un.then((f) => f());
    };
  }, [setProgress]);

  // Click-away for the bucket menu; a dropdown that only closes via its own button is a trap.
  useEffect(() => {
    if (!bucketsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!bucketsRef.current?.contains(e.target as Node)) setBucketsOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [bucketsOpen]);

  const shown = browseFolder ? browseFiles : files;
  const bucketKind = sortBy === "date" || sortBy === "type" ? sortBy : null;
  const buckets = useMemo(
    () => (bucketKind ? bucketsOf(shown, bucketKind) : []),
    [shown, bucketKind],
  );
  const hiddenHere = buckets.filter((b) => hiddenBuckets.includes(b.key)).length;

  useEffect(() => {
    if (!bucketKind) setBucketsOpen(false);
  }, [bucketKind]);

  /** Ask which libraries first when more than one is open (§5). With one there is nothing to
   *  choose, so it runs straight through, exactly as it always did. */
  function beginGroup(mode: Exclude<GroupMode, "none">) {
    if (grouping || scanning || files.length === 0) return;
    if (useAppStore.getState().roots.length > 1) {
      useAppStore.getState().requestGroupScope(mode);
      return;
    }
    void runScoped(mode, files).catch(() => {});
  }

  /** The one grouping code path: the toolbar's direct call and the pop-up's OK both land here. */
  async function runScoped(mode: Exclude<GroupMode, "none">, subject: FileInfo[]) {
    if (subject.length === 0) return;
    if (mode === "date" || mode === "type") {
      applyGroups(
        mode === "date" ? groupByDate(subject, dateGroupSort) : groupByType(subject),
        mode,
      );
      return;
    }
    setGrouping(true);
    setProgress({ done: 0, total: subject.length });
    try {
      const result =
        mode === "visual"
          ? await groupVisual(subject, settings.similarityThreshold, settings.hashAlgorithm)
          : await groupTemporal(subject, settings.timeWindowHours);
      applyGroups(result, mode);
    } catch (e) {
      // Esc during a run rejects with `cancelled`. That is the user's decision, not a failure:
      // leave whatever grouping was already applied exactly as it was and say nothing.
      if (!String(e).includes(GROUPING_CANCELLED)) throw e;
    } finally {
      setGrouping(false);
      setProgress(null);
    }
  }

  /** Flip the dated groups between oldest-first and biggest-first, rebuilding them in place (§4).
   *  Rebuilt over whatever the last run covered, so re-ordering does not silently widen a scoped
   *  grouping back out to every library. */
  function chooseDateOrder(order: DateGroupSort) {
    if (order === dateGroupSort) return;
    setDateGroupSort(order);
    if (groupMode !== "date") return;
    const st = useAppStore.getState();
    const subject = st.roots.length > 1 ? filesInScope(files, st.groupRoots) : files;
    applyGroups(groupByDate(subject.length > 0 ? subject : files, order), "date");
  }

  const canGroup = !grouping && !scanning && files.length > 0;
  const pct = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0;

  return (
    <header className="relative flex items-center gap-2 px-3 h-12 border-b border-[var(--border)] bg-[var(--panel)]">
      {/* Source */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={() => void scanFlow().catch(() => {})}
          disabled={scanning}
          className={`${CONTROL} px-3 bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 font-medium text-white`}
        >
          {scanning ? (
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="anim-spin h-3 w-3 rounded-full border-2 border-white/40 border-t-white"
              />
              Scanning…
            </span>
          ) : (
            "Scan folder"
          )}
        </button>
        {(scanning || grouping) && (
          <button
            onClick={() => void (scanning ? abortScan() : cancelGrouping().catch(() => {}))}
            title="Stop (Esc)"
            className={`${CONTROL} press gap-1.5 px-2.5 bg-[var(--elevated)] hover:bg-[var(--elevated-hover)]`}
          >
            Stop
            <kbd className="rounded bg-[var(--panel)] px-1 text-[10px] text-[var(--muted)]">Esc</kbd>
          </button>
        )}
      </div>

      {/* History */}
      <Cluster>
        <Segmented>
          <Seg onClick={() => void undo().catch(() => {})} disabled={undoStack.length === 0} label="Undo" title="Undo (Ctrl+Z)">
            ↶
          </Seg>
          <Seg onClick={() => void redo().catch(() => {})} disabled={redoStack.length === 0} label="Redo" title="Redo (Ctrl+Y)">
            ↷
          </Seg>
        </Segmented>
      </Cluster>

      {/* View */}
      <Cluster>
        <Segmented>
          <Seg active={viewMode === "grid"} onClick={() => setViewMode("grid")} label="Grid view" title="Grid view ([)">
            ⊞
          </Seg>
          <Seg active={viewMode === "list"} onClick={() => setViewMode("list")} label="List view" title="List view (])">
            ≣
          </Seg>
        </Segmented>
      </Cluster>

      {/* Sort + per-bucket visibility */}
      <Cluster label="Sort">
        <select
          value={sortBy}
          onChange={(e) => setSort(e.target.value as SortBy)}
          aria-label="Sort by"
          className={`${CONTROL} px-2 bg-[var(--elevated)] hover:bg-[var(--elevated-hover)] cursor-pointer`}
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <IconButton
          onClick={() => setSort(sortBy, sortDir === "asc" ? "desc" : "asc")}
          label={`Sort direction: ${sortDir === "asc" ? "ascending" : "descending"}`}
          title="Toggle sort direction"
        >
          {sortDir === "asc" ? "↑" : "↓"}
        </IconButton>

        {bucketKind && buckets.length > 0 && (
          <div className="relative" ref={bucketsRef}>
            <button
              onClick={() => setBucketsOpen((o) => !o)}
              aria-expanded={bucketsOpen}
              aria-label={`Show or hide ${bucketKind} groups`}
              title={`Show/hide files by ${bucketKind}`}
              className={`${CONTROL} px-2 gap-1 ${
                hiddenHere > 0
                  ? "bg-amber-600 text-white hover:bg-amber-500"
                  : "bg-[var(--elevated)] hover:bg-[var(--elevated-hover)]"
              }`}
            >
              {hiddenHere > 0 ? `${hiddenHere} hidden` : "Visible"}
              <span className="text-[10px] opacity-70">▾</span>
            </button>
            {bucketsOpen && (
              <div className="absolute left-0 top-full mt-1.5 z-40 w-56 max-h-80 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--panel)] shadow-xl p-1.5">
                <div className="flex items-center justify-between px-1 pb-1.5">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                    {bucketKind === "type" ? "File types" : "Dates"}
                  </span>
                  <button onClick={() => showAllBuckets()} className="text-[11px] text-[var(--accent-hover)] hover:underline">
                    Show all
                  </button>
                </div>
                {buckets.map((b) => {
                  const hidden = hiddenBuckets.includes(b.key);
                  return (
                    <label
                      key={b.key}
                      className="flex items-center gap-2 px-1.5 py-1 rounded text-sm cursor-pointer hover:bg-[var(--elevated)]"
                    >
                      <input
                        type="checkbox"
                        checked={!hidden}
                        onChange={() => toggleBucket(b.key)}
                        aria-label={`Show ${b.label}`}
                      />
                      <span className={`flex-1 truncate ${hidden ? "text-[var(--muted)] line-through" : ""}`}>
                        {b.label}
                      </span>
                      <span className="text-[var(--muted)] text-xs tabular-nums">{b.count}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </Cluster>

      {/* Group */}
      <Cluster label="Group">
        <Segmented>
          {GROUPS.map((g) => (
            <Seg
              key={g.id}
              active={groupMode === g.id}
              disabled={!canGroup}
              onClick={() => beginGroup(g.id)}
              title={
                g.id === "visual"
                  ? "Group visually similar photos"
                  : g.id === "temporal"
                    ? "Group photos taken close together"
                    : `Group by ${g.label.toLowerCase()}`}
            >
              {grouping && g.id === "visual" ? "…" : g.label}
            </Seg>
          ))}
        </Segmented>
        {groupMode !== "none" && !grouping && (
          <IconButton onClick={() => clearGroups()} label="Clear grouping" title="Clear grouping">
            ✕
          </IconButton>
        )}
        {groupMode === "date" && groups.length > 0 && (
          <Segmented>
            <Seg
              active={dateGroupSort === "chronological"}
              onClick={() => chooseDateOrder("chronological")}
              label="Order date groups oldest first"
              title="Date groups: oldest day first"
            >
              Oldest
            </Seg>
            <Seg
              active={dateGroupSort === "volume"}
              onClick={() => chooseDateOrder("volume")}
              label="Order date groups by number of files"
              title="Date groups: most files first"
            >
              Busiest
            </Seg>
          </Segmented>
        )}
        {groups.length > 0 && !grouping && (
          <span className="text-xs text-[var(--muted)] tabular-nums whitespace-nowrap">
            {groups.length} groups
          </span>
        )}
      </Cluster>

      {/* Right rail: search, counts, secondary actions */}
      <div className="ml-auto flex items-center gap-2 min-w-0">
        <div className="relative min-w-0">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)]">
            ⌕
          </span>
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…  Ctrl+F"
            aria-label="Search files by name"
            className={`${CONTROL} w-44 max-w-[40vw] pl-6 pr-2 bg-[var(--elevated)] outline-none placeholder:text-[var(--muted)]`}
          />
        </div>

        {/* The selection count and the folder's item/size totals both used to sit here, in a
            corner nobody looks at while they are working in the grid. The count now lives in
            the bar at the foot of the grid, and the totals in the header directly above it —
            each next to the thing it is describing. */}

        <div className="flex items-center gap-1 pl-2 border-l border-[var(--border)]">
          <IconButton
            onClick={() => openRename()}
            disabled={scanning || files.length === 0}
            label="Batch rename"
            title="Batch rename (Shift+R)"
          >
            ✎
          </IconButton>
          <IconButton onClick={() => openProjects()} label="Projects" title="Saved projects">
            ⛁
          </IconButton>
          <IconButton onClick={() => openSettings()} label="Settings" title="Settings (Ctrl+,)">
            ⚙
          </IconButton>
        </div>
      </div>

      {/* Progress: a hairline across the bottom of the bar plus a live count, so neither a
          two-minute hash of 1000 photos nor a long recursive scan ever looks like a hang.
          `aria-live` because these are the two longest operations in the app and until now they
          announced nothing at all. */}
      {(grouping || scanning) && (
        <>
          <span
            role="status"
            aria-live="polite"
            className="absolute right-3 -bottom-6 z-30 flex items-center gap-2 rounded-b-md border border-t-0 border-[var(--border)] bg-[var(--panel)] px-2.5 py-1 text-[11px] tabular-nums text-[var(--muted)] shadow-[var(--shadow-2)]"
          >
            {grouping && progress
              ? `Hashing ${progress.done} / ${progress.total}`: `Scanning… ${files.length} found`}
            <kbd className="rounded bg-[var(--elevated)] px-1 text-[10px]">Esc</kbd>
            <span className="text-[10px] opacity-70">to stop</span>
          </span>
          <span
            aria-hidden
            className={`absolute bottom-0 left-0 h-0.5 w-full overflow-hidden ${
              grouping && progress ? "" : "bar-indeterminate"
            }`}
          >
            {grouping && progress && (
              <span
                className="block h-full bg-[var(--accent)] transition-[width] duration-150"
                style={{ width: `${pct}%` }}
              />
            )}
          </span>
        </>
      )}
    </header>
  );
}

/** Run a grouping over an explicit set of roots — the pop-up's OK path (§5). Kept as a module
 *  function taking the store as its only input so `App` can pass it straight to the panel. */
export async function runGroupOverRoots(
  mode: Exclude<GroupMode, "none">,
  roots: string[],
): Promise<void> {
  const st = useAppStore.getState();
  const subject = filesInScope(st.files, roots);
  if (subject.length === 0) return;
  if (mode === "date" || mode === "type") {
    st.applyGroups(
      mode === "date" ? groupByDate(subject, st.dateGroupSort) : groupByType(subject),
      mode,
    );
    return;
  }
  st.setGrouping(true);
  st.setGroupProgress({ done: 0, total: subject.length });
  try {
    const result =
      mode === "visual"
        ? await groupVisual(subject, st.settings.similarityThreshold, st.settings.hashAlgorithm)
        : await groupTemporal(subject, st.settings.timeWindowHours);
    useAppStore.getState().applyGroups(result, mode);
  } catch (e) {
    if (!String(e).includes(GROUPING_CANCELLED)) throw e;
  } finally {
    useAppStore.getState().setGrouping(false);
    useAppStore.getState().setGroupProgress(null);
  }
}
