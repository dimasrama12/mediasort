//! Grouping (§6.5): perceptual near-duplicate clustering (visual) + burst/session
//! clustering (temporal). The clustering core is pure and IO-free so it unit-tests
//! without the filesystem; only `dhash` touches disk. Commands + progress events are
//! wired in slice #7b, hence `#![allow(dead_code)]` for now.
#![allow(dead_code)]

use crate::model::{FileGroup, FileInfo, FileType, GroupType};
use image::imageops::FilterType;
use serde::Serialize;
use std::path::Path;
use tauri::{AppHandle, Emitter};

/// Default minimum group size (§4 `AppSettings.min_group_size`). Hard-coded until the
/// settings module (slice 10); the frontend passes threshold/window, the rest defaults here.
const MIN_GROUP_SIZE: usize = 2;

/// A file reduced to its perceptual hash — the pure input to `cluster_visual`.
pub struct Hashed {
    pub id: String,
    pub hash: u64,
}

/// A file reduced to a timestamp — the pure input to `group_temporal`.
pub struct Timed {
    pub id: String,
    pub timestamp: i64,
}

/// 64-bit difference hash (dHash): grayscale → 9×8 → compare horizontally adjacent
/// pixels (left > right ⇒ 1). Returns `None` if the image can't be decoded (videos,
/// HEIC/SVG without their decoders, corrupt files) — those are simply skipped, per v1.
pub fn dhash(path: &Path) -> Option<u64> {
    let img = image::open(path).ok()?;
    let small = img.resize_exact(9, 8, FilterType::Triangle).to_luma8();
    let mut hash: u64 = 0;
    let mut bit = 0u32;
    for y in 0..8u32 {
        for x in 0..8u32 {
            let left = small.get_pixel(x, y).0[0];
            let right = small.get_pixel(x + 1, y).0[0];
            if left > right {
                hash |= 1u64 << bit;
            }
            bit += 1;
        }
    }
    Some(hash)
}

/// Number of differing bits between two hashes (0..=64).
pub fn hamming(a: u64, b: u64) -> u32 {
    (a ^ b).count_ones()
}

/// Similarity on v1's 0..=100 scale: `100 - distance*100/64`.
pub fn similarity(a: u64, b: u64) -> u32 {
    100 - hamming(a, b) * 100 / 64
}

/// Greedy visual clustering (§6.5): scan order; each ungrouped file seeds a group and
/// absorbs every later ungrouped file with `similarity >= threshold`. Groups smaller
/// than `min_size` are dropped. `similarity` = the group's average seed-to-member score.
pub fn cluster_visual(items: &[Hashed], threshold: u32, min_size: usize) -> Vec<FileGroup> {
    let min = min_size.max(1);
    let mut used = vec![false; items.len()];
    let mut groups: Vec<FileGroup> = Vec::new();

    for i in 0..items.len() {
        if used[i] {
            continue;
        }
        used[i] = true;
        let mut ids = vec![items[i].id.clone()];
        let mut sim_sum: u32 = 0;
        let mut sim_count: u32 = 0;

        for j in (i + 1)..items.len() {
            if used[j] {
                continue;
            }
            let s = similarity(items[i].hash, items[j].hash);
            if s >= threshold {
                used[j] = true;
                ids.push(items[j].id.clone());
                sim_sum += s;
                sim_count += 1;
            }
        }

        if ids.len() >= min {
            let avg = if sim_count > 0 {
                sim_sum as f32 / sim_count as f32
            } else {
                100.0
            };
            let n = groups.len() + 1;
            groups.push(FileGroup {
                id: format!("visual-{n}"),
                name: format!("Group {n}"),
                file_ids: ids,
                similarity: avg,
                time_span: None,
                group_type: GroupType::Visual,
            });
        }
    }
    groups
}

