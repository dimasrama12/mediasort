import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { previewKind, previewSrc } from "../lib/preview";

export function Preview() {
  const previewId = useAppStore((s) => s.previewId);
  const files = useAppStore((s) => s.files);
  const closePreview = useAppStore((s) => s.closePreview);
  const previewNext = useAppStore((s) => s.previewNext);
  const previewPrev = useAppStore((s) => s.previewPrev);
  const [errored, setErrored] = useState(false);

  // Reset the load-error flag whenever the shown file changes.
  useEffect(() => setErrored(false), [previewId]);

  // Global keys while open: Esc closes, arrows / j / k navigate.
  useEffect(() => {
    if (previewId == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePreview();
      else if (e.key === "ArrowRight" || e.key === "j") previewNext();
      else if (e.key === "ArrowLeft" || e.key === "k") previewPrev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewId, closePreview, previewNext, previewPrev]);

  if (previewId == null) return null;
  const file = files.find((f) => f.id === previewId);
  if (!file) return null;

  const kind = previewKind(file);
  const showFallback = kind === "unsupported" || errored;
  const src = previewSrc(file);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={closePreview}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute top-3 right-4 z-10 text-3xl leading-none text-[var(--text)] hover:text-white"
        onClick={(e) => { e.stopPropagation(); closePreview(); }}
      >
        ✕
      </button>
      <button
        type="button"
        aria-label="Previous"
        className="absolute left-3 z-10 px-2 text-4xl text-[var(--text)] hover:text-white"
        onClick={(e) => { e.stopPropagation(); previewPrev(); }}
      >
        ‹
      </button>
      <button
        type="button"
        aria-label="Next"
        className="absolute right-3 z-10 px-2 text-4xl text-[var(--text)] hover:text-white"
        onClick={(e) => { e.stopPropagation(); previewNext(); }}
      >
        ›
      </button>

      <div className="max-h-[95vh] max-w-[95vw]" onClick={(e) => e.stopPropagation()}>
        {showFallback ? (
          <div className="rounded border border-[var(--border)] bg-[var(--elevated)] px-8 py-10 text-center">
            <div className="truncate text-sm text-[var(--text)]">{file.name}</div>
            <div className="mt-2 text-xs text-[var(--muted)]">
              Preview not available for .{file.extension.toLowerCase()} yet
            </div>
          </div>
        ) : kind === "video" ? (
          <video
            src={src}
            controls
            autoPlay
            className="max-h-[95vh] max-w-[95vw]"
            onError={() => setErrored(true)}
          />
        ) : (
          <img
            src={src}
            alt={file.name}
            className="max-h-[95vh] max-w-[95vw] object-contain"
            onError={() => setErrored(true)}
          />
        )}
      </div>
    </div>
  );
}
