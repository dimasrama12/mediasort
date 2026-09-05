//! Media decoding + in-place edits.
//!
//! Three jobs live here:
//!   * `read_data_url` — read a local image as a `data:` URL (Settings "Special For You" portrait).
//!   * `decode_any` — decode a still image, using the `image` crate first and falling back to
//!     Windows' WIC (see `wic.rs`) for what it can't handle, notably HEIC/HEIF.
//!   * `rotate_image` — rotate the *original file on disk* (§1: rotation is permanent, not a
//!     CSS transform), re-encoding in place through a temp file + rename.
//!
//! Self-contained base64 (no extra crate) keeps the dependency surface — and the installer — small.

use std::collections::HashSet;
use std::path::Path;
use std::sync::{Arc, Condvar, Mutex, OnceLock};

use image::DynamicImage;

/// Hard ceiling on how many pixels we will decode from one file (~80 MP: a 10 000 x 8 000 photo
/// still passes, a 60 000 x 60 000 "decompression bomb" does not). Checked from the file *header*
/// before a single pixel is allocated, so a crafted image costs a few bytes of IO, not 14 GB of RAM.
pub const MAX_PIXELS: u64 = 80_000_000;

/// Allocation ceiling handed to the `image` crate itself, as the second line of defence for
/// formats whose header we could not read up front (and for the crate's own intermediate buffers).
pub const MAX_DECODE_BYTES: u64 = 768 * 1024 * 1024;

/// Longest edge of a decoded preview handed back over IPC. A full-resolution 6000 x 4000 photo is
/// ~72 MB of RGBA, and base64 adds a third on top of the encode - all of it copied through the IPC
/// channel and held again as a JS string. 2048 px is more than any window shows.
const PREVIEW_MAX_EDGE: u32 = 2048;

/// Cap on `read_data_url`, which base64s an entire file into a JSON string.
const MAX_DATA_URL_BYTES: u64 = 24 * 1024 * 1024;

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard base64 (RFC 4648) with `=` padding.
fn base64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | (b[2] as u32);
        out.push(B64[((n >> 18) & 63) as usize] as char);
        out.push(B64[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { B64[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { B64[(n & 63) as usize] as char } else { '=' });
    }
    out
}

/// Guess an image MIME type from a file extension (defaults to `image/jpeg`).
fn mime_for(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "tiff" | "tif" => "image/tiff",
        _ => "image/jpeg",
    }
}

/// Read `path` and return it as a `data:<mime>;base64,<...>` URL. Errors if the file is missing
/// or unreadable — the caller surfaces that (e.g. "portrait not found at this path").
pub fn read_data_url(path: &str) -> Result<String, String> {
    // Size-check before reading: base64 of a 2 GB file would be a 2.7 GB JSON string.
    let len = std::fs::metadata(path)
        .map_err(|e| format!("read {path}: {e}"))?
        .len();
    if len > MAX_DATA_URL_BYTES {
        return Err(format!(
            "{path} is {} MB - too large to inline (limit {} MB)",
            len / (1024 * 1024),
            MAX_DATA_URL_BYTES / (1024 * 1024)
        ));
    }
    let bytes = std::fs::read(path).map_err(|e| format!("read {path}: {e}"))?;
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    Ok(format!("data:{};base64,{}", mime_for(ext), base64_encode(&bytes)))
}

/// `image::open` with an allocation budget attached. The crate defaults to unlimited, which is
/// what makes a malformed header able to ask for gigabytes; `Limits::max_alloc` turns that into
/// a clean error instead.
fn decode_with_limits(path: &str) -> Result<DynamicImage, String> {
    let mut reader = image::ImageReader::open(path)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(MAX_DECODE_BYTES);
    reader.limits(limits);
    reader.decode().map_err(|e| e.to_string())
}

