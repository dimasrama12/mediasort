//! Shared IPC data types (mirrored in src/lib/types.ts).

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileType {
    Image,
    Video,
}

impl FileType {
    pub fn from_extension(ext: &str) -> Option<FileType> {
        match ext.to_lowercase().as_str() {
            "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "tiff" | "heic" | "heif" | "svg" => {
                Some(FileType::Image)
            }
            "mp4" | "mkv" | "mov" | "avi" | "webm" => Some(FileType::Video),
            _ => None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub id: String,
    pub path: String,
    pub name: String,
    pub extension: String,
    pub size: u64,
    pub modified_at: i64,
    pub date_taken: Option<i64>,
    pub file_type: FileType,
    pub group_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_known_extensions() {
        assert_eq!(FileType::from_extension("jpg"), Some(FileType::Image));
        assert_eq!(FileType::from_extension("HEIC"), Some(FileType::Image));
        assert_eq!(FileType::from_extension("svg"), Some(FileType::Image));
        assert_eq!(FileType::from_extension("mp4"), Some(FileType::Video));
        assert_eq!(FileType::from_extension("txt"), None);
    }

    #[test]
    fn fileinfo_serializes_camelcase() {
        let f = FileInfo {
            id: "d:\\a\\b.jpg".into(),
            path: "D:\\a\\b.jpg".into(),
            name: "b.jpg".into(),
            extension: "jpg".into(),
            size: 10,
            modified_at: 1,
            date_taken: None,
            file_type: FileType::Image,
            group_id: None,
        };
        let j = serde_json::to_string(&f).unwrap();
        assert!(j.contains("\"modifiedAt\":1"));
        assert!(j.contains("\"fileType\":\"image\""));
    }
}
