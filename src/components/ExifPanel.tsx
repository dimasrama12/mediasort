import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/useAppStore";
import { decodePreview, readExif } from "../lib/commands";
import { previewKind, previewSrc } from "../lib/preview";
import { useClickOutside } from "../lib/useClickOutside";
import { useFocusTrap } from "../lib/useFocusTrap";
import { copyText } from "../lib/clipboard";
import { exifToText, fileFacts } from "../lib/exifText";
import type { ExifData } from "../lib/types";

/** EXIF viewer (§6): the photo on the left, everything the file says about itself on the right.
 *  The metadata is real selectable text — a table you can drag a cursor through — with a Copy
 *  button for the whole lot, because the usual reason to open this is to paste it somewhere. */
export function ExifPanel() {
  const exifFileId = useAppStore((s) => s.exifFileId);
  const closeExif = useAppStore((s) => s.closeExif);
  const files = useAppStore((s) => s.files);
  const browseFiles = useAppStore((s) => s.browseFiles);
  const browseFolder = useAppStore((s) => s.browseFolder);
  const cardRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<ExifData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decoded, setDecoded] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const file = (browseFolder ? browseFiles : files).find((f) => f.id === exifFileId);
  const kind = file ? previewKind(file) : "unsupported";

  useClickOutside(exifFileId != null, cardRef, closeExif);
  useFocusTrap(exifFileId != null, cardRef);

  useEffect(() => {
    if (!file) return;
    let alive = true;
    setData(null);
    setError(null);
    setCopied(false);
    readExif(file.path)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(String(e).replace(/^Error:\s*/, "")));
    return () => {
      alive = false;
    };
  }, [file?.path, file?.modifiedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // HEIC/TIFF have no webview decoder — the same Rust path the preview uses renders them here.
  useEffect(() => {
    if (!file || kind !== "decode") return;
    let alive = true;
    setDecoded(null);
    decodePreview(file.path)
      .then((url) => alive && setDecoded(url))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [file?.path, file?.modifiedAt, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (exifFileId == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeExif();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exifFileId, closeExif]);

  if (exifFileId == null || !file) return null;

  const imgSrc = kind === "decode" ? decoded : `${previewSrc(file)}?v=${file.modifiedAt}`;
  const onCopy = () => {
    if (!data) return;
    void copyText(exifToText(data)).then((ok) => {
      setCopied(ok);
      if (ok) window.setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div
      className="fixed inset-0 z-[65] grid place-items-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="exif-title"
    >
      <div
        ref={cardRef}
        className="flex h-[80vh] w-[min(1000px,92vw)] flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)] shadow-2xl"
      >
        <header className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2">
          <h2 id="exif-title" className="min-w-0 flex-1 truncate text-sm font-medium" title={file.path}>
            EXIF · {file.name}
          </h2>
          <button
            type="button"
            onClick={onCopy}
            disabled={!data}
            className="rounded bg-[var(--elevated)] px-2.5 py-1 text-xs hover:bg-[var(--elevated-hover)] disabled:opacity-40"
          >
            {copied ? "Copied ✓" : "Copy to Clipboard"}
          </button>
          <button
            type="button"
            onClick={closeExif}
            aria-label="Close"
            className="px-1 text-[var(--muted)] hover:text-[var(--text)]"
          >
            ✕
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Left: the photo itself, so the numbers on the right have something to belong to. */}
          <div className="grid min-h-0 flex-1 place-items-center overflow-hidden bg-black/40 p-3 md:max-w-[46%]">
            {imgSrc ? (
              <img
                src={imgSrc}
                alt={file.name}
                draggable={false}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="text-xs text-[var(--muted)]">
                {kind === "decode" ? `Decoding .${file.extension}…` : "No preview"}
              </span>
            )}
          </div>

          {/* Right: selectable metadata. `select-text` is explicit because the app disables text
              selection on tiles, and the entire point here is to be able to grab a value. */}
          <div className="min-h-0 flex-1 select-text overflow-auto border-t border-[var(--border)] md:border-l md:border-t-0">
            {error ? (
              <p className="p-4 text-sm text-red-400">{error}</p>
            ) : !data ? (
              <p className="p-4 text-sm text-[var(--muted)]">Reading metadata…</p>
            ) : (
              <>
                <table className="w-full table-fixed text-[13px]">
                  <tbody>
                    {fileFacts(data).map((f) => (
                      <tr key={f.label} className="border-b border-[var(--border)]">
                        <th className="w-32 px-3 py-1.5 text-left align-top font-normal text-[var(--muted)]">
                          {f.label}
                        </th>
                        <td className="break-words px-3 py-1.5 text-[var(--text)]">{f.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {data.entries.length === 0 ? (
                  <p className="p-4 text-sm text-[var(--muted)]">
                    This file carries no EXIF metadata. Screenshots and most PNG/WebP images never
                    do — the facts above come from the file itself.
                  </p>
                ) : (
                  <table className="w-full table-fixed text-[13px]">
                    <caption className="px-3 pt-3 pb-1 text-left text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
                      EXIF ({data.entries.length} fields)
                    </caption>
                    <tbody>
                      {data.entries.map((e, i) => (
                        <tr key={`${e.ifd}-${e.tag}-${i}`} className="border-b border-[var(--border)]">
                          <th
                            className="w-32 px-3 py-1.5 text-left align-top font-normal text-[var(--muted)]"
                            title={`${e.ifd} IFD`}
                          >
                            {e.tag}
                          </th>
                          <td className="break-words px-3 py-1.5 text-[var(--text)]">{e.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
