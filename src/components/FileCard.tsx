import type { FileInfo } from "../lib/types";
import { useThumbnail } from "../lib/useThumbnail";
import { useAppStore } from "../store/useAppStore";

export function FileCard({ file, focused = false }: { file: FileInfo; focused?: boolean }) {
  const { url, status } = useThumbnail(file);
  const setFocus = useAppStore((s) => s.setFocus);
  const openPreview = useAppStore((s) => s.openPreview);
  return (
    <button
      type="button"
      onClick={() => setFocus(file.id)}
      onDoubleClick={() => openPreview(file.id)}
      className={`w-[152px] h-[150px] rounded bg-neutral-800 border overflow-hidden relative flex items-end text-left ${
        focused ? "border-blue-500 ring-2 ring-blue-500" : "border-neutral-700"
      }`}
      title={file.path}
    >
      {status === "ready" && url && (
        <img src={url} alt={file.name} className="absolute inset-0 w-full h-full object-cover" />
      )}
      {status === "loading" && <div className="absolute inset-0 animate-pulse bg-neutral-700/40" />}
      <span className="relative z-10 w-full truncate p-1 text-[11px] text-neutral-200 bg-gradient-to-t from-black/70 to-transparent">
        {file.name}
      </span>
    </button>
  );
}
