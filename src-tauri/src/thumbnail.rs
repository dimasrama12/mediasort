//! Thumbnail generation + on-disk cache (asset-protocol delivery).

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
}
