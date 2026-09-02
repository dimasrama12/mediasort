import { pickFolders, scanFolders, cancelScan } from "../lib/commands";
import { useAppStore } from "../store/useAppStore";

export function Toolbar() {
  const { scanning, files, scanned, startScan, setRoots } = useAppStore();

  async function onScan() {
    const dirs = await pickFolders();
    if (!dirs) return;
    setRoots(dirs);
    startScan();
    await scanFolders(dirs);
  }

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
      <span className="text-sm text-neutral-400 ml-auto">
        {scanning ? `${files.length} found…` : `${scanned} items`}
      </span>
    </header>
  );
}
