# 📸 MediaSort

**MediaSort** is a fast, keyboard-driven desktop app for tearing through a messy folder of photos and videos: scan it, auto-cluster near-duplicates, and blast through them into target folders with a single keystroke. Built with **Tauri v2** (Rust) + **React 19** + **TypeScript** — no cloud, no AI, no telemetry, everything stays on your machine.

![Rust](https://img.shields.io/badge/Rust-Tauri%20v2-000000?logo=rust&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

---

## Why MediaSort

Library managers like Eagle, digiKam, and PhotoPrism are built for cataloging a collection you keep forever. MediaSort is built for the other job: you point it at a dump folder — a phone backup, a camera card, a downloads folder — and you need to *sort it once and be done*. Group the near-duplicates, keep the best one, file the rest, throw away the junk, in one pass, without touching the mouse.

## ✨ Features

- **Similarity grouping** — clusters near-duplicate images by perceptual hash (dHash by default, or DCT-based pHash for more robustness), plus time-based grouping (EXIF capture time, falling back to file mtime). Group by Similar / Time / Date / Type, with live counts that update as you sort.
- **One-pass sorting** — map up to 9 target folders to number keys; press a number to move the selected file(s) instantly. Drag-and-drop and multi-select both work.
- **Sharp previews at scale** — thumbnails are generated and cached on disk (not re-encoded through IPC), so grids of thousands of files stay smooth. Full-size preview with zoom, rotation (written back to the file), and inline video playback.
- **HEIC/HEIF support** — decoded via Windows WIC, no external codec install required.
- **EXIF viewer** — inspect a file's metadata inline; values are sanitized and length-capped since EXIF is attacker-controlled input.
- **Undoable everything that matters** — trash, restore, batch rename, and moves are all undo/redo-able (Ctrl+Z / Ctrl+Y). Permanent delete is the one exception, and it's the only action that asks for confirmation.
- **Safety-first trash** — deleting sends files to an in-app trash with full restore, not straight to disk.
- **Batch rename**, **search/filter**, **project save/load** (resume a sorting session later), and a **right-click context menu** for the usual file operations.
- **Fully rebindable keyboard shortcuts**, a **scratch-disk auto-clean** on app close, and **light/dark/system** theming.
- **Hardened by design** — path allowlisting on every file-mutating command, a strict CSP, atomic settings/trash writes, and decode-time pixel limits so a malicious/corrupt image can't be used to exhaust memory.

See [`FEATURES.md`](FEATURES.md) for the full list, [`docs/DESIGN.md`](docs/DESIGN.md) for the architecture behind these decisions, and [`PRD-MediaSort-v2.md`](PRD-MediaSort-v2.md) for the original product spec.

## 🚀 Quick Start (Users)

1. Download the latest installer from the [Releases](../../releases) page and run it.
2. Launch MediaSort, then **Scan Folder** (`Ctrl+O`) to load an unsorted folder.
3. Create target folders (`Ctrl+N`) — each gets mapped to a number key `1`–`9`.
4. Optionally group by similarity or time from the sidebar to spot duplicates.
5. Select a file (or a group) and press its target folder's number key to move it. Anything you don't want goes to trash (`Delete`) — nothing is deleted permanently without a separate, confirmed action.

## ⌨️ Keyboard Shortcuts

All shortcuts are rebindable in **Settings → Shortcuts**; these are the defaults.

| Action | Shortcut | Action | Shortcut |
| :--- | :--- | :--- | :--- |
| Scan / open folder | `Ctrl+O` | Move to trash | `Delete` / `B` |
| New target folder | `Ctrl+N` | Delete permanently | `Shift+Delete` |
| Move file to target folder | `1`–`9` | Return files to library | `` ` `` |
| Batch rename | `Shift+R` | Select all | `Ctrl+A` |
| Toggle sidebar | `Ctrl+H` | Open trash | `T` |
| Grid / list view | `[` / `]` | Focus search | `Ctrl+F` |
| Refresh | `Ctrl+R` / `F5` | Undo / redo | `Ctrl+Z` / `Ctrl+Y` |
| Open settings | `Ctrl+,` | Exit application | `Alt+X` |
| Rotate left / right (preview) | `L` / `R` | Zoom in / out / reset (preview) | `+` / `-` / `0` |

## 🛠️ Development

**Prerequisites:** [Node.js 18+](https://nodejs.org/), the [Rust MSVC toolchain](https://www.rust-lang.org/tools/install) (`x86_64-pc-windows-msvc`), and the [Tauri CLI](https://tauri.app/start/prerequisites/) (installed as a dev dependency below).

```bash
npm install

# Run in live-development mode (hot reload)
npm run tauri dev

# Build a production installer
npm run tauri build
```

```bash
# Frontend tests (Vitest)
npm test

# Backend tests (Rust)
cd src-tauri && cargo test
```

See [`docs/BUILD.md`](docs/BUILD.md) for the exact installer output path.

## 📁 Project Structure

```
mediasort/
├── src/                  # React + TypeScript UI (Vite)
├── src-tauri/            # Rust backend: scanning, hashing/grouping, thumbnails, trash, EXIF
├── docs/                 # Architecture, build notes, and per-feature plans/specs
├── PRD-MediaSort-v2.md   # Product requirements for the current app
├── FEATURES.md           # Full feature list & shortcuts
├── trash/                # Superseded code/notes kept for reference, not part of the app
└── LICENSE
```

## 💻 Tech Stack

- **Backend:** Rust, Tauri v2, `image` + a Windows WIC fallback (HEIC/HEIF), `kamadak-exif`, perceptual hashing (dHash/pHash)
- **Frontend:** React 19, TypeScript, Vite, Zustand, Tailwind CSS v4, TanStack Virtual
- **Testing:** Vitest + Testing Library (frontend), `cargo test` (backend)

## 📜 Documentation

- [Features & Shortcuts](FEATURES.md)
- [Architecture & Design](docs/DESIGN.md)
- [Product Requirements](PRD-MediaSort-v2.md)
- [Build Instructions](docs/BUILD.md)

## 📄 License

Released under the [MIT License](LICENSE).

---
© 2026 MediaSort
