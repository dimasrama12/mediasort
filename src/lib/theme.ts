import type { Theme } from "./types";

/** Resolve "system" against the OS colour-scheme preference. */
export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme === "system") {
    const dark =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    return dark ? "dark" : "light";
  }
  return theme;
}

/** Apply a theme by toggling the `light` class on <html> (dark is the default palette). */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("light", resolveTheme(theme) === "light");
}
