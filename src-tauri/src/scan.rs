//! Folder scanning: extension filter, recursive walk, streamed command.

use crate::model::{FileInfo, FileType};
use crate::paths::normalize_path;
use std::path::Path;
use walkdir::WalkDir;

/// True if the extension (without dot) is a supported photo/video type.
pub fn is_supported(ext: &str) -> bool {
    FileType::from_extension(ext).is_some()
}

/// Build a `FileInfo` for a single path, or `None` if unsupported / unreadable.
pub fn build_file_info(path: &Path) -> Option<FileInfo> {
    let ext = path.extension()?.to_string_lossy().to_string();
    let file_type = FileType::from_extension(&ext)?;
    let meta = std::fs::metadata(path).ok()?;
    let modified_at = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let path_str = path.to_string_lossy().to_string();
    Some(FileInfo {
        id: normalize_path(&path_str),
        path: path_str,
        name: path.file_name()?.to_string_lossy().to_string(),
        extension: ext.to_lowercase(),
        size: meta.len(),
        modified_at,
        date_taken: None, // EXIF DateTimeOriginal wired in the grouping slice
        file_type,
        group_id: None,
    })
}

/// Recursively scan the given roots, returning all supported media files.
/// Synchronous core shared by the streaming command and by tests.
pub fn scan_paths_collect(roots: &[String]) -> Vec<FileInfo> {
    let mut out = Vec::new();
    for root in roots {
        for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                if let Some(fi) = build_file_info(entry.path()) {
                    out.push(fi);
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn filters_to_supported_media_recursively() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.jpg"), b"x").unwrap();
        fs::write(dir.path().join("b.MP4"), b"x").unwrap();
        fs::write(dir.path().join("c.txt"), b"x").unwrap();
        let sub = dir.path().join("sub");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("d.png"), b"x").unwrap();

        let root = dir.path().to_string_lossy().to_string();
        let mut got = scan_paths_collect(&[root]);
        got.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

        let names: Vec<_> = got.iter().map(|f| f.name.clone()).collect();
        assert_eq!(names, vec!["a.jpg", "b.MP4", "d.png"]);
        assert!(got.iter().all(|f| f.id == crate::paths::normalize_path(&f.path)));
    }
}
