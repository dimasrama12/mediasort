# 📸 PhotoSort

**PhotoSort** is an AI-powered desktop application for organizing and sorting large media libraries with precision and speed. Built with [Wails v2](https://wails.io/) (Go + React), it combines perceptual-hash grouping, optional Gemini AI classification, and a fast keyboard-driven workflow.

![Go](https://img.shields.io/badge/Go-1.24-00ADD8?logo=go&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![Wails](https://img.shields.io/badge/Wails-v2.11-DF0000)
![License](https://img.shields.io/badge/License-MIT-green)

---

## ✨ Features

- **AI-Powered Grouping** — Clusters similar photos using perceptual hashing (pHash), temporal proximity, or a hybrid of both. Optional Google Gemini classification for smarter grouping.
- **High-Performance Preview** — Virtual scrolling handles thousands of files smoothly; full-size preview with zoom and rotation.
- **Precision Manual Sorting** — Assign target folders to keys `1–9` and move files with a single keystroke; drag & drop and multi-select supported.
- **Safety First** — Integrated trash with full restore, contextual rename/copy-path/delete, and real-time folder stats.
- **Modern UI** — High-contrast, animated interface with theme support and English/Indonesian localization.

See [`FEATURES.md`](FEATURES.md) for the full feature list and shortcuts.

## 🚀 Quick Start (Users)

1. Download the latest `PhotoSort.exe` from the [Releases](../../releases) page.
2. Launch it, then click **Scan Folder** (`Ctrl+O`) to load your unsorted media.
3. Use **AI Group** (`Ctrl+G`) to auto-cluster, or create target folders (`Ctrl+N`) mapped to keys `1–9`.
4. Press a number key to move the selected file. Files are physically moved only once you confirm.

> Gemini AI grouping is optional. Add your own API key in **Settings** — no key ships with the app.

## ⌨️ Keyboard Shortcuts

| Action | Shortcut | Action | Shortcut |
| :--- | :--- | :--- | :--- |
| Scan Folder | `Ctrl+O` | Preview Image | `Space` |
| New Folder | `Ctrl+N` | Toggle Trash | `T` |
| AI Grouping | `Ctrl+G` | Undo / Redo | `Ctrl+Z` / `Ctrl+Y` |
| Move to Folder | `1`–`9` | Fullscreen | `F11` |

## 🛠️ Development

**Prerequisites:** [Go 1.24+](https://go.dev/), [Node.js 18+](https://nodejs.org/), and the [Wails CLI](https://wails.io/docs/gettingstarted/installation).

```bash
# Install the Wails CLI
go install github.com/wailsapp/wails/v2/cmd/wails@latest

cd source

# Run in live-development mode
wails dev

# Build a production binary (output in source/build/bin/)
wails build
```

## 📁 Project Structure

```
photosort/
├── source/               # Application source
│   ├── *.go              # Go backend (app, AI grouping, thumbnails, trash, ops)
│   ├── frontend/         # React + TypeScript UI (Vite)
│   ├── docs/             # PRD, requirements, changelog, deployment notes
│   └── wails.json        # Wails project config
├── FEATURES.md           # Feature list & shortcuts
├── LICENSE               # MIT
└── README.md
```

## 💻 Tech Stack

- **Backend:** Go, Wails v2, goimagehash (pHash), goheif, goexif
- **Frontend:** React 18, TypeScript, Vite, Zustand, Lucide Icons
- **AI:** Perceptual hashing + optional Google Gemini (`generative-ai-go`)

## 📜 Documentation

- [Features & Shortcuts](FEATURES.md)
- [Product Requirements (PRD)](source/docs/PRD.md)
- [Requirements](source/docs/REQUIREMENTS.md)
- [Changelog](source/docs/CHANGELOG.md)
- [Deployment](source/docs/DEPLOYMENT.md)

## 📄 License

Released under the [MIT License](LICENSE).

---
© 2026 PhotoSort — built for the future of file management.
