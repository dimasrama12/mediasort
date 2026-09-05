//! Project (session) persistence: one JSON file per project under `app_data/projects/`.
//! Pure `*_in` helpers take an explicit dir so tests touch only a tempdir; commands resolve
//! the real dir. A project snapshots the session (roots + files + folders + groups), not the
//! global settings (those live in settings.json).

use crate::model::{FileGroup, FileInfo, FolderInfo};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub saved_at: i64,
    pub roots: Vec<String>,
    pub files: Vec<FileInfo>,
    pub folders: Vec<FolderInfo>,
    pub groups: Vec<FileGroup>,
}

/// Lightweight listing entry — avoids loading every file just to render the list.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub saved_at: i64,
    pub file_count: u32,
}

/// Filename-safe form of an id (prevents path traversal): keep alnum / `-` / `_`, else `_`.
fn sanitize(id: &str) -> String {
    id.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}

fn file_for(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{}.json", sanitize(id)))
}

pub fn save_project_in(dir: &Path, project: &Project) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(project).map_err(|e| e.to_string())?;
    std::fs::write(file_for(dir, &project.id), json).map_err(|e| e.to_string())
}

pub fn load_project_in(dir: &Path, id: &str) -> Result<Project, String> {
    let s = std::fs::read_to_string(file_for(dir, id)).map_err(|e| e.to_string())?;
    serde_json::from_str(&s).map_err(|e| e.to_string())
}

pub fn delete_project_in(dir: &Path, id: &str) -> Result<(), String> {
    let path = file_for(dir, id);
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Summaries of every readable `*.json` under `dir`, newest first. Unreadable files are skipped.
pub fn list_projects_in(dir: &Path) -> Vec<ProjectSummary> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for entry in rd.flatten() {
            if entry.path().extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            if let Ok(s) = std::fs::read_to_string(entry.path()) {
                if let Ok(p) = serde_json::from_str::<Project>(&s) {
                    out.push(ProjectSummary {
                        id: p.id,
                        name: p.name,
                        saved_at: p.saved_at,
                        file_count: p.files.len() as u32,
                    });
                }
            }
        }
    }
    out.sort_by(|a, b| b.saved_at.cmp(&a.saved_at));
    out
}

pub struct ProjectState(pub Mutex<PathBuf>);
impl ProjectState {
    pub fn new(dir: PathBuf) -> Self {
        Self(Mutex::new(dir))
    }
}

fn dir_of(state: &State<'_, ProjectState>) -> Result<PathBuf, String> {
    Ok(state.0.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
pub fn save_project(state: State<'_, ProjectState>, project: Project) -> Result<(), String> {
    save_project_in(&dir_of(&state)?, &project)
}

#[tauri::command]
pub fn load_project(
    state: State<'_, ProjectState>,
    scope: State<'_, crate::guard::AccessScope>,
    id: String,
) -> Result<Project, String> {
    let project = load_project_in(&dir_of(&state)?, &id)?;
    // Loading a project restores a whole session without a scan, so it has to restore the
    // session's write scope too, or every move in it would be refused (see guard.rs).
    scope.allow_all(&project.roots);
    scope.allow_all(project.folders.iter().map(|f| &f.path));
    Ok(project)
}

#[tauri::command]
pub fn list_projects(state: State<'_, ProjectState>) -> Result<Vec<ProjectSummary>, String> {
    Ok(list_projects_in(&dir_of(&state)?))
}

#[tauri::command]
pub fn delete_project(state: State<'_, ProjectState>, id: String) -> Result<(), String> {
    delete_project_in(&dir_of(&state)?, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::FileType;

    fn mk_file(id: &str) -> FileInfo {
        FileInfo {
            id: id.into(),
            path: format!("C:/x/{id}.jpg"),
            name: format!("{id}.jpg"),
            extension: "jpg".into(),
            size: 1,
            modified_at: 0,
            date_taken: None,
            file_type: FileType::Image,
            group_id: None,
        }
    }

    fn mk_project(id: &str, name: &str, files: usize, saved_at: i64) -> Project {
        Project {
            id: id.into(),
            name: name.into(),
            saved_at,
            roots: vec!["C:/x".into()],
            files: (0..files).map(|i| mk_file(&format!("f{i}"))).collect(),
            folders: vec![],
            groups: vec![],
        }
    }

    #[test]
    fn save_then_load_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        let p = mk_project("p1", "Trip", 3, 100);
        save_project_in(dir.path(), &p).unwrap();
        let back = load_project_in(dir.path(), "p1").unwrap();
        assert_eq!(back.name, "Trip");
        assert_eq!(back.files.len(), 3);
        assert_eq!(back.roots, vec!["C:/x".to_string()]);
    }

    #[test]
    fn list_returns_summaries_newest_first() {
        let dir = tempfile::tempdir().unwrap();
        save_project_in(dir.path(), &mk_project("a", "Older", 2, 100)).unwrap();
        save_project_in(dir.path(), &mk_project("b", "Newer", 5, 200)).unwrap();
        let list = list_projects_in(dir.path());
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, "b"); // newest first
        assert_eq!(list[0].file_count, 5);
        assert_eq!(list[1].name, "Older");
    }

    #[test]
    fn delete_removes_the_file() {
        let dir = tempfile::tempdir().unwrap();
        save_project_in(dir.path(), &mk_project("gone", "X", 1, 1)).unwrap();
        delete_project_in(dir.path(), "gone").unwrap();
        assert!(load_project_in(dir.path(), "gone").is_err());
        assert!(list_projects_in(dir.path()).is_empty());
    }

    #[test]
    fn load_missing_errors() {
        let dir = tempfile::tempdir().unwrap();
        assert!(load_project_in(dir.path(), "nope").is_err());
    }

    #[test]
    fn id_is_sanitized_against_traversal() {
        let dir = tempfile::tempdir().unwrap();
        let p = mk_project("../../evil", "Evil", 1, 1);
        save_project_in(dir.path(), &p).unwrap();
        // File lands inside dir (sanitized name), not outside it.
        let escaped = dir.path().parent().unwrap().join("evil.json");
        assert!(!escaped.exists());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
