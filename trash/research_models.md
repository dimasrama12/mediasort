# Research: models & algorithms for MediaSort's grouping engine

**Scope.** An audit of how MediaSort currently groups, sorts and clusters media, followed by
concrete recommendations for perceptual-hashing, embedding and recognition models that could be
integrated into the Rust backend.

**Audience.** Whoever picks up `src-tauri/src/grouping.rs` next.

**Status of numbers.** Model sizes and latencies below are order-of-magnitude estimates from
published model cards and typical desktop CPU throughput, not measurements on this machine.
Anything marked *(estimate)* needs a benchmark before it drives a decision.

---

## Implementation status (2026-09-05)

**This document is a roadmap, not a backlog, and it is deliberately not implemented.** Tiers 1–3
(DINOv2/MobileCLIP embeddings, face recognition, OCR) each need a model file and an inference
runtime — `candle` or `tract` plus 30–300 MB of weights — shipped inside an installer that is
currently a few megabytes and works entirely offline with no ML dependency at all. That is a
product decision about what MediaSort *is*, not a refactor, and it should be made deliberately
rather than arrived at by implementing a research note.

What has changed since this was written, and what it means for §8's roadmap:

- **§4.4's "chaining failure mode" stopped being hypothetical and was fixed by removal.** The
  union-find contextual clustering this document analyses put 1 089 of 1 090 files into a single
  group on a real screenshot folder — every image shared an aspect ratio and a broadly similar
  palette, so one chain swallowed the library. `group_visual` is back to greedy seed-based
  clustering: a file joins a group only if it clears the threshold against that group's **seed**,
  never against another member. Phase 3 of the roadmap (average-linkage / HDBSCAN) is therefore
  the *first* thing worth trying if contextual grouping is ever revisited — not phases 1–2.
- **§1.2's feature vector is gone with it.** Palette (`color_grid`), aspect ratio and letterbox
  class are no longer computed, which also made grouping meaningfully faster: one decode per
  image now yields only the hash.
- **§3.4 (cache the features) is still the highest-value, lowest-risk item** and still unbuilt.
- **§3.1 (LSH/BK-tree) is not yet a real constraint.** The greedy pass is O(n²) popcounts; on
  1 100 files that is well under a second next to the decode, which dominates.

---

## 1. What the app does today

### 1.1 The pipeline

| Stage | Where | Cost |
|---|---|---|
| Walk + `FileInfo` build (EXIF `DateTimeOriginal`) | `src-tauri/src/scan.rs` | one `stat` + one EXIF parse per file |
| Decode + feature extraction, 8 threads | `grouping.rs::feature_all` | one full-resolution decode per image |
| Pairwise linking + union-find | `grouping.rs::cluster_contextual` | O(n²) comparisons, each ~100 ns |
| Volume ordering | `grouping.rs::sort_groups_by_volume` | O(g log g) |
| Date / Type grouping | `src/lib/clientGroup.ts` | O(n) in the UI, no backend call |
| Sort + bucket filter + group view | `src/lib/sort.ts`, `buckets.ts`, `groupView.ts` | pure, per-render, memoized |

### 1.2 The feature vector

`grouping.rs::Feature` currently carries four signals per image, all derived from a **single**
decode:

| Signal | Bits | What it captures | Blind to |
|---|---|---|---|
| dHash (9×8 luma gradient) or pHash (32×32 DCT) | 64 | near-duplicates, burst frames | crops, different scenes |
| 4×4 mean-RGB grid (`color_grid`) | 384 | overall palette | composition, subject |
| Aspect ratio ×100 | 16 | source geometry | anything else |
| Letterbox class in eighths (`letterbox_class`) | 8 | cinematic bars | non-letterboxed sources |
| Capture time (EXIF, else mtime) | 64 | sessions, sittings | files copied without metadata |

Two images link when `similarity(hash) ≥ threshold` **or** when the geometry gate passes and the
weighted score `0.55·hash + 0.30·palette + 0.15·time` clears `0.75 × threshold`, with a hard floor
of 55 on palette agreement. Links resolve through union-find, so chains merge — a bright scene and
a dark scene from one film connect through the mid-toned frames between them.

### 1.3 Where it is genuinely good

- **One decode, many features.** Decoding dominates (tens of milliseconds per photo); every extra
  descriptor computed from the already-decoded `DynamicImage` is nearly free. This is the right
  shape to extend.
- **Transitive clustering.** Single-linkage union-find is what makes cross-day grouping possible
  at all with such weak features.
- **Purity.** `cluster_contextual`, `linked`, `color_similarity`, `time_affinity` and
  `sort_groups_by_volume` are IO-free and unit-tested. Any replacement can be A/B'd against them
  without a filesystem.
