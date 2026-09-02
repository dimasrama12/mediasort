//! Folder scanning: extension filter, recursive walk, streamed command.

use crate::model::{FileInfo, FileType};
use crate::paths::normalize_path;
use std::path::Path;
use walkdir::WalkDir;

/// True if the extension (without dot) is a supported photo/video type.
/// Part of the scan API surface; consumed by later slices (filters/grouping).
#[allow(dead_code)]
pub fn is_supported(ext: &str) -> bool {
    FileType::from_extension(ext).is_some()
}

/// Unix seconds for a civil UTC date-time (Howard Hinnant's `days_from_civil`).
fn civil_to_unix(y: i64, m: i64, d: i64, hh: i64, mm: i64, ss: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400; // [0, 399]
    let mp = if m > 2 { m - 3 } else { m + 9 }; // Mar=0..Feb=11
    let doy = (153 * mp + 2) / 5 + d - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    let days = era * 146097 + doe - 719468;
    days * 86400 + hh * 3600 + mm * 60 + ss
}

/// Parse an EXIF `DateTimeOriginal` string (`"YYYY:MM:DD HH:MM:SS"`, seconds optional)
/// into unix seconds (treated as UTC — EXIF carries no zone). `None` if malformed.
fn parse_exif_datetime(s: &str) -> Option<i64> {
    let (date, time) = s.trim().split_once(' ')?;
    let mut d = date.split(':');
    let (y, mo, da) = (d.next()?.parse().ok()?, d.next()?.parse().ok()?, d.next()?.parse().ok()?);
    let mut t = time.split(':');
    let hh: i64 = t.next()?.parse().ok()?;
    let mm: i64 = t.next()?.parse().ok()?;
    let ss: i64 = t.next().unwrap_or("0").parse().ok()?;
    if !(1..=12).contains(&mo) || !(1..=31).contains(&da) {
        return None;
    }
    Some(civil_to_unix(y, mo, da, hh, mm, ss))
}

/// Read EXIF `DateTimeOriginal` for an image, as unix seconds. `None` if the file has no
/// readable EXIF (most PNG/WebP, videos, corrupt files) — callers fall back to mtime.
fn read_exif_datetime(path: &Path) -> Option<i64> {
    let file = std::fs::File::open(path).ok()?;
    let mut reader = std::io::BufReader::new(file);
    let exif = exif::Reader::new().read_from_container(&mut reader).ok()?;
    let field = exif.get_field(exif::Tag::DateTimeOriginal, exif::In::PRIMARY)?;
    let raw = match &field.value {
        exif::Value::Ascii(vals) => vals.first().map(|b| String::from_utf8_lossy(b).into_owned()),
        _ => None,
    }?;
    parse_exif_datetime(&raw)
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
    // Capture time from EXIF for images; temporal grouping prefers it over mtime.
    let date_taken = if file_type == FileType::Image {
        read_exif_datetime(path)
    } else {
        None
    };
    let path_str = path.to_string_lossy().to_string();
    Some(FileInfo {
        id: normalize_path(&path_str),
        path: path_str,
        name: path.file_name()?.to_string_lossy().to_string(),
        extension: ext.to_lowercase(),
        size: meta.len(),
        modified_at,
        date_taken,
        file_type,
        group_id: None,
    })
}

/// Recursively scan the given roots, returning all supported media files.
/// Synchronous core exercised by unit tests; the streaming `scan_folders`
/// command mirrors this walk with batching, progress events, and cancellation.
#[allow(dead_code)]
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

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, State};

/// Managed state holding the cooperative-cancellation flag for the active scan.
#[derive(Default)]
pub struct ScanState {
    pub cancel: AtomicBool,
}

#[derive(Serialize, Clone)]
struct Progress {
    done: usize,
}
#[derive(Serialize, Clone)]
struct Done {
    total: usize,
}

/// Scan `paths` recursively on a background thread, streaming results to the UI:
/// `scan-file` batches of up to 100 `FileInfo`, `scan-progress` counts, and a
/// final `scan-done`. Honors cooperative cancellation via `cancel_scan`.
#[tauri::command]
pub async fn scan_folders(
    app: AppHandle,
    state: State<'_, ScanState>,
    paths: Vec<String>,
) -> Result<(), String> {
    state.cancel.store(false, Ordering::SeqCst);

    // Let the webview load originals under these roots via the asset protocol
    // (full-res preview + inline video). Best-effort: a failed grant only means
    // that file falls back to the filename card, never a crash.
    for root in &paths {
        let _ = app.asset_protocol_scope().allow_directory(root, true);
    }

    let mut batch: Vec<FileInfo> = Vec::with_capacity(100);
    let mut done = 0usize;

    for root in &paths {
        for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
            if state.cancel.load(Ordering::SeqCst) {
                app.emit("scan-done", Done { total: done }).ok();
                return Ok(());
            }
            if entry.file_type().is_file() {
                if let Some(fi) = build_file_info(entry.path()) {
                    batch.push(fi);
                    done += 1;
                    if batch.len() >= 100 {
                        app.emit("scan-file", batch.clone())
                            .map_err(|e| e.to_string())?;
                        app.emit("scan-progress", Progress { done }).ok();
                        batch.clear();
                    }
                }
            }
        }
    }
    if !batch.is_empty() {
        app.emit("scan-file", batch.clone())
            .map_err(|e| e.to_string())?;
    }
    app.emit("scan-progress", Progress { done }).ok();
    app.emit("scan-done", Done { total: done })
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Request cancellation of the in-progress scan (checked each walk iteration).
#[tauri::command]
pub fn cancel_scan(state: State<'_, ScanState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn parse_exif_datetime_known_epochs_and_rejects_bad() {
        assert_eq!(parse_exif_datetime("1970:01:01 00:00:00"), Some(0));
        assert_eq!(parse_exif_datetime("2021:01:01 00:00:00"), Some(1_609_459_200));
        assert_eq!(parse_exif_datetime("2021:01:01 01:01:01"), Some(1_609_459_200 + 3661));
        assert_eq!(parse_exif_datetime("garbage"), None);
        assert_eq!(parse_exif_datetime("2021:13:01 00:00:00"), None); // bad month
        assert_eq!(parse_exif_datetime("2021:06:15 12:30"), Some(civil_to_unix(2021, 6, 15, 12, 30, 0)));
    }

    #[test]
    fn read_exif_datetime_none_for_non_exif_file() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("x.jpg");
        std::fs::write(&p, b"not a real jpeg").unwrap();
        assert!(read_exif_datetime(&p).is_none());
    }

    #[test]
    fn build_file_info_has_no_date_taken_without_exif() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.jpg");
        std::fs::write(&p, b"x").unwrap();
        let fi = build_file_info(&p).unwrap();
        assert_eq!(fi.date_taken, None); // falls back to mtime in temporal grouping
    }

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