/// Decode a still image to memory. Tries the `image` crate (fast, pure Rust) and falls back to
/// WIC on Windows, which covers HEIC/HEIF and any other format the OS has a codec for. Both
/// failures are reported so a support question ("why won't this HEIC open?") is answerable.
pub fn decode_any(path: &str) -> Result<DynamicImage, String> {
    // Header-only dimension read first (a few bytes of IO). Anything absurd is refused before
    // the decoder is asked to allocate for it. Formats the crate cannot parse fall through to
    // WIC below, where `Limits` no longer applies but the OS decoder does its own bounds work.
    if let Ok((w, h)) = image::image_dimensions(path) {
        let pixels = w as u64 * h as u64;
        if pixels > MAX_PIXELS {
            return Err(format!(
                "{path} is {w}x{h} ({} MP) - beyond the {} MP decode limit",
                pixels / 1_000_000,
                MAX_PIXELS / 1_000_000
            ));
        }
    }
    let first = match decode_with_limits(path) {
        Ok(img) => return Ok(img),
        Err(e) => e,
    };
    #[cfg(windows)]
    {
        match crate::wic::decode(path) {
            Ok(img) => return Ok(img),
            Err(second) => return Err(format!("decode {path}: {first}; WIC: {second}")),
        }
    }
    #[cfg(not(windows))]
    Err(format!("decode {path}: {first}"))
}

/// Decode `path` and hand it back as a PNG `data:` URL. This is the preview path for formats the
/// webview itself cannot render (HEIC/HEIF, TIFF): decode once in Rust, show it as a normal image.
/// PNG (not JPEG) so a preview is never visibly worse than the original.
pub fn decode_to_png_data_url(path: &str) -> Result<String, String> {
    let img = decode_any(path)?;
    // Downscale to what a window can actually show before encoding. Skipped for images that are
    // already small, so a screenshot is byte-for-byte what the file holds.
    let fitted = if img.width().max(img.height()) > PREVIEW_MAX_EDGE {
        img.resize(
            PREVIEW_MAX_EDGE,
            PREVIEW_MAX_EDGE,
            image::imageops::FilterType::CatmullRom,
        )
    } else {
        img
    };
    let mut buf = std::io::Cursor::new(Vec::<u8>::new());
    fitted
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| format!("encode png: {e}"))?;
    Ok(format!("data:image/png;base64,{}", base64_encode(&buf.into_inner())))
}

/// Formats we can write back after rotating. Deliberately narrower than what we can *read*:
/// the `image` crate is decode-only for WebP, and rewriting an animated GIF from a single frame
/// would silently destroy it — better to refuse than to damage the user's file.
pub fn is_rotatable(ext: &str) -> bool {
    matches!(
        ext.to_lowercase().as_str(),
        "jpg" | "jpeg" | "png" | "bmp" | "tiff" | "tif"
    )
}

