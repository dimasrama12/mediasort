# Building the MediaSort installer

The app is code-complete; this is the only remaining manual step.

## Prerequisites
- Rust **MSVC** toolchain (`x86_64-pc-windows-msvc`), pinned in `rust-toolchain.toml`.
- **The MSVC build tools themselves** - `cl.exe` / `link.exe`. Reinstalled on this machine on
  2026-09-11 (MSVC 14.44.35207) after they went missing; they landed in
  `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools`, **not** the 64-bit
  `Program Files` path. See "Building through vcvars64" below - a plain `npm run tauri build`
  still fails on this box.
- Node + `npm install` in the repo root.

### If the build fails with `linker 'link.exe' not found`

rustc cannot find the linker the pinned `x86_64-pc-windows-msvc` target needs. Two different
causes have hit this repo, and they need different fixes:

- **The tools really are absent** - `C:\Program Files\Microsoft Visual Studio\2022` exists but is
  empty, only the VS *Installer* survives, and `where.exe cl.exe` finds nothing. That was the state
  on the morning of 2026-09-11. Fix: option B below.
- **They are installed but the VS instance is not registered** - `link.exe` is on disk, yet
  `vswhere` lists no installation, so rustc's auto-detection comes up empty. That was the state
  right after the reinstall the same evening. Fix: build through `vcvars64.bat`, see
  "Building through vcvars64".

Option A below (GNU) gets a binary that runs *on this machine only*; it can never produce an
installer you hand to someone else.

#### Option A - GNU toolchain: local testing only, NEVER for an installer you hand out

MinGW lives at `D:\apk\mingw64\bin`, and the whole dependency tree compiles against it:

```powershell
$env:RUSTUP_TOOLCHAIN="stable-x86_64-pc-windows-gnu"
$env:CARGO_TARGET_DIR="D:/mediasort-target-gnu"   # keep GNU artifacts out of the MSVC target dir
npx tauri build
```

~7.5 min from cold, and the bundler downloads NSIS itself, so `makensis` need not be on PATH.

**But the installer it produces is broken on every machine**, and nothing in the build reports it.
`webview2-com-sys/src/lib.rs` picks the link mode off the target env:

```rust
#[cfg_attr(target_env = "msvc",      link(name = "WebView2LoaderStatic", kind = "static"))]
#[cfg_attr(not(target_env = "msvc"), link(name = "WebView2Loader.dll"))]
```

So a GNU build imports `WebView2Loader.dll` at runtime (confirm with
`objdump -p mediasort.exe | grep "DLL Name"`), the NSIS bundle does not carry that DLL, and the
installed app dies on launch with *"The code execution cannot proceed because WebView2Loader.dll
was not found."* Tried 2026-09-11; that is exactly what happened. Only `mediasort.exe` run straight
out of `D:/mediasort-target-gnu/release/` works, because the DLL sits beside it there.

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

### Building through vcvars64 (required on this machine)

The 2026-09-11 reinstall left the VS *instance* unregistered: `vswhere -all -products *` prints
nothing and `C:\ProgramData\Microsoft\VisualStudio\Packages\_Instances` does not exist, so rustc's
MSVC auto-detection finds no linker and `npm run tauri build` dies with `linker 'link.exe' not
found` even though `link.exe` is on disk. Build from the developer environment instead:

```powershell
cmd /c "call ""C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"" >nul && npx tauri build"
```

~6 min from cold. (Repairing the VS install so `vswhere` reports the instance would make the plain
command work again; the vcvars wrapper is the cheaper fix.)

This runs `npm run build` (`tsc && vite build`) then bundles. Output (note: `.cargo/config.toml`
redirects Cargo's `target-dir` to `D:/mediasort-target`, so the bundle lands there, **not** under
`src-tauri/target`):
```
D:/mediasort-target/release/bundle/nsis/MediaSort_0.3.0_x64-setup.exe   (4.0 MB)
```

### Verify before handing the installer to anyone

1. **Import table** - the exe must not import `WebView2Loader.dll`:
   ```powershell
   & "D:\apk\mingw64\bin\objdump.exe" -p D:\mediasort-target\release\mediasort.exe | Select-String "WebView2Loader"
   ```
   Zero hits on an MSVC build. Any hit means the build is a GNU one and will die on launch.
2. **Install it for real**, into a throwaway dir, and check the app window comes up:
   ```powershell
   Start-Process <installer> -ArgumentList "/S","/D=C:\some\temp\dir" -Wait
   ```
   A correct install contains exactly `mediasort.exe` + `uninstall.exe`. Then run `uninstall.exe /S`
   - it leaves no registry entry and no shortcuts behind.

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
