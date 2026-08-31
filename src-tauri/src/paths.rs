//! Path normalization and app-data / cache directories.

/// Normalize a filesystem path into a stable identity key on Windows:
/// forward slashes become backslashes, duplicate/trailing separators are
/// collapsed, and everything is lowercased (the Windows filesystem is
/// case-insensitive). This single key underpins folder identity and cache
/// keys — the structural reason the v1 folder-duplication bug can't recur.
pub fn normalize_path(p: &str) -> String {
    p.replace('/', "\\")
        .split('\\')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_lowercase())
        .collect::<Vec<_>>()
        .join("\\")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lowercases_drive_and_normalizes_separators() {
        assert_eq!(normalize_path(r"C:/Users/Me/Pics"), r"c:\users\me\pics");
    }

    #[test]
    fn strips_trailing_separator() {
        assert_eq!(normalize_path(r"D:\Photos\"), r"d:\photos");
    }

    #[test]
    fn collapses_mixed_and_duplicate_separators() {
        assert_eq!(normalize_path(r"D:\a//b\\c"), r"d:\a\b\c");
    }

    #[test]
    fn same_folder_two_spellings_one_key() {
        assert_eq!(normalize_path(r"C:\A\B"), normalize_path(r"c:/a/b/"));
    }
}
