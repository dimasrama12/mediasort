//! Thumbnail generation + on-disk cache (asset-protocol delivery).

use std::path::Path;

/// Decode `src`, fit it within `max_edge` (preserving aspect, never upscaling),
/// and write a JPEG to `dst`. Writes to a temp sibling then renames, so a crash
/// mid-encode never leaves a half-written cache file.
pub fn generate_thumbnail(src: &Path, dst: &Path, max_edge: u32) -> Result<(), String> {
    let img = image::open(src).map_err(|e| format!("decode {}: {e}", src.display()))?;
    let scaled = if img.width().max(img.height()) <= max_edge {
        img
    } else {
        img.resize(max_edge, max_edge, image::imageops::FilterType::Lanczos3)
    };
    let rgb = scaled.to_rgb8();

    let tmp = dst.with_extension("tmp");
    {
        let file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        let mut enc =
            image::codecs::jpeg::JpegEncoder::new_with_quality(std::io::BufWriter::new(file), 80);
        enc.encode_image(&rgb).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, dst).map_err(|e| e.to_string())?;
    Ok(())
}

/// Stable per-file cache identity. Any change to path, mtime, or size yields a
/// new key (and therefore a new cache file), so staleness is impossible.
pub fn thumb_cache_key(normalized_path: &str, mtime: i64, size: u64) -> String {
    let data = format!("{normalized_path}|{mtime}|{size}");
    blake3::hash(data.as_bytes()).to_hex().to_string()
}

/// Formats decodable by the `image` crate in this slice. heic/heif/svg/video
/// are intentionally excluded (own follow-on plans).
pub fn is_raster_supported(ext: &str) -> bool {
    matches!(
        ext.to_lowercase().as_str(),
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "tiff"
    )
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
        for e in ["jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "JPG", "PNG"] {
            assert!(is_raster_supported(e), "{e} should be supported");
        }
        for e in ["heic", "heif", "svg", "mp4", "txt", ""] {
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
}
