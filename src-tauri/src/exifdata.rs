//! EXIF metadata extraction for the viewer (§6).
//!
//! `scan.rs` already reads one EXIF tag (`DateTimeOriginal`) to sharpen temporal grouping; this
//! module reads the *whole* container and hands it to the UI as a flat, display-ready list.
//!
//! Everything here treats the file as hostile input. EXIF is attacker-controlled data that
//! arrives with the photo, so every value is passed through `sanitize`: control characters are
//! dropped (a stray escape sequence has no business in a table cell), the string is capped, and
//! the number of entries is capped too — a crafted file with thousands of maker-note fields
//! can't be used to wedge the renderer.

use serde::Serialize;
use std::path::Path;

/// Longest value string handed to the UI. Real tags are a few dozen characters; a maker note
/// can be tens of kilobytes of binary, which is neither readable nor worth shipping over IPC.
const MAX_VALUE_LEN: usize = 512;
/// Most entries returned for one file. Well past any real camera's tag count.
const MAX_ENTRIES: usize = 400;

/// One EXIF field, already rendered for display.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExifEntry {
    /// Human tag name, e.g. `"DateTimeOriginal"`.
    pub tag: String,
    /// Which image file directory it came from: `"Primary"`, `"Thumbnail"`, `"Other"`.
    pub ifd: String,
    /// The value with its unit, e.g. `"1/125 s"`, `"f/2.8"`, `"2021-01-01 12:00:00"`.
    pub value: String,
}

/// Everything the EXIF viewer shows: the file's own facts plus whatever EXIF it carries.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExifData {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified_at: i64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// False when the file carries no readable EXIF at all (most PNG/WebP screenshots) — the UI
    /// says so plainly instead of showing an empty table that looks like a failure.
    pub has_exif: bool,
    pub entries: Vec<ExifEntry>,
}

/// Strip control characters, collapse whitespace runs, and cap the length. Anything the file
/// supplies goes through here before it reaches the UI.
fn sanitize(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len().min(MAX_VALUE_LEN));
    let mut count = 0usize;
    let mut last_space = false;
    for ch in raw.chars() {
        let c = if ch.is_control() { ' ' } else { ch };
        if c == ' ' {
            if last_space || out.is_empty() {
                continue;
            }
            last_space = true;
        } else {
            last_space = false;
        }
        if count >= MAX_VALUE_LEN {
            out.push('…');
            break;
        }
        out.push(c);
        count += 1;
    }
    while out.ends_with(' ') {
        out.pop();
    }
    out
}

/// Drop the surrounding double quotes the EXIF crate renders around ASCII values. A table cell
/// showing `"Canon"` reads as a bug; the quoting carries no information the viewer needs.
fn unquote(v: &str) -> String {
    let t = v.trim();
    match (t.strip_prefix('"'), t.strip_suffix('"')) {
        (Some(_), Some(_)) if t.len() >= 2 => t[1..t.len() - 1].to_string(),
        _ => t.to_string(),
    }
}

/// Name of the IFD a field came from, as a short display string.
fn ifd_name(ifd: exif::In) -> &'static str {
    match ifd {
        exif::In::PRIMARY => "Primary",
        exif::In::THUMBNAIL => "Thumbnail",
        _ => "Other",
    }
}

/// Read and render every EXIF field of `path`. Returns an empty list (not an error) for a file
/// with no EXIF — "this PNG has no metadata" is an answer, not a failure.
pub fn read_exif_entries(path: &Path) -> Vec<ExifEntry> {
    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return Vec::new(),
    };
    let mut reader = std::io::BufReader::new(file);
    let exif = match exif::Reader::new().read_from_container(&mut reader) {
        Ok(e) => e,
        Err(_) => return Vec::new(),
    };
    exif.fields()
        .take(MAX_ENTRIES)
        .map(|f| ExifEntry {
            tag: sanitize(&f.tag.to_string()),
            ifd: ifd_name(f.ifd_num).to_string(),
            value: sanitize(&unquote(&f.display_value().with_unit(&exif).to_string())),
        })
        .filter(|e| !e.value.is_empty())
        .collect()
}

/// Build the full viewer payload for one file.
pub fn read_exif_data(path: &str) -> Result<ExifData, String> {
    let p = Path::new(path);
    let meta = std::fs::metadata(p).map_err(|e| format!("{path}: {e}"))?;
    if !meta.is_file() {
        return Err(format!("{path} is not a file"));
    }
    let modified_at = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    // Dimensions come from the image header, not from EXIF, so they are right even when the EXIF
    // block lies or is missing. Formats the `image` crate can't parse (HEIC) simply report none.
    let (width, height) = match image::image_dimensions(p) {
        Ok((w, h)) => (Some(w), Some(h)),
        Err(_) => (None, None),
    };
    let entries = read_exif_entries(p);
    Ok(ExifData {
        path: path.to_string(),
        name: p
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default(),
        size: meta.len(),
        modified_at,
        width,
        height,
        has_exif: !entries.is_empty(),
        entries,
    })
}

