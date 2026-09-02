import { useAppStore } from "../store/useAppStore";
import { moveFiles } from "./commands";

const dirname = (p: string) => {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(0, i) : p;
};

/** Undo the top operation: move each file back to its source dir, then apply the store reducer. */
export async function undo(): Promise<void> {
  const { undoStack, applyUndoMove } = useAppStore.getState();
  const op = undoStack[undoStack.length - 1];
  if (!op) return;
  if (op.kind === "move") {
    const backPaths = await Promise.all(
      op.moved.map((m) => moveFiles([m.toPath], dirname(m.file.path)).then(([p]) => p)),
    );
    applyUndoMove(backPaths);
  }
}

/** Redo the top undone operation: re-apply the move, then apply the store reducer. */
export async function redo(): Promise<void> {
  const { redoStack, folders, applyRedoMove } = useAppStore.getState();
  const op = redoStack[redoStack.length - 1];
  if (!op) return;
  if (op.kind === "move") {
    const folder = folders.find((f) => f.id === op.folderId);
    if (!folder) return; // target folder was deleted — can't redo
    const newPaths = await Promise.all(
      op.moved.map((m) => moveFiles([m.file.path], folder.path).then(([p]) => p)),
    );
    applyRedoMove(newPaths);
  }
}
