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

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GroupType {
    Visual,
    Temporal,
}

/// A cluster of related files. `file_ids` reference `FileInfo.id` (normalized path),
/// never embedded copies (§4). `similarity` is 0..100 (visual only); `time_span` is a
/// human "start – end" range (temporal only).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileGroup {
    pub id: String,
    pub name: String,
    pub file_ids: Vec<String>,
    pub similarity: f32,
    pub time_span: Option<String>,
    pub group_type: GroupType,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FolderInfo {
    pub id: String,      // = normalize_path(path) — stable, unique, the dedup key
    pub name: String,    // leaf folder name (display)
    pub path: String,    // absolute path (as created)
    pub shortcut: u8,    // 1..=9
    pub file_count: u32, // files moved into it this session
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrashItem {
    pub id: String,
    pub original_path: String,
    pub trash_path: String,
    pub name: String,
    pub size: u64,
    pub deleted_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrashStats {
    pub count: u32,
    pub total_size: u64,
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

    #[test]
    fn folderinfo_serializes_camelcase() {
        let f = FolderInfo {
            id: "d:\\a\\family".into(),
            name: "family".into(),
            path: "D:\\a\\family".into(),
            shortcut: 1,
            file_count: 3,
        };
        let j = serde_json::to_string(&f).unwrap();
        assert!(j.contains("\"fileCount\":3"));
        assert!(j.contains("\"shortcut\":1"));
    }

    #[test]
    fn filegroup_serializes_camelcase() {
        let g = FileGroup {
            id: "visual-1".into(),
            name: "Group 1".into(),
            file_ids: vec!["d:\\a\\b.jpg".into(), "d:\\a\\c.jpg".into()],
            similarity: 92.5,
            time_span: None,
            group_type: GroupType::Visual,
        };
        let j = serde_json::to_string(&g).unwrap();
        assert!(j.contains("\"fileIds\":[\"d:\\\\a\\\\b.jpg\""));
        assert!(j.contains("\"groupType\":\"visual\""));
        assert!(j.contains("\"timeSpan\":null"));
        let t = FileGroup {
            id: "temporal-1".into(),
            name: "Group 1".into(),
            file_ids: vec![],
            similarity: 0.0,
            time_span: Some("2021-01-01 00:00 – 2021-01-01 01:00".into()),
            group_type: GroupType::Temporal,
        };
        assert!(serde_json::to_string(&t).unwrap().contains("\"groupType\":\"temporal\""));
    }

    #[test]
    fn trashitem_and_stats_serialize_camelcase() {
        let it = TrashItem {
            id: "trash_1_b.jpg".into(),
            original_path: "D:\\a\\b.jpg".into(),
            trash_path: "D:\\app\\trash\\trash_1_b.jpg".into(),
            name: "b.jpg".into(),
            size: 10,
            deleted_at: 123,
        };
        let j = serde_json::to_string(&it).unwrap();
        assert!(j.contains("\"originalPath\":"));
        assert!(j.contains("\"trashPath\":"));
        assert!(j.contains("\"deletedAt\":123"));
        let s = TrashStats { count: 2, total_size: 20 };
        let js = serde_json::to_string(&s).unwrap();
        assert!(js.contains("\"totalSize\":20"));
    }
}
