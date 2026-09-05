//! Scratch-disk cleanup (§1): empty the *contents* of a user-designated folder, leaving the
//! folder itself in place. Called on app close (see `lib.rs`) and on demand via `empty_scratch`.
//! The pure `empty_dir_contents` helper takes an explicit path so tests touch only a tempdir.

use std::path::Path;
use tauri::State;

use crate::settings::SettingsState;

/// Recursively delete everything *inside* `dir` (files and subdirectories), keeping `dir` itself.
/// Best-effort per entry: a single failure (e.g. a locked file) is skipped so one stubborn file
/// can't abort the whole clean. A missing `dir` is a no-op success — nothing to empty.
pub fn empty_dir_contents(dir: &Path) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    if !dir.is_dir() {
        return Err(format!("scratch path is not a directory: {}", dir.display()));
    }
    // Safety: never empty a filesystem root (e.g. `C:\`). A root has no parent; refuse so a
    // mis-set scratch path can't wipe a whole drive on close.
    if dir.parent().is_none() {
        return Err(format!("refusing to empty a drive root: {}", dir.display()));
    }
    let rd = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in rd.flatten() {
        let path = entry.path();
        let _ = if path.is_dir() {
            std::fs::remove_dir_all(&path)
        } else {
            std::fs::remove_file(&path)
        };
    }
    Ok(())
}

/// Empty the configured scratch folder now (used by a manual "clean" button and the close hook).
/// A blank/missing path is a no-op — nothing configured, nothing to do.
pub fn empty_scratch_at(scratch_path: Option<&str>) -> Result<(), String> {
    match scratch_path {
        Some(p) if !p.trim().is_empty() => empty_dir_contents(Path::new(p)),
        _ => Ok(()),
    }
}

/// Read the persisted `scratch_path` from `settings.json` and empty that folder's contents.
/// Used by the window-close handler, where we only have the settings file to go on.
pub fn empty_scratch_from_settings(settings_path: &Path) -> Result<(), String> {
    let settings = crate::settings::load_from(settings_path);
    empty_scratch_at(settings.scratch_path.as_deref())
}

#[tauri::command]
pub async fn empty_scratch(state: State<'_, SettingsState>) -> Result<(), String> {
    let settings_path = state.0.lock().map_err(|e| e.to_string())?.clone();
    empty_scratch_from_settings(&settings_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn empties_files_and_subdirs_but_keeps_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        let scratch = dir.path().join("scratch");
        fs::create_dir_all(scratch.join("nested")).unwrap();
        fs::write(scratch.join("a.tmp"), b"x").unwrap();
        fs::write(scratch.join("nested/b.tmp"), b"y").unwrap();

        empty_dir_contents(&scratch).unwrap();

        assert!(scratch.is_dir(), "the scratch folder itself stays");
        assert_eq!(fs::read_dir(&scratch).unwrap().count(), 0, "contents gone");
    }

    #[test]
    fn missing_dir_is_ok() {
        let dir = tempfile::tempdir().unwrap();
        assert!(empty_dir_contents(&dir.path().join("nope")).is_ok());
    }

    #[test]
    fn refuses_a_drive_root() {
        // A path with no parent (a root) must be rejected, never emptied.
        assert!(empty_dir_contents(Path::new("C:\\")).is_err());
    }

    #[test]
    fn none_or_blank_scratch_is_noop() {
        assert!(empty_scratch_at(None).is_ok());
        assert!(empty_scratch_at(Some("   ")).is_ok());
    }

    #[test]
    fn empty_scratch_from_settings_reads_path_and_cleans() {
        let dir = tempfile::tempdir().unwrap();
        let scratch = dir.path().join("scratch");
        fs::create_dir_all(&scratch).unwrap();
        fs::write(scratch.join("junk.bin"), b"data").unwrap();

        // Write a settings.json pointing at the scratch folder.
        let settings_path = dir.path().join("settings.json");
        let mut s = crate::model::AppSettings::default();
        s.scratch_path = Some(scratch.to_string_lossy().to_string());
        crate::settings::save_to(&settings_path, &s).unwrap();

        empty_scratch_from_settings(&settings_path).unwrap();
        assert_eq!(fs::read_dir(&scratch).unwrap().count(), 0);
        assert!(scratch.is_dir());
    }
}
