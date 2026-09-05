# Trash — safe to delete manually

Everything here was moved out of the active project on 2026-09-06 because it isn't part of the
shipping app. Nothing was deleted — this folder is a staging area for you to review and remove by
hand whenever you're ready. Nothing else in the repo references these paths.

## `source-legacy-wails/`

The original Wails (Go + frontend) implementation of MediaSort, superseded by the current Tauri v2
app in root `src/` + `src-tauri/`. See `docs/DESIGN.md` for why the rewrite happened (thumbnail
delivery, bundle size, no-AI decision, etc.) and `docs/BUILD.md` for how to build the app that
replaced it. Kept only for historical reference — none of its code is imported by the live app.

## `improvements_ui_ux_security.md`

A UI/UX + security audit written mid-project. Every finding in it has since been implemented (the
doc's own "Implementation status" section says so) — kept as a record of what was found and fixed,
not as a live TODO list.

## `research_models.md`

A research note on perceptual-hashing/embedding models for the grouping engine. It's a roadmap,
not a backlog — explicitly **not implemented** (see its own status note), evaluating features
(face recognition, OCR, ML embeddings) that would require bundling a model runtime and conflict
with the project's "no AI, ~15 MB installer" design decision (`docs/DESIGN.md` §1.4). Worth
reading again only if that product decision is revisited.

## `tambahanfitur.md`

A one-off task prompt given to the AI assistant (a bug-fix instruction for group-count state
sync), not documentation. The fix it describes has already been implemented and tested.
