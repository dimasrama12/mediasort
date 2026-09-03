//! Grouping (§6.5): perceptual near-duplicate clustering (visual) + burst/session
//! clustering (temporal). The clustering core is pure and IO-free so it unit-tests
//! without the filesystem; only `dhash`/`phash` touch disk. Commands + progress events
//! are wired in slice #7b, hence `#![allow(dead_code)]` for now.
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

/// Which perceptual hash `group_visual` uses. dHash is the fast default; pHash (DCT) is the
/// more robust option (§6.5 names dHash the default and pHash the *option*).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HashAlgo {
    DHash,
    PHash,
}

impl HashAlgo {
    /// Parse the frontend's lowercase tag; anything but `"phash"` ⇒ the safe `DHash` default.
    pub fn from_tag(tag: &str) -> HashAlgo {
        match tag {
            "phash" => HashAlgo::PHash,
            _ => HashAlgo::DHash,
        }
    }
}

/// Perceptual hash of `path` by the chosen algorithm; `None` if the image can't be decoded
/// (videos, HEIC/SVG without decoders, corrupt files) — those are skipped, exactly like `dhash`.
pub fn hash_image(path: &Path, algo: HashAlgo) -> Option<u64> {
    match algo {
        HashAlgo::DHash => dhash(path),
        HashAlgo::PHash => phash(path),
    }
}

/// Side length of the pHash working image; the DCT keeps only its low-frequency corner.
const PHASH_N: usize = 32;

/// 64-bit DCT perceptual hash (pHash): grayscale → 32×32 → 2-D DCT-II → keep the top-left
/// 8×8 low-frequency block → bit = coefficient > the block's mean (excluding the DC term).
/// Compared to dHash it survives gamma, blur, and scaling far better, at ~65k extra multiplies
/// per image. Returns `None` on an undecodable file (same contract as `dhash`).
pub fn phash(path: &Path) -> Option<u64> {
    let img = image::open(path).ok()?;
    let small = img
        .resize_exact(PHASH_N as u32, PHASH_N as u32, FilterType::Triangle)
        .to_luma8();
    let mut f = [[0f64; PHASH_N]; PHASH_N];
    for y in 0..PHASH_N {
        for x in 0..PHASH_N {
            f[y][x] = small.get_pixel(x as u32, y as u32).0[0] as f64;
        }
    }
    let dct = dct2d(&f);

    // Top-left 8×8 low-frequency block, row-major into 64 slots.
    let mut block = [0f64; 64];
    for v in 0..8 {
        for u in 0..8 {
            block[v * 8 + u] = dct[v][u];
        }
    }
    // Mean of the block *excluding* the DC term (block[0]); the DC dwarfs the AC coefficients
    // and would drag the threshold, so it's left out of the average (canonical pHash).
    let mean = block[1..].iter().sum::<f64>() / 63.0;
    let mut hash = 0u64;
    for (i, &c) in block.iter().enumerate() {
        if c > mean {
            hash |= 1u64 << i;
        }
    }
    Some(hash)
}

