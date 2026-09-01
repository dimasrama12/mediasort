import { useEffect, useState } from "react";
import type { FileInfo } from "./types";
import { ensureThumbnail } from "./commands";

export type ThumbStatus = "loading" | "ready" | "error" | "placeholder";

// Module-level memo: survives cell unmount/remount as the grid virtualizes,
// so a file is never generated or invoked twice.
const resolved = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

const PLACEHOLDER_EXT = new Set(["heic", "heif", "svg"]);
function isPlaceholder(file: FileInfo): boolean {
  return file.fileType === "video" || PLACEHOLDER_EXT.has(file.extension.toLowerCase());
}

/** Test-only: reset the module memo between tests. */
export function __clearThumbnailMemo(): void {
  resolved.clear();
  inflight.clear();
}

export function useThumbnail(file: FileInfo): { url: string | null; status: ThumbStatus } {
  const placeholder = isPlaceholder(file);
  const cached = resolved.get(file.id) ?? null;
  const [url, setUrl] = useState<string | null>(cached);
  const [status, setStatus] = useState<ThumbStatus>(
    placeholder ? "placeholder" : cached ? "ready" : "loading",
  );

  useEffect(() => {
    if (placeholder) {
      setStatus("placeholder");
      setUrl(null);
      return;
    }
    const hit = resolved.get(file.id);
    if (hit) {
      setUrl(hit);
      setStatus("ready");
      return;
    }

    let active = true;
    let p = inflight.get(file.id);
    if (!p) {
      p = ensureThumbnail(file.path).then((u) => {
        resolved.set(file.id, u);
        inflight.delete(file.id);
        return u;
      });
      inflight.set(file.id, p);
    }
    setStatus("loading");
    p.then((u) => {
      if (active) {
        setUrl(u);
        setStatus("ready");
      }
    }).catch(() => {
      inflight.delete(file.id);
      if (active) {
        setStatus("error");
        setUrl(null);
      }
    });
    return () => {
      active = false;
    };
  }, [file.id, file.path, placeholder]);

  return { url, status };
}
