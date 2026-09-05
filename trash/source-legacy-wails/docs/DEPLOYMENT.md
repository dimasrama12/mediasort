# PhotoSort - Deployment Structure

## Overview

This folder contains the **production-ready** PhotoSort application with a clean, simplified structure designed for end users.

## What's Included

### Root Directory (For End Users)
```
PhotoSort/
├── photosort.exe          ← Main application (double-click to run)
├── README.md              ← User documentation
├── CHANGELOG.md           ← Version history and features
└── QUICKSTART.md          ← Quick start guide
```

### Source Directory (For Developers)
```
source/
├── *.go                   ← Go source files
├── go.mod, go.sum         ← Go dependencies
├── wails.json             ← Wails configuration
├── build/                 ← Build resources (icons, manifests)
├── frontend/              ← React frontend source
├── docs/                  ← Additional documentation
└── .gitignore             ← Git configuration
```

## How to Run

### For End Users
Simply **double-click** `photosort.exe` to launch the application. No installation or additional steps required.

### First Time Use
1. Double-click `photosort.exe`
2. Press `Ctrl+O` or click "Open" to select a folder
3. Start organizing your files!

See `QUICKSTART.md` for detailed instructions.

## System Requirements

- **OS**: Windows 10/11 (64-bit)
- **RAM**: 4GB minimum, 8GB recommended
- **Storage**: 100MB for application + space for thumbnails
- **Display**: 1024x768 minimum resolution

## Development

If you want to modify or build from source:

1. Navigate to the `source/` folder
2. Install dependencies:
   - Go 1.22 or later
   - Node.js 18 or later
   - Wails CLI: `go install github.com/wailsapp/wails/v2/cmd/wails@latest`
3. Run: `wails build` from the source directory

For detailed development instructions, see `source/docs/REQUIREMENTS.md`.

## File Locations

### Application Data
The application stores data in standard Windows locations:
- **Settings**: `%APPDATA%/PhotoSort/settings.json`
- **Projects**: `%APPDATA%/PhotoSort/projects/`
- **Thumbnails**: `%APPDATA%/PhotoSort/thumbnails/`

### User Files
- Organize files in any folder you choose
- The app remembers your last used folders
- Projects can be saved and loaded from anywhere

## Support

For help, documentation, and updates:
- Check `README.md` for detailed documentation
- See `CHANGELOG.md` for the list of features
- Refer to `QUICKSTART.md` for getting started

## License

See source documentation for license information.

---

**Version**: 1.0.0  
**Status**: Production Ready  
**Last Updated**: 2026-02-03