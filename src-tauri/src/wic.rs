//! Windows Imaging Component (WIC) decode fallback.
//!
//! The `image` crate cannot decode HEIC/HEIF (HEVC-coded stills, what every modern iPhone
//! writes). Windows can, through WIC, provided the system has the matching image extension
//! installed — which Windows 11 ships for HEIF by default. Going through WIC keeps this
//! dependency-light: the `windows` crate is pure Rust bindings, no C toolchain, no libheif.
//!
//! Everything here is best-effort: any failure returns `Err` and the caller falls back to the
//! "open in your default app" card, so a machine without the codec still behaves sensibly.

#![cfg(windows)]

use image::{DynamicImage, RgbaImage};

/// Decode any image WIC understands (HEIC/HEIF, JPEG-XR, camera RAW where a codec is installed,
/// plus every format the `image` crate already handles) into an in-memory RGBA image.
pub fn decode(path: &str) -> Result<DynamicImage, String> {
    use windows::core::HSTRING;
    use windows::Win32::Foundation::GENERIC_READ;
    use windows::Win32::Graphics::Imaging::{
        CLSID_WICImagingFactory, GUID_WICPixelFormat32bppRGBA, IWICImagingFactory,
        WICBitmapDitherTypeNone, WICBitmapPaletteTypeCustom, WICDecodeMetadataCacheOnDemand,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
    };

    unsafe {
        // Ignore the HRESULT: S_FALSE ("already initialized on this thread") is normal here,
        // and a genuine failure surfaces on the very next call anyway.
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let factory: IWICImagingFactory =
            CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)
                .map_err(|e| format!("WIC factory: {e}"))?;

        let decoder = factory
            .CreateDecoderFromFilename(
                &HSTRING::from(path),
                None,
                GENERIC_READ,
                WICDecodeMetadataCacheOnDemand,
            )
            .map_err(|e| format!("WIC decode {path}: {e}"))?;

        let frame = decoder
            .GetFrame(0)
            .map_err(|e| format!("WIC frame: {e}"))?;

        // Normalize whatever the codec produced (10-bit YCbCr for HEIC, CMYK for some TIFFs)
        // to straight 8-bit RGBA so the rest of the pipeline is format-agnostic.
        let converter = factory
            .CreateFormatConverter()
            .map_err(|e| format!("WIC converter: {e}"))?;
        converter
            .Initialize(
                &frame,
                &GUID_WICPixelFormat32bppRGBA,
                WICBitmapDitherTypeNone,
                None,
                0.0,
                WICBitmapPaletteTypeCustom,
            )
            .map_err(|e| format!("WIC convert: {e}"))?;

        let (mut w, mut h) = (0u32, 0u32);
        converter
            .GetSize(&mut w, &mut h)
            .map_err(|e| format!("WIC size: {e}"))?;
        if w == 0 || h == 0 {
            return Err("WIC returned an empty image".to_string());
        }
        // The same pixel budget the `image` path enforces (media::MAX_PIXELS). Without it this
        // was the way around that check: a file the Rust decoder rejects (bad CRC, unknown
        // format) falls through to here, and `vec![0u8; w*h*4]` on a header claiming 60000x60000
        // is a 14.4 GB allocation that takes the process down before WIC ever reads a pixel.
        let pixels = w as u64 * h as u64;
        if pixels > crate::media::MAX_PIXELS {
            return Err(format!(
                "WIC: {w}x{h} ({} MP) is beyond the {} MP decode limit",
                pixels / 1_000_000,
                crate::media::MAX_PIXELS / 1_000_000
            ));
        }
        // The same pixel budget the `image` path enforces (media::MAX_PIXELS). Without it this
        // was the way around that check: a file the Rust decoder rejects (bad CRC, unknown
        // format) falls through to here, and `vec![0u8; w*h*4]` on a header claiming 60000x60000
        // is a 14.4 GB allocation that takes the process down before WIC ever reads a pixel.
        let pixels = w as u64 * h as u64;
        if pixels > crate::media::MAX_PIXELS {
            return Err(format!(
                "WIC: {w}x{h} ({} MP) is beyond the {} MP decode limit",
                pixels / 1_000_000,
                crate::media::MAX_PIXELS / 1_000_000
            ));
        }
        let stride = w
            .checked_mul(4)
            .ok_or_else(|| "image too wide".to_string())?;
        let len = (stride as usize)
            .checked_mul(h as usize)
            .ok_or_else(|| "image too large".to_string())?;

        let mut buf = vec![0u8; len];
        converter
            .CopyPixels(std::ptr::null(), stride, &mut buf)
            .map_err(|e| format!("WIC copy: {e}"))?;

        let rgba = RgbaImage::from_raw(w, h, buf)
            .ok_or_else(|| "WIC buffer did not match its reported size".to_string())?;
        Ok(DynamicImage::ImageRgba8(rgba))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_errors_rather_than_panicking() {
        assert!(decode("Z:/nope/missing.heic").is_err());
    }

    #[test]
    fn refuses_an_oversized_frame() {
        // Built the same way `media`'s bomb test is: a valid PNG header declaring a huge canvas.
        // WIC parses the header happily, so the ceiling here is the only thing between us and a
        // multi-gigabyte allocation.
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("bomb.png");
        crate::media::tests_support::write_png_declaring(&p, 60_000, 60_000);
        let err = decode(p.to_str().unwrap()).unwrap_err();
        assert!(err.contains("decode limit") || err.contains("WIC"), "{err}");
    }

    #[test]
    fn decodes_a_png_through_wic() {
        // WIC ships PNG support on every Windows, so this exercises the whole COM path
        // (factory → decoder → converter → pixels) without needing a HEIC sample on disk.
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("a.png");
        image::RgbImage::from_pixel(7, 5, image::Rgb([200, 100, 50]))
            .save(&p)
            .unwrap();
        let img = decode(p.to_str().unwrap()).unwrap();
        assert_eq!((img.width(), img.height()), (7, 5));
    }
}
