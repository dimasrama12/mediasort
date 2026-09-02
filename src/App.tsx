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
import { applyTheme } from "./lib/theme";
import { useAppStore } from "./store/useAppStore";

function App() {
  const { addFiles, finishScan } = useAppStore();
  const setSettings = useAppStore((s) => s.setSettings);
  const theme = useAppStore((s) => s.settings.theme);

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

  // Apply the theme, and follow the OS while on "system".
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  return (
    <main className="h-screen flex flex-col bg-[var(--bg)] text-[var(--text)]">
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
