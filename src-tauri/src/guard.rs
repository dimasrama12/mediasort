//! Session path allowlist for the commands that **change** files.
//!
//! ## Why
//!
//! Every file-mutating command took an absolute path straight from the webview and acted on it:
//! `move_files` could move anything anywhere, `delete_files_permanently` could unlink any file,
//! `batch_rename`/`rename_files` could rename anything, `trash_files` could pull any file into
//! app data, and `rotate_image` could rewrite any image in place. Under a renderer compromise
//! (script running in the webview — the realistic threat for a local app with no server) that is
//! an arbitrary file-mutation primitive over the whole disk, reachable from one `invoke`.
//!
//! The app already knows exactly which paths are legitimate, because it is the thing that listed
//! them: the scanned roots, the registered target folders, the folders the user has browsed, and
//! its own app-data directory. This records that set as it is learned and refuses everything else.
//!
//! ## Deliberate limits
//!
//! * **Mutations only.** Read-only commands (thumbnails, EXIF, preview decode) are not gated
//!   here. A read primitive is a far smaller blast radius than an unlink primitive, and gating
//!   them risks a blank thumbnail on a path nobody remembered to grant — a visible regression
//!   traded for a marginal gain. They are bounded instead by the pixel and byte caps in
//!   `media.rs`.
//! * **Additive for the session.** Scanning a second root does not revoke the first: undo still
//!   has to be able to move a file back where it came from an hour later.
//! * **Empty means open.** Before anything has been scanned or loaded there is no session
//!   context to enforce, and nothing has been listed for the UI to act on either.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// The canonicalised directories this session is allowed to modify inside.
///
/// Two lists, deliberately:
///
/// * `0` — the **session roots**: scanned libraries, registered target folders, browsed folders.
///   These are what the user has pointed the app at, and they are what decides whether there is
///   a session context to enforce at all.
/// * `1` — **internal** grants: the app's own data directory (trash, thumbnail cache). Always
///   permitted, but never counted as session context.
///
/// Keeping them apart is what makes "empty means open" mean what it says. The app-data grant is
/// made in `setup()`, before the user has done anything; folding it into the session roots turned
/// enforcement on at launch, so the first move of a session that had not scanned anything yet
/// (a restored project) was refused as "outside this session's folders" — and refused silently,
/// because the caller discards the error.
#[derive(Default)]
pub struct AccessScope(pub Mutex<Vec<PathBuf>>, pub Mutex<Vec<PathBuf>>);

/// Canonicalise `p` if it exists; otherwise canonicalise the nearest existing ancestor and
/// re-attach the rest. A move's *destination* usually does not exist yet, so plain
/// `canonicalize` would reject exactly the paths this most needs to judge.
fn resolve(p: &Path) -> Option<PathBuf> {
    if let Ok(c) = p.canonicalize() {
        return Some(c);
    }
    let mut tail: Vec<&std::ffi::OsStr> = Vec::new();
    let mut cur = p;
    while let Some(parent) = cur.parent() {
        tail.push(cur.file_name()?);
        if let Ok(c) = parent.canonicalize() {
            let mut out = c;
            for part in tail.iter().rev() {
                out.push(part);
            }
            return Some(out);
        }
        cur = parent;
    }
    None
}

/// Lock a list, recovering from a poisoned mutex — a panic in one command must not turn every
/// later permission check into a panic of its own.
fn lock(m: &Mutex<Vec<PathBuf>>) -> std::sync::MutexGuard<'_, Vec<PathBuf>> {
    match m.lock() {
        Ok(g) => g,
        Err(e) => e.into_inner(),
    }
}

/// Resolve `path` and append it to `list` if it is not already there. Best-effort: a path that
/// cannot be resolved is simply not granted.
fn push_unique(m: &Mutex<Vec<PathBuf>>, path: &Path) {
    let Some(canon) = resolve(path) else {
        return;
    };
    let mut list = lock(m);
    if !list.iter().any(|r| *r == canon) {
        list.push(canon);
    }
}

impl AccessScope {
    /// Record `path` (and therefore everything under it) as somewhere this session may work.
    /// Best-effort: a path that cannot be resolved is simply not granted.
    pub fn allow(&self, path: impl AsRef<Path>) {
        push_unique(&self.0, path.as_ref());
    }

    /// Record `path` as permanently writable **without** treating it as session context: the
    /// app's own storage, granted at launch. See the type docs for why this is a separate list.
    pub fn allow_internal(&self, path: impl AsRef<Path>) {
        push_unique(&self.1, path.as_ref());
    }

    /// Grant several paths at once.
    pub fn allow_all<I, P>(&self, paths: I)
    where
        I: IntoIterator<Item = P>,
        P: AsRef<Path>,
    {
        for p in paths {
            self.allow(p);
        }
    }

    /// True if `path` sits inside a granted root — or if nothing has been granted yet.
    pub fn permits(&self, path: impl AsRef<Path>) -> bool {
        let roots = lock(&self.0);
        let internal = lock(&self.1);
        if roots.is_empty() {
            return true; // nothing scanned or registered yet: no session context to enforce
        }
        let Some(canon) = resolve(path.as_ref()) else {
            return false;
        };
        roots.iter().chain(internal.iter()).any(|r| canon.starts_with(r))
    }

