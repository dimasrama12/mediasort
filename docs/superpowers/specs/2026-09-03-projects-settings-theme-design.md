# Slice 10 — Projects + settings + light/dark

Roadmap: DESIGN.md §12.10 · Modules §6.10 · Model §4 (`AppSettings`, `Theme`). Autonomous
overnight build, lean "option 1", decisions recorded here.

## Sub-slices (each its own branch, `--ff-only` merge)

- **#10a settings backend** (`settings.rs` + `AppSettings`/`Theme` in `model.rs`): JSON at
  `app_data/settings.json`; `get_settings`/`save_settings`/`reset_settings`; pure `load_from`/
  `save_to` helpers TDD in a tempdir (missing/corrupt ⇒ defaults; save→load round-trip).
- **#10b settings frontend**: store settings slice + Settings panel (grouping threshold / time
  window / min-group / theme); persist via commands on change; **wire grouping defaults from
  settings** (Toolbar currently hard-codes 80 / 1h).
- **#10c projects backend** (`project.rs`): save/load/list/delete a project (files + folders+keymap
  + groups + a settings snapshot) as JSON at `app_data/projects/<id>.json`; pure helpers TDD.
- **#10d projects frontend**: Projects panel — save current session, list, load, delete.
- **#10e theme**: persist Light/Dark/System; `System` resolves via `matchMedia`; toggle a `dark`
  class on `<html>`; Tailwind `darkMode: "class"`; CSS-variable palette (`--bg/--panel/--border/
  --text/--muted`) on surfaces. **Accent colors (blue/sky/amber/red) stay literal** — FileCard tests
  assert on `sky`/`ring-2` substrings. If theme visuals get risky/unverifiable, ship the mechanism
  and defer the full restyle (documented) rather than a broken light mode.

## `AppSettings` (§4) defaults

`similarity_threshold=80`, `time_window_hours=1.0`, `min_group_size=2`, `theme=System`,
`default_view="grid"`, `thumbnail_size=200`, `sidebar_width=224`, `sidebar_collapsed=false`,
`cache_path=None`. Removed vs v1: gemini key, non-media filter flags, auto-cleanup.

## Acceptance

- Settings: defaults on first run; edits persist across `get_settings`; `reset_settings` restores
  defaults; grouping uses the stored threshold/window/min.
- Projects: save→list shows it; load restores files/folders/groups; delete removes it.
- Theme: choosing Light/Dark flips the surface palette; System follows the OS.
- `cargo test` + `npm test -- --run` gate every sub-slice merge; prior tests stay green.
