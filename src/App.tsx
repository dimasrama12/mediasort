import { useEffect } from "react";
import { Toolbar } from "./components/Toolbar";
import { FileGrid } from "./components/FileGrid";
import { Preview } from "./components/Preview";
import { onScanFile, onScanDone } from "./lib/events";
import { useAppStore } from "./store/useAppStore";

function App() {
  const { addFiles, finishScan } = useAppStore();

  useEffect(() => {
    const unlisteners = Promise.all([
      onScanFile((batch) => addFiles(batch)),
      onScanDone((total) => finishScan(total)),
    ]);
    return () => {
      unlisteners.then((fns) => fns.forEach((f) => f()));
    };
  }, [addFiles, finishScan]);

  return (
    <main className="h-screen flex flex-col bg-neutral-950 text-neutral-100">
      <Toolbar />
      <FileGrid />
      <Preview />
    </main>
  );
}

export default App;
