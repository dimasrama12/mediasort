//! Copy-to-clipboard with a fallback (§6).
//!
//! `navigator.clipboard` is the right API but it is not always there: it needs a secure context,
//! and inside a webview it can be missing or reject outright. Falling back to a hidden textarea +
//! `execCommand("copy")` — deprecated, still universally implemented — means the button works
//! rather than failing silently, which for a "copy this metadata" affordance is the whole point.

/** Copy `text`, returning whether it actually made it to the clipboard. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    // Off-screen but still focusable — execCommand only copies from a live selection.
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
