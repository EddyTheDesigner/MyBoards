use serde::Serialize;
use serde_json::Value;
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tempfile::NamedTempFile;
use uuid::Uuid;

const WORKSPACE_LIMIT: u64 = 32 * 1024 * 1024;
const PASTE_LIMIT: usize = 50 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct MediaAsset {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: &'static str,
}

fn read_workspace(path: &Path) -> Result<Value, String> {
    let mut input = fs::File::open(path).map_err(|error| error.to_string())?;
    if input.metadata().map_err(|error| error.to_string())?.len() > WORKSPACE_LIMIT {
        return Err("The workspace is too large to open".into());
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut input)
        .take(WORKSPACE_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > WORKSPACE_LIMIT {
        return Err("The workspace is too large to open".into());
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    if !value.is_object() {
        return Err("The saved workspace is not valid".into());
    }
    Ok(value)
}

pub fn load_workspace(root: &Path) -> Result<Value, String> {
    let primary = root.join("workspace.json");
    let backup = root.join("workspace.backup.json");
    if !primary.exists() && !backup.exists() {
        return Ok(Value::Null);
    }
    match read_workspace(&primary) {
        Ok(value) => Ok(value),
        Err(primary_error) => read_workspace(&backup).map_err(|backup_error| {
            format!("Could not read the workspace or its backup. Your files were preserved. Workspace: {primary_error}. Backup: {backup_error}")
        }),
    }
}

// persist() replaces an existing file atomically on Windows, macOS, and Linux.
// The temporary file lives in the destination directory, so no cross-volume rename occurs.
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid storage location")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let mut temporary = NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    temporary
        .write_all(bytes)
        .map_err(|error| error.to_string())?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    temporary.persist(path).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    fs::File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn save_workspace(root: &Path, workspace: &Value) -> Result<(), String> {
    if !workspace.is_object() {
        return Err("The workspace must be a JSON object".into());
    }
    let bytes = serde_json::to_vec(workspace).map_err(|error| error.to_string())?;
    if bytes.len() as u64 > WORKSPACE_LIMIT {
        return Err("The workspace is too large to save".into());
    }
    let primary = root.join("workspace.json");
    let backup = root.join("workspace.backup.json");
    // Never replace a valid backup with a damaged primary, including after recovery.
    if let Ok(previous) = read_workspace(&primary) {
        let previous_bytes = serde_json::to_vec(&previous).map_err(|error| error.to_string())?;
        atomic_write(&backup, &previous_bytes)?;
    }
    atomic_write(&primary, &bytes)
}

fn media_type(name: &str) -> Result<(&'static str, String), String> {
    let extension = Path::new(name)
        .extension()
        .and_then(|part| part.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let kind = match extension.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "avif" => "image",
        "mp4" | "webm" | "mov" | "m4v" | "ogv" | "ogg" => "video",
        _ => return Err(format!("Unsupported media format: {name}")),
    };
    Ok((kind, extension))
}

fn destination(root: &Path, name: &str) -> Result<(MediaAsset, PathBuf), String> {
    let (kind, extension) = media_type(name)?;
    let directory = root.join("media");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let id = Uuid::new_v4().to_string();
    let path = directory.join(format!("{id}.{extension}"));
    let asset = MediaAsset {
        id,
        name: Path::new(name)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        path: path.to_string_lossy().into_owned(),
        kind,
    };
    Ok((asset, path))
}

fn import_one(root: &Path, source: &Path) -> Result<MediaAsset, String> {
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid media filename")?;
    media_type(name)?;
    let mut input =
        fs::File::open(source).map_err(|error| format!("Could not open {name}: {error}"))?;
    let metadata = input.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err(format!("{name} is not a nonempty media file"));
    }
    let (asset, target) = destination(root, name)?;
    let mut temporary =
        NamedTempFile::new_in(root.join("media")).map_err(|error| error.to_string())?;
    // Stream videos from disk instead of holding a complete media file in memory.
    std::io::copy(&mut input, temporary.as_file_mut())
        .map_err(|error| format!("Could not copy {name}: {error}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    temporary
        .persist(&target)
        .map_err(|error| error.to_string())?;
    Ok(asset)
}

pub fn import_media(root: &Path, paths: &[String]) -> Result<Vec<MediaAsset>, String> {
    if paths.len() > 256 {
        return Err("Import up to 256 files at a time".into());
    }
    let mut assets: Vec<MediaAsset> = Vec::new();
    for path in paths {
        match import_one(root, Path::new(path)) {
            Ok(asset) => assets.push(asset),
            Err(error) => {
                for asset in &assets {
                    let _ = fs::remove_file(&asset.path);
                }
                return Err(error);
            }
        }
    }
    Ok(assets)
}

pub fn import_media_bytes(root: &Path, name: &str, bytes: &[u8]) -> Result<MediaAsset, String> {
    if bytes.is_empty() {
        return Err("The pasted media is empty".into());
    }
    if bytes.len() > PASTE_LIMIT {
        return Err(
            "Paste supports files up to 50 MB. Use the import button for larger files".into(),
        );
    }
    let (asset, target) = destination(root, name)?;
    atomic_write(&target, bytes)?;
    Ok(asset)
}
