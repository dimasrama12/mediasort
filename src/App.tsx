import { useEffect } from "react";
import { Toolbar } from "./components/Toolbar";
import { Sidebar } from "./components/Sidebar";
import { FileGrid } from "./components/FileGrid";
import { Preview } from "./components/Preview";
import { TrashPanel } from "./components/TrashPanel";
import { TrashButton } from "./components/TrashButton";
import { RenamePanel } from "./components/RenamePanel";
import { RenameFilePanel } from "./components/RenameFilePanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { ProjectsPanel } from "./components/ProjectsPanel";
import { ConfirmDelete } from "./components/ConfirmDelete";
import { ContextMenu } from "./components/ContextMenu";
import { ExifPanel } from "./components/ExifPanel";
import { onScanFile, onScanDone } from "./lib/events";
import { getSettings } from "./lib/commands";
import { applyTheme } from "./lib/theme";
import { bindingsWithDefaults } from "./lib/keybindings";
import { installContextMenu, installGlobalKeys } from "./lib/globalHandlers";
import { syncFolders } from "./lib/fileActions";
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

  // Load persisted settings once on startup: merge keybinding defaults, then apply the saved
  // default view and sidebar state to the session.
  useEffect(() => {
    void getSettings()
      .then((s) => {
        const merged = { ...s, keybindings: bindingsWithDefaults(s.keybindings) };
        setSettings(merged);
        const st = useAppStore.getState();
        st.setViewMode(merged.defaultView === "list" ? "list" : "grid");
        st.setSidebarCollapsed(!!merged.sidebarCollapsed);
      })
      .catch(() => {});
  }, [setSettings]);

  // Hydrate the 1-9 target folders from the backend registry on mount, before anything else can
  // need them.
  //
  // The digit shortcuts resolve against `folders`, and nothing ever put anything in it at
  // startup: the registry lives in the backend, and the UI only ever re-read it as a *side
  // effect* of something else (a drop onto the sidebar, a rename, a Ctrl+R). Until one of those
  // happened, pressing 1 found no folder for that shortcut and returned without moving anything
  // and without saying anything — the shortcut looked dead on the first try of the session.
  //
  // Deliberately fire-and-forget and deliberately unguarded by any other state: this must not
  // wait on the settings load, the theme, or a scan.
  useEffect(() => {
    void syncFolders();
  }, []);

  // Window-level input that no panel can own: the Ctrl+' double-tap for Settings, Ctrl+R for a
  // real refresh (instead of the webview reloading the page), and the app's own right-click menu
  // in place of the native one. See lib/globalHandlers.ts for why each one lives up here.
  useEffect(() => installGlobalKeys(), []);
  useEffect(() => installContextMenu(), []);

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
      <TrashButton />
      <Preview />
      <TrashPanel />
      <RenamePanel />
      <RenameFilePanel />
      <SettingsPanel />
      <ProjectsPanel />
      <ConfirmDelete />
      <ExifPanel />
      <ContextMenu />
    </main>
  );
}

export default App;
