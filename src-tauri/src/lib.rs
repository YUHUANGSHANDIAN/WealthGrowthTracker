use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// 数据根目录：
/// - 桌面端（Windows/macOS/Linux）：`<Documents>/财富成长记`，保持 v1.1/v1.2 用户数据兼容。
/// - 移动端（Android/iOS）：App-specific 数据目录（scoped storage），不写公共 Documents。
fn base_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        return app
            .path()
            .app_data_dir()
            .map(|p| p.join("财富成长记"))
            .map_err(|e| e.to_string());
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let _ = app;
        let doc = dirs::document_dir().ok_or("无法获取系统「文档」目录")?;
        Ok(doc.join("财富成长记"))
    }
}

/// 把相对路径安全地拼到数据根目录下（阻止目录穿越）。
fn safe_path(app: &tauri::AppHandle, rel: &str) -> Result<PathBuf, String> {
    if rel.is_empty() || rel.contains("..") || Path::new(rel).is_absolute() {
        return Err("非法路径".into());
    }
    Ok(base_dir(app)?.join(rel))
}

#[tauri::command]
fn fs_read_text(app: tauri::AppHandle, rel_path: String) -> Result<String, String> {
    fs::read_to_string(safe_path(&app, &rel_path)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_write_text(app: tauri::AppHandle, rel_path: String, content: String) -> Result<(), String> {
    let p = safe_path(&app, &rel_path)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&p, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_exists(app: tauri::AppHandle, rel_path: String) -> Result<bool, String> {
    Ok(safe_path(&app, &rel_path)?.exists())
}

#[tauri::command]
fn fs_mkdir(app: tauri::AppHandle, rel_path: String) -> Result<(), String> {
    fs::create_dir_all(safe_path(&app, &rel_path)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_read_dir(app: tauri::AppHandle, rel_path: String) -> Result<Vec<String>, String> {
    let entries = fs::read_dir(safe_path(&app, &rel_path)?).map_err(|e| e.to_string())?;
    let mut names = Vec::new();
    for e in entries {
        if let Ok(e) = e {
            names.push(e.file_name().to_string_lossy().to_string());
        }
    }
    Ok(names)
}

#[tauri::command]
fn fs_remove(app: tauri::AppHandle, rel_path: String) -> Result<(), String> {
    let p = safe_path(&app, &rel_path)?;
    if p.is_dir() {
        fs::remove_dir_all(&p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&p).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn fs_copy(app: tauri::AppHandle, src: String, dst: String) -> Result<(), String> {
    let s = safe_path(&app, &src)?;
    let d = safe_path(&app, &dst)?;
    if let Some(parent) = d.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(&s, &d).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn fs_rename(app: tauri::AppHandle, src: String, dst: String) -> Result<(), String> {
    let s = safe_path(&app, &src)?;
    let d = safe_path(&app, &dst)?;
    if let Some(parent) = d.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&s, &d).map_err(|e| e.to_string())
}

#[tauri::command]
fn document_dir(app: tauri::AppHandle) -> Result<String, String> {
    base_dir(&app).map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn open_path(app: tauri::AppHandle, rel_path: String) -> Result<(), String> {
    // 空相对路径 → 打开数据根目录本身（「打开数据文件夹」）
    let p = if rel_path.is_empty() {
        base_dir(&app)?
    } else {
        safe_path(&app, &rel_path)?
    };
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
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&p)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&p)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        // 移动端走 scoped storage / SAF，不存在「打开数据文件夹」；前端按 capability 隐藏此入口。
        return Err("当前平台不支持打开数据文件夹".into());
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
