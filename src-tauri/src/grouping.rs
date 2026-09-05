//! Grouping (§6.5): perceptual near-duplicate clustering (visual) + burst/session
//! clustering (temporal). The clustering core is pure and IO-free so it unit-tests
//! without the filesystem; only `dhash`/`phash` touch disk.
//!
//! ## Why the clustering is greedy and *not* transitive
//!
//! An earlier revision replaced the greedy seed pass with union-find over a softer
//! "contextual" link rule (hash + palette + aspect/letterbox + capture time). The idea was to
//! chain a film's bright and dark scenes together through the mid-toned frames between them.
//! In practice transitivity is a one-way door: on a real 1 090-file screenshot folder every
//! image shared the same aspect ratio and a broadly similar palette, so one chain swallowed
//! 1 089 files into "Group 1" and left singletons behind. A union-find blob is not a grouping.
//!
//! The rule here is deliberately *local*: a file joins a group only if it clears the similarity
//! threshold against that group's **seed**. Two members of a group are therefore always within
//! a bounded distance of the same image, which is what makes the groups mean something.

#![allow(dead_code)]

use crate::model::{FileGroup, FileInfo, FileType, GroupType};
use image::imageops::FilterType;
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use tauri::{AppHandle, Emitter};

/// Minimum group size. **1, deliberately.** With a minimum of 2 every photo that had no
/// near-duplicate was silently dropped from the result, so on a 1100-file folder you got ~170
/// groups and a long tail of files with no group and no colour dot. A file that matches nothing
/// is still a legitimate group of one, so nothing is ever left unassigned.
const MIN_GROUP_SIZE: usize = 1;

/// The error string a cancelled grouping run returns. The frontend matches on it to tell an
/// abort apart from a genuine failure (one leaves the existing groups alone and says nothing;
/// the other is worth surfacing).
pub const CANCELLED: &str = "cancelled";

/// Cooperative-cancellation flag for the active grouping run. A module-level static rather than
/// Tauri managed state on purpose: the hashing workers run inside `spawn_blocking`, where a
/// borrowed `State<'_, _>` cannot follow them, and only one grouping run is ever in flight (the
/// toolbar disables the group buttons while one is going).
static CANCEL: AtomicBool = AtomicBool::new(false);

/// True once `cancel_grouping` has been called for the current run.
fn cancelled() -> bool {
    CANCEL.load(Ordering::SeqCst)
}

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
/// pixels (left > right ⇒ 1). Returns `None` only when nothing on the machine can decode the
/// file (videos, SVG, corrupt files); `decode_any` means HEIC/HEIF hash like any other photo,
/// which is what stopped them dropping out of "Group: Similar" entirely.
pub fn dhash(path: &Path) -> Option<u64> {
    Some(dhash_img(&crate::media::decode_any(&path.to_string_lossy()).ok()?))
}

/// dHash of an already-decoded image. Split out so a worker decodes each photo once and derives
/// the hash from that single decode.
pub fn dhash_img(img: &image::DynamicImage) -> u64 {
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
    hash
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
    Some(phash_img(&crate::media::decode_any(&path.to_string_lossy()).ok()?))
}

