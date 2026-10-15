use serde::{Deserialize, Serialize};
use std::fs;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;
pub mod ai;
mod durable;

static NEXT_CONFIG_BACKUP: AtomicU64 = AtomicU64::new(0);

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

fn read_storage_config(app: &tauri::AppHandle) -> Result<StorageConfig, String> {
    let p = config_path(app)?;
    match fs::read_to_string(&p) {
        Ok(raw) => {
            let cfg: StorageConfig =
                serde_json::from_str(&raw).map_err(|e| format!("存储配置损坏：{e}"))?;
            validate_config(&cfg)?;
            return Ok(cfg);
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("无法读取存储配置：{e}")),
    }
    Ok(StorageConfig {
        data_root_mode: "default".into(),
        custom_data_root: None,
        updated_at: None,
    })
}

fn validate_config(cfg: &StorageConfig) -> Result<(), String> {
    match cfg.data_root_mode.as_str() {
        "default" => Ok(()),
        "custom"
            if cfg
                .custom_data_root
                .as_ref()
                .is_some_and(|p| Path::new(p).is_absolute()) =>
        {
            Ok(())
        }
        _ => Err("存储配置无效；请恢复原配置".into()),
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
        let cfg = read_storage_config(app)?;
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
    if rel.is_empty()
        || Path::new(rel)
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("非法路径".into());
    }
    let root = base_dir(app)?;
    reject_links(&root)?;
    let path = root.join(rel);
    reject_links(&path)?;
    Ok(path)
}

