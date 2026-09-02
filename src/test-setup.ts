// Registers jest-dom matchers on vitest's `expect` — both at runtime (setupFiles)
// and, because this file is under `src`, for `tsc` (module augmentation of the
// Assertion types), which fixes toBeInTheDocument/toBeDisabled type errors.
import "@testing-library/jest-dom/vitest";
