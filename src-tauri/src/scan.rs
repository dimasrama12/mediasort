//! Folder scanning: extension filter, recursive walk, streamed command.

use crate::model::{FileInfo, FileType};
use crate::paths::normalize_path;
use std::path::{Path, PathBuf};
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

/// Canonicalise `p` for comparison, falling back to the path as given when it cannot be resolved
/// (deleted mid-walk, or a target folder removed outside the app). Comparing raw strings would
/// miss `C:/random` vs `C:\random\.\` vs a junction pointing at the same directory.
fn canonical(p: &Path) -> PathBuf {
    p.canonicalize().unwrap_or_else(|_| p.to_path_buf())
}

/// Resolve the excluded directories once per scan. Paths that no longer exist resolve to
/// themselves, so a stale exclusion simply never matches anything - it must not prune the scan.
fn resolve_exclusions(excluded: &[String]) -> Vec<PathBuf> {
    excluded.iter().map(|e| canonical(Path::new(e))).collect()
}

/// True if `dir` **is** one of the excluded directories, or lives inside one.
///
/// This is the rule that keeps a target folder's contents out of the library: a registered 1-9
/// target sitting inside the scanned root is somewhere files have already been filed *to*, so
/// walking into it hands every filed photo straight back to the grid it was filed out of.
fn is_excluded(dir: &Path, excluded: &[PathBuf]) -> bool {
    if excluded.is_empty() {
        return false;
    }
    let canon = canonical(dir);
    excluded.iter().any(|e| canon.starts_with(e))
}

/// The walk both the synchronous helper and the streaming command use.
///
/// Two independent guards keep already-filed photos out of the library:
///
///   * **Depth.** With `subfolders` off (the default) the walk stops at the root's own entries,
///     so a scanned folder shows exactly the files sitting in it — and reads as empty once
///     everything has been filed into a sub-folder. This is the guard that holds *unconditionally*,
///     which matters because the target-folder registry is session-only: on a fresh launch nothing
///     is registered yet, and exclusion alone would let a rescan pull every filed photo back.
///   * **Exclusion.** When the user does turn subfolder scanning on, registered 1-9 targets are
///     still pruned, so the folders the app files *into* are never folders it reads back *from*.
///
/// `WalkDir::filter_entry` makes the exclusion a *prune* rather than a filter — an excluded
/// directory is never read at all, so a target holding 20 000 filed photos costs nothing.
fn walk<'a>(
    root: &str,
    excluded: &'a [PathBuf],
    subfolders: bool,
) -> impl Iterator<Item = walkdir::DirEntry> + 'a {
    // Depth 0 is the root entry itself, depth 1 its direct children.
    let mut wd = WalkDir::new(root);
    if !subfolders {
        wd = wd.max_depth(1);
    }
    wd.into_iter()
        .filter_entry(move |e| !(e.file_type().is_dir() && is_excluded(e.path(), excluded)))
        .filter_map(|e| e.ok())
}

/// Recursively scan `roots`, skipping `excluded` directories, returning all supported media files
/// with **no duplicates**.
///
/// Deduplication is by the same normalized path the frontend uses as a file id. Two roots in one
/// multi-select can overlap (a folder and its own subfolder), and `addFiles` appends without
/// checking - so without this the grid grew two tiles for one photo, and moving one of them left
/// the other pointing at a path that no longer existed.
pub fn walk_media(roots: &[String], excluded: &[String], subfolders: bool) -> Vec<FileInfo> {
    let excluded = resolve_exclusions(excluded);
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for root in roots {
        for entry in walk(root, &excluded, subfolders) {
            if !entry.file_type().is_file() {
                continue;
            }
            if let Some(fi) = build_file_info(entry.path()) {
                if seen.insert(fi.id.clone()) {
                    out.push(fi);
                }
            }
        }
    }
    out
}

