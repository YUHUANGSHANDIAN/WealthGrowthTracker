use std::fs;
use std::path::{Path, PathBuf};

/// 数据根目录：`<Documents>/财富成长记`
fn base_dir() -> Result<PathBuf, String> {
    let doc = dirs::document_dir().ok_or("无法获取系统「文档」目录")?;
    Ok(doc.join("财富成长记"))
}

/// 把相对路径安全地拼到数据根目录下（阻止目录穿越）。
fn safe_path(rel: &str) -> Result<PathBuf, String> {
    if rel.is_empty() || rel.contains("..") || Path::new(rel).is_absolute() {
        return Err("非法路径".into());
    }
    Ok(base_dir()?.join(rel))
}

#[tauri::command]
fn fs_read_text(rel_path: String) -> Result<String, String> {
    fs::read_to_string(safe_path(&rel_path)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_write_text(rel_path: String, content: String) -> Result<(), String> {
    let p = safe_path(&rel_path)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&p, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_exists(rel_path: String) -> Result<bool, String> {
    Ok(safe_path(&rel_path)?.exists())
}

#[tauri::command]
fn fs_mkdir(rel_path: String) -> Result<(), String> {
    fs::create_dir_all(safe_path(&rel_path)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_read_dir(rel_path: String) -> Result<Vec<String>, String> {
    let entries = fs::read_dir(safe_path(&rel_path)?).map_err(|e| e.to_string())?;
    let mut names = Vec::new();
    for e in entries {
        if let Ok(e) = e {
            names.push(e.file_name().to_string_lossy().to_string());
        }
    }
    Ok(names)
}

#[tauri::command]
fn fs_remove(rel_path: String) -> Result<(), String> {
    let p = safe_path(&rel_path)?;
    if p.is_dir() {
        fs::remove_dir_all(&p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&p).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn fs_copy(src: String, dst: String) -> Result<(), String> {
    let s = safe_path(&src)?;
    let d = safe_path(&dst)?;
    if let Some(parent) = d.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(&s, &d).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn fs_rename(src: String, dst: String) -> Result<(), String> {
    let s = safe_path(&src)?;
    let d = safe_path(&dst)?;
    if let Some(parent) = d.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&s, &d).map_err(|e| e.to_string())
}

#[tauri::command]
fn document_dir() -> Result<String, String> {
    dirs::document_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or("无法获取系统「文档」目录".into())
}

#[tauri::command]
fn open_path(rel_path: String) -> Result<(), String> {
    let p = safe_path(&rel_path)?;
    #[cfg(target_os = "windows")]
    {
        if p.is_dir() {
            std::process::Command::new("explorer")
                .arg(&p)
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            std::process::Command::new("cmd")
                .args(["/C", "start", "", &p.to_string_lossy()])
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            fs_read_text,
            fs_write_text,
            fs_exists,
            fs_mkdir,
            fs_read_dir,
            fs_remove,
            fs_copy,
            fs_rename,
            document_dir,
            open_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