- **Progress plumbing already exists** (`group-progress` events, throttled 1-in-16), so a slower,
  smarter model would not feel like a hang.

### 1.4 Where it will fail

1. **O(n²) linking.** 1 000 images ≈ 500 k comparisons (fine, ~50 ms). 20 000 images ≈ 200 M
   comparisons — seconds of pure CPU *after* the decode pass, and it grows quadratically.
2. **Single-linkage chaining.** The same property that merges a film's scenes will, on a library
   of 16:9 screenshots with muted palettes, eventually merge two different films through one
   ambiguous frame. There is no cluster-cohesion check to stop a bad link.
3. **64 bits is not a description.** dHash/pHash answer "is this the same picture?". They cannot
   answer "is this the same *show*?", which is the actual question §4 of the feature request asks.
   The palette + geometry + time gates are a proxy that works because screenshots of one source
   share encoding artefacts — it will not survive a source with high scene variety.
4. **No crop/rotation invariance.** A cropped duplicate reads as a different image.
5. **Videos are never hashed** — they land in the "no visual match" group wholesale.
6. **No persistence.** Every re-group re-decodes the entire library. Features are thrown away.

---

## 2. Selection criteria for anything new

MediaSort is a 13 MB offline Windows executable with a 2.9 MB installer, built with **no C
toolchain** (that constraint is why HEIC decoding goes through WIC bindings rather than libheif).
Any model recommendation has to respect:

1. **Pure Rust, or a prebuilt native library with no build-time compiler.**
2. **CPU-only.** No GPU may be assumed; a discrete GPU is a bonus path, never the requirement.
3. **Offline.** The app never phones home. Weights ship in the bundle or are fetched once, on an
   explicit user action, with a checksum.
4. **Bounded memory.** The app already runs 8 concurrent full-resolution decodes; an embedding
   model must not multiply that.
5. **Installer discipline.** A 350 MB model in a 2.9 MB installer is a non-starter; anything over
   ~30 MB should be an opt-in download.

---

## 3. Tier 0 — better classical signals (no new dependencies, days of work)

These are worth doing **first**: they are cheap, they compose with the existing `Feature`, and
they raise the floor before any model is introduced.

### 3.1 Scale the linking with LSH banding or a BK-tree

Replace the O(n²) scan for the *hash-only* link with a candidate-generation step:

- **LSH banding.** Split each 64-bit hash into four 16-bit bands, index each band in a
  `HashMap<u16, Vec<usize>>`. Two images sharing any band are candidates. At a similarity
  threshold of 80 % (≤ 12 differing bits), the pigeonhole principle guarantees at least one band
  differs by ≤ 3 bits, so widening each band lookup to its 3-bit neighbourhood keeps recall high.
- **BK-tree.** A metric tree over Hamming distance answers "everything within *d* of this hash"
  in roughly O(log n) for small *d*. ~120 lines, or the `bk-tree` crate.

The contextual link still needs its geometry gate, but that gate is already the cheap early-out —
bucket by `(aspect, bars)` first and the quadratic term collapses to within-bucket comparisons.

> Expected: 20 000 images from seconds of linking to well under a second *(estimate)*.

### 3.2 Add descriptors that survive crops and re-encodes

| Descriptor | Lines | Adds |
|---|---|---|
| **Tiled hashes** — dHash of each of 9 tiles, plus the whole frame | ~40 | crop tolerance: a crop still matches on 4–6 tiles |
| **Wavelet hash (Haar)** | ~60 | more robust than dHash to blur and re-compression |
| **Block-mean hash** | ~30 | trivially cheap third opinion for an ensemble vote |
| **HSV / OKLab histogram (e.g. 8×4×4 bins)** | ~50 | far better palette matching than 16 mean-RGB samples; compare with χ² or intersection |
| **Edge-orientation histogram (Sobel, 8 bins)** | ~60 | composition and line structure — separates "dark room" from "night sky" |

OKLab in particular is worth the swap: `color_similarity` currently averages absolute RGB channel
differences, which is not perceptually uniform. Two palettes a human calls "the same teal" can
score badly, and two a human calls different can score well.

### 3.3 Detect the subtitle band

For anime and film screenshots the strongest cheap signal available is the **subtitle strip**:
a horizontal band in the lower third with high local contrast and a stable vertical position.
Encode `(band_present, band_top_eighth, band_height_eighth)` — 8 bits — and treat a *matching*
band geometry as a strong same-source vote. Cost: one pass over the 16×16 luma image already
computed in `letterbox_class`.

