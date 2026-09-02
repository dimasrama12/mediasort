# Slice 9 — Undo / redo (command stacks + toolbar state)

Roadmap: DESIGN.md §12.9 · History module: §6.9. Autonomous overnight build — lean "option 1",
decisions recorded here.

## Architecture decision

The design (§6.9) sketches a Rust history module, but v2's **file list lives only in the frontend
Zustand store** (scan streams `FileInfo` to the UI; the backend never holds the working set). A
backend undo stack couldn't reinsert a file at its grid index. So the command stack lives in the
**frontend store**, and an async **orchestrator** (`src/lib/history.ts`) performs the inverse/forward
backend calls, then applies a pure store reducer. This generalises today's per-move `moveHistory`
into a real grouped `undoStack`/`redoStack` and adds redo — fixing the #5d "grouped batch-undo"
deferral (one Ctrl+Z now undoes a whole batch move).

## Scope (option-1)

- **Undoable/redoable: Move** (single + batch, each recorded as **one** grouped op). This is the
  frequent, index-sensitive operation and the one that already had partial undo.
- **Deferred (documented):** Trash and Rename via the history stack. Both already have recovery
  paths — Trash via the TrashPanel restore, Rename by renaming again — and Trash-undo needs the
  trash metadata threaded through while Rename-undo needs an explicit-name backend command. Any new
  Trash/Rename action **clears the redo stack** (a new mutation invalidates redo), so the stack
  never replays a stale op.

## Store (`useAppStore`)

```ts
interface MovedFile { file: FileInfo; fromIndex: number; toPath: string; }
type HistoryOp = { kind: "move"; folderId: string; moved: MovedFile[] };
undoStack: HistoryOp[]; redoStack: HistoryOp[];
completeMove / completeMoveMany  // now push ONE grouped move op, clear redoStack
applyUndoMove(backPaths)  // pop undo op, reinsert each moved file at its fromIndex (ascending),
                          // decrement folder count, push op to redoStack, focus first restored
applyRedoMove(newPaths)   // pop redo op, remove files again, increment count, push to undoStack
```

`moveHistory`/`MoveRecord`/`completeUndo` are removed. `canUndo`/`canRedo` are just
`undoStack.length > 0` / `redoStack.length > 0`, read directly by components.

## Orchestrator (`src/lib/history.ts`)

`undo()` — for the top move op, `moveFiles([toPath], dirname(file.path))` per file (parallel,
order-preserved) → `applyUndoMove(backPaths)`. `redo()` — `moveFiles([file.path], folder.path)` per
file → `applyRedoMove(newPaths)` (no-op if the target folder was deleted).

## UI

- `FileGrid`: `Ctrl+Z` → `undo()`, `Ctrl+Y` / `Ctrl+Shift+Z` → `redo()` (replaces the old inline
  moveHistory undo). Still inert while Preview/Trash/Rename own the keyboard.
- `Toolbar`: Undo / Redo buttons, disabled when their stack is empty.

## Acceptance

- Store: `completeMove`/`completeMoveMany` push exactly one op; `applyUndoMove` reconstructs the
  original array + order in one call (grouped) and decrements the count; `applyRedoMove` re-applies;
  a full move→undo→redo round-trip returns to the moved state.
- Grid: `Ctrl+Z` undoes the last (possibly batch) move; `Ctrl+Y` redoes it; Undo/Redo buttons
  enable/disable off the stacks. All prior tests stay green; `cargo test` + `npm test` gate the merge.
