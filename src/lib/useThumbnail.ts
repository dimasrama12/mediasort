import { useEffect, useState } from "react";
import type { FileInfo } from "./types";
import { ensureThumbnail } from "./commands";

export type ThumbStatus = "loading" | "ready" | "error" | "placeholder";

// Module-level memo: survives cell unmount/remount as the grid virtualizes,
// so a file is never generated or invoked twice.
//
// **Bounded.** These used to be plain Maps that only ever grew: scrolling a 50 000-file library
// retained 50 000 URL strings and keys for the life of the session, tens of MB of JS heap that
// nothing ever reclaimed. A Map iterates in insertion order, so the oldest key is simply the
// first one — which makes an LRU-by-insertion eviction three lines, with no extra structure.
const MEMO_LIMIT = 3000;
const resolved = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

/** Remember `url` for `key`, evicting the oldest entries once the memo is over its limit.
 *  Evicting a URL costs one cheap re-`invoke` if that tile ever comes back on screen; the
 *  on-disk thumbnail cache behind it is untouched, so nothing is re-decoded. */
function remember(key: string, url: string): void {
  resolved.set(key, url);
  while (resolved.size > MEMO_LIMIT) {
    const oldest = resolved.keys().next();
    if (oldest.done) break;
    resolved.delete(oldest.value);
  }
}

/** Cache identity for a file's thumbnail. Includes mtime + size, exactly like the backend's cache
 *  key, so rewriting the file in place (rotation) is enough to invalidate every layer at once:
 *  this memo, the React effect, and the on-disk thumbnail. */
const memoKey = (file: FileInfo): string => `${file.id}|${file.modifiedAt}|${file.size}`;

// heic/heif are decoded through WIC in the backend now, so they get real thumbnails; svg (vector)
// and videos (frame extraction) still fall back to an icon tile.
const PLACEHOLDER_EXT = new Set(["svg"]);
function isPlaceholder(file: FileInfo): boolean {
  return file.fileType === "video" || PLACEHOLDER_EXT.has(file.extension.toLowerCase());
}

/** Forget every cached thumbnail for a file id, whatever its mtime. Belt-and-braces after an
 *  in-place edit: the memo key changes on its own, this just stops the old entry lingering. */
export function invalidateThumbnail(id: string): void {
  for (const k of [...resolved.keys()]) if (k.startsWith(`${id}|`)) resolved.delete(k);
  for (const k of [...inflight.keys()]) if (k.startsWith(`${id}|`)) inflight.delete(k);
}

/** Drop every cached thumbnail URL. Used by the Ctrl+R refresh (§5) so files changed outside the
 *  app are re-read, and by tests to reset the module memo between cases. */
export function clearThumbnailMemo(): void {
  resolved.clear();
  inflight.clear();
}

/** Older alias kept for the existing test suites. */
export const __clearThumbnailMemo = clearThumbnailMemo;

export function useThumbnail(file: FileInfo): { url: string | null; status: ThumbStatus } {
  const placeholder = isPlaceholder(file);
  const key = memoKey(file);
  const cached = resolved.get(key) ?? null;
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
    const hit = resolved.get(key);
    if (hit) {
      setUrl(hit);
      setStatus("ready");
      return;
    }

    let active = true;
    let p = inflight.get(key);
    if (!p) {
      p = ensureThumbnail(file.path).then((u) => {
        remember(key, u);
        inflight.delete(key);
        return u;
      });
      inflight.set(key, p);
    }
    setStatus("loading");
    p.then((u) => {
      if (active) {
        setUrl(u);
        setStatus("ready");
      }
    }).catch(() => {
      inflight.delete(key);
      if (active) {
        setStatus("error");
        setUrl(null);
      }
    });
    return () => {
      active = false;
    };
  }, [key, file.path, placeholder]);

  return { url, status };
}
