# Building the MediaSort installer

The app is code-complete; this is the only remaining manual step.

## Prerequisites
- Rust **MSVC** toolchain (`x86_64-pc-windows-msvc`), pinned in `rust-toolchain.toml`.
- **The MSVC build tools themselves** — `cl.exe` / `link.exe`. See the next section: as of
  2026-09-11 this machine no longer has them.
- Node + `npm install` in the repo root.

### If the build fails with `linker 'link.exe' not found`

The MSVC C++ build tools are missing (`C:\Program Files\Microsoft Visual Studio\2022` exists but is
empty — only the VS *Installer* is left). The pinned `x86_64-pc-windows-msvc` target links with
`link.exe` and the CRT import libraries that ship with the "Desktop development with C++" workload,
and neither is present. Two ways out; the GNU one needs no download.

#### Option A - build against the GNU toolchain (this is what shipped 0.3.0)

MinGW lives at `D:\apk\mingw64\bin` on this machine, and the whole dependency tree - `windows`,
`webview2-com`, `image`, `trash` - compiles against it. Override the pinned toolchain and give the
GNU artifacts their own target dir so the MSVC ones are not clobbered:

```powershell
$env:RUSTUP_TOOLCHAIN="stable-x86_64-pc-windows-gnu"
$env:CARGO_TARGET_DIR="D:/mediasort-target-gnu"
npx tauri build
```

~7.5 min from cold. The bundler downloads NSIS itself, so `makensis` need not be on PATH. Output:

```
D:/mediasort-target-gnu/release/bundle/nsis/MediaSort_0.3.0_x64-setup.exe   (7.6 MB)
```

Caveat: this is not the target `rust-toolchain.toml` pins. It runs, but for a build you hand to
someone else, prefer option B and rebuild on MSVC.

#### Option B - reinstall the MSVC build tools

Then `npm run tauri build` works again:

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Verify with `where.exe cl.exe` from a *Developer* PowerShell, or just re-run the build.

Running `cargo test` does not need the installer — the GNU toolchain
(`cargo +stable-x86_64-pc-windows-gnu test`) builds and runs the unit tests fine, with two
caveats: run it from PowerShell (Git Bash's coreutils `link` shadows the MSVC linker), and the
test binaries carry no manifest, so the dialog plugin's static import of comctl32 v6's
`TaskDialogIndirect` fails at load. Dropping a `<exe>.manifest` next to each test binary that
declares a `Microsoft.Windows.Common-Controls` 6.0.0.0 dependency — and touching the exe
afterwards, since the loader caches "no manifest" by timestamp — makes them run.

## Build
```powershell
npm run tauri build
```
This runs `npm run build` (`tsc && vite build`) then bundles. Output (note: `.cargo/config.toml`
redirects Cargo's `target-dir` to `D:/mediasort-target`, so the bundle lands there, **not** under
`src-tauri/target`):
```
D:/mediasort-target/release/bundle/nsis/MediaSort_0.3.0_x64-setup.exe
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
