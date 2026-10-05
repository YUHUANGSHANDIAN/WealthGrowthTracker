use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// 数据根目录配置（保存在 OS App Config Directory，而非数据根目录自身，
/// 否则一移动目录就找不到配置）。
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StorageConfig {
    data_root_mode: String, // "default" | "custom"
    #[serde(skip_serializing_if = "Option::is_none")]
    custom_data_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    updated_at: Option<String>,
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("storage-config.json"))
}

fn read_storage_config(app: &tauri::AppHandle) -> StorageConfig {
    if let Ok(p) = config_path(app) {
        if let Ok(raw) = fs::read_to_string(&p) {
            if let Ok(cfg) = serde_json::from_str::<StorageConfig>(&raw) {
                return cfg;
            }
        }
    }
    StorageConfig {
        data_root_mode: "default".into(),
        custom_data_root: None,
        updated_at: None,
    }
}

/// 数据根目录：
/// - 移动端（Android/iOS）：App-specific 数据目录（scoped storage）。
/// - 桌面端：优先读取 storage-config.json 的 customDataRoot，否则 `Documents/财富成长记`。
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
        let cfg = read_storage_config(app);
        if cfg.data_root_mode == "custom" {
            if let Some(custom) = cfg.custom_data_root {
                let trimmed = custom.trim();
                if !trimmed.is_empty() {
                    return Ok(PathBuf::from(trimmed));
                }
            }
        }
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
    let names = entries
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
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

/// 默认数据根目录（忽略自定义配置），用于「恢复默认位置」。
#[tauri::command]
fn default_data_dir() -> Result<String, String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        return Err("移动端无默认公共数据目录".into());
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let doc = dirs::document_dir().ok_or("无法获取系统「文档」目录")?;
        Ok(doc.join("财富成长记").to_string_lossy().to_string())
    }
}

#[tauri::command]
fn storage_config_read(app: tauri::AppHandle) -> StorageConfig {
    read_storage_config(&app)
}

#[tauri::command]
fn storage_config_write(app: tauri::AppHandle, config: StorageConfig) -> Result<(), String> {
    let p = config_path(&app)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&p, raw).map_err(|e| e.to_string())
}

#[tauri::command]
fn config_dir(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .app_config_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

/// 递归复制整个目录树（用于数据根目录迁移），返回复制的文件数。
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<u64, String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    let mut count = 0u64;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            count += copy_dir_recursive(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|e| e.to_string())?;
            count += 1;
        }
    }
    Ok(count)
}

/// 把整个数据根目录从 src 复制到 dst（跨磁盘安全，不依赖 rename）。
#[tauri::command]
fn migrate_data_root(src: String, dst: String) -> Result<u64, String> {
    let s = PathBuf::from(&src);
    let d = PathBuf::from(&dst);
    if s == d {
        return Err("目标目录与当前目录相同".into());
    }
    if d.starts_with(&s) {
        return Err("目标目录不能位于当前目录内部".into());
    }
    copy_dir_recursive(&s, &d)
}

/// 删除任意绝对路径（文件或目录）。仅供存储迁移完成后的旧根清理等受控场景使用。
#[tauri::command]
fn remove_path_absolute(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if p.is_dir() {
        fs::remove_dir_all(&p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(&p).map_err(|e| e.to_string())
    }
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
            default_data_dir,
            storage_config_read,
            storage_config_write,
            config_dir,
            migrate_data_root,
            remove_path_absolute,
            open_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
