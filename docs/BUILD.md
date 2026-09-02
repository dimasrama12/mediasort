# Building the MediaSort installer

The app is code-complete; this is the only remaining manual step.

## Prerequisites
- Rust **MSVC** toolchain (`x86_64-pc-windows-msvc`) + the MSVC build tools (already set up for dev).
- Node + `npm install` in the repo root.

## Build
```powershell
npm run tauri build
```
This runs `npm run build` (`tsc && vite build`) then bundles. Output:
```
src-tauri/target/release/bundle/nsis/MediaSort_0.1.0_x64-setup.exe
```

## Notes
- **Target:** NSIS only (`bundle.targets` in `src-tauri/tauri.conf.json`). Switch to `"all"` to also
  emit an `.msi`.
- **Size (≤15 MB goal):** `webviewInstallMode: downloadBootstrapper` ships a tiny installer that
  fetches the WebView2 runtime at install time if it's missing (present on Windows 11 already).
- **Video thumbnails:** ffmpeg is runtime-detected (film-strip placeholder when absent), so it isn't
  bundled — playback still works via WebView2.
- **Code signing (optional but recommended):** an unsigned installer trips Windows SmartScreen. To
  sign, set `bundle.windows.certificateThumbprint` (or the `signCommand`) per the Tauri v2 Windows
  signing guide, using your own code-signing certificate. This needs your cert, so it's left to you.