/// Temporal clustering (§6.5): sort by timestamp asc, split into a new group whenever the
/// gap to the previous file exceeds `window_hours`. Groups smaller than `min_size` are
/// dropped. `time_span` is the group's `"start – end"` in UTC.
pub fn cluster_temporal(items: &[Timed], window_hours: f64, min_size: usize) -> Vec<FileGroup> {
    let min = min_size.max(1);
    if items.is_empty() {
        return Vec::new();
    }
    let mut idx: Vec<usize> = (0..items.len()).collect();
    idx.sort_by_key(|&i| items[i].timestamp);
    let window_secs = (window_hours * 3600.0).max(0.0) as i64;

    let mut groups: Vec<FileGroup> = Vec::new();
    let push_run = |run: &[usize], groups: &mut Vec<FileGroup>| {
        if run.len() >= min {
            let n = groups.len() + 1;
            let first = items[run[0]].timestamp;
            let last = items[*run.last().unwrap()].timestamp;
            groups.push(FileGroup {
                id: format!("temporal-{n}"),
                name: format!("Group {n}"),
                file_ids: run.iter().map(|&i| items[i].id.clone()).collect(),
                similarity: 0.0,
                time_span: Some(format!("{} – {}", fmt_utc(first), fmt_utc(last))),
                group_type: GroupType::Temporal,
            });
        }
    };

    let mut start = 0usize;
    for pos in 1..idx.len() {
        let prev = items[idx[pos - 1]].timestamp;
        let cur = items[idx[pos]].timestamp;
        if cur - prev > window_secs {
            push_run(&idx[start..pos], &mut groups);
            start = pos;
        }
    }
    push_run(&idx[start..], &mut groups);
    groups
}

/// Format unix seconds as `"YYYY-MM-DD HH:MM"` in UTC (Howard Hinnant's civil-from-days;
/// no `chrono` dependency). Timestamps are local mtime today, so this is an approximate
/// label, not a timezone-correct clock — good enough for a group indicator.
fn fmt_utc(secs: i64) -> String {
    let rem = secs.rem_euclid(86400);
    let hour = rem / 3600;
    let minute = (rem % 3600) / 60;
    let z = secs.div_euclid(86400) + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let year = if m <= 2 { y + 1 } else { y };
    format!("{year:04}-{m:02}-{d:02} {hour:02}:{minute:02}")
}

#[derive(Serialize, Clone)]
struct GroupProgress {
    done: usize,
    total: usize,
}

/// Group images by visual similarity. Hashes every image (emitting `group-progress`
/// per file, like `scan_folders`), then greedily clusters at `threshold`. Non-images
/// and undecodable files are skipped. Runs inline in the async command (same pattern as
/// the scan walk); returns `FileGroup[]` without mutating any `FileInfo`.
#[tauri::command]
pub async fn group_visual(
    app: AppHandle,
    files: Vec<FileInfo>,
    threshold: u32,
) -> Result<Vec<FileGroup>, String> {
    let images: Vec<&FileInfo> = files
        .iter()
        .filter(|f| f.file_type == FileType::Image)
        .collect();
    let total = images.len();
    let mut hashed: Vec<Hashed> = Vec::with_capacity(total);
    for (i, f) in images.iter().enumerate() {
        if let Some(hash) = dhash(Path::new(&f.path)) {
            hashed.push(Hashed { id: f.id.clone(), hash });
        }
        app.emit("group-progress", GroupProgress { done: i + 1, total })
            .ok();
    }
    Ok(cluster_visual(&hashed, threshold, MIN_GROUP_SIZE))
}

