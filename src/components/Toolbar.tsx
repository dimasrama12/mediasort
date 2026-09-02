import { useState } from "react";
import {
  pickFolders,
  scanFolders,
  cancelScan,
  groupVisual,
  groupTemporal,
} from "../lib/commands";
import { useAppStore } from "../store/useAppStore";

// Defaults from DESIGN §4 AppSettings until the settings slice wires them up.
const SIMILARITY_THRESHOLD = 80;
const TIME_WINDOW_HOURS = 1;

export function Toolbar() {
  const { scanning, files, scanned, startScan, setRoots } = useAppStore();
  const groupMode = useAppStore((s) => s.groupMode);
  const applyGroups = useAppStore((s) => s.applyGroups);
  const clearGroups = useAppStore((s) => s.clearGroups);
  const [grouping, setGrouping] = useState(false);

  async function onScan() {
    const dirs = await pickFolders();
    if (!dirs) return;
    setRoots(dirs);
    startScan();
    await scanFolders(dirs);
  }

  async function runGroup(mode: "visual" | "temporal") {
    if (grouping || scanning || files.length === 0) return;
    setGrouping(true);
    try {
      const groups =
        mode === "visual"
          ? await groupVisual(files, SIMILARITY_THRESHOLD)
          : await groupTemporal(files, TIME_WINDOW_HOURS);
      applyGroups(groups, mode);
    } finally {
      setGrouping(false);
    }
  }

  const canGroup = !grouping && !scanning && files.length > 0;

  return (
    <header className="flex items-center gap-3 px-4 h-12 border-b border-neutral-800 bg-neutral-900">
      <button
        onClick={onScan}
        disabled={scanning}
        className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm font-medium"
      >
        {scanning ? "Scanning…" : "Scan folder"}
      </button>
      {scanning && (
        <button
          onClick={() => cancelScan()}
          className="px-3 py-1.5 rounded bg-neutral-700 text-sm"
        >
          Cancel
        </button>
      )}

      <div className="flex items-center gap-1 pl-3 ml-1 border-l border-neutral-800">
        <span className="text-xs text-neutral-500">Group:</span>
        <button
          onClick={() => runGroup("visual")}
          disabled={!canGroup}
          aria-pressed={groupMode === "visual"}
          className={`px-2 py-1 rounded text-sm disabled:opacity-40 ${
            groupMode === "visual" ? "bg-amber-600" : "bg-neutral-800 hover:bg-neutral-700"
          }`}
        >
          {grouping ? "Grouping…" : "Similar"}
        </button>
        <button
          onClick={() => runGroup("temporal")}
          disabled={!canGroup}
          aria-pressed={groupMode === "temporal"}
          className={`px-2 py-1 rounded text-sm disabled:opacity-40 ${
            groupMode === "temporal" ? "bg-amber-600" : "bg-neutral-800 hover:bg-neutral-700"
          }`}
        >
          By time
        </button>
        {groupMode !== "none" && (
          <button
            onClick={() => clearGroups()}
            className="px-2 py-1 rounded text-sm bg-neutral-800 hover:bg-neutral-700 text-neutral-400"
          >
            Clear
          </button>
        )}
      </div>

      <span className="text-sm text-neutral-400 ml-auto">
        {scanning ? `${files.length} found…` : `${scanned} items`}
      </span>
    </header>
  );
}
