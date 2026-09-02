import { afterEach, expect, test, vi } from "vitest";
import { resolveTheme, applyTheme } from "./theme";

afterEach(() => {
  document.documentElement.classList.remove("light");
  vi.unstubAllGlobals();
});

const mockMatch = (matches: boolean) =>
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches }) as MediaQueryList),
  );

test("resolveTheme passes light/dark through and resolves system via matchMedia", () => {
  expect(resolveTheme("light")).toBe("light");
  expect(resolveTheme("dark")).toBe("dark");
  mockMatch(true);
  expect(resolveTheme("system")).toBe("dark");
  mockMatch(false);
  expect(resolveTheme("system")).toBe("light");
});

test("applyTheme toggles the light class on the root element", () => {
  applyTheme("light");
  expect(document.documentElement.classList.contains("light")).toBe(true);
  applyTheme("dark");
  expect(document.documentElement.classList.contains("light")).toBe(false);
});