### 3.4 Cache the features

Persist `Feature` to a sidecar keyed by the identity the app already computes —
`thumbnail.rs::thumb_cache_key` (blake3 of `normalized_path|mtime|size`). Re-grouping then costs
zero decodes for unchanged files. This is the single highest-value change in Tier 0: it turns
grouping from a two-minute operation into an instant one on the second run, and it is the
precondition for anything more expensive later.

Storage: one JSON or bincode file in `app_data`, or SQLite if a real index is ever wanted.

---

## 4. Tier 1 — visual embeddings (the real answer to "cluster by context")

A 512-dimensional CLIP-style embedding is a *semantic* description: two frames from one film sit
close together because they share setting, palette, character design and art style, even when no
pixel-level hash agrees. This is the change that makes "group screenshots of the same movie"
work by construction rather than by proxy.

### 4.1 Runtime options

| Runtime | Native deps | Notes |
|---|---|---|
| **`tract`** (Sonos) | none — pure Rust | Best fit for this project's constraints. ONNX subset; slower than ORT but no toolchain, no DLL shipping. |
| **`ort`** (ONNX Runtime bindings) | prebuilt `onnxruntime.dll` (~10–20 MB) | Considerably faster, well maintained, can auto-download the binary. Adds a DLL to the bundle. |
| **`candle`** (HuggingFace) | none — pure Rust | Has a CLIP implementation; loads safetensors directly. Good ergonomics, active development. |

Recommendation: prototype with **`candle`** or **`tract`** to keep the zero-toolchain property,
and only reach for `ort` if measured throughput is unacceptable.

### 4.2 Model options

| Model | Image-encoder size | Notes |
|---|---|---|
| **MobileCLIP-S0** | ~11 M params, ~20–45 MB int8 *(estimate)* | Designed for on-device; the best size/quality trade-off here |
| **CLIP ViT-B/32** | ~88 M params, ~90 MB int8 / ~350 MB fp32 *(estimate)* | The reference point; too large to bundle, fine as an opt-in download |
| **DINOv2-S** | ~21 M params | Self-supervised; excellent for *visual* similarity (better than CLIP for near-duplicate/instance matching), no text tower needed |
| **SigLIP-B/16** | ~90 M params | Stronger than CLIP at the same size; same size problem |

