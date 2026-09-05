# PhotoSort - Quick Start Guide

## 🚀 Running the Application

### Development Mode (Current)

**Option 1: Single Command**
```bash
wails dev
```

**Option 2: Manual (if you want separate terminals)**
```bash
# Terminal 1 - Frontend
cd frontend
npm run dev

# Terminal 2 - Backend + App
wails dev -s
```

The application will open automatically in a native window!

### What You Can Do Now

1. **Scan a Folder**
   - Click the "Scan Folder" button in the header
   - Select any folder with photos/files
   - See all files displayed in the grid

2. **Toggle Views**
   - Click the grid icon for grid view
   - Click the list icon for list view

3. **Check File Count**
   - Look at the status bar at the bottom
   - Shows total files scanned

---

## 🎨 UI Overview

### Clean, Modern Design
The UI is inspired by klipin.pro with:
- **Dark theme** - Easy on the eyes
- **Indigo accent** - Professional and modern
- **Smooth animations** - Polished feel
- **Minimal clutter** - Focus on your files

### Layout
```
┌─────────────────────────────────────────────────────┐
│  PhotoSort  [Scan Folder] [AI Group]  [⊞] [≡] [⚙]  │ Header
├──────────┬──────────────────────────────────────────┤
│ Folders  │  Your Files Here                         │
│          │                                           │
│ 📁 All   │  [Grid of files with thumbnails]         │
│          │                                           │
│ + New    │                                           │
│          │                                           │
├──────────┴──────────────────────────────────────────┤
│  Selected: 0  |  Total: 2847 files                  │ Status
└─────────────────────────────────────────────────────┘
```

---

## 🛠️ Next Steps for Development

### Immediate (This Week)
- [ ] Add thumbnail generation for images
- [ ] Implement file type icons
- [ ] Add folder creation UI
- [ ] Enable file selection

### Short Term (Next 2 Weeks)
- [ ] Integrate AI grouping (perceptual hashing)
- [ ] Add drag & drop functionality
- [ ] Implement keyboard shortcuts
- [ ] Create file operations (move, copy, delete)

### Medium Term (Month 1)
- [ ] Build project save/load
- [ ] Add batch rename
- [ ] Implement undo/redo
- [ ] Performance optimization

---

## 📦 Building for Production

When ready to create an executable:

```bash
# Build Windows .exe
wails build

# Output will be in:
# build/bin/PhotoSort.exe
```

---

## 🎯 Current Features

✅ **Working Now:**
- Folder selection dialog
- File scanning (all file types)
- Grid/List view toggle
- File count display
- Clean, modern UI
- Hot reload (dev mode)

🚧 **Coming Soon:**
- AI-powered grouping
- Drag & drop sorting
- Keyboard shortcuts (1-9 for folders)
- File preview
- Thumbnail generation
- Project save/load

---

## 💻 Tech Stack

- **Backend:** Golang 1.25.6 + Wails v2.11.0
- **Frontend:** React 18 + TypeScript + Vite 5
- **UI:** Custom CSS (inspired by klipin.pro)
- **Icons:** Lucide React

---

## 📞 Need Help?

Check the documentation:
- `docs/PRD.md` - Product requirements
- `docs/REQUIREMENTS.md` - Technical specs
- `docs/FEATURES.md` - Feature details
- `README.md` - Project overview

---

**Happy Sorting! 📁✨**