    /// `permits`, as a `Result` for the `?` at the top of a command.
    pub fn check(&self, path: impl AsRef<Path>) -> Result<(), String> {
        let p = path.as_ref();
        if self.permits(p) {
            Ok(())
        } else {
            Err(format!(
                "{} is outside this session's folders",
                p.to_string_lossy()
            ))
        }
    }

    /// `check` for a whole batch: refuses the batch if *any* member is out of scope, so a
    /// half-applied multi-file operation is not a thing that can happen.
    pub fn check_all<I, P>(&self, paths: I) -> Result<(), String>
    where
        I: IntoIterator<Item = P>,
        P: AsRef<Path>,
    {
        for p in paths {
            self.check(p)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn an_empty_scope_permits_everything() {
        let scope = AccessScope::default();
        assert!(scope.permits("Z:/anything/at/all.jpg"));
    }

    #[test]
    fn granting_a_root_permits_it_and_its_children_only() {
        let dir = tempdir().unwrap();
        let inside = dir.path().join("sub");
        std::fs::create_dir_all(&inside).unwrap();
        let file = inside.join("a.jpg");
        std::fs::write(&file, b"x").unwrap();

        let other = tempdir().unwrap();
        let outside = other.path().join("b.jpg");
        std::fs::write(&outside, b"x").unwrap();

        let scope = AccessScope::default();
        scope.allow(dir.path());
        assert!(scope.permits(&file));
        assert!(scope.permits(&inside));
        assert!(!scope.permits(&outside));
        assert!(scope.check(&outside).is_err());
    }

    #[test]
    fn a_destination_that_does_not_exist_yet_is_still_judged() {
        // Every move targets a path that does not exist; plain canonicalize would reject them all.
        let dir = tempdir().unwrap();
        let scope = AccessScope::default();
        scope.allow(dir.path());
        assert!(scope.permits(dir.path().join("not-created-yet.jpg")));
        assert!(scope.permits(dir.path().join("deep/nested/new.jpg")));
    }

    #[test]
    fn traversal_out_of_a_granted_root_is_refused() {
        // The point of canonicalising first: `<root>/../secret.txt` resolves *out* of the root,
        // so a prefix test on the raw string would have been trivially defeated.
        let parent = tempdir().unwrap();
        let root = parent.path().join("granted");
        std::fs::create_dir_all(&root).unwrap();
        let secret = parent.path().join("secret.txt");
        std::fs::write(&secret, b"private").unwrap();

        let scope = AccessScope::default();
        scope.allow(&root);
        assert!(!scope.permits(root.join("../secret.txt")));
        assert!(!scope.permits(root.join(r"..\secret.txt")));
    }

    #[test]
    fn scope_accumulates_across_scans_so_undo_still_reaches_the_first_root() {
        let a = tempdir().unwrap();
        let b = tempdir().unwrap();
        let scope = AccessScope::default();
        scope.allow(a.path());
        scope.allow(b.path());
        assert!(scope.permits(a.path().join("x.jpg")));
        assert!(scope.permits(b.path().join("y.jpg")));
        // ...and granting the same root twice does not duplicate it.
        scope.allow(a.path());
        assert_eq!(scope.0.lock().unwrap().len(), 2);
    }

    #[test]
    fn check_all_refuses_the_whole_batch_if_one_member_is_out() {
        let dir = tempdir().unwrap();
        let other = tempdir().unwrap();
        let scope = AccessScope::default();
        scope.allow(dir.path());
        let ok = dir.path().join("a.jpg").to_string_lossy().to_string();
        let bad = other.path().join("b.jpg").to_string_lossy().to_string();
        assert!(scope.check_all([&ok]).is_ok());
        assert!(scope.check_all([&ok, &bad]).is_err());
    }
}

#[cfg(test)]
mod init_tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn the_internal_app_data_grant_does_not_switch_on_enforcement() {
        // `setup()` grants the app's own data directory at launch. That is bookkeeping, not a
        // session context: until the user has actually scanned or registered something there is
        // nothing to enforce, and treating app_data as "the session" made the first move of a
        // restored session fail with "outside this session's folders" — silently, because the
        // caller discards the error.
        let app_data = tempdir().unwrap();
        let library = tempdir().unwrap();
        let photo = library.path().join("a.jpg");
        std::fs::write(&photo, b"x").unwrap();

        let scope = AccessScope::default();
        scope.allow_internal(app_data.path());
        assert!(scope.permits(&photo), "a move must not be refused before anything is scanned");
        assert!(scope.permits(app_data.path().join("trash/x.jpg")));
    }

    #[test]
    fn app_data_stays_permitted_once_a_real_root_is_granted() {
        let app_data = tempdir().unwrap();
        let library = tempdir().unwrap();
        let other = tempdir().unwrap();
        let scope = AccessScope::default();
        scope.allow_internal(app_data.path());
        scope.allow(library.path());
        assert!(scope.permits(library.path().join("a.jpg")));
        assert!(scope.permits(app_data.path().join("trash/a.jpg")));
        assert!(!scope.permits(other.path().join("a.jpg")), "enforcement is live now");
    }
}
