import type { MouseEvent } from "react";
import type { FileInfo } from "../lib/types";
import { useThumbnail } from "../lib/useThumbnail";
import { useAppStore } from "../store/useAppStore";

export function FileCard({
  file,
  focused = false,
  selected = false,
}: {
  file: FileInfo;
  focused?: boolean;
  selected?: boolean;
}) {
  const { url, status } = useThumbnail(file);
  const selectOnly = useAppStore((s) => s.selectOnly);
  const toggleSelected = useAppStore((s) => s.toggleSelected);
  const selectRangeTo = useAppStore((s) => s.selectRangeTo);
  const openPreview = useAppStore((s) => s.openPreview);

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (e.shiftKey) selectRangeTo(file.id);
    else if (e.ctrlKey || e.metaKey) toggleSelected(file.id);
    else selectOnly(file.id);
  };

  const border = focused
    ? "border-blue-500 ring-2 ring-blue-500"
    : selected
      ? "border-sky-400"
      : "border-neutral-700";
  const bg = selected ? "bg-sky-500/20" : "bg-neutral-800";

  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={() => openPreview(file.id)}
      className={`w-[152px] h-[150px] rounded ${bg} border overflow-hidden relative flex items-end text-left ${border}`}
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