/// Rotate the file at `path` by `degrees` (any multiple of 90; sign gives the direction) and
/// write the result back **over the original** — §1 asks for a real rotation, not a view
/// transform. Encodes to a temp sibling and renames, so an interrupted write can never leave a
/// truncated photo behind.
///
/// Note: the rewrite drops EXIF (the `image` crate does not carry metadata through a re-encode),
/// which also means no stale orientation tag can fight the pixels we just rotated.
pub fn rotate_file(path: &str, degrees: i32) -> Result<(), String> {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !is_rotatable(&ext) {
        return Err(format!(
            "rotating .{ext} in place isn't supported — only JPEG, PNG, BMP and TIFF can be re-encoded losslessly enough to overwrite"
        ));
    }
    // Normalize to one of the three meaningful turns; 0 (or 360) is a no-op, not an error.
    let turns = (((degrees / 90) % 4) + 4) % 4;
    if degrees % 90 != 0 {
        return Err("rotation must be a multiple of 90 degrees".to_string());
    }
    if turns == 0 {
        return Ok(());
    }

    let img = decode_any(path)?;
    let rotated = match turns {
        1 => img.rotate90(),
        2 => img.rotate180(),
        _ => img.rotate270(),
    };

    let tmp = Path::new(path).with_extension(format!("{ext}.rot{}.tmp", std::process::id()));
    let format = match ext.as_str() {
        "png" => image::ImageFormat::Png,
        "bmp" => image::ImageFormat::Bmp,
        "tiff" | "tif" => image::ImageFormat::Tiff,
        _ => image::ImageFormat::Jpeg,
    };
    // JPEG has no alpha; drop it rather than letting the encoder error out on an RGBA buffer
    // (WIC always hands us RGBA).
    let out = if format == image::ImageFormat::Jpeg {
        DynamicImage::ImageRgb8(rotated.to_rgb8())
    } else {
        rotated
    };
    let write = || -> Result<(), String> {
        let file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        let mut w = std::io::BufWriter::new(file);
        if format == image::ImageFormat::Jpeg {
            // Quality 92: visually lossless for a one-off re-encode, still a sane file size.
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut w, 92)
                .encode_image(&out)
                .map_err(|e| e.to_string())
        } else {
            out.write_to(&mut w, format).map_err(|e| e.to_string())
        }
    };
    if let Err(e) = write() {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("encode {path}: {e}"));
    }
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("replace {path}: {e}")
    })
}

#[tauri::command]
pub async fn read_image_data_url(path: String) -> Result<String, String> {
    read_data_url(&path)
}

/// Decode a still the webview can't display itself (HEIC/HEIF/TIFF) into a PNG data URL.
#[tauri::command]
pub async fn decode_preview(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || decode_to_png_data_url(&path))
        .await
        .map_err(|e| e.to_string())?
}

/// The rewritten file's new identity. The frontend stores these back onto its `FileInfo`, which
/// is what makes the stale thumbnail and the stale preview both refresh: every cache downstream
/// (the thumbnail cache key, the preview URL) is keyed on mtime + size.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RotateResult {
    pub modified_at: i64,
    pub size: u64,
}

/// The set of paths currently being rewritten, plus a condvar to wait on. One in-flight rotation
/// per file; everything else queues behind it rather than racing for the rename.
fn in_flight() -> &'static (Mutex<HashSet<String>>, Condvar) {
    static IN_FLIGHT: OnceLock<Arc<(Mutex<HashSet<String>>, Condvar)>> = OnceLock::new();
    IN_FLIGHT.get_or_init(|| Arc::new((Mutex::new(HashSet::new()), Condvar::new())))
}

/// RAII guard: holds the exclusive claim on one path and releases it on drop, panic included.
struct PathLock(String);

impl PathLock {
    fn acquire(path: &str) -> PathLock {
        let key = crate::paths::normalize_path(path);
        let (lock, cv) = in_flight();
        let mut set = lock.lock().unwrap_or_else(|e| e.into_inner());
        while set.contains(&key) {
            set = cv.wait(set).unwrap_or_else(|e| e.into_inner());
        }
        set.insert(key.clone());
        PathLock(key)
    }
}

impl Drop for PathLock {
    fn drop(&mut self) {
        let (lock, cv) = in_flight();
        lock.lock().unwrap_or_else(|e| e.into_inner()).remove(&self.0);
        cv.notify_all();
    }
}

/// Rotate the original file on disk, returning its new mtime + size.
#[tauri::command]
pub async fn rotate_image(
    scope: tauri::State<'_, crate::guard::AccessScope>,
    path: String,
    degrees: i32,
) -> Result<RotateResult, String> {
    scope.check(&path)?; // rewrites the user's original file in place
    let p = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Two quick `R` presses on the same photo would otherwise decode, rotate and rename over
        // each other; the loser's temp file wins the rename and one turn is silently lost.
        let _held = PathLock::acquire(&p);
        rotate_file(&p, degrees)
    })
    .await
    .map_err(|e| e.to_string())??;
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let modified_at = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    Ok(RotateResult { modified_at, size: meta.len() })
}


