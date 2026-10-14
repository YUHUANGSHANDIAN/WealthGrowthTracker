use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static NEXT_FILE: AtomicU64 = AtomicU64::new(0);

fn temporary_file(path: &Path) -> io::Result<(PathBuf, File)> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("missing parent"))?;
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::other("missing file name"))?;
    for _ in 0..128 {
        let mut temp_name = name.to_os_string();
        let time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        temp_name.push(format!(
            ".{}-{}-{}.tmp",
            std::process::id(),
            time,
            NEXT_FILE.fetch_add(1, Ordering::Relaxed)
        ));
        let temp = parent.join(temp_name);
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&temp) {
            Ok(file) => return Ok((temp, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "temporary file collision",
    ))
}

pub fn sync_parent(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    if let Some(parent) = path.parent() {
        File::open(parent)?.sync_all()?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

fn replace_with(
    path: &Path,
    bytes: &[u8],
    replace: impl FnOnce(&Path, &Path) -> io::Result<()>,
) -> io::Result<()> {
    let (temp, mut file) = temporary_file(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    // Failed writes leave the original and the specific temporary file for recovery.
    replace(&temp, path)?;
    sync_parent(path)
}

pub fn atomic_replace(path: &Path, bytes: &[u8]) -> io::Result<()> {
    replace_with(path, bytes, |from, to| fs::rename(from, to))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "wealth-storage-test-{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT_FILE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        path.join("state.json")
    }

    #[test]
    fn replaces_existing_file_and_reads_back_exact_bytes() {
        let path = fixture();
        atomic_replace(&path, b"original").unwrap();
        atomic_replace(&path, "新配置".as_bytes()).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "新配置");
    }

    #[test]
    fn failed_replace_preserves_original_and_complete_candidate() {
        let path = fixture();
        fs::write(&path, b"original").unwrap();
        let result = replace_with(&path, b"candidate", |temp, _| {
            assert_eq!(fs::read(temp)?, b"candidate");
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "injected failure",
            ))
        });
        assert!(result.is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original");
    }
}