/// pHash of an already-decoded image (see `dhash_img` for why this split exists).
pub fn phash_img(img: &image::DynamicImage) -> u64 {
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
    hash
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
///
/// Membership is measured against the **seed only**, never member-to-member, so a group can
/// never grow by chaining (see the module header for what happened when it could).
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

/// Order groups by file count, biggest first, then renumber their ids and names so "Group 1" is
/// always the biggest group (§4). A trailing qualifier on a name ("Group 7 · no visual match") is
/// carried across the renumbering. The sort is stable, so equal-sized groups keep the order the
/// clustering produced.
pub fn sort_groups_by_volume(groups: &mut [FileGroup], prefix: &str) {
    groups.sort_by(|a, b| b.file_ids.len().cmp(&a.file_ids.len()));
    for (i, g) in groups.iter_mut().enumerate() {
        let n = i + 1;
        let suffix = match g.name.split_once(" · ") {
            Some((_, tail)) => format!(" · {tail}"),
            None => String::new(),
        };
        g.id = format!("{prefix}-{n}");
        g.name = format!("Group {n}{suffix}");
    }
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

/// Decode every image once, in parallel across the CPU, and reduce it to its perceptual hash.
/// Decoding 1000+ full-size photos one at a time is what made grouping feel like it had hung;
/// this keeps the same per-file `group-progress` reporting (throttled) so the UI shows real
/// movement, and polls `cancel` on every file so Esc aborts within one decode.
fn hash_all(
    app: &AppHandle,
    images: &[&FileInfo],
    algo: HashAlgo,
    total: usize,
) -> Vec<Option<u64>> {
    let mut out: Vec<Option<u64>> = (0..images.len()).map(|_| None).collect();
    if images.is_empty() {
        return out;
    }
    let workers = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(1, 8);
    let chunk = images.len().div_ceil(workers);
    let done = AtomicUsize::new(0);

    std::thread::scope(|scope| {
        for (ci, slice) in out.chunks_mut(chunk).enumerate() {
            let base = ci * chunk;
            let app = app.clone();
            let done = &done;
            scope.spawn(move || {
                for (k, slot) in slice.iter_mut().enumerate() {
                    if cancelled() {
                        return; // Esc: stop this worker where it stands
                    }
                    let f = images[base + k];
                    *slot = hash_image(Path::new(&f.path), algo);
                    // Throttled: one event per 16 files keeps the IPC channel quiet while
                    // still moving the progress readout several times a second.
                    let d = done.fetch_add(1, Ordering::Relaxed) + 1;
                    if d % 16 == 0 || d == images.len() {
                        app.emit("group-progress", GroupProgress { done: d, total }).ok();
                    }
                }
            });
        }
    });
    out
}

/// Group images by visual similarity. Every image is decoded once and reduced to a perceptual
/// hash (dHash or pHash, per the user's setting), then clustered greedily around seeds.
///
/// **Every scanned file ends up in a group.** Images that match nothing become groups of one
/// (see `MIN_GROUP_SIZE`), and files no decoder can hash — videos, SVG, corrupt images — are
/// collected into one trailing group rather than being dropped.
///
/// Groups come back ordered by volume: group 1 has the most files, group 2 the next, and so on.
///
/// Pressing Esc calls `cancel_grouping`, which makes this return `Err(CANCELLED)` — the frontend
/// then leaves whatever grouping was already applied alone.
#[tauri::command]
pub async fn group_visual(
    app: AppHandle,
    files: Vec<FileInfo>,
    threshold: u32,
    algo: Option<String>,
) -> Result<Vec<FileGroup>, String> {
    let algo = HashAlgo::from_tag(algo.as_deref().unwrap_or("dhash"));
    CANCEL.store(false, Ordering::SeqCst);

    // Hashing is CPU-bound and can run for a minute on a big folder — off the async runtime.
    tauri::async_runtime::spawn_blocking(move || {
        let total = files.len();
        let images: Vec<&FileInfo> = files
            .iter()
            .filter(|f| f.file_type == FileType::Image)
            .collect();

        let hashes = hash_all(&app, &images, algo, total);
        if cancelled() {
            return Err(CANCELLED.to_string());
        }
        let mut hashed: Vec<Hashed> = Vec::with_capacity(images.len());
        let mut unhashable: Vec<String> = Vec::new();
        for (f, h) in images.iter().zip(hashes) {
            match h {
                Some(hash) => hashed.push(Hashed { id: f.id.clone(), hash }),
                None => unhashable.push(f.id.clone()),
            }
        }
        // Videos never had a hash to begin with; they belong with the rest of the leftovers.
        unhashable.extend(
            files
                .iter()
                .filter(|f| f.file_type != FileType::Image)
                .map(|f| f.id.clone()),
        );

        let mut groups = cluster_visual(&hashed, threshold, MIN_GROUP_SIZE);
        if !unhashable.is_empty() {
            let n = groups.len() + 1;
            groups.push(FileGroup {
                id: format!("visual-{n}"),
                name: format!("Group {n} · no visual match"),
                file_ids: unhashable,
                similarity: 0.0,
                time_span: None,
                group_type: GroupType::Visual,
            });
        }
        sort_groups_by_volume(&mut groups, "visual");
        app.emit("group-progress", GroupProgress { done: total, total }).ok();
        Ok(groups)
    })
    .await
    .map_err(|e| e.to_string())?
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
    let mut groups = cluster_temporal(&timed, hours, MIN_GROUP_SIZE);
    // Biggest burst first (§4) — the run that actually needs attention leads the list, rather
    // than whatever happened to be earliest on the clock.
    sort_groups_by_volume(&mut groups, "temporal");
    Ok(groups)
}

/// Request cancellation of the in-progress grouping run (Esc, §4). Checked once per file, so a
/// 1000-photo hash stops within a single decode rather than running to completion unseen.
#[tauri::command]
pub fn cancel_grouping() {
    CANCEL.store(true, Ordering::SeqCst);
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

    /// The regression this file's header is about: a chain of images where each is close to its
    /// neighbour but the ends are opposites must **not** collapse into one group. Union-find did
    /// exactly that and produced a single 1 089-file blob on a real folder.
    #[test]
    fn cluster_visual_never_chains_a_gradient_into_one_blob() {
        // 64 hashes, each one bit further from the last: neighbours are ~98% similar, the two
        // ends are 0% similar. A transitive rule merges all 64; a seed-based rule must not.
        let items: Vec<Hashed> = (0..64u32)
            .map(|i| Hashed {
                id: format!("f{i}"),
                hash: if i == 0 { 0 } else { u64::MAX >> (64 - i) },
            })
            .collect();
        let groups = cluster_visual(&items, 80, MIN_GROUP_SIZE);
        assert!(
            groups.len() > 1,
            "a similarity chain must not collapse into one group (got {} group(s))",
            groups.len()
        );
        // No group may hold more than the seed plus everything genuinely within the threshold.
        let biggest = groups.iter().map(|g| g.file_ids.len()).max().unwrap();
        assert!(biggest <= 14, "a group swallowed {biggest} of 64 files");
        // ...and nothing is lost on the way.
        let assigned: usize = groups.iter().map(|g| g.file_ids.len()).sum();
        assert_eq!(assigned, items.len());
    }

    /// Every member of a group is within the threshold of its seed — the property that makes a
    /// group mean something, and the one union-find gave up.
    #[test]
    fn cluster_visual_members_are_all_within_threshold_of_their_seed() {
        let items: Vec<Hashed> = (0..200u64)
            .map(|i| Hashed { id: format!("f{i}"), hash: i.wrapping_mul(0x9E37_79B9_7F4A_7C15) })
            .collect();
        let by_id: std::collections::HashMap<&str, u64> =
            items.iter().map(|h| (h.id.as_str(), h.hash)).collect();
        for g in cluster_visual(&items, 80, MIN_GROUP_SIZE) {
            let seed = by_id[g.file_ids[0].as_str()];
            for member in &g.file_ids[1..] {
                assert!(similarity(seed, by_id[member.as_str()]) >= 80);
            }
        }
    }

    #[test]
    fn the_shipped_minimum_leaves_no_file_ungrouped() {
        // The regression this guards: at MIN_GROUP_SIZE 2 a big folder of mostly-unique photos
        // produced a handful of groups and dropped everything else on the floor.
        let items: Vec<Hashed> = (0..200u64)
            .map(|i| Hashed { id: format!("f{i}"), hash: i.wrapping_mul(0x9E37_79B9_7F4A_7C15) })
            .collect();
        let groups = cluster_visual(&items, 90, MIN_GROUP_SIZE);
        let assigned: usize = groups.iter().map(|g| g.file_ids.len()).sum();
        assert_eq!(assigned, items.len(), "every file must land in a group");
        // ...and each file appears exactly once.
        let mut seen: Vec<&String> = groups.iter().flat_map(|g| g.file_ids.iter()).collect();
        seen.sort();
        seen.dedup();
        assert_eq!(seen.len(), items.len());
        // Group ids stay contiguous and 1-based so the colour cycling lines up with the sidebar.
        assert_eq!(groups[0].id, "visual-1");
        assert_eq!(groups.last().unwrap().id, format!("visual-{}", groups.len()));
    }

    #[test]
    fn the_shipped_minimum_also_keeps_lone_timestamps() {
        let items = vec![
            Timed { id: "a".into(), timestamp: 0 },
            Timed { id: "b".into(), timestamp: 1800 },
            Timed { id: "far".into(), timestamp: 100_000 },
        ];
        let groups = cluster_temporal(&items, 1.0, MIN_GROUP_SIZE);
        let assigned: usize = groups.iter().map(|g| g.file_ids.len()).sum();
        assert_eq!(assigned, 3);
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
    fn sort_groups_by_volume_orders_biggest_first_and_renumbers() {
        let mk = |id: &str, name: &str, n: usize| FileGroup {
            id: id.into(),
            name: name.into(),
            file_ids: (0..n).map(|i| format!("{id}-{i}")).collect(),
            similarity: 0.0,
            time_span: None,
            group_type: GroupType::Visual,
        };
        let mut groups = vec![
            mk("visual-1", "Group 1", 2),
            mk("visual-2", "Group 2", 9),
            mk("visual-3", "Group 3 · no visual match", 5),
        ];
        sort_groups_by_volume(&mut groups, "visual");

        assert_eq!(
            groups.iter().map(|g| g.file_ids.len()).collect::<Vec<_>>(),
            vec![9, 5, 2],
            "group 1 must hold the most files"
        );
        assert_eq!(groups[0].id, "visual-1");
        assert_eq!(groups[0].name, "Group 1");
        // The renumbering carries a group's qualifier along with it.
        assert_eq!(groups[1].id, "visual-2");
        assert_eq!(groups[1].name, "Group 2 · no visual match");
        assert_eq!(groups[2].id, "visual-3");
    }

    #[test]
    fn sort_groups_by_volume_is_stable_for_equal_sizes() {
        let mk = |id: &str, first: &str| FileGroup {
            id: id.into(),
            name: "Group x".into(),
            file_ids: vec![first.into(), "z".into()],
            similarity: 0.0,
            time_span: None,
            group_type: GroupType::Temporal,
        };
        let mut groups = vec![mk("temporal-1", "a"), mk("temporal-2", "b")];
        sort_groups_by_volume(&mut groups, "temporal");
        assert_eq!(groups[0].file_ids[0], "a");
        assert_eq!(groups[1].file_ids[0], "b");
    }

    #[test]
    fn fmt_utc_known_epochs() {
        assert_eq!(fmt_utc(0), "1970-01-01 00:00");
        assert_eq!(fmt_utc(1_609_459_200), "2021-01-01 00:00");
        assert_eq!(fmt_utc(1_609_459_200 + 3661), "2021-01-01 01:01");
    }
}