/// Fixtures shared between this module's tests and `wic.rs`'s.
#[cfg(test)]
pub mod tests_support {
    use std::path::Path;

    /// CRC-32 (IEEE), computed the long way - PNG chunks carry one, and a decoder that sees a bad
    /// CRC bails before it ever reads the dimensions we are trying to test.
    fn crc32(data: &[u8]) -> u32 {
        let mut crc = 0xFFFF_FFFFu32;
        for &b in data {
            crc ^= b as u32;
            for _ in 0..8 {
                crc = if crc & 1 != 0 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
            }
        }
        !crc
    }

    /// Write a structurally valid 1x1 PNG whose IHDR *declares* `w` x `h`. Nothing decodes it -
    /// that is the point: the guards under test must refuse it on the header alone.
    pub fn write_png_declaring(path: &Path, w: u32, h: u32) {
        image::RgbImage::from_pixel(1, 1, image::Rgb([0, 0, 0]))
            .save(path)
            .unwrap();
        let mut bytes = std::fs::read(path).unwrap();
        // 8-byte signature, then the IHDR chunk: 4 len, 4 type, 13 data, 4 CRC.
        bytes[16..20].copy_from_slice(&w.to_be_bytes());
        bytes[20..24].copy_from_slice(&h.to_be_bytes());
        let crc = crc32(&bytes[12..29]); // "IHDR" + the 13 data bytes
        bytes[29..33].copy_from_slice(&crc.to_be_bytes());
        std::fs::write(path, &bytes).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_known_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn data_url_has_mime_and_payload() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("pic.png");
        std::fs::write(&p, b"foobar").unwrap();
        let url = read_data_url(&p.to_string_lossy()).unwrap();
        assert_eq!(url, "data:image/png;base64,Zm9vYmFy");
    }

    #[test]
    fn missing_file_errors() {
        assert!(read_data_url("Z:/nope/missing.jpg").is_err());
    }

