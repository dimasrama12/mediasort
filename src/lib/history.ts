import { useAppStore } from "../store/useAppStore";
import { moveFiles, renameFiles, restoreFromTrash, trashFiles } from "./commands";
import { dirname } from "./paths";

/** Undo the top operation and apply the matching store reducer. */
export async function undo(): Promise<void> {
  const st = useAppStore.getState();
  const op = st.undoStack[st.undoStack.length - 1];
  if (!op) return;
  if (op.kind === "move") {
    // Move each file back to its source directory.
    const backPaths = await Promise.all(
      op.moved.map((m) => moveFiles([m.toPath], dirname(m.file.path)).then(([p]) => p)),
    );
    st.applyUndoMove(backPaths);
  } else if (op.kind === "trash") {
    // Restore each trashed file to its original directory (sequential — same dir, avoids races).
    const restored: string[] = [];
    for (const t of op.trashed) {
      restored.push(await restoreFromTrash(t.item.id, dirname(t.file.path)));
    }
    st.applyUndoTrash(restored);
  } else if (op.kind === "rename") {
    // Rename each file from its new path back to its original path.
    await renameFiles(op.renamed.map((r) => ({ from: r.after.path, to: r.before.path })));
    st.applyUndoRename();
  }
}

/** Redo the top undone operation and apply the matching store reducer. */
export async function redo(): Promise<void> {
  const st = useAppStore.getState();
  const op = st.redoStack[st.redoStack.length - 1];
  if (!op) return;
  if (op.kind === "move") {
    const folder = st.folders.find((f) => f.id === op.folderId);
    if (!folder) return; // target folder was deleted — can't redo
    const newPaths = await Promise.all(
      op.moved.map((m) => moveFiles([m.file.path], folder.path).then(([p]) => p)),
    );
    st.applyRedoMove(newPaths);
  } else if (op.kind === "trash") {
    // Re-trash the restored files; the fresh trash entries are threaded back onto the op.
    const items = await trashFiles(op.trashed.map((t) => t.file.path));
    st.applyRedoTrash(items);
  } else if (op.kind === "rename") {
    await renameFiles(op.renamed.map((r) => ({ from: r.before.path, to: r.after.path })));
    st.applyRedoRename();
  }
}
