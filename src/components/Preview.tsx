import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { previewKind, previewSrc } from "../lib/preview";
import { bindingsWithDefaults, eventToCombo, formatCombo, matchAction } from "../lib/keybindings";
import { decodePreview, openInDefaultApp, rotateImage } from "../lib/commands";
import { moveToFolder } from "../lib/fileActions";
import { invalidateThumbnail } from "../lib/useThumbnail";
import type { FolderInfo } from "../lib/types";

// Zooming *out* past the fit-to-window size only ever shrank the photo into a stamp in the
// middle of a black screen, so 100% is the floor (§1): the image can be magnified, never
// reduced below the size the window already shows it at.
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

interface View {
  zoom: number;
  x: number;
  y: number;
}
const RESET: View = { zoom: 1, x: 0, y: 0 };

export function Preview() {
  const previewId = useAppStore((s) => s.previewId);
  const libraryFiles = useAppStore((s) => s.files);
  const browseFolder = useAppStore((s) => s.browseFolder);
  const browseFiles = useAppStore((s) => s.browseFiles);
  const closePreview = useAppStore((s) => s.closePreview);
  const previewNext = useAppStore((s) => s.previewNext);
  const previewPrev = useAppStore((s) => s.previewPrev);
  const applyRotation = useAppStore((s) => s.applyRotation);
  const folders = useAppStore((s) => s.folders);
  const [errored, setErrored] = useState(false);
  const [view, setView] = useState<View>(RESET);
  const [busy, setBusy] = useState<false | "Rotating file…" | "Moving…">(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [decoded, setDecoded] = useState<string | null>(null);
  /** Set only once the Rust decoder has *also* failed. Until then a failed <img> is a reason to
   *  try harder, not a reason to give up and send the user to another application. */
  const [decodeFailed, setDecodeFailed] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);

  const files = browseFolder ? browseFiles : libraryFiles;
  const file = previewId == null ? undefined : files.find((f) => f.id === previewId);
  const kind = file ? previewKind(file) : "unsupported";

  // Reset per-file view state whenever the shown file changes.
  useEffect(() => {
    setErrored(false);
    setDecodeFailed(false);
    setView(RESET);
    setNotice(null);
    setDecoded(null);
    // Keyed on mtime as well as identity: rotating the file in place rewrites those bytes, so a
    // decoded copy from before the turn is stale and has to be thrown away with the rest.
  }, [previewId, file?.modifiedAt]);

  // Two paths into the same Rust decoder:
  //
  //   * `kind === "decode"` — formats the webview has no decoder for at all (HEIC/HEIF/TIFF).
  //   * `errored` on an ordinary image — the **recovery** path, and the reason a PNG can no
  //     longer end up behind a "this machine has no codec for .png" card. Every browser engine
  //     decodes PNG; when the <img> fails it is the *asset URL* that failed (a directory that was
  //     never granted to the asset protocol, a path the protocol mangles, a file being rewritten
  //     under us), not the codec. Decoding the bytes in Rust and handing back a data: URL renders
  //     it in our own window, which is what the format deserves.
  //
  // `decode_preview` downscales before encoding, so this costs a bounded amount of memory even
  // for a 50-megapixel original.
  const needsDecode = kind === "decode" || (kind === "image" && errored);
  useEffect(() => {
    if (!file || !needsDecode || decoded != null || decodeFailed) return;
    let active = true;
    decodePreview(file.path)
      .then((url) => {
        if (!active) return;
        setDecoded(url);
        setDecodeFailed(false);
      })
      .catch(() => active && setDecodeFailed(true));
    return () => {
      active = false;
    };
  }, [file?.path, file?.modifiedAt, needsDecode, decoded, decodeFailed]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomBy = useCallback((factor: number, px?: number, py?: number) => {
    setView((v) => {
      const zoom = clampZoom(v.zoom * factor);
      if (zoom === v.zoom) return v;
      const k = zoom / v.zoom;
      // Keep the point under the cursor (or the centre) fixed while scaling.
      const ax = px ?? 0;
      const ay = py ?? 0;
      return { zoom, x: ax - (ax - v.x) * k, y: ay - (ay - v.y) * k };
    });
  }, []);

  /** Rotate the *original file on disk* by ±90° (§1) and reload it. */
  const rotate = useCallback(
    async (degrees: number) => {
      if (!file || busy) return;
      setBusy("Rotating file…");
      setNotice(null);
      try {
        const { modifiedAt, size } = await rotateImage(file.path, degrees);
        // Writing the new mtime/size back into the store is what refreshes everything at once:
        // the grid tile's thumbnail key, the preview URL below, and any other view of this file.
        invalidateThumbnail(file.id);
        applyRotation(file.id, modifiedAt, size);
        setView(RESET);
      } catch (e) {
        setNotice(String(e).replace(/^Error:\s*/, ""));
      } finally {
        setBusy(false);
      }
    },
    [file, busy, applyRotation],
  );

  /**
   * File the photo on screen into target folder `folder`, then keep the viewer on the photo that
   * takes its place.
   *
   * The next id has to be read *before* the move: the moment the store drops the file, this
   * component can no longer find it and the whole preview unmounts — which is what closing the
   * viewer on every single move would look like. Reading it first turns "move" into "move and
   * advance", which is the gesture people actually want when they are working through a folder.
   */
  const fileTo = useCallback(
    async (folder: FolderInfo) => {
      const st = useAppStore.getState();
      if (!file || busy || folder.id === st.browseFolder?.id) return;
      const order = st.visibleIds.length > 0 ? st.visibleIds : files.map((f) => f.id);
      const i = order.indexOf(file.id);
      const nextId = order[i + 1] ?? order[i - 1] ?? null;
      setBusy("Moving…");
      setNotice(null);
      try {
        await moveToFolder([file], folder);
        useAppStore.setState({ previewId: nextId });
      } catch (e) {
        setNotice(String(e).replace(/^Error:\s*/, ""));
      } finally {
        setBusy(false);
      }
    },
    [file, busy, files],
  );

  // Global keys while open: Esc closes, arrows / j / k navigate, the (rebindable) preview-scope
  // actions rotate and zoom, and a target folder's key files the photo. Bindings are read live so
  // a rebind takes effect without re-subscribing.
  useEffect(() => {
    if (previewId == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return closePreview();
      if (e.key === "ArrowRight" || e.key === "j") return previewNext();
      if (e.key === "ArrowLeft" || e.key === "k") return previewPrev();
      const bindings = bindingsWithDefaults(useAppStore.getState().settings.keybindings);
      const action = matchAction(bindings, e, "preview");
      if (action) {
        e.preventDefault();
        if (action === "rotateLeft") void rotate(-90);
        else if (action === "rotateRight") void rotate(90);
        else if (action === "zoomIn") zoomBy(1.25);
        else if (action === "zoomOut") zoomBy(1 / 1.25);
        else if (action === "zoomReset") setView(RESET);
        return;
      }
      // A folder's key files the photo, exactly as it does in the grid — and *after* the
      // preview-scope actions for the same reason the grid checks them last. The pool hands out
      // "0" as the tenth key, and "0" is zoom-reset in here; the binding wins, which is why the
      // conflict rules leave preview-scope combos claimable in the first place.
      const combo = eventToCombo(e);
      if (!combo) return;
      const folder = useAppStore.getState().folders.find((f) => f.key !== "" && f.key === combo);
      if (!folder) return;
      e.preventDefault();
      void fileTo(folder);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewId, closePreview, previewNext, previewPrev, rotate, zoomBy, fileTo]);

  // Wheel zoom, anchored at the pointer. Registered natively (not via onWheel) so the listener
  // can be non-passive and actually cancel the webview's own scroll/zoom.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || previewId == null) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [previewId, zoomBy]);

  if (previewId == null || !file) return null;

  const zoomed = view.zoom !== 1 || view.x !== 0 || view.y !== 0;
  // The escape hatch is the *last* resort: an unknown extension, a video the machine cannot play,
  // or a still that both the webview and the Rust decoder (image crate, then WIC) refused.
  const showFallback =
    kind === "unsupported" || (kind === "video" && errored) || (needsDecode && decodeFailed);
  // Keyed on mtime, so the moment a rotation rewrites the file the URL changes and the webview
  // refetches instead of serving the copy it already has cached. (Tauri's asset protocol reads
  // only the URL path, so the query string is inert on the Rust side.)
  const src = `${previewSrc(file)}?v=${file.modifiedAt}`;
  const imgSrc = needsDecode ? decoded : src;

  const onPointerDown = (e: React.PointerEvent) => {
    if (view.zoom <= 1) return;
    drag.current = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    d.moved = true;
    setView((v) => ({ ...v, x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
  const toolBtn =
    "px-2 py-1 rounded text-sm bg-white/10 hover:bg-white/20 text-white disabled:opacity-40";

  return (
    <div
      className="anim-fade fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={closePreview}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute top-3 right-4 z-20 text-3xl leading-none text-[var(--text)] hover:text-white"
        onClick={(e) => { e.stopPropagation(); closePreview(); }}
      >
        ✕
      </button>
      <button
        type="button"
        aria-label="Previous"
        className="absolute left-3 z-20 px-2 text-4xl text-[var(--text)] hover:text-white"
        onClick={(e) => { e.stopPropagation(); previewPrev(); }}
      >
        ‹
      </button>
      <button
        type="button"
        aria-label="Next"
        className="absolute right-3 z-20 px-2 text-4xl text-[var(--text)] hover:text-white"
        onClick={(e) => { e.stopPropagation(); previewNext(); }}
      >
        ›
      </button>

      {/* The stage fills the window so wheel-zoom works anywhere, but a click that lands on the
          backdrop itself (not on the image or a control) still closes the preview. */}
      <div
        ref={stageRef}
        className="relative flex h-full w-full items-center justify-center overflow-hidden"
      >
        {showFallback ? (
          <div
            onClick={(e) => e.stopPropagation()}
            className="rounded border border-[var(--border)] bg-[var(--elevated)] px-8 py-10 text-center"
          >
            <div className="truncate text-sm text-[var(--text)]">{file.name}</div>
            <div className="mt-2 max-w-sm text-xs text-[var(--muted)]">
              {kind === "video"
                ? `This machine has no codec for .${file.extension.toLowerCase()} video — open it in your default player instead.`: `.${file.extension.toLowerCase()} could not be decoded here — the file may be corrupt or still being written.`}
            </div>
            <button
              type="button"
              onClick={() => void openInDefaultApp(file.path).catch(() => {})}
              className="mt-4 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-sm"
            >
              Open in default app
            </button>
          </div>
        ) : kind === "video" ? (
          <video
            src={src}
            controls
            autoPlay
            onClick={(e) => e.stopPropagation()}
            className="max-h-[95vh] max-w-[95vw]"
            onError={() => setErrored(true)}
          />
        ) : imgSrc ? (
          <img
            src={imgSrc}
            alt={file.name}
            // Tagged like a grid tile so the right-click menu (§5) knows which file is on screen
            // and can offer its EXIF from here too.
            data-file-id={file.id}
            draggable={false}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="max-h-[95vh] max-w-[95vw] object-contain select-none"
            style={{
              transform,
              transformOrigin: "center",
              transition: drag.current ? "none" : "transform 0.12s ease-out",
              cursor: view.zoom > 1 ? "grab" : "default",
            }}
            onError={() => setErrored(true)}
          />
        ) : (
          <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <span
              aria-hidden
              className="anim-spin h-4 w-4 rounded-full border-2 border-[var(--muted)] border-t-transparent"
            />
            Decoding .{file.extension}…
          </div>
        )}

        {/* Toolbar: zoom, permanent rotation, and the escape hatch to the OS viewer. */}
        <div
          className="absolute bottom-4 left-1/2 z-20 flex max-w-[92vw] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-lg bg-black/80 px-2 py-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Zoom out"
            title="Zoom out (−) — 100% is the minimum"
            className={toolBtn}
            disabled={view.zoom <= 1}
            onClick={() => zoomBy(1 / 1.25)}
          >
            −
          </button>
          <button
            type="button"
            aria-label="Reset zoom"
            title="Reset zoom (0)"
            className={`${toolBtn} w-14 tabular-nums`}
            onClick={() => setView(RESET)}
          >
            {Math.round(view.zoom * 100)}%
          </button>
          <button type="button" aria-label="Zoom in" title="Zoom in (+)" className={toolBtn} onClick={() => zoomBy(1.25)}>
            +
          </button>
          <span className="mx-1 h-4 w-px bg-white/20" />
          <button
            type="button"
            aria-label="Rotate left"
            title="Rotate left — rewrites the file (L)"
            className={toolBtn}
            disabled={!!busy || kind === "video"}
            onClick={() => void rotate(-90)}
          >
            ↺
          </button>
          <button
            type="button"
            aria-label="Rotate right"
            title="Rotate right — rewrites the file (R)"
            className={toolBtn}
            disabled={!!busy || kind === "video"}
            onClick={() => void rotate(90)}
          >
            ↻
          </button>
          {folders.length > 0 && (
            <>
              <span className="mx-1 h-4 w-px bg-white/20" />
              {/* File this photo away without leaving the viewer. Sorting is the app's whole
                  job, and until now the preview — where you actually decide — was the one
                  place you could not do it: you had to close it, find the tile again, and
                  press the key. The folder keys work in here too. */}
              {folders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`${toolBtn} gap-1`}
                  disabled={!!busy}
                  title={`Move to ${f.name}${f.key ? ` (${formatCombo(f.key)})` : ""}`}
                  aria-label={`Move to ${f.name}`}
                  onClick={() => void fileTo(f)}
                >
                  <span className="text-[10px] opacity-60 tabular-nums">{f.key || "—"}</span>
                  <span className="max-w-[7rem] truncate">{f.name}</span>
                </button>
              ))}
            </>
          )}
        </div>

        {(busy || notice || zoomed) && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 max-w-[70vw] rounded bg-black/70 px-3 py-1 text-xs text-white">
            {busy ? busy : (notice ?? "Drag to pan · scroll to zoom")}
          </div>
        )}
      </div>
    </div>
  );
}