    #[test]
    fn rotate_ninety_swaps_dimensions_in_place() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.png");
        image::RgbImage::from_pixel(40, 10, image::Rgb([1, 2, 3]))
            .save(&p)
            .unwrap();
        rotate_file(p.to_str().unwrap(), 90).unwrap();
        let after = image::open(&p).unwrap();
        assert_eq!((after.width(), after.height()), (10, 40));
        // ...and the temp sibling is gone (renamed, not left behind).
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn rotate_left_and_right_are_inverses() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("b.png");
        let mut src = image::RgbImage::from_pixel(6, 4, image::Rgb([0, 0, 0]));
        src.put_pixel(0, 0, image::Rgb([255, 0, 0])); // an asymmetric marker
        src.save(&p).unwrap();
        let path = p.to_str().unwrap();
        rotate_file(path, 90).unwrap();
        rotate_file(path, -90).unwrap();
        let back = image::open(&p).unwrap().to_rgb8();
        assert_eq!(back.dimensions(), (6, 4));
        assert_eq!(*back.get_pixel(0, 0), image::Rgb([255, 0, 0]));
    }

    #[test]
    fn rotate_jpeg_keeps_it_a_jpeg() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("c.jpg");
        image::RgbImage::from_pixel(20, 8, image::Rgb([9, 9, 9]))
            .save(&p)
            .unwrap();
        rotate_file(p.to_str().unwrap(), 270).unwrap();
        let after = image::open(&p).unwrap();
        assert_eq!((after.width(), after.height()), (8, 20));
        assert_eq!(
            image::ImageReader::open(&p).unwrap().format(),
            Some(image::ImageFormat::Jpeg)
        );
    }

    #[test]
    fn rotate_is_a_noop_for_full_turns_and_refuses_odd_angles() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("d.png");
        image::RgbImage::from_pixel(5, 3, image::Rgb([4, 5, 6]))
            .save(&p)
            .unwrap();
        let path = p.to_str().unwrap();
        rotate_file(path, 0).unwrap();
        rotate_file(path, 360).unwrap();
        let after = image::open(&p).unwrap();
        assert_eq!((after.width(), after.height()), (5, 3));
        assert!(rotate_file(path, 45).is_err());
    }

    #[test]
    fn rotate_refuses_formats_it_cannot_re_encode() {
        assert!(is_rotatable("jpg") && is_rotatable("PNG") && is_rotatable("tiff"));
        for e in ["webp", "gif", "heic", "mp4", ""] {
            assert!(!is_rotatable(e), "{e} must not be rewritten in place");
        }
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("e.webp");
        std::fs::write(&p, b"not really a webp").unwrap();
        let before = std::fs::read(&p).unwrap();
        assert!(rotate_file(p.to_str().unwrap(), 90).is_err());
        assert_eq!(std::fs::read(&p).unwrap(), before, "the file is left untouched");
    }

    #[test]
    fn read_data_url_refuses_an_oversized_file() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("huge.bin");
        // One byte past the cap is enough; the check reads metadata, never the bytes.
        let f = std::fs::File::create(&p).unwrap();
        f.set_len(MAX_DATA_URL_BYTES + 1).unwrap();
        drop(f);
        let err = read_data_url(&p.to_string_lossy()).unwrap_err();
        assert!(err.contains("too large"), "{err}");
    }

    #[test]
    fn decode_refuses_a_declared_pixel_bomb() {
        // A PNG whose IHDR claims 60000x60000 (with a correct CRC, so every decoder believes it).
        // The header check must reject it before anything allocates for those 3.6 G pixels - and
        // that includes the WIC fallback, which is what a malformed file falls through to.
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("bomb.png");
        tests_support::write_png_declaring(&p, 60_000, 60_000);
        let err = decode_any(&p.to_string_lossy()).unwrap_err();
        assert!(err.contains("decode limit"), "{err}");
    }

    #[test]
    fn preview_downscales_a_large_image() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("big.png");
        image::RgbImage::from_pixel(PREVIEW_MAX_EDGE + 500, 64, image::Rgb([1, 2, 3]))
            .save(&p)
            .unwrap();
        let url = decode_to_png_data_url(p.to_str().unwrap()).unwrap();
        let raw = url.strip_prefix("data:image/png;base64,").unwrap();
        // Decode the payload back and check the longest edge was fitted, not the original width.
        let png = base64_decode(raw).unwrap();
        let back = image::load_from_memory(&png).unwrap();
        assert_eq!(back.width(), PREVIEW_MAX_EDGE);
    }

    /// Minimal base64 decoder, test-only — the production path only ever encodes.
    fn base64_decode(s: &str) -> Option<Vec<u8>> {
        let idx = |c: u8| B64.iter().position(|&b| b == c);
        let mut out = Vec::with_capacity(s.len() / 4 * 3);
        let bytes: Vec<u8> = s.bytes().filter(|b| *b != b'\n').collect();
        for chunk in bytes.chunks(4) {
            let mut n = 0u32;
            let mut keep = 3;
            for (i, &c) in chunk.iter().enumerate() {
                if c == b'=' {
                    keep -= 1;
                    continue;
                }
                n |= (idx(c)? as u32) << (18 - 6 * i);
            }
            out.push((n >> 16) as u8);
            if keep > 1 {
                out.push((n >> 8) as u8);
            }
            if keep > 2 {
                out.push(n as u8);
            }
        }
        Some(out)
    }

    #[test]
    fn decode_to_png_data_url_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("f.png");
        image::RgbImage::from_pixel(3, 2, image::Rgb([7, 8, 9]))
            .save(&p)
            .unwrap();
        let url = decode_to_png_data_url(p.to_str().unwrap()).unwrap();
        assert!(url.starts_with("data:image/png;base64,"));
        assert!(url.len() > 30);
    }
}
