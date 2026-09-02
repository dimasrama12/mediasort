# Plan — Slice 8 Batch rename + search/filter

Spec: `docs/superpowers/specs/2026-09-03-batch-rename-search-design.md`. TDD; each sub-slice its
own branch, `--ff-only` to `main` when `cargo test` + `npm test -- --run` are green.

## #8a — backend batch_rename (branch `slice-8a-batch-rename`)
1. `fileops.rs`: add `resolve_collision` (shared `_N` suffix), refactor `move_one` to use it,
   `RenamePlan` + `plan_batch_rename` (pure) + `apply_batch_rename` (two-phase) + `batch_rename`
   command.
2. `lib.rs`: register `fileops::batch_rename`.
3. Tests: plan name computation (`{n}` / no-`{n}` / pad 0 / no extension); apply in a tempdir
   (order, originals gone, `1,2,3→2,3,4` shift no-suffix, external collision `_1`); existing move
   tests stay green.
4. `cargo test` green → commit → merge.

## #8b — search/filter (branch `slice-8b-search-filter`)
1. `src/lib/filter.ts`: `filterFiles(files, query)` pure (case-insensitive name substring) + tests.
2. Store: `query: string` + `setQuery`; reset on scan/reset.
3. `Toolbar`: search `<input>` bound to query/setQuery.
4. `FileGrid`: render `filterFiles(files, query)`; key handler derives the same visible list.
5. Vitest: filter helper; grid renders only matches; search input doesn't fire grid shortcuts.
6. Gate green → merge.

## #8c — batch rename UI (branch `slice-8c-rename-ui`)
1. Store: `completeRename(updates: {id,newId,newPath,newName}[])` patching files in place + test.
2. `commands.ts`: `batchRename(paths, pattern, start, pad)` wrapper.
3. Rename panel component (pattern/start/pad + first-result preview), acts on selection-or-all,
   calls `batchRename` then `completeRename`; toolbar button + key (e.g. `R`) to open.
4. Vitest: reducer patches ids/paths/names; panel renders + submits.
5. Gate green → merge.

## Carry-forward / guardrails
- Rename undo → slice 9 (history). tempdirs only; no origin push; stop + clean branch + written
  status if genuinely blocked.
