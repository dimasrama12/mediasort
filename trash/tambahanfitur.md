Act as an expert Full-Stack Software Engineer (Rust/Tauri + React). Fix a critical state synchronization bug regarding the grouping feature.

Use `superpowers:verification-before-completion` to ensure the React state updates accurately without requiring a full app refresh. Implement the changes directly without asking for interactive permissions.

**1. Real-Time Group Count Update Bug Fix**
- Currently, there is a state desync: when files belonging to a specific group (e.g., Group 1) are moved to a target folder, the file count indicator next to that group in the sidebar does not update. It still displays the original count (e.g., 99) even though the files have been successfully moved and are no longer in the main grid.
- Fix the React state logic: Whenever files are moved to a target folder (or deleted/moved to trash), instantly and dynamically decrement the file count for the affected groups in the sidebar.
- If all files in a group are moved, the group's count must update to `0` in real-time.
- This real-time count update MUST apply universally to ALL active grouping modes: "Group by Similar", "Group by Time", "Group by Date", and "Group by Type".
- Ensure this is handled efficiently via frontend state array updates (filtering/decrementing) to avoid triggering a heavy, unnecessary backend re-scan just for a UI count update.

Work step-by-step. Verify the state synchronization carefully before marking the task as complete.