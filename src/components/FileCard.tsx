import type { FileInfo } from "../lib/types";
import { useThumbnail } from "../lib/useThumbnail";

export function FileCard({ file }: { file: FileInfo }) {
  const { url, status } = useThumbnail(file);
  return (
    <div
      className="w-[152px] h-[150px] rounded bg-neutral-800 border border-neutral-700 overflow-hidden relative flex items-end"
      title={file.path}
    >
      {status === "ready" && url && (
        <img src={url} alt={file.name} className="absolute inset-0 w-full h-full object-cover" />
      )}
      {status === "loading" && <div className="absolute inset-0 animate-pulse bg-neutral-700/40" />}
      <span className="relative z-10 w-full truncate p-1 text-[11px] text-neutral-200 bg-gradient-to-t from-black/70 to-transparent">
        {file.name}
      </span>
    </div>
  );
}
