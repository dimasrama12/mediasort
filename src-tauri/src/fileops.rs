//! File moves for target-folder sorting: rename fast-path, cross-volume
//! copy-then-delete fallback, `_N` collision suffix.

use std::path::{Path, PathBuf};

/// Move one file into `dest_dir`, returning its new absolute path.
pub fn move_one(src: &str, dest_dir: &str) -> Result<PathBuf, String> {
    let src_path = Path::new(src);
    let file_name = src_path
        .file_name()
        .ok_or_else(|| format!("no file name in {src}"))?;
    let dest_dir_path = Path::new(dest_dir);
    std::fs::create_dir_all(dest_dir_path).map_err(|e| e.to_string())?;

    let mut target = dest_dir_path.join(file_name);
    if target.exists() {
        let stem = src_path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let ext = src_path.extension().map(|e| e.to_string_lossy().to_string());
        let mut n = 1;
        loop {
            let candidate = dest_dir_path.join(match &ext {
                Some(e) => format!("{stem}_{n}.{e}"),
                None => format!("{stem}_{n}"),
            });
            if !candidate.exists() {
                target = candidate;
                break;
            }
            n += 1;
        }
    }

    match std::fs::rename(src_path, &target) {
        Ok(()) => Ok(target),
        Err(_) => {
            // Cross-volume: rename fails with EXDEV — copy then delete.
            std::fs::copy(src_path, &target).map_err(|e| e.to_string())?;
            std::fs::remove_file(src_path).map_err(|e| e.to_string())?;
            Ok(target)
        }
    }
}

#[tauri::command]
pub async fn move_files(paths: Vec<String>, dest: String) -> Result<Vec<String>, String> {
    let mut out = Vec::with_capacity(paths.len());
    for p in &paths {
        out.push(move_one(p, &dest)?.to_string_lossy().to_string());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn moves_file_into_dest_and_returns_new_path() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("a.jpg");
        fs::write(&src, b"x").unwrap();
        let dest = dir.path().join("Keep");
        let new = move_one(src.to_str().unwrap(), dest.to_str().unwrap()).unwrap();
        assert_eq!(new, dest.join("a.jpg"));
        assert!(new.exists());
        assert!(!src.exists()); // source gone
    }

    #[test]
    fn collision_gets_suffixed() {
        let dir = tempdir().unwrap();
        let dest = dir.path().join("Keep");
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join("a.jpg"), b"old").unwrap(); // occupy the slot
        let src = dir.path().join("a.jpg");
        fs::write(&src, b"new").unwrap();
        let new = move_one(src.to_str().unwrap(), dest.to_str().unwrap()).unwrap();
        assert_eq!(new, dest.join("a_1.jpg"));
        assert!(new.exists());
    }
}