/// Recursively scan the given roots, returning all supported media files.
/// Synchronous core exercised by unit tests; the streaming `scan_folders`
/// command mirrors this walk with batching, progress events, and cancellation.
#[allow(dead_code)]
pub fn scan_paths_collect(roots: &[String]) -> Vec<FileInfo> {
    walk_media(roots, &[], true)
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
    folders: State<'_, crate::folders::FolderState>,
    paths: Vec<String>,
) -> Result<(), String> {
    state.cancel.store(false, Ordering::SeqCst);

    // Registered 1-9 target folders are pruned out of the walk. A target living inside the
    // scanned root (the usual layout: "random/contoh 1") holds files that have already been
    // filed, and re-listing them puts every one of them back in the library grid they were
    // filed out of.
    let excluded: Vec<String> = folders
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .iter()
        .map(|f| f.path.clone())
        .collect();
    let excluded = resolve_exclusions(&excluded);

    // Whether to descend at all. Off by default: the folder you scan is the folder you sort, and
    // the sub-folders under it are overwhelmingly the ones you have been sorting *into*.
    let subfolders = app
        .state::<crate::settings::SettingsState>()
        .0
        .lock()
        .map(|p| crate::settings::load_from(&p).scan_subfolders)
        .unwrap_or(false);

    // Let the webview load originals under these roots via the asset protocol
    // (full-res preview + inline video). Best-effort: a failed grant only means
    // that file falls back to the filename card, never a crash.
    for root in &paths {
        let _ = app.asset_protocol_scope().allow_directory(root, true);
    }
    // The scanned roots are also the set of paths this session is allowed to *modify*
    // (see guard.rs). Additive on purpose: scanning a second library must not make undo unable
    // to put a file back into the first one.
    app.state::<crate::guard::AccessScope>().allow_all(&paths);

    let mut batch: Vec<FileInfo> = Vec::with_capacity(100);
    let mut done = 0usize;
    // Overlapping roots (a folder and its own subfolder picked together) would otherwise emit the
    // same file twice, and the store appends batches without checking.
    let mut seen = std::collections::HashSet::new();

    for root in &paths {
        for entry in walk(root, &excluded, subfolders) {
            if state.cancel.load(Ordering::SeqCst) {
                app.emit("scan-done", Done { total: done }).ok();
                return Ok(());
            }
            if !entry.file_type().is_file() {
                continue;
            }
            if let Some(fi) = build_file_info(entry.path()) {
                if !seen.insert(fi.id.clone()) {
                    continue;
                }
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
    if !batch.is_empty() {
        app.emit("scan-file", batch.clone())
            .map_err(|e| e.to_string())?;
    }
    app.emit("scan-progress", Progress { done }).ok();
    app.emit("scan-done", Done { total: done })
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// List the media files sitting directly inside `path` (non-recursive), newest naming order.
/// Backs the sidebar's "click a target folder to see what landed in it" browse mode (§3): the
/// folder was created/registered after the scan, so it has no asset-protocol scope yet — grant
/// it here or its thumbnails and previews would silently fail to load.
#[tauri::command]
pub async fn list_folder_files(app: AppHandle, path: String) -> Result<Vec<FileInfo>, String> {
    let _ = app.asset_protocol_scope().allow_directory(&path, true);
    // Browsing a folder is how the user tells the app about it; files in it can then be filed
    // onward into another target, so it has to be modifiable too.
    app.state::<crate::guard::AccessScope>().allow(&path);
    let mut out = Vec::new();
    let rd = std::fs::read_dir(&path).map_err(|e| format!("{path}: {e}"))?;
    for entry in rd.flatten() {
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            if let Some(fi) = build_file_info(&entry.path()) {
                out.push(fi);
            }
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// Build `FileInfo` for a list of explicit paths (§2). Restoring out of the trash gives back a
/// path, not a file record — this turns those paths into the same shape the grid already holds so
/// restored files reappear in the library instead of only vanishing from the trash panel.
///
/// Paths that no longer exist, or that aren't supported media, are skipped rather than failing
/// the whole call: a partial restore should still show what it managed to bring back.
#[tauri::command]
pub async fn file_infos(app: AppHandle, paths: Vec<String>) -> Result<Vec<FileInfo>, String> {
    let mut out = Vec::with_capacity(paths.len());
    for path in &paths {
        let p = Path::new(path);
        // The file may sit outside every scanned root (restored to a folder registered later),
        // so grant its directory before the webview tries to load a thumbnail from it.
        if let Some(dir) = p.parent() {
            let _ = app.asset_protocol_scope().allow_directory(dir, false);
            app.state::<crate::guard::AccessScope>().allow(dir);
        }
        if let Some(fi) = build_file_info(p) {
            out.push(fi);
        }
    }
    Ok(out)
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
    fn a_flat_scan_shows_only_what_sits_directly_in_the_root() {
        // The default. The registry of target folders is session-only, so on a fresh launch
        // "random/contoh 1" is not registered and exclusion alone cannot keep its already-filed
        // photos out of the library. Depth 1 does, unconditionally: the root shows exactly what
        // is sitting in the root, and reads as empty once everything has been filed away.
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("loose.jpg"), b"x").unwrap();
        let filed = dir.path().join("contoh 1");
        fs::create_dir(&filed).unwrap();
        fs::write(filed.join("already-sorted.jpg"), b"x").unwrap();

        let root = dir.path().to_string_lossy().to_string();
        let names: Vec<String> = walk_media(&[root], &[], false).into_iter().map(|f| f.name).collect();
        assert_eq!(names, vec!["loose.jpg"]);
    }

    #[test]
    fn a_flat_scan_of_a_fully_filed_root_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        let filed = dir.path().join("contoh 1");
        fs::create_dir(&filed).unwrap();
        fs::write(filed.join("a.jpg"), b"x").unwrap();
        let root = dir.path().to_string_lossy().to_string();
        assert!(walk_media(&[root], &[], false).is_empty());
    }

    #[test]
    fn a_recursive_scan_still_reaches_nested_media() {
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("2019").join("summer");
        fs::create_dir_all(&sub).unwrap();
        fs::write(sub.join("deep.jpg"), b"x").unwrap();
        let root = dir.path().to_string_lossy().to_string();
        assert_eq!(walk_media(&[root], &[], true).len(), 1);
    }

    #[test]
    fn a_flat_scan_still_dedups_overlapping_roots() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.jpg"), b"x").unwrap();
        let root = dir.path().to_string_lossy().to_string();
        assert_eq!(walk_media(&[root.clone(), root], &[], false).len(), 1);
    }

    #[test]
    fn a_target_folder_inside_the_scanned_root_is_not_scanned() {
        // The reported bug: "contoh 1" is a registered 1-9 target sitting inside the scanned
        // root "random". Walking into it re-lists every photo the user has already filed, so the
        // library grid fills back up with files that are no longer in it.
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("loose.jpg"), b"x").unwrap();
        let target = dir.path().join("contoh 1");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("filed.jpg"), b"x").unwrap();
        // A plain subfolder that is *not* a target still gets scanned - the scan stays recursive.
        let sub = dir.path().join("holiday");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("deep.jpg"), b"x").unwrap();

        let root = dir.path().to_string_lossy().to_string();
        let excluded = vec![target.to_string_lossy().to_string()];
        let mut names: Vec<String> = walk_media(&[root], &excluded, true)
            .into_iter()
            .map(|f| f.name)
            .collect();
        names.sort();
        assert_eq!(names, vec!["deep.jpg", "loose.jpg"]);
    }

    #[test]
    fn a_target_nested_deeper_inside_the_root_is_pruned_with_its_whole_subtree() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("sorted").join("contoh 1");
        fs::create_dir_all(target.join("more")).unwrap();
        fs::write(target.join("a.jpg"), b"x").unwrap();
        fs::write(target.join("more/b.jpg"), b"x").unwrap();
        fs::write(dir.path().join("sorted/keep.jpg"), b"x").unwrap();

        let root = dir.path().to_string_lossy().to_string();
        let excluded = vec![target.to_string_lossy().to_string()];
        let names: Vec<String> = walk_media(&[root], &excluded, true).into_iter().map(|f| f.name).collect();
        assert_eq!(names, vec!["keep.jpg"]);
    }

    #[test]
    fn overlapping_roots_never_yield_the_same_file_twice() {
        // Picking a folder and one of its own subfolders in the same multi-select walked the
        // subfolder twice, and `addFiles` appends without deduping - two tiles for one photo,
        // both pointing at the same path.
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("sub");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("a.jpg"), b"x").unwrap();
        fs::write(dir.path().join("b.jpg"), b"x").unwrap();

        let roots = vec![
            dir.path().to_string_lossy().to_string(),
            sub.to_string_lossy().to_string(),
        ];
        let got = walk_media(&roots, &[], true);
        let mut names: Vec<String> = got.iter().map(|f| f.name.clone()).collect();
        names.sort();
        assert_eq!(names, vec!["a.jpg", "b.jpg"]);
        let mut ids: Vec<String> = got.iter().map(|f| f.id.clone()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), got.len(), "no duplicate ids reach the frontend");
    }

    #[test]
    fn a_root_that_is_itself_a_target_yields_nothing() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.jpg"), b"x").unwrap();
        let root = dir.path().to_string_lossy().to_string();
        assert!(walk_media(&[root.clone()], &[root], true).is_empty());
    }

    #[test]
    fn an_unresolvable_exclusion_does_not_prune_the_whole_scan() {
        // A target folder deleted outside the app cannot be canonicalised; that must not turn
        // into "exclude everything" (or into a panic).
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.jpg"), b"x").unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let got = walk_media(&[root], &["Z:/gone/for/good".to_string()], true);
        assert_eq!(got.len(), 1);
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
