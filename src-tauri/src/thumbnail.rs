//! Thumbnail generation + on-disk cache (asset-protocol delivery).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::State;
use tokio::sync::Semaphore;

static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Decode `src`, fit it within `max_edge` (preserving aspect, never upscaling),
/// and write a JPEG to `dst`. Writes to a temp sibling then renames, so a crash
/// mid-encode never leaves a half-written cache file.
pub fn generate_thumbnail(src: &Path, dst: &Path, max_edge: u32) -> Result<(), String> {
    // decode_any, not image::open: it adds the WIC fallback, which is what makes HEIC/HEIF
    // photos show a real thumbnail instead of a blank placeholder tile.
    let img = crate::media::decode_any(&src.to_string_lossy())?;
    let scaled = if img.width().max(img.height()) <= max_edge {
        img
    } else {
        img.resize(max_edge, max_edge, image::imageops::FilterType::Lanczos3)
    };
    let rgb = scaled.to_rgb8();

    let tmp = dst.with_extension(format!(
        "{}.{}.tmp",
        std::process::id(),
        TMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    {
        let file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        let mut enc =
            image::codecs::jpeg::JpegEncoder::new_with_quality(std::io::BufWriter::new(file), 80);
        enc.encode_image(&rgb).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, dst).map_err(|e| e.to_string())?;
    Ok(())
}

/// Return the cache path for `path`'s thumbnail, generating it if absent.
/// Rejects non-raster inputs (the frontend already gates, this is defense).
pub fn ensure_thumbnail_sync(cache_dir: &Path, path: &str) -> Result<PathBuf, String> {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    if !is_raster_supported(ext) {
        return Err(format!("unsupported thumbnail type: {ext}"));
    }
    let norm = crate::paths::normalize_path(path);
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let key = thumb_cache_key(&norm, mtime, meta.len());
    let dst = cache_dir.join(format!("{key}.jpg"));
    if dst.exists() {
        return Ok(dst);
    }
    generate_thumbnail(Path::new(path), &dst, 512)?;
    Ok(dst)
}

/// Stable per-file cache identity. Any change to path, mtime, or size yields a
/// new key (and therefore a new cache file), so staleness is impossible.
pub fn thumb_cache_key(normalized_path: &str, mtime: i64, size: u64) -> String {
    let data = format!("{normalized_path}|{mtime}|{size}");
    blake3::hash(data.as_bytes()).to_hex().to_string()
}

/// Formats we can turn into a thumbnail: everything the `image` crate decodes, plus heic/heif
/// via the WIC fallback in `media::decode_any`. svg and video remain excluded (vector rendering
/// and frame extraction are separate problems).
pub fn is_raster_supported(ext: &str) -> bool {
    matches!(
        ext.to_lowercase().as_str(),
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "tiff" | "tif" | "heic" | "heif"
    )
}

/// Managed state: resolved cache dir + a small permit pool that bounds how many
/// CPU-bound generations run at once (keeps the app responsive under fast scroll).
pub struct ThumbState {
    pub cache_dir: PathBuf,
    pub(crate) sem: Semaphore,
}

impl ThumbState {
    pub fn new(cache_dir: PathBuf) -> Self {
        Self { cache_dir, sem: Semaphore::new(4) }
    }
}

#[tauri::command]
pub async fn ensure_thumbnail(
    state: State<'_, ThumbState>,
    path: String,
) -> Result<String, String> {
    let _permit = state.sem.acquire().await.map_err(|e| e.to_string())?;
    let cache_dir = state.cache_dir.clone();
    let dst = tauri::async_runtime::spawn_blocking(move || ensure_thumbnail_sync(&cache_dir, &path))
        .await
        .map_err(|e| e.to_string())??;
    Ok(dst.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn clear_thumbnail_cache(state: State<'_, ThumbState>) -> Result<(), String> {
    let dir = state.cache_dir.clone();
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_is_stable_and_change_sensitive() {
        let base = thumb_cache_key(r"d:\a\b.jpg", 100, 2048);
        assert_eq!(base, thumb_cache_key(r"d:\a\b.jpg", 100, 2048));
        assert_ne!(base, thumb_cache_key(r"d:\a\b.jpg", 101, 2048)); // mtime
        assert_ne!(base, thumb_cache_key(r"d:\a\b.jpg", 100, 4096)); // size
        assert_ne!(base, thumb_cache_key(r"d:\a\c.jpg", 100, 2048)); // path
    }

    #[test]
    fn raster_gate_matches_supported_only() {
        for e in ["jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "heic", "heif", "JPG", "HEIC"] {
            assert!(is_raster_supported(e), "{e} should be supported");
        }
        for e in ["svg", "mp4", "mkv", "txt", ""] {
            assert!(!is_raster_supported(e), "{e} should not be supported");
        }
    }

    #[test]
    fn downscales_large_preserving_aspect() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("big.png");
        image::RgbImage::from_pixel(1000, 500, image::Rgb([10, 20, 30]))
            .save(&src)
            .unwrap();
        let dst = dir.path().join("t.jpg");
        generate_thumbnail(&src, &dst, 512).unwrap();
        let t = image::open(&dst).unwrap();
        assert_eq!((t.width(), t.height()), (512, 256)); // 2:1 preserved
    }

    #[test]
    fn does_not_upscale_small_images() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("small.png");
        image::RgbImage::from_pixel(100, 80, image::Rgb([1, 2, 3]))
            .save(&src)
            .unwrap();
        let dst = dir.path().join("t.jpg");
        generate_thumbnail(&src, &dst, 512).unwrap();
        let t = image::open(&dst).unwrap();
        assert_eq!((t.width(), t.height()), (100, 80));
    }

    #[test]
    fn generates_then_hits_cache() {
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("cache");
        std::fs::create_dir(&cache).unwrap();
        let src = dir.path().join("a.png");
        image::RgbImage::from_pixel(640, 480, image::Rgb([9, 9, 9]))
            .save(&src)
            .unwrap();

        let p1 = ensure_thumbnail_sync(&cache, src.to_str().unwrap()).unwrap();
        assert!(p1.exists());
        let t = image::open(&p1).unwrap();
        assert!(t.width().max(t.height()) <= 512);

        let p2 = ensure_thumbnail_sync(&cache, src.to_str().unwrap()).unwrap();
        assert_eq!(p1, p2);
        assert_eq!(std::fs::read_dir(&cache).unwrap().count(), 1); // cache hit, no dup
    }

    #[test]
    fn rejects_unsupported_and_missing() {
        let dir = tempfile::tempdir().unwrap();
        let txt = dir.path().join("note.txt");
        std::fs::write(&txt, b"x").unwrap();
        assert!(ensure_thumbnail_sync(dir.path(), txt.to_str().unwrap()).is_err());
        assert!(ensure_thumbnail_sync(dir.path(), dir.path().join("gone.png").to_str().unwrap()).is_err());
    }
}