fn reject_links(path: &Path) -> Result<(), String> {
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(meta) => {
                if meta.file_type().is_symlink() {
                    return Err("不允许符号链接".into());
                }
                #[cfg(target_os = "windows")]
                {
                    use std::os::windows::fs::MetadataExt;
                    if meta.file_attributes() & 0x400 != 0 {
                        return Err("不允许 junction 或重解析点".into());
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
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
    let mut file = fs::File::create(&p).map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes())
        .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_exists(app: tauri::AppHandle, rel_path: String) -> Result<bool, String> {
    safe_path(&app, &rel_path)?
        .try_exists()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_mkdir(app: tauri::AppHandle, rel_path: String) -> Result<(), String> {
    fs::create_dir_all(safe_path(&app, &rel_path)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_read_dir(app: tauri::AppHandle, rel_path: String) -> Result<Vec<String>, String> {
    let entries = fs::read_dir(safe_path(&app, &rel_path)?).map_err(|e| e.to_string())?;
    entries
        .map(|entry| entry.map(|e| e.file_name().to_string_lossy().to_string()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_remove(app: tauri::AppHandle, rel_path: String) -> Result<(), String> {
    let p = safe_path(&app, &rel_path)?;
    if p.is_dir() {
        Err("只允许删除一个明确的文件；目录清理由用户手动执行".into())
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
    fs::rename(&s, &d).map_err(|e| e.to_string())?;
    durable::sync_parent(&d).map_err(|e| e.to_string())
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
fn storage_config_read(app: tauri::AppHandle) -> Result<StorageConfig, String> {
    read_storage_config(&app)
}

#[tauri::command]
fn storage_config_write(app: tauri::AppHandle, config: StorageConfig) -> Result<(), String> {
    validate_config(&config)?;
    let p = config_path(&app)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    reject_links(&p)?;
    durable::atomic_replace(&p, raw.as_bytes()).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigRecoveryStatus {
    exists: bool,
    damaged: bool,
    detail: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryRootInspection {
    canonical_root: String,
    has_primary_state: bool,
    backups: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigRepairResult {
    canonical_root: String,
    preserved_config: String,
    preserved_state: Option<String>,
    durability_warning: Option<String>,
}

#[tauri::command]
fn storage_config_recovery_status(app: tauri::AppHandle) -> Result<ConfigRecoveryStatus, String> {
    if cfg!(any(target_os = "android", target_os = "ios")) {
        return Ok(ConfigRecoveryStatus {
            exists: false,
            damaged: false,
            detail: None,
        });
    }
    let path = config_path(&app)?;
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ConfigRecoveryStatus {
                exists: false,
                damaged: false,
                detail: None,
            });
        }
        Err(error) => return Err(format!("无法只读检查存储配置：{error}")),
    };
    let parsed = std::str::from_utf8(&bytes)
        .map_err(|error| format!("存储配置不是有效 UTF-8，原始字节尚未改动：{error}"))
        .and_then(|raw| {
            serde_json::from_str::<StorageConfig>(raw).map_err(|error| error.to_string())
        })
        .and_then(|config| validate_config(&config).map(|_| config));
    Ok(match parsed {
        Ok(_) => ConfigRecoveryStatus {
            exists: true,
            damaged: false,
            detail: None,
        },
        Err(detail) => ConfigRecoveryStatus {
            exists: true,
            damaged: true,
            detail: Some(detail),
        },
    })
}

fn recovery_root(path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path.trim());
    if !candidate.is_absolute()
        || candidate
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err("候选数据目录必须是规范的绝对路径，不能包含 ..".into());
    }
    reject_links(&candidate)?;
    let canonical =
        fs::canonicalize(&candidate).map_err(|error| format!("无法访问候选目录：{error}"))?;
    if !canonical.is_dir() {
        return Err("候选路径不是目录".into());
    }
    reject_links(&canonical)?;
    Ok(canonical)
}

fn is_backup_name(name: &str) -> bool {
    name.ends_with(".json")
        && (name.starts_with("wealth-backup_") || name.starts_with("wealth-backup_manual_"))
        && name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.'))
}

fn recovery_candidate_path(root: &Path, candidate: &str) -> Result<PathBuf, String> {
    let path = if candidate == "app-state" {
        root.join("data").join("app-state.json")
    } else if is_backup_name(candidate) {
        root.join("backups").join(candidate)
    } else {
        return Err("恢复候选文件名无效".into());
    };
    reject_links(&path)?;
    let metadata = fs::metadata(&path).map_err(|error| format!("无法读取候选文件：{error}"))?;
    if !metadata.is_file() {
        return Err("候选路径不是普通文件".into());
    }
    Ok(path)
}

fn validate_recovery_state(raw: &str) -> Result<(), String> {
    use serde_json::Value;
    fn valid_date(value: &Value) -> bool {
        let Some(raw) = value.as_str() else {
            return false;
        };
        let bytes = raw.as_bytes();
        if bytes.len() != 10
            || bytes[4] != b'-'
            || bytes[7] != b'-'
            || bytes
                .iter()
                .enumerate()
                .any(|(index, byte)| index != 4 && index != 7 && !byte.is_ascii_digit())
        {
            return false;
        }
        let Ok(year) = raw[0..4].parse::<u32>() else {
            return false;
        };
        let Ok(month) = raw[5..7].parse::<u32>() else {
            return false;
        };
        let Ok(day) = raw[8..10].parse::<u32>() else {
            return false;
        };
        if !(1..=12).contains(&month) {
            return false;
        }
        let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
        let max_day = match month {
            2 if leap => 29,
            2 => 28,
            4 | 6 | 9 | 11 => 30,
            _ => 31,
        };
        (1..=max_day).contains(&day)
    }
    fn valid_amount(value: Option<&Value>) -> bool {
        value.and_then(Value::as_f64).is_some_and(f64::is_finite)
    }
    fn validate_channel(value: &Value) -> Result<(), String> {
        let channel = value.as_object().ok_or("渠道结构无效")?;
        if !channel
            .get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| !id.is_empty())
            || !valid_amount(channel.get("amount"))
        {
            return Err("渠道 ID 或金额无效".into());
        }
        if let Some(children) = channel.get("children") {
            let children = children.as_array().ok_or("子渠道列表无效")?;
            for child in children {
                validate_channel(child)?;
            }
        }
        Ok(())
    }
    let value: Value =
        serde_json::from_str(raw).map_err(|error| format!("数据文件不是有效 JSON：{error}"))?;
    let object = value.as_object().ok_or("数据文件结构无效")?;
    let payload = if let Some(schema) = object.get("storageSchemaVersion") {
        if schema.as_u64().is_some_and(|version| version > 1) {
            return Err("数据文件来自更新版本，当前版本只允许检查，不能切换".into());
        }
        if schema.as_u64() != Some(1)
            || !object
                .get("revision")
                .and_then(Value::as_u64)
                .is_some_and(|revision| revision <= 9_007_199_254_740_991)
        {
            return Err("数据文件 Envelope 无效".into());
        }
        object
            .get("payload")
            .and_then(Value::as_object)
            .ok_or("数据文件 payload 无效")?
    } else {
        object
    };
    if payload.values().any(|item| !item.is_string()) {
        return Err("数据文件包含无法识别的存储值".into());
    }
    let ledger_raw = payload
        .get("wealth_tracker_data")
        .and_then(Value::as_str)
        .ok_or("数据文件缺少资产主数据")?;
    let ledger: Value = serde_json::from_str(ledger_raw)
        .map_err(|error| format!("资产主数据不是有效 JSON：{error}"))?;
    let ledger = ledger.as_object().ok_or("资产主数据结构无效")?;
    let channels = ledger
        .get("channels")
        .and_then(Value::as_array)
        .ok_or("资产渠道列表无效")?;
    let history = ledger
        .get("history")
        .and_then(Value::as_array)
        .ok_or("资产历史列表无效")?;
    for channel in channels {
        validate_channel(channel)?;
    }
    for point in history {
        let point = point.as_object().ok_or("历史记录结构无效")?;
        if !point.get("date").is_some_and(valid_date) || !valid_amount(point.get("totalAmount")) {
            return Err("历史记录日期或总额无效".into());
        }
        if let Some(point_channels) = point.get("channels") {
            let point_channels = point_channels.as_array().ok_or("历史渠道快照无效")?;
            for channel in point_channels {
                validate_channel(channel)?;
            }
        }
    }
    if let Some(reports_raw) = payload.get("financial_reports") {
        let reports: Value = serde_json::from_str(reports_raw.as_str().ok_or("报告存储值无效")?)
            .map_err(|error| format!("报告数据不是有效 JSON：{error}"))?;
        if reports.is_null() {
            return Ok(());
        }
        let reports = reports.as_array().ok_or("报告列表结构无效")?;
        for report in reports {
            let report = report.as_object().ok_or("报告结构无效")?;
            let start = report.get("startDate").ok_or("报告缺少开始日期")?;
            let end = report.get("endDate").ok_or("报告缺少结束日期")?;
            if !report
                .get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| !id.is_empty())
                || !valid_date(start)
                || !valid_date(end)
                || start.as_str() > end.as_str()
                || !valid_amount(report.get("totalAmount"))
            {
                return Err("报告 ID、日期或金额无效".into());
            }
            if let Some(schema) = report.get("reportSchemaVersion") {
                if !schema.as_f64().is_some_and(|version| version <= 5.0) {
                    return Err("报告 Schema 来自更新版本或格式无效，当前版本禁止写入".into());
                }
            }
            for field in ["previousTotalAmount", "changeAmount", "changePercentage"] {
                if report.contains_key(field) && !valid_amount(report.get(field)) {
                    return Err(format!("报告字段 {field} 无效"));
                }
            }
            if let Some(status) = report.get("baselineStatus") {
                match status.as_str() {
                    Some("known") if report.contains_key("previousTotalAmount") => {}
                    Some("unknown") => {}
                    _ => return Err("报告期初基准状态无效或缺少期初金额".into()),
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn storage_recovery_inspect_root(root: String) -> Result<RecoveryRootInspection, String> {
    if cfg!(any(target_os = "android", target_os = "ios")) {
        return Err("此恢复入口仅支持桌面存储配置".into());
    }
    let canonical = recovery_root(&root)?;
    let primary = canonical.join("data").join("app-state.json");
    reject_links(&primary)?;
    let has_primary_state = match fs::symlink_metadata(&primary) {
        Ok(metadata) => {
            if !metadata.is_file() {
                return Err("主数据路径不是普通文件".into());
            }
            true
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(error.to_string()),
    };
    let backup_dir = canonical.join("backups");
    reject_links(&backup_dir)?;
    let mut backups = Vec::new();
    match fs::read_dir(&backup_dir) {
        Ok(entries) => {
            for entry in entries {
                let entry = entry.map_err(|error| error.to_string())?;
                reject_links(&entry.path())?;
                if entry
                    .file_type()
                    .map_err(|error| error.to_string())?
                    .is_file()
                {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if is_backup_name(&name) {
                        backups.push(name);
                    }
                }
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    backups.sort();
    backups.reverse();
    Ok(RecoveryRootInspection {
        canonical_root: canonical.to_string_lossy().to_string(),
        has_primary_state,
        backups,
    })
}

#[tauri::command]
fn storage_recovery_read_candidate(root: String, candidate: String) -> Result<String, String> {
    if cfg!(any(target_os = "android", target_os = "ios")) {
        return Err("此恢复入口仅支持桌面存储配置".into());
    }
    let canonical = recovery_root(&root)?;
    let path = recovery_candidate_path(&canonical, &candidate)?;
    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    let raw =
        String::from_utf8(bytes).map_err(|error| format!("候选文件不是有效 UTF-8：{error}"))?;
    validate_recovery_state(&raw)?;
    Ok(raw)
}

fn preserve_config_bytes(path: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
    reject_links(path)?;
    let parent = path.parent().ok_or("存储配置缺少父目录")?;
    let name = path
        .file_name()
        .ok_or("存储配置文件名无效")?
        .to_string_lossy();
    for _ in 0..128 {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let suffix = NEXT_CONFIG_BACKUP.fetch_add(1, Ordering::Relaxed);
        let preserved = parent.join(format!(
            "{name}.damaged-{}-{nanos}-{suffix}",
            std::process::id()
        ));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&preserved) {
            Ok(mut file) => {
                file.write_all(bytes).map_err(|error| error.to_string())?;
                file.sync_all().map_err(|error| error.to_string())?;
                if fs::read(&preserved).map_err(|error| error.to_string())? != bytes {
                    return Err("损坏配置副本读回不一致，原配置未修改".into());
                }
                durable::sync_parent(&preserved).map_err(|error| error.to_string())?;
                return Ok(preserved);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("无法保留损坏配置，原配置未修改：{error}")),
        }
    }
    Err("无法生成唯一的损坏配置副本名，原配置未修改".into())
}

/// A damaged primary may be replaced after preservation, but a newer schema is always read-only.
fn reject_future_recovery_schema(bytes: &[u8]) -> Result<(), String> {
    use serde_json::Value;
    let Ok(Value::Object(object)) = serde_json::from_slice::<Value>(bytes) else {
        return Ok(());
    };
    if object
        .get("storageSchemaVersion")
        .and_then(Value::as_f64)
        .is_some_and(|version| version > 1.0)
    {
        return Err("现有主文件来自更新版本，当前版本禁止覆盖".into());
    }
    let payload = if object.contains_key("storageSchemaVersion") {
        object.get("payload").and_then(Value::as_object)
    } else {
        Some(&object)
    };
    if let Some(raw) = payload
        .and_then(|payload| payload.get("financial_reports"))
        .and_then(Value::as_str)
    {
        if let Ok(Value::Array(reports)) = serde_json::from_str::<Value>(raw) {
            if reports.iter().any(|report| {
                report
                    .get("reportSchemaVersion")
                    .and_then(Value::as_f64)
                    .is_some_and(|version| version > 5.0)
            }) {
                return Err("现有主文件包含更新版本的报告，当前版本禁止覆盖".into());
            }
        }
    }
    Ok(())
}

fn require_unchanged(path: &Path, expected: &[u8], message: &str) -> Result<(), String> {
    reject_links(path)?;
    let actual = fs::read(path).map_err(|error| error.to_string())?;
    if actual != expected {
        return Err(message.into());
    }
    Ok(())
}

#[tauri::command]
fn storage_config_recovery_repair(
    app: tauri::AppHandle,
    root: String,
    candidate: String,
    expected_raw: String,
) -> Result<ConfigRepairResult, String> {
    if cfg!(any(target_os = "android", target_os = "ios")) {
        return Err("此恢复入口仅支持桌面存储配置".into());
    }
    repair_storage_config_at_path(&config_path(&app)?, &root, &candidate, &expected_raw)
}

fn repair_storage_config_at_path(
    config: &Path,
    root: &str,
    candidate: &str,
    expected_raw: &str,
) -> Result<ConfigRepairResult, String> {
    let canonical = recovery_root(root)?;
    let candidate_path = recovery_candidate_path(&canonical, candidate)?;
    let candidate_bytes = fs::read(&candidate_path).map_err(|error| error.to_string())?;
    if candidate_bytes != expected_raw.as_bytes() {
        return Err("候选数据在检查后已变化，请重新检查".into());
    }
    validate_recovery_state(expected_raw)?;

    reject_links(config)?;
    let original = fs::read(config).map_err(|error| format!("无法读取并保留原配置：{error}"))?;
    let valid_config = std::str::from_utf8(&original)
        .ok()
        .and_then(|raw| serde_json::from_str::<StorageConfig>(raw).ok())
        .is_some_and(|value| validate_config(&value).is_ok());
    if valid_config {
        return Err("存储配置当前有效；请通过常规数据目录设置执行切换".into());
    }

    let state_path = canonical.join("data").join("app-state.json");
    reject_links(&state_path)?;
    let original_state = match fs::read(&state_path) {
        Ok(bytes) => {
            reject_future_recovery_schema(&bytes)?;
            Some(bytes)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("无法检查现有主文件，原配置未修改：{error}")),
    };
    let preserved = preserve_config_bytes(config, &original)?;
    require_unchanged(
        config,
        &original,
        "存储配置在恢复期间发生变化；原配置和已保留副本均未覆盖",
    )?;
    let mut preserved_state = None;
    let mut warnings = Vec::new();

    if candidate != "app-state" {
        let state_parent = state_path.parent().ok_or("主数据文件缺少父目录")?;
        fs::create_dir_all(state_parent).map_err(|error| format!("无法建立主数据目录：{error}"))?;
        reject_links(state_parent)?;
        match fs::symlink_metadata(&state_path) {
            Ok(metadata) => {
                if !metadata.is_file() {
                    return Err("现有主数据路径不是普通文件".into());
                }
                reject_links(&state_path)?;
                let old_bytes = original_state
                    .as_ref()
                    .ok_or("主文件在预览后出现，请重新检查")?;
                require_unchanged(
                    &state_path,
                    old_bytes,
                    "主文件在恢复期间发生变化，请重新检查",
                )?;
                preserved_state = Some(
                    preserve_config_bytes(&state_path, old_bytes)
                        .map_err(|error| format!("无法保留原主数据文件，未恢复备份：{error}"))?
                        .to_string_lossy()
                        .to_string(),
                );
                require_unchanged(&state_path, old_bytes, "主文件在保留后发生变化，请重新检查")?;
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::NotFound && original_state.is_none() => {}
            Err(error) => return Err(error.to_string()),
        }
        require_unchanged(
            &candidate_path,
            &candidate_bytes,
            "候选备份在检查后已变化，请重新检查",
        )?;
        let replace_result = durable::atomic_replace(&state_path, &candidate_bytes);
        let state_readback =
            fs::read(&state_path).map_err(|error| format!("备份恢复结果无法读回：{error}"))?;
        if state_readback != candidate_bytes {
            return Err("备份恢复读回不一致；损坏配置及原主数据副本均保留".into());
        }
        validate_recovery_state(
            std::str::from_utf8(&state_readback).map_err(|error| error.to_string())?,
        )?;
        if let Err(error) = replace_result {
            warnings.push(format!("备份已读回验证，但目录同步报告警告：{error}"));
        }
    }

    require_unchanged(
        &state_path,
        &candidate_bytes,
        "主文件在配置切换前发生变化，写入保持暂停",
    )?;
    require_unchanged(
        config,
        &original,
        "存储配置在恢复期间发生变化，写入保持暂停",
    )?;

    let repaired = StorageConfig {
        data_root_mode: "custom".into(),
        custom_data_root: Some(canonical.to_string_lossy().to_string()),
        updated_at: None,
    };
    validate_config(&repaired)?;
    let bytes = serde_json::to_vec_pretty(&repaired).map_err(|error| error.to_string())?;
    let replace_result = durable::atomic_replace(config, &bytes);
    let readback = fs::read(config).map_err(|error| {
        format!(
            "配置切换结果无法读回；损坏原配置副本保留于 {}：{error}",
            preserved.display()
        )
    })?;
    let readback_matches = std::str::from_utf8(&readback)
        .ok()
        .and_then(|raw| serde_json::from_str::<StorageConfig>(raw).ok())
        .is_some_and(|value| {
            value.data_root_mode == "custom"
                && value.custom_data_root.as_deref() == Some(canonical.to_string_lossy().as_ref())
        });
    if !readback_matches {
        return Err(format!(
            "配置读回校验失败；原配置副本保留于 {}",
            preserved.display()
        ));
    }
    require_unchanged(
        &state_path,
        &candidate_bytes,
        "配置已切换，但主文件读回不一致；原文件副本已保留，写入保持暂停",
    )?;
    if let Err(error) = replace_result {
        warnings.push(format!("配置已读回验证，但目录同步报告警告：{error}"));
    }
    Ok(ConfigRepairResult {
        canonical_root: canonical.to_string_lossy().to_string(),
        preserved_config: preserved.to_string_lossy().to_string(),
        preserved_state,
        durability_warning: if warnings.is_empty() {
            None
        } else {
            Some(warnings.join("；"))
        },
    })
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
        reject_links(&entry.path())?;
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

fn validate_tree(root: &Path) -> Result<(), String> {
    reject_links(root)?;
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        reject_links(&entry.path())?;
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        if ty.is_dir() {
            validate_tree(&entry.path())?;
        } else if !ty.is_file() {
            return Err("源目录含非普通文件".into());
        }
    }
    Ok(())
}

// Streaming byte-for-byte readback avoids loading financial backups into memory.
fn verify_tree(source: &Path, target: &Path) -> Result<(), String> {
    use std::io::Read;
    let source_count = fs::read_dir(source).map_err(|e| e.to_string())?.count();
    let target_count = fs::read_dir(target).map_err(|e| e.to_string())?.count();
    if source_count != target_count {
        return Err("迁移清单不一致".into());
    }
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let from = entry.path();
        let to = target.join(entry.file_name());
        reject_links(&from)?;
        reject_links(&to)?;
        if entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            verify_tree(&from, &to)?;
        } else {
            let mut a = fs::File::open(&from).map_err(|e| e.to_string())?;
            let mut b = fs::File::open(&to).map_err(|e| e.to_string())?;
            if a.metadata().map_err(|e| e.to_string())?.len()
                != b.metadata().map_err(|e| e.to_string())?.len()
            {
                return Err("迁移文件大小不一致".into());
            }
            let mut left = [0u8; 65536];
            let mut right = [0u8; 65536];
            loop {
                let n = a.read(&mut left).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                b.read_exact(&mut right[..n]).map_err(|e| e.to_string())?;
                if left[..n] != right[..n] {
                    return Err("迁移文件读回不一致".into());
                }
            }
        }
    }
    Ok(())
}

/// 把整个数据根目录从 src 复制到 dst（跨磁盘安全，不依赖 rename）。
#[tauri::command]
fn migrate_data_root(app: tauri::AppHandle, src: String, dst: String) -> Result<u64, String> {
    let source = PathBuf::from(&src);
    let target = PathBuf::from(&dst);
    if !source.is_absolute() || !target.is_absolute() {
        return Err("迁移路径必须是绝对路径".into());
    }
    reject_links(&source)?;
    reject_links(&target)?;
    let s = fs::canonicalize(&source).map_err(|e| e.to_string())?;
    let current = fs::canonicalize(base_dir(&app)?).map_err(|e| e.to_string())?;
    if s != current {
        return Err("源根与当前配置不一致".into());
    }
    // Require an existing parent so the normalized target identity is unambiguous.
    let d = if target.exists() {
        if !target.is_dir()
            || fs::read_dir(&target)
                .map_err(|e| e.to_string())?
                .next()
                .is_some()
        {
            return Err("目标目录必须为空".into());
        }
        fs::canonicalize(&target).map_err(|e| e.to_string())?
    } else {
        let parent = target.parent().ok_or("目标缺少父目录")?;
        fs::canonicalize(parent)
            .map_err(|e| e.to_string())?
            .join(target.file_name().ok_or("目标缺少目录名")?)
    };
    if s.starts_with(&d) || d.starts_with(&s) {
        return Err("源和目标不能相同或相互包含".into());
    }
    // Validate the whole source before the first copy; symlinks and junctions are rejected.
    validate_tree(&s)?;
    let count = copy_dir_recursive(&s, &d)?;
    verify_tree(&s, &d)?;
    Ok(count)
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
        .manage(ai::AiBroker::default())
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
            storage_config_recovery_status,
            storage_recovery_inspect_root,
            storage_recovery_read_candidate,
            storage_config_recovery_repair,
            migrate_data_root,
            open_path,
            ai::ai_set_enabled,
            ai::ai_configure_profile,
            ai::ai_models,
            ai::ai_infer,
            ai::ai_vision_extract,
            ai::ai_research_lookup,
            ai::ai_cancel,
            ai::ai_remove_profile
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod recovery_tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "wealth-config-recovery-test-{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT_CONFIG_BACKUP.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        fs::create_dir(root.join("data")).unwrap();
        fs::create_dir(root.join("backups")).unwrap();
        let config = root.join("storage-config.json");
        fs::write(&config, b"{damaged config\xff\x00").unwrap();
        (root, config)
    }

    fn legacy_state() -> String {
        serde_json::to_string_pretty(&json!({
            "wealth_tracker_data": json!({ "channels": [{ "id": "synthetic", "amount": 123.45 }], "history": [] }).to_string(),
            "financial_reports": "[]",
            "unknown_key": "exactly retained"
        })).unwrap()
    }

    fn root_text(root: &Path) -> String {
        root.to_string_lossy().to_string()
    }

    #[test]
    fn accepts_legacy_envelope_empty_ledger_and_report_schema_five() {
        let raw = legacy_state();
        validate_recovery_state(&raw).unwrap();
        let payload: serde_json::Value = serde_json::from_str(&raw).unwrap();
        validate_recovery_state(&json!({ "storageSchemaVersion": 1, "revision": 2, "payload": payload, "unknown": true }).to_string()).unwrap();
        validate_recovery_state(&json!({ "wealth_tracker_data": "{\"channels\":[],\"history\":[]}", "financial_reports": "null" }).to_string()).unwrap();
        let reports = json!([{ "id": "r", "startDate": "2026-01-01", "endDate": "2026-01-31", "totalAmount": 1, "reportSchemaVersion": 5, "baselineStatus": "unknown" }]);
        let mut state: serde_json::Value = serde_json::from_str(&raw).unwrap();
        state["financial_reports"] = reports.to_string().into();
        validate_recovery_state(&state.to_string()).unwrap();
    }

    #[test]
    fn rejects_corrupt_missing_future_and_invalid_financial_data_without_panicking() {
        for raw in [
            "{",
            "null",
            "[]",
            "{}",
            "{\"wealth_tracker_data\":\"null\"}",
        ] {
            assert!(validate_recovery_state(raw).is_err());
        }
        let legacy: serde_json::Value = serde_json::from_str(&legacy_state()).unwrap();
        assert!(validate_recovery_state(
            &json!({ "storageSchemaVersion": 2, "revision": 1, "payload": legacy }).to_string()
        )
        .is_err());
        for (date, amount) in [
            ("2026-02-30", json!(1)),
            ("éé-é-1", json!(1)),
            ("2026-01-01", json!("bad")),
        ] {
            let raw = json!({ "wealth_tracker_data": json!({ "channels": [], "history": [{ "date": date, "totalAmount": amount }] }).to_string() }).to_string();
            assert!(validate_recovery_state(&raw).is_err());
        }
        for extra in [
            json!({"reportSchemaVersion": 6}),
            json!({"previousTotalAmount": null}),
            json!({"baselineStatus": "known"}),
        ] {
            let mut report = json!({ "id": "r", "startDate": "2026-01-01", "endDate": "2026-01-31", "totalAmount": 1 });
            report
                .as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            let mut state: serde_json::Value = serde_json::from_str(&legacy_state()).unwrap();
            state["financial_reports"] = json!([report]).to_string().into();
            assert!(validate_recovery_state(&state.to_string()).is_err());
        }
    }

    #[test]
    fn config_repair_preserves_invalid_binary_bytes_and_does_not_rewrite_primary() {
        let (root, config) = fixture();
        let original_config = fs::read(&config).unwrap();
        let raw = legacy_state();
        fs::write(root.join("data/app-state.json"), &raw).unwrap();
        let result =
            repair_storage_config_at_path(&config, &root_text(&root), "app-state", &raw).unwrap();
        assert_eq!(fs::read(&result.preserved_config).unwrap(), original_config);
        assert_eq!(
            fs::read_to_string(root.join("data/app-state.json")).unwrap(),
            raw
        );
        assert!(result.preserved_state.is_none());
        let repaired: StorageConfig = serde_json::from_slice(&fs::read(config).unwrap()).unwrap();
        assert_eq!(repaired.custom_data_root.unwrap(), result.canonical_root);
    }

    #[test]
    fn backup_confirmation_preserves_corrupt_primary_and_writes_exact_candidate_bytes() {
        let (root, config) = fixture();
        let state_path = root.join("data/app-state.json");
        let original = b"{corrupt state\x00\xff";
        fs::write(&state_path, original).unwrap();
        let raw = legacy_state();
        fs::write(
            root.join("backups/wealth-backup_manual_synthetic.json"),
            &raw,
        )
        .unwrap();
        let result = repair_storage_config_at_path(
            &config,
            &root_text(&root),
            "wealth-backup_manual_synthetic.json",
            &raw,
        )
        .unwrap();
        assert_eq!(fs::read(result.preserved_state.unwrap()).unwrap(), original);
        assert_eq!(fs::read(&state_path).unwrap(), raw.as_bytes());
    }

    #[test]
    fn explicitly_selected_backup_restores_missing_primary_before_switching_config() {
        let (root, config) = fixture();
        let raw = legacy_state();
        fs::write(root.join("backups/wealth-backup_synthetic.json"), &raw).unwrap();
        let result = repair_storage_config_at_path(
            &config,
            &root_text(&root),
            "wealth-backup_synthetic.json",
            &raw,
        )
        .unwrap();
        assert_eq!(
            fs::read(root.join("data/app-state.json")).unwrap(),
            raw.as_bytes()
        );
        assert!(result.preserved_state.is_none());
        assert!(fs::read(result.preserved_config)
            .unwrap()
            .ends_with(b"\xff\x00"));
    }

    #[test]
    fn changed_candidate_aborts_without_modifying_config_or_primary() {
        let (root, config) = fixture();
        let before = fs::read(&config).unwrap();
        fs::write(root.join("data/app-state.json"), b"changed since preview").unwrap();
        let result =
            repair_storage_config_at_path(&config, &root_text(&root), "app-state", &legacy_state());
        assert!(result.unwrap_err().contains("变化"));
        assert_eq!(fs::read(config).unwrap(), before);
        assert_eq!(
            fs::read(root.join("data/app-state.json")).unwrap(),
            b"changed since preview"
        );
    }

    #[test]
    fn future_primary_or_report_cannot_be_overwritten_by_an_old_backup() {
        for future_primary in [
            json!({ "storageSchemaVersion": 2, "revision": 3, "payload": {} }).to_string(),
            json!({ "wealth_tracker_data": "{}", "financial_reports": "[{\"reportSchemaVersion\":6}]" }).to_string(),
        ] {
            let (root, config) = fixture();
            let config_before = fs::read(&config).unwrap();
            fs::write(root.join("data/app-state.json"), &future_primary).unwrap();
            let raw = legacy_state();
            fs::write(root.join("backups/wealth-backup_synthetic.json"), &raw).unwrap();
            let result = repair_storage_config_at_path(&config, &root_text(&root), "wealth-backup_synthetic.json", &raw);
            assert!(result.unwrap_err().contains("更新版本"));
            assert_eq!(fs::read_to_string(root.join("data/app-state.json")).unwrap(), future_primary);
            assert_eq!(fs::read(config).unwrap(), config_before);
        }
    }

    #[test]
    fn valid_configuration_and_nonregular_candidate_are_rejected() {
        let (root, config) = fixture();
        let config_bytes = b"{\"dataRootMode\":\"default\"}";
        fs::write(&config, config_bytes).unwrap();
        let raw = legacy_state();
        fs::write(root.join("data/app-state.json"), &raw).unwrap();
        assert!(
            repair_storage_config_at_path(&config, &root_text(&root), "app-state", &raw)
                .unwrap_err()
                .contains("当前有效")
        );
        assert_eq!(fs::read(config).unwrap(), config_bytes);
        fs::create_dir(root.join("backups/wealth-backup_directory.json")).unwrap();
        assert!(recovery_candidate_path(&root, "wealth-backup_directory.json").is_err());
        assert!(recovery_candidate_path(&root, "../app-state.json").is_err());
        assert!(recovery_root("relative/path").is_err());
        assert!(recovery_root(&root_text(&root.join("data/../backups"))).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn linked_candidate_is_rejected() {
        let (root, _) = fixture();
        fs::write(root.join("data/app-state.json"), legacy_state()).unwrap();
        std::os::unix::fs::symlink(
            root.join("data/app-state.json"),
            root.join("backups/wealth-backup_link.json"),
        )
        .unwrap();
        assert!(recovery_candidate_path(&root, "wealth-backup_link.json").is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn junction_root_is_rejected() {
        let (root, _) = fixture();
        let target = root.join("synthetic-target");
        let link = root.join("synthetic-junction");
        fs::create_dir(&target).unwrap();
        let result = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(&link)
            .arg(&target)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "failed to create synthetic junction: {}",
            String::from_utf8_lossy(&result.stderr)
        );
        let error = recovery_root(&root_text(&link)).unwrap_err();
        assert!(error.contains("junction") || error.contains("符号链接"));
    }
}
