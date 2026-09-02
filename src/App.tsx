import { useEffect } from "react";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { FileGrid } from "./components/FileGrid";
import { Preview } from "./components/Preview";
import { TrashPanel } from "./components/TrashPanel";
import { RenamePanel } from "./components/RenamePanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { ProjectsPanel } from "./components/ProjectsPanel";
import { onScanFile, onScanDone } from "./lib/events";
import { getSettings } from "./lib/commands";
import { useAppStore } from "./store/useAppStore";

function App() {
  const { addFiles, finishScan } = useAppStore();
  const setSettings = useAppStore((s) => s.setSettings);

  useEffect(() => {
    const unlisteners = Promise.all([
      onScanFile((batch) => addFiles(batch)),
      onScanDone((total) => finishScan(total)),
    ]);
    return () => {
      unlisteners.then((fns) => fns.forEach((f) => f()));
    };
  }, [addFiles, finishScan]);

  // Load persisted settings once on startup.
  useEffect(() => {
    void getSettings().then(setSettings).catch(() => {});
  }, [setSettings]);

  return (
    <main className="h-screen flex flex-col bg-neutral-950 text-neutral-100">
      <Toolbar />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <FileGrid />
      </div>
      <Preview />
      <TrashPanel />
      <RenamePanel />
      <SettingsPanel />
      <ProjectsPanel />
    </main>
  );
}

export default App;