/// Group all files (images + videos) into temporal bursts within `hours`. Uses EXIF
/// `date_taken` when present, else fs `modified_at`. Cheap — no progress events.
#[tauri::command]
pub async fn group_temporal(files: Vec<FileInfo>, hours: f64) -> Result<Vec<FileGroup>, String> {
    let timed: Vec<Timed> = files
        .iter()
        .map(|f| Timed {
            id: f.id.clone(),
            timestamp: f.date_taken.unwrap_or(f.modified_at),
        })
        .collect();
    Ok(cluster_temporal(&timed, hours, MIN_GROUP_SIZE))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{GrayImage, Luma};
    use std::path::PathBuf;

    #[test]
    fn similarity_and_hamming_edges() {
        assert_eq!(hamming(0, 0), 0);
        assert_eq!(hamming(0, u64::MAX), 64);
        assert_eq!(similarity(0xABCD, 0xABCD), 100);
        assert_eq!(similarity(0, u64::MAX), 0);
        assert_eq!(similarity(0, 1), 99); // distance 1 → 100 - 1
    }

    fn write_gray(path: &PathBuf, f: impl Fn(u32) -> u8) {
        let img = GrayImage::from_fn(16, 16, |x, _| Luma([f(x)]));
        img.save(path).unwrap();
    }

    #[test]
    fn dhash_identical_is_zero_distance_mirror_is_far() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.png");
        let b = dir.path().join("b.png"); // exact copy of a
        let mirror = dir.path().join("m.png"); // left/right swapped
        write_gray(&a, |x| if x < 8 { 0 } else { 255 });
        write_gray(&b, |x| if x < 8 { 0 } else { 255 });
        write_gray(&mirror, |x| if x < 8 { 255 } else { 0 });

        let ha = dhash(&a).unwrap();
        let hb = dhash(&b).unwrap();
        let hm = dhash(&mirror).unwrap();
        assert_eq!(hamming(ha, hb), 0, "identical images must hash equal");
        assert!(similarity(ha, hm) < 80, "mirror should be below the 80 threshold");
    }

    #[test]
    fn dhash_none_on_undecodable() {
        let dir = tempfile::tempdir().unwrap();
        let bad = dir.path().join("x.png");
        std::fs::write(&bad, b"not a real png").unwrap();
        assert!(dhash(&bad).is_none());
    }

    #[test]
    fn cluster_visual_groups_near_and_drops_far_singleton() {
        let items = vec![
            Hashed { id: "a".into(), hash: 0 },
            Hashed { id: "b".into(), hash: 1 },       // sim 99 to a
            Hashed { id: "c".into(), hash: 0b11 },    // sim 97 to a
            Hashed { id: "d".into(), hash: u64::MAX }, // sim 0 to a → singleton
        ];
        let groups = cluster_visual(&items, 80, 2);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].file_ids, vec!["a", "b", "c"]);
        assert_eq!(groups[0].group_type, GroupType::Visual);
        assert!(groups[0].similarity > 90.0);
        assert_eq!(groups[0].id, "visual-1");
    }

    #[test]
    fn cluster_visual_min_size_one_keeps_singletons() {
        let items = vec![
            Hashed { id: "a".into(), hash: 0 },
            Hashed { id: "b".into(), hash: u64::MAX },
        ];
        let groups = cluster_visual(&items, 80, 1);
        assert_eq!(groups.len(), 2);
    }

    #[test]
    fn group_temporal_clusters_within_window_and_splits_on_gap() {
        // 0,1800,3600 within a 1h window of each other; 100000 far off → dropped (min 2).
        let items = vec![
            Timed { id: "a".into(), timestamp: 0 },
            Timed { id: "b".into(), timestamp: 1800 },
            Timed { id: "c".into(), timestamp: 3600 },
            Timed { id: "d".into(), timestamp: 100_000 },
        ];
        let groups = cluster_temporal(&items, 1.0, 2);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].file_ids, vec!["a", "b", "c"]);
        assert_eq!(groups[0].group_type, GroupType::Temporal);
        assert_eq!(
            groups[0].time_span.as_deref(),
            Some("1970-01-01 00:00 – 1970-01-01 01:00")
        );
    }

    #[test]
    fn group_temporal_sorts_unsorted_input_and_splits_two_runs() {
        let items = vec![
            Timed { id: "c".into(), timestamp: 200 },
            Timed { id: "a".into(), timestamp: 0 },
            Timed { id: "b".into(), timestamp: 100 },
            Timed { id: "f".into(), timestamp: 10_200 },
            Timed { id: "d".into(), timestamp: 10_000 },
            Timed { id: "e".into(), timestamp: 10_100 },
        ];
        let groups = cluster_temporal(&items, 1.0, 2);
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].file_ids, vec!["a", "b", "c"]);
        assert_eq!(groups[1].file_ids, vec!["d", "e", "f"]);
    }

    #[test]
    fn fmt_utc_known_epochs() {
        assert_eq!(fmt_utc(0), "1970-01-01 00:00");
        assert_eq!(fmt_utc(1_609_459_200), "2021-01-01 00:00");
        assert_eq!(fmt_utc(1_609_459_200 + 3661), "2021-01-01 01:01");
    }
}