/// Separable 2-D DCT-II of an N×N matrix: transform every row, then every column, reusing one
/// precomputed cosine table. Orthonormal scaling (`C(0)=√(1/N)`, else `√(2/N)`) — its exact value
/// is immaterial to the hash (a per-frequency constant), but faithful scaling keeps it a real DCT.
fn dct2d(f: &[[f64; PHASH_N]; PHASH_N]) -> [[f64; PHASH_N]; PHASH_N] {
    const N: usize = PHASH_N;
    let mut cos_tab = [[0f64; N]; N];
    for k in 0..N {
        for x in 0..N {
            cos_tab[k][x] =
                ((2 * x + 1) as f64 * k as f64 * std::f64::consts::PI / (2.0 * N as f64)).cos();
        }
    }
    let c = |k: usize| {
        if k == 0 {
            (1.0 / N as f64).sqrt()
        } else {
            (2.0 / N as f64).sqrt()
        }
    };

    // Rows: g[y][u] = C(u) · Σ_x f[y][x]·cos((2x+1)uπ/2N)
    let mut g = [[0f64; N]; N];
    for y in 0..N {
        for u in 0..N {
            let mut s = 0.0;
            for x in 0..N {
                s += f[y][x] * cos_tab[u][x];
            }
            g[y][u] = c(u) * s;
        }
    }
    // Columns: F[v][u] = C(v) · Σ_y g[y][u]·cos((2y+1)vπ/2N)
    let mut out = [[0f64; N]; N];
    for u in 0..N {
        for v in 0..N {
            let mut s = 0.0;
            for y in 0..N {
                s += g[y][u] * cos_tab[v][y];
            }
            out[v][u] = c(v) * s;
        }
    }
    out
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

/// Group images by visual similarity. Hashes every image by the chosen `algo` (dHash default,
/// pHash option — emitting `group-progress` per file, like `scan_folders`), then greedily
/// clusters at `threshold`. Non-images and undecodable files are skipped. Runs inline in the
/// async command (same pattern as the scan walk); returns `FileGroup[]` without mutating `FileInfo`.
#[tauri::command]
pub async fn group_visual(
    app: AppHandle,
    files: Vec<FileInfo>,
    threshold: u32,
    algo: Option<String>,
) -> Result<Vec<FileGroup>, String> {
    let algo = HashAlgo::from_tag(algo.as_deref().unwrap_or("dhash"));
    let images: Vec<&FileInfo> = files
        .iter()
        .filter(|f| f.file_type == FileType::Image)
        .collect();
    let total = images.len();
    let mut hashed: Vec<Hashed> = Vec::with_capacity(total);
    for (i, f) in images.iter().enumerate() {
        if let Some(hash) = hash_image(Path::new(&f.path), algo) {
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
    fn phash_identical_is_equal_and_undecodable_is_none() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.png");
        let b = dir.path().join("b.png"); // byte-identical content
        write_gray(&a, |x| if x < 8 { 20 } else { 200 });
        write_gray(&b, |x| if x < 8 { 20 } else { 200 });
        assert_eq!(phash(&a).unwrap(), phash(&b).unwrap(), "same image ⇒ same pHash");

        let bad = dir.path().join("x.png");
        std::fs::write(&bad, b"not a real png").unwrap();
        assert!(phash(&bad).is_none());
    }

    #[test]
    fn phash_distinguishes_a_pattern_from_its_inverse() {
        let dir = tempfile::tempdir().unwrap();
        let vert = dir.path().join("v.png");
        let inv = dir.path().join("i.png");
        write_gray(&vert, |x| if x < 8 { 0 } else { 255 });
        write_gray(&inv, |x| if x < 8 { 255 } else { 0 }); // left/right swapped
        assert!(
            hamming(phash(&vert).unwrap(), phash(&inv).unwrap()) > 0,
            "an inverted pattern must not collide"
        );
    }

    #[test]
    fn phash_is_nondegenerate_on_a_gradient() {
        // A real DCT of a gradient yields a mix of set/unset bits; an all-0 or all-1 hash would
        // mean the transform (or the mean threshold) is broken.
        let dir = tempfile::tempdir().unwrap();
        let g = dir.path().join("g.png");
        GrayImage::from_fn(64, 64, |x, y| Luma([((x + y) * 2) as u8]))
            .save(&g)
            .unwrap();
        let bits = phash(&g).unwrap().count_ones();
        assert!(bits > 0 && bits < 64, "degenerate pHash: {bits} bits set");
    }

    #[test]
    fn hash_image_dispatches_by_algo_and_from_tag_defaults_safely() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.png");
        write_gray(&a, |x| if x < 8 { 30 } else { 220 });
        assert_eq!(hash_image(&a, HashAlgo::DHash), dhash(&a));
        assert_eq!(hash_image(&a, HashAlgo::PHash), phash(&a));

        assert_eq!(HashAlgo::from_tag("phash"), HashAlgo::PHash);
        assert_eq!(HashAlgo::from_tag("dhash"), HashAlgo::DHash);
        assert_eq!(HashAlgo::from_tag("garbage"), HashAlgo::DHash); // unknown ⇒ safe default
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