/// Read a file's EXIF metadata for the viewer (§6).
#[tauri::command]
pub async fn read_exif(path: String) -> Result<ExifData, String> {
    tauri::async_runtime::spawn_blocking(move || read_exif_data(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage};

    #[test]
    fn sanitize_drops_control_chars_and_collapses_space() {
        assert_eq!(sanitize("Canon\u{0}\u{1b}[31m EOS"), "Canon [31m EOS");
        assert_eq!(sanitize("  lots   of\tspace  "), "lots of space");
        assert_eq!(sanitize(""), "");
    }

    #[test]
    fn unquote_strips_only_a_matched_pair() {
        assert_eq!(unquote("\"Canon\""), "Canon");
        assert_eq!(unquote("Canon"), "Canon");
        assert_eq!(unquote("\"unterminated"), "\"unterminated");
        assert_eq!(unquote("\""), "\""); // a lone quote is not a pair
    }

    #[test]
    fn sanitize_caps_a_runaway_value() {
        let out = sanitize(&"a".repeat(5000));
        assert_eq!(out.chars().count(), MAX_VALUE_LEN + 1); // capped + the ellipsis
        assert!(out.ends_with('…'));
    }

    #[test]
    fn png_without_exif_reports_no_metadata_but_still_reads_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("plain.png");
        RgbImage::from_pixel(7, 3, Rgb([1, 2, 3])).save(&p).unwrap();

        let d = read_exif_data(&p.to_string_lossy()).unwrap();
        assert!(!d.has_exif, "a freshly encoded PNG carries no EXIF");
        assert!(d.entries.is_empty());
        // The file's own facts are still there — that is what the viewer falls back to.
        assert_eq!(d.name, "plain.png");
        assert_eq!(d.width, Some(7));
        assert_eq!(d.height, Some(3));
        assert!(d.size > 0);
    }

    #[test]
    fn missing_file_is_an_error_not_a_panic() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("nope.jpg");
        assert!(read_exif_data(&missing.to_string_lossy()).is_err());
    }

    #[test]
    fn a_directory_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_exif_data(&dir.path().to_string_lossy()).is_err());
    }

    #[test]
    fn reads_real_exif_out_of_a_jpeg_with_a_tiff_header() {
        // A minimal JPEG carrying an APP1/Exif segment with one ASCII tag (Make = "MediaSort").
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("tagged.jpg");
        std::fs::write(&p, jpeg_with_make_tag()).unwrap();

        let entries = read_exif_entries(&p);
        let make = entries.iter().find(|e| e.tag == "Make").expect("Make tag");
        assert_eq!(make.value, "MediaSort");
        assert_eq!(make.ifd, "Primary");
    }

    /// Hand-assembled JPEG: SOI + APP1(Exif/TIFF little-endian, one IFD0 entry: Make) + EOI.
    fn jpeg_with_make_tag() -> Vec<u8> {
        let make = b"MediaSort\0"; // 10 bytes, NUL-terminated ASCII
        let mut tiff = Vec::new();
        tiff.extend_from_slice(&[0x49, 0x49, 0x2a, 0x00]); // "II*\0" little-endian magic
        tiff.extend_from_slice(&8u32.to_le_bytes()); // offset of IFD0
        tiff.extend_from_slice(&1u16.to_le_bytes()); // one entry
        tiff.extend_from_slice(&0x010fu16.to_le_bytes()); // tag: Make
        tiff.extend_from_slice(&2u16.to_le_bytes()); // type: ASCII
        tiff.extend_from_slice(&(make.len() as u32).to_le_bytes()); // count
        tiff.extend_from_slice(&26u32.to_le_bytes()); // value offset (past this IFD)
        tiff.extend_from_slice(&0u32.to_le_bytes()); // next IFD: none
        assert_eq!(tiff.len(), 26);
        tiff.extend_from_slice(make);

        let mut app1 = Vec::new();
        app1.extend_from_slice(b"Exif\0\0");
        app1.extend_from_slice(&tiff);

        let mut jpeg = vec![0xff, 0xd8]; // SOI
        jpeg.extend_from_slice(&[0xff, 0xe1]); // APP1
        jpeg.extend_from_slice(&((app1.len() + 2) as u16).to_be_bytes());
        jpeg.extend_from_slice(&app1);
        jpeg.extend_from_slice(&[0xff, 0xd9]); // EOI
        jpeg
    }
}
