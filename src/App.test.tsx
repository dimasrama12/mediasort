import { expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// App registers scan-event listeners on mount; stub Tauri's event bridge,
// which isn't present in the jsdom test environment.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import App from "./App";

test("renders the scan control", () => {
  render(<App />);
  expect(screen.getByRole("button", { name: /scan folder/i })).toBeDefined();
});