For this app's job — "same source, different scene" — **DINOv2-S is arguably the better fit than
CLIP**: there is no need for a text tower, and DINOv2 features are known to be strong at instance
and style-level retrieval. CLIP only becomes necessary if text search ("show me photos of a
beach") is ever a feature.

### 4.3 Cost

Per image, on a modern desktop CPU, at 224×224 input *(estimates)*:

| | MobileCLIP-S0 | ViT-B/32 |
|---|---|---|
| Latency, 1 thread | ~10–25 ms | ~60–150 ms |
| Latency, 8 threads (throughput) | ~2–5 ms/img | ~10–25 ms/img |
| Peak RAM | tens of MB | ~200–400 MB |

Crucially, the model input is 224×224 — the app **already resizes** each decoded image several
times in `feature_all`. Adding one more resize + a forward pass is a modest addition on top of a
decode that already costs 20–80 ms. On a 1 000-image library that is roughly +5 s of wall clock
with MobileCLIP *(estimate)*, once, with the feature cache from §3.4 making every later run free.

### 4.4 Indexing and clustering over embeddings

- **Similarity:** cosine on L2-normalised vectors.
- **Index:** HNSW (`hnsw_rs`, `instant-distance`, or `usearch`) for k-NN in ~O(log n). Below ~5 000
  images a brute-force 512-dim dot product is genuinely fine (5 000² × 512 FLOPs ≈ 1.3 GFLOP,
  well under a second with SIMD).
- **Clustering:** build a k-NN graph (k ≈ 15) and run one of:
  - **HDBSCAN** — density-based, finds clusters of varying size, labels genuine outliers instead
    of forcing them into a group. The closest match to what a photo library actually looks like.
  - **Leiden / Louvain** community detection on the k-NN graph — fast, no distance threshold to
    tune, naturally produces the "biggest community first" ordering §4 wants.
  - **Agglomerative with average linkage** — a drop-in upgrade from today's single linkage that
    fixes the chaining problem specifically.

Any of these is a strict improvement on single-linkage union-find, and all keep the existing
`FileGroup` output shape, so `applyGroups`, the sidebar and project persistence stay untouched.

### 4.5 Naming groups for free

With CLIP (text tower included) a group can be *labelled*: embed a fixed vocabulary of ~200
phrases once at build time, and name each cluster by the phrase closest to its centroid —
"Group 1 · beach", "Group 4 · anime screenshots". This turns the group list from `Group 1..N` into
something scannable, at near-zero runtime cost.

---

## 5. Tier 2 — faces

Once embeddings exist, face-based albums are the obvious next capability:

| Stage | Model | Size |
|---|---|---|
| Detection | YuNet (OpenCV Zoo) or RetinaFace-MobileNet0.25 | ~1–2 MB |
| Recognition | ArcFace / MobileFaceNet, 512-dim | ~4–25 MB |

Both run through the same ONNX runtime chosen in §4.1. Cluster the face embeddings per-identity
with HDBSCAN (cosine, threshold ≈ 0.35–0.45 for ArcFace *(estimate)*), store `person_id` alongside
`Feature`, and "Group by → People" drops straight into the existing `GroupType` enum and the
`FileGroup` shape.

**Privacy note.** Face recognition on a personal photo library is sensitive by nature. It should
be opt-in, entirely local, with a visible way to delete the face index — and it must never be
enabled by default.

---

## 6. Tier 3 — text in frames (highest signal for the actual use case)

For movie and anime screenshots, **on-screen text is close to a source fingerprint**: subtitle
font, styling, position, and the dialogue itself. Two screenshots whose subtitles are consecutive
lines of the same script are certainly the same episode.

- **Model:** PP-OCRv4 (detection ~4 MB, recognition ~10 MB) through ONNX, or the detector alone if
  only text *geometry* is wanted.
- **Cheap alternative:** run only the detector, and use the resulting text-box layout as a
  descriptor. That gets most of the same-source signal without any character recognition.
- **Bonus:** recognised text feeds a real full-text search over screenshots, which is a headline
  feature no perceptual hash can offer.

Cost: OCR is the most expensive option here (~50–200 ms/image *(estimate)*), so it belongs behind
an explicit "deep scan" action, not the default grouping path.

---

## 7. Video

Videos are currently unhashable and land in the leftovers group. The honest options:

1. **Metadata-only** (today): duration/resolution/mtime. Cheap, weak.
2. **First-frame / keyframe hashing.** Requires a demuxer. Pure-Rust MP4/H.264 decoding is not
   realistically available; on Windows, **Media Foundation** could extract a frame the same way
   `wic.rs` uses WIC for HEIC — consistent with the existing architecture and needing no C
   toolchain.
3. **Bundle ffmpeg.** Rejected: it would dwarf the installer and complicate licensing.

Recommendation: a `mediafoundation.rs` sibling to `wic.rs` that pulls one frame at 10 % duration.
Videos then flow through the *entire* existing pipeline — hash, palette, letterbox, embedding —
with no changes to the clustering code at all.

---

## 8. Suggested roadmap

| Phase | Work | Payoff | Risk |
|---|---|---|---|
| **1** | Feature cache (§3.4) + LSH/BK-tree candidate generation (§3.1) | Re-grouping becomes instant; scales to 50 k files | Very low — pure refactor, existing tests apply |
| **2** | OKLab histogram, tiled hashes, subtitle-band descriptor (§3.2–3.3) | Better crop tolerance and materially better same-source detection | Low — extends `Feature`, thresholds need re-tuning |
| **3** | Average-linkage or HDBSCAN in place of union-find (§4.4) | Kills the chaining failure mode | Low — `cluster_contextual` is already pure and swappable |
| **4** | DINOv2-S or MobileCLIP embeddings via `candle`/`tract` (§4) | The actual semantic grouping the feature request describes | Medium — model distribution, bundle size, first real ML dependency |
| **5** | Faces (§5), then OCR / text search (§6) | New capabilities, not just better grouping | Medium — privacy design, model size |
| **6** | Media Foundation keyframes (§7) | Videos stop being second-class | Medium — new Windows API surface |

Phases 1–3 need no new dependencies and no model files. They are where the next work should go.

---

## 9. How to validate any of this

The repo's testing style — pure functions, `#[cfg(test)]` beside the code — extends naturally:

1. **Build a labelled fixture set.** A few hundred images with a ground-truth `source_id`
   (two films, one anime, one holiday, one burst sequence, plus distractors).
2. **Score with precision / recall / adjusted Rand index** against that labelling, not by eye.
3. **Keep the current algorithm as the baseline** — `cluster_contextual` is pure, so a comparison
   harness is a test, not a branch.
4. **Guard the cost**, not just the quality: assert wall-clock and peak RSS on the fixture set, so
   a smarter model that is 50× slower gets caught before it ships.

Without step 1 every threshold in this system stays a guess, including the ones shipped today.
