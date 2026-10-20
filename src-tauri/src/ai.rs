//! 桌面 AI Broker：把前端的类型化命令翻译为私有 stdio JSONL 协议，
//! 并独占凭据与子进程生命周期。AI 默认关闭；关闭时不启动子进程、不枚举模型。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Manager;

const KEYRING_SERVICE: &str = "wealth-growth-tracker";
const PROVIDERS: [&str; 7] = [
    "openai",
    "copilot",
    "anthropic",
    "deepseek",
    "ollama",
    "lmstudio",
    "gateway",
];
const AUTH_KINDS: [&str; 4] = [
    "api-key",
    "local",
    "copilot-subscription",
    "openai-subscription",
];
const CONFIGURE_TIMEOUT: Duration = Duration::from_secs(15);
const INFER_TIMEOUT: Duration = Duration::from_secs(60);
const VISION_TIMEOUT: Duration = Duration::from_secs(90);
const RESEARCH_TIMEOUT: Duration = Duration::from_secs(110);
const CANCEL_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_CREDENTIAL_LEN: usize = 16_384;
const MAX_INPUT_TEXT_LEN: usize = 8_000;
const MAX_FACTS: usize = 48;
const MAX_IMAGES: usize = 4;
const MAX_IMAGE_BASE64_CHARS: usize = 1_500_000;
const MAX_TOTAL_IMAGE_BASE64_CHARS: usize = 3_000_000;
const MAX_RESEARCH_URLS: usize = 5;
const IMAGE_MIME_TYPES: [&str; 3] = ["image/png", "image/jpeg", "image/webp"];
const VISION_TASK: &str = "document-extraction";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub profile_id: String,
    pub provider_id: String,
    pub auth_kind: String,
    pub model_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
    /// 用户声明的读图能力；缺省即视为不可读图，Broker 不会替用户猜测。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supports_vision: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InferenceRequest {
    pub request_id: String,
    pub profile_id: String,
    pub provider_id: String,
    pub task: String,
    pub input: Value,
}

#[derive(Clone)]
struct StoredProfile {
    profile: ConnectionProfile,
    credential: Option<String>,
    persisted: bool,
}

struct RuntimeProcess {
    child: Child,
    stdin: ChildStdin,
    pending: Arc<Mutex<HashMap<String, Sender<Value>>>>,
    dead: Arc<AtomicBool>,
}

#[derive(Default)]
struct InnerState {
    enabled: AtomicBool,
    runtime: Mutex<Option<RuntimeProcess>>,
    profiles: Mutex<HashMap<String, StoredProfile>>,
    configured: Mutex<HashSet<String>>,
    counter: AtomicU64,
}

/// Tauri 管理的 Broker 句柄；可克隆以便在 spawn_blocking 中使用。
#[derive(Clone, Default)]
pub struct AiBroker {
    inner: Arc<InnerState>,
}

/// Broker 侧事件与运行时 stderr 共用同一个日志文件，便于区分「运行时自己崩」与「被 Broker 杀掉」。
fn append_runtime_log(line: &str) {
    let dir = std::env::temp_dir().join("wealth-ai-runtime");
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("stderr.log"))
    {
        let _ = writeln!(file, "[broker] {line}");
    }
}

fn ok_result(result: Value) -> Value {
    json!({ "ok": true, "result": result })
}

/// 运行时意外退出时，命令层可以重建一次并重试同一个帧。
fn is_runtime_exited(response: &Value) -> bool {
    response
        .get("error")
        .and_then(|error| error.get("code"))
        .and_then(Value::as_str)
        == Some("RUNTIME_EXITED")
}

fn error_result(code: &str) -> Value {
    json!({ "ok": false, "error": { "code": code } })
}

/// 把运行时的 envelope 归一化为 Ok(result) 或 Err(code)。
fn interpret(response: Value) -> Result<Value, String> {
    if response.get("ok").and_then(Value::as_bool) == Some(true) {
        return Ok(response.get("result").cloned().unwrap_or(Value::Null));
    }
    let code = response
        .get("error")
        .and_then(|error| error.get("code"))
        .and_then(Value::as_str)
        .unwrap_or("PROVIDER_FAILED")
        .to_string();
    Err(code)
}

fn is_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) if first.is_ascii_alphanumeric() => {}
        _ => return false,
    }
    value.len() <= 128
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-'))
}

fn credential_looks_valid(credential: &str) -> bool {
    !credential.is_empty()
        && credential.len() <= MAX_CREDENTIAL_LEN
        && !credential.contains(['\r', '\n', '\0'])
}

fn validate_profile(profile: &ConnectionProfile) -> Result<(), &'static str> {
    if !is_identifier(&profile.profile_id) {
        return Err("INVALID_REQUEST");
    }
    if !PROVIDERS.contains(&profile.provider_id.as_str()) {
        return Err("INVALID_REQUEST");
    }
    if !AUTH_KINDS.contains(&profile.auth_kind.as_str()) {
        return Err("INVALID_REQUEST");
    }
    if profile.model_id.trim().is_empty() || profile.model_id.len() > 128 {
        return Err("INVALID_REQUEST");
    }
    if let Some(endpoint) = &profile.endpoint {
        if endpoint.len() > 512 || endpoint.contains(['\r', '\n', '\0']) {
            return Err("INVALID_REQUEST");
        }
    }
    Ok(())
}

fn profile_frame(profile: &ConnectionProfile, credential: Option<&str>) -> Value {
    let mut value = serde_json::to_value(profile).unwrap_or_else(|_| json!({}));
    if let (Some(object), Some(credential)) = (value.as_object_mut(), credential) {
        object.insert("credential".into(), Value::String(credential.to_string()));
    }
    value
}

/// 视觉输入在 Broker 侧先做一次失败关闭校验：图片数量、MIME 与体积都被收紧，
/// 运行时会再校验一次，两层都不允许“无图却能识别”的假成功。
fn validate_vision_input(input: &Value) -> Result<(), &'static str> {
    let object = input.as_object().ok_or("INVALID_REQUEST")?;
    if object
        .keys()
        .any(|key| !matches!(key.as_str(), "images" | "text" | "facts"))
    {
        return Err("INVALID_REQUEST");
    }
    if let Some(text) = object.get("text") {
        match text.as_str() {
            Some(value) if value.len() <= MAX_INPUT_TEXT_LEN => {}
            _ => return Err("INVALID_REQUEST"),
        }
    }
    if let Some(facts) = object.get("facts") {
        match facts.as_array() {
            Some(entries) if entries.len() <= MAX_FACTS => {}
            _ => return Err("INVALID_REQUEST"),
        }
    }
    let images = object
        .get("images")
        .and_then(Value::as_array)
        .ok_or("INVALID_REQUEST")?;
    if images.is_empty() || images.len() > MAX_IMAGES {
        return Err("INVALID_REQUEST");
    }
    let mut total = 0usize;
    for image in images {
        let image = image.as_object().ok_or("INVALID_REQUEST")?;
        if image.len() != 2 || !image.contains_key("mimeType") || !image.contains_key("data") {
            return Err("INVALID_REQUEST");
        }
        let mime = image
            .get("mimeType")
            .and_then(Value::as_str)
            .ok_or("INVALID_REQUEST")?;
        if !IMAGE_MIME_TYPES.contains(&mime) {
            return Err("INVALID_REQUEST");
        }
        let data = image
            .get("data")
            .and_then(Value::as_str)
            .ok_or("INVALID_REQUEST")?;
        if data.is_empty()
            || !data
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='))
        {
            return Err("INVALID_REQUEST");
        }
        if data.len() > MAX_IMAGE_BASE64_CHARS {
            return Err("IMAGE_TOO_LARGE");
        }
        total += data.len();
    }
    if total > MAX_TOTAL_IMAGE_BASE64_CHARS {
        return Err("IMAGE_TOO_LARGE");
    }
    Ok(())
}

/// 研究检索只接受用户显式给出的公网 HTTPS 链接。DNS、重定向与体积的限制在
/// Node 运行时执行；这里先拒绝协议、凭据、片段与重复项。
fn validate_research_urls(urls: &[String]) -> Result<(), &'static str> {
    if urls.is_empty() || urls.len() > MAX_RESEARCH_URLS {
        return Err("INVALID_REQUEST");
    }
    let mut seen: HashSet<&str> = HashSet::new();
    for url in urls {
        if url.len() > 2_048 || url.is_empty() {
            return Err("INVALID_URL");
        }
        if !seen.insert(url.as_str()) {
            return Err("INVALID_REQUEST");
        }
        let lower = url.to_ascii_lowercase();
        if !lower.starts_with("https://") {
            return Err("INVALID_URL");
        }
        let rest = &url["https://".len()..];
        if rest.contains(['\r', '\n', '\t', '\0', ' ', '#']) {
            return Err("INVALID_URL");
        }
        let authority = rest.split(['/', '?']).next().unwrap_or_default();
        if authority.is_empty() || authority.contains('@') {
            return Err("INVALID_URL");
        }
    }
    Ok(())
}

fn keyring_entry(profile_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, &format!("ai:{profile_id}"))
        .map_err(|_| "KEYRING_UNAVAILABLE".to_string())
}

fn persist_credential(profile_id: &str, credential: &str) -> Result<(), String> {
    keyring_entry(profile_id)?
        .set_password(credential)
        .map_err(|_| "KEYRING_UNAVAILABLE".to_string())
}

fn load_credential(profile_id: &str) -> Result<Option<String>, String> {
    let entry = keyring_entry(profile_id)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("KEYRING_UNAVAILABLE".to_string()),
    }
}

fn delete_credential(profile_id: &str) {
    if let Ok(entry) = keyring_entry(profile_id) {
        let _ = entry.delete_credential();
    }
}

/// Locate the private stdio runtime. Never falls back to a shell or the data directory.
fn runtime_entry(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("WEALTH_AI_RUNTIME") {
        let candidate = PathBuf::from(path);
        if candidate.is_file() {
            return Ok(candidate);
        }
        return Err("AI_RUNTIME_MISSING".into());
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join("ai-runtime").join("main.mjs"));
        candidates.push(
            resources
                .join("resources")
                .join("ai-runtime")
                .join("main.mjs"),
        );
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("ai-runtime").join("main.mjs"));
            candidates.push(dir.join("resources").join("ai-runtime").join("main.mjs"));
        }
    }
    // Development checkout: <repo>/ai-runtime/main.mjs relative to src-tauri.
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("ai-runtime")
            .join("main.mjs"),
    );
    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| "AI_RUNTIME_MISSING".to_string())
}

fn spawn_runtime(app: &tauri::AppHandle) -> Result<RuntimeProcess, String> {
    let entry = runtime_entry(app)?;
    let node = resolve_node();
    let working_dir = std::env::temp_dir().join("wealth-ai-runtime");
    let _ = std::fs::create_dir_all(&working_dir);

    let mut command = Command::new(&node);
    command
        .arg(&entry)
        .arg("--stdio")
        .arg("--enable-ai-runtime")
        .current_dir(&working_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        // 子进程崩溃时唯一线索就是 stderr；以前直接丢弃，界面只能看到 RUNTIME_EXITED。
        // 现在落到临时目录的日志里（含凭据特征的行整行打码），便于定位。
        .stderr(Stdio::piped());
    // Minimal environment only: no HOME/USERPROFILE, so provider CLIs and ambient
    // credential files are not discoverable from the runtime process.
    command.env_clear();
    #[cfg(windows)]
    {
        if let Ok(system_root) = std::env::var("SystemRoot") {
            command.env("SystemRoot", system_root);
        }
        if let Ok(temp) = std::env::var("TEMP") {
            command.env("TEMP", temp);
        }
    }
    #[cfg(not(windows))]
    {
        if let Ok(temp) = std::env::var("TMPDIR") {
            command.env("TMPDIR", temp);
        }
    }
    command.env("PATH", node_path_hint(&node));

    let mut child = command.spawn().map_err(|error| {
        append_runtime_log(&format!("runtime spawn failed: {error}"));
        "AI_RUNTIME_MISSING".to_string()
    })?;
    append_runtime_log(&format!("runtime spawned (pid {})", child.id()));
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "AI_RUNTIME_MISSING".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "AI_RUNTIME_MISSING".to_string())?;
    if let Some(stderr) = child.stderr.take() {
        let log_path = working_dir.join("stderr.log");
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            let mut log = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
                .ok();
            for line in reader.lines().map_while(Result::ok) {
                let lower = line.to_ascii_lowercase();
                let safe = if lower.contains("sk-")
                    || lower.contains("bearer")
                    || lower.contains("api_key")
                {
                    "[redacted line containing credential-like text]".to_string()
                } else {
                    line.chars().take(500).collect::<String>()
                };
                if let Some(file) = log.as_mut() {
                    let _ = writeln!(file, "{safe}");
                }
            }
        });
    }
    let pending: Arc<Mutex<HashMap<String, Sender<Value>>>> = Arc::new(Mutex::new(HashMap::new()));
    let dead = Arc::new(AtomicBool::new(false));
    let reader_pending = Arc::clone(&pending);
    let reader_dead = Arc::clone(&dead);
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let Ok(value) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            let Some(id) = value
                .get("requestId")
                .and_then(Value::as_str)
                .map(str::to_string)
            else {
                continue;
            };
            if let Some(sender) = reader_pending.lock().unwrap().remove(&id) {
                let _ = sender.send(value);
            }
        }
        reader_dead.store(true, Ordering::SeqCst);
        for (_, sender) in reader_pending.lock().unwrap().drain() {
            let _ = sender.send(error_result("RUNTIME_EXITED"));
        }
    });
    Ok(RuntimeProcess {
        child,
        stdin,
        pending,
        dead,
    })
}

/// Packaged builds prefer the bundled sidecar Node next to the executable; the
/// development checkout falls back to `WEALTH_AI_NODE` and then PATH.
fn resolve_node() -> String {
    if let Ok(explicit) = std::env::var("WEALTH_AI_NODE") {
        if std::path::Path::new(&explicit).is_file() {
            return explicit;
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let name = if cfg!(windows) { "node.exe" } else { "node" };
            let candidate = dir.join(name);
            if candidate.is_file() {
                return candidate.to_string_lossy().to_string();
            }
        }
    }
    "node".to_string()
}

fn node_path_hint(node: &str) -> String {
    std::path::Path::new(node)
        .parent()
        .map(|dir| dir.to_string_lossy().to_string())
        .unwrap_or_default()
}

impl InnerState {
    fn next_request_id(&self) -> String {
        format!("broker-{}", self.counter.fetch_add(1, Ordering::SeqCst) + 1)
    }

    /// Write one frame and wait for its response outside of any process lock so
    /// that `ai_cancel` can run while an inference is still pending.
    fn request(
        &self,
        app: &tauri::AppHandle,
        frame: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        let id = frame
            .get("requestId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let (sender, receiver): (Sender<Value>, Receiver<Value>) = channel();
        {
            let mut runtime = self.runtime.lock().unwrap();
            if runtime
                .as_ref()
                .is_some_and(|process| process.dead.load(Ordering::SeqCst))
            {
                *runtime = None;
            }
            if runtime.is_none() {
                *runtime = Some(spawn_runtime(app)?);
            }
            let process = runtime.as_mut().expect("runtime just initialized");
            process.pending.lock().unwrap().insert(id.clone(), sender);
            let line = format!("{frame}\n");
            let written = process
                .stdin
                .write_all(line.as_bytes())
                .and_then(|_| process.stdin.flush());
            if written.is_err() {
                append_runtime_log(
                    "stdin write failed; dropping runtime (request will fail RUNTIME_EXITED)",
                );
                process.pending.lock().unwrap().remove(&id);
                *runtime = None;
                return Ok(error_result("RUNTIME_EXITED"));
            }
        }
        match receiver.recv_timeout(timeout) {
            Ok(value) => Ok(value),
            Err(RecvTimeoutError::Timeout) => {
                if let Some(process) = self.runtime.lock().unwrap().as_ref() {
                    process.pending.lock().unwrap().remove(&id);
                }
                Ok(error_result("TIMEOUT"))
            }
            Err(RecvTimeoutError::Disconnected) => Ok(error_result("RUNTIME_EXITED")),
        }
    }

    fn configure(
        &self,
        app: &tauri::AppHandle,
        profile: ConnectionProfile,
        credential: Option<String>,
        persist: bool,
    ) -> Result<Value, String> {
        if !self.enabled.load(Ordering::SeqCst) {
            return Ok(error_result("AI_DISABLED"));
        }
        if let Err(code) = validate_profile(&profile) {
            return Ok(error_result(code));
        }
        if credential
            .as_deref()
            .is_some_and(|value| !credential_looks_valid(value))
        {
            return Ok(error_result("INVALID_REQUEST"));
        }
        let mut effective = credential.clone();
        if persist {
            match &credential {
                Some(value) => {
                    if persist_credential(&profile.profile_id, value).is_err() {
                        return Ok(error_result("KEYRING_UNAVAILABLE"));
                    }
                }
                None => match load_credential(&profile.profile_id) {
                    Ok(found) => effective = found,
                    Err(code) => return Ok(error_result(&code)),
                },
            }
        }
        self.profiles.lock().unwrap().insert(
            profile.profile_id.clone(),
            StoredProfile {
                profile: profile.clone(),
                credential: effective.clone(),
                persisted: persist,
            },
        );
        self.configured.lock().unwrap().remove(&profile.profile_id);
        let frame = json!({
            "protocolVersion": 1,
            "requestId": self.next_request_id(),
            "operation": "configure",
            "profile": profile_frame(&profile, effective.as_deref()),
        });
        match self
            .request(app, frame, CONFIGURE_TIMEOUT)
            .and_then(interpret)
        {
            Ok(result) => {
                self.configured
                    .lock()
                    .unwrap()
                    .insert(profile.profile_id.clone());
                Ok(ok_result(json!({
                    "profileId": profile.profile_id,
                    "providerId": profile.provider_id,
                    "state": result.get("state").cloned().unwrap_or(json!("configured")),
                })))
            }
            Err(code) => Ok(error_result(&code)),
        }
    }

    /// Re-configure the runtime after a restart without touching the keyring.
    fn ensure_configured(&self, app: &tauri::AppHandle, profile_id: &str) -> Result<(), String> {
        if self.configured.lock().unwrap().contains(profile_id) {
            let alive = self
                .runtime
                .lock()
                .unwrap()
                .as_ref()
                .is_some_and(|process| !process.dead.load(Ordering::SeqCst));
            if alive {
                return Ok(());
            }
            self.configured.lock().unwrap().remove(profile_id);
        }
        let stored = self
            .profiles
            .lock()
            .unwrap()
            .get(profile_id)
            .cloned()
            .ok_or("PROFILE_UNAVAILABLE")?;
        let mut credential = stored.credential.clone();
        if credential.is_none() && stored.persisted {
            credential = load_credential(profile_id)?;
            if let Some(value) = &credential {
                if let Some(entry) = self.profiles.lock().unwrap().get_mut(profile_id) {
                    entry.credential = Some(value.clone());
                }
            }
        }
        let frame = json!({
            "protocolVersion": 1,
            "requestId": self.next_request_id(),
            "operation": "configure",
            "profile": profile_frame(&stored.profile, credential.as_deref()),
        });
        let response = self.request(app, frame, CONFIGURE_TIMEOUT)?;
        let _ = interpret(response)?;
        self.configured
            .lock()
            .unwrap()
            .insert(profile_id.to_string());
        Ok(())
    }

    fn models(
        &self,
        app: &tauri::AppHandle,
        profile_id: &str,
        provider_id: &str,
    ) -> Result<Value, String> {
        if !self.enabled.load(Ordering::SeqCst) {
            return Ok(error_result("AI_DISABLED"));
        }
        if !is_identifier(profile_id) || !PROVIDERS.contains(&provider_id) {
            return Ok(error_result("INVALID_REQUEST"));
        }
        let known = self
            .profiles
            .lock()
            .unwrap()
            .get(profile_id)
            .map(|entry| entry.profile.provider_id.clone());
        if known.as_deref() != Some(provider_id) {
            return Ok(error_result("PROFILE_UNAVAILABLE"));
        }
        if let Err(code) = self.ensure_configured(app, profile_id) {
            return Ok(error_result(&code));
        }
        let frame = json!({
            "protocolVersion": 1,
            "requestId": self.next_request_id(),
            "operation": "models",
            "profileId": profile_id,
            "providerId": provider_id,
        });
        let mut response = self.request(app, frame.clone(), CONFIGURE_TIMEOUT)?;
        if is_runtime_exited(&response) {
            append_runtime_log(
                "models hit RUNTIME_EXITED; rebuilding the runtime and retrying once",
            );
            self.configured.lock().unwrap().remove(profile_id);
            if self.ensure_configured(app, profile_id).is_ok() {
                response = self.request(app, frame, CONFIGURE_TIMEOUT)?;
            }
        }
        match interpret(response) {
            Ok(result) => Ok(ok_result(
                json!({ "models": result.get("models").cloned().unwrap_or(json!([])) }),
            )),
            Err(code) => Ok(error_result(&code)),
        }
    }

    fn infer(&self, app: &tauri::AppHandle, request: InferenceRequest) -> Result<Value, String> {
        if !self.enabled.load(Ordering::SeqCst) {
            return Ok(error_result("AI_DISABLED"));
        }
        if !is_identifier(&request.request_id)
            || !is_identifier(&request.profile_id)
            || !PROVIDERS.contains(&request.provider_id.as_str())
        {
            return Ok(error_result("INVALID_REQUEST"));
        }
        let known = self
            .profiles
            .lock()
            .unwrap()
            .get(&request.profile_id)
            .map(|entry| entry.profile.provider_id.clone());
        if known.as_deref() != Some(request.provider_id.as_str()) {
            return Ok(error_result("PROFILE_UNAVAILABLE"));
        }
        if let Err(code) = self.ensure_configured(app, &request.profile_id) {
            return Ok(error_result(&code));
        }
        let frame = json!({
            "protocolVersion": 1,
            "requestId": request.request_id,
            "operation": "infer",
            "profileId": request.profile_id,
            "providerId": request.provider_id,
            "task": request.task,
            "input": request.input,
        });
        let mut response = self.request(app, frame.clone(), INFER_TIMEOUT)?;
        if is_runtime_exited(&response) {
            append_runtime_log(
                "infer hit RUNTIME_EXITED; rebuilding the runtime and retrying once",
            );
            self.configured.lock().unwrap().remove(&request.profile_id);
            if self.ensure_configured(app, &request.profile_id).is_ok() {
                response = self.request(app, frame, INFER_TIMEOUT)?;
            }
        }
        match interpret(response) {
            Ok(result) => Ok(ok_result(result)),
            Err(code) => Ok(error_result(&code)),
        }
    }

    /// 图片视觉提取：只有被声明为可读图的连接才会收到图片，其余一律失败关闭。
    fn vision_extract(
        &self,
        app: &tauri::AppHandle,
        request: InferenceRequest,
    ) -> Result<Value, String> {
        if !self.enabled.load(Ordering::SeqCst) {
            return Ok(error_result("AI_DISABLED"));
        }
        if !is_identifier(&request.request_id)
            || !is_identifier(&request.profile_id)
            || !PROVIDERS.contains(&request.provider_id.as_str())
            || request.task != VISION_TASK
        {
            return Ok(error_result("INVALID_REQUEST"));
        }
        if let Err(code) = validate_vision_input(&request.input) {
            return Ok(error_result(code));
        }
        let declared = self
            .profiles
            .lock()
            .unwrap()
            .get(&request.profile_id)
            .map(|entry| {
                (
                    entry.profile.provider_id.clone(),
                    entry.profile.supports_vision,
                )
            });
        match declared {
            Some((provider_id, supports_vision)) if provider_id == request.provider_id => {
                if supports_vision != Some(true) {
                    return Ok(error_result("VISION_UNSUPPORTED"));
                }
            }
            _ => return Ok(error_result("PROFILE_UNAVAILABLE")),
        }
        if let Err(code) = self.ensure_configured(app, &request.profile_id) {
            return Ok(error_result(&code));
        }
        let frame = json!({
            "protocolVersion": 1,
            "requestId": request.request_id,
            "operation": "vision-extract",
            "profileId": request.profile_id,
            "providerId": request.provider_id,
            "task": request.task,
            "input": request.input,
        });
        match self.request(app, frame, VISION_TIMEOUT).and_then(interpret) {
            Ok(result) => Ok(ok_result(result)),
            Err(code) => Ok(error_result(&code)),
        }
    }

    /// 研究检索：由 Node 运行时按白名单抓取用户给出的公网 HTTPS 链接。
    fn research_lookup(
        &self,
        app: &tauri::AppHandle,
        profile_id: &str,
        provider_id: &str,
        urls: Vec<String>,
    ) -> Result<Value, String> {
        if !self.enabled.load(Ordering::SeqCst) {
            return Ok(error_result("AI_DISABLED"));
        }
        if !is_identifier(profile_id) || !PROVIDERS.contains(&provider_id) {
            return Ok(error_result("INVALID_REQUEST"));
        }
        if let Err(code) = validate_research_urls(&urls) {
            return Ok(error_result(code));
        }
        let known = self
            .profiles
            .lock()
            .unwrap()
            .get(profile_id)
            .map(|entry| entry.profile.provider_id.clone());
        if known.as_deref() != Some(provider_id) {
            return Ok(error_result("PROFILE_UNAVAILABLE"));
        }
        if let Err(code) = self.ensure_configured(app, profile_id) {
            return Ok(error_result(&code));
        }
        let frame = json!({
            "protocolVersion": 1,
            "requestId": self.next_request_id(),
            "operation": "research-lookup",
            "profileId": profile_id,
            "providerId": provider_id,
            "urls": urls,
        });
        match self
            .request(app, frame, RESEARCH_TIMEOUT)
            .and_then(interpret)
        {
            Ok(result) => Ok(ok_result(result)),
            Err(code) => Ok(error_result(&code)),
        }
    }

    fn cancel(&self, app: &tauri::AppHandle, target_request_id: &str) -> Result<Value, String> {
        if !is_identifier(target_request_id) {
            return Ok(error_result("INVALID_REQUEST"));
        }
        if !self.enabled.load(Ordering::SeqCst) || self.runtime.lock().unwrap().is_none() {
            return Ok(ok_result(json!({ "cancelled": false })));
        }
        let frame = json!({
            "protocolVersion": 1,
            "requestId": self.next_request_id(),
            "operation": "cancel",
            "targetRequestId": target_request_id,
        });
        match self.request(app, frame, CANCEL_TIMEOUT).and_then(interpret) {
            Ok(result) => Ok(ok_result(result)),
            Err(code) => Ok(error_result(&code)),
        }
    }

    fn remove_profile(&self, app: &tauri::AppHandle, profile_id: &str) -> Result<Value, String> {
        if !is_identifier(profile_id) {
            return Ok(error_result("INVALID_REQUEST"));
        }
        let removed = self.profiles.lock().unwrap().remove(profile_id).is_some();
        self.configured.lock().unwrap().remove(profile_id);
        delete_credential(profile_id);
        if self.enabled.load(Ordering::SeqCst)
            && self
                .runtime
                .lock()
                .unwrap()
                .as_ref()
                .is_some_and(|process| !process.dead.load(Ordering::SeqCst))
        {
            let frame = json!({
                "protocolVersion": 1,
                "requestId": self.next_request_id(),
                "operation": "removeProfile",
                "profileId": profile_id,
            });
            let _ = self.request(app, frame, CANCEL_TIMEOUT);
        }
        Ok(ok_result(json!({ "removed": removed })))
    }

    fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::SeqCst);
        if !enabled {
            append_runtime_log("AI disabled by user: killing runtime on purpose");
            if let Some(mut process) = self.runtime.lock().unwrap().take() {
                drop(process.stdin);
                let _ = process.child.kill();
                let _ = process.child.wait();
            }
            self.configured.lock().unwrap().clear();
            for entry in self.profiles.lock().unwrap().values_mut() {
                entry.credential = None;
            }
        }
    }
}

#[tauri::command]
pub async fn ai_set_enabled(
    broker: tauri::State<'_, AiBroker>,
    enabled: bool,
) -> Result<Value, String> {
    broker.inner.set_enabled(enabled);
    Ok(ok_result(json!({ "enabled": enabled })))
}

#[tauri::command]
pub async fn ai_configure_profile(
    app: tauri::AppHandle,
    broker: tauri::State<'_, AiBroker>,
    profile: ConnectionProfile,
    credential: Option<String>,
    persist_credential: Option<bool>,
) -> Result<Value, String> {
    let inner = Arc::clone(&broker.inner);
    tauri::async_runtime::spawn_blocking(move || {
        inner.configure(
            &app,
            profile,
            credential,
            persist_credential.unwrap_or(false),
        )
    })
    .await
    .map_err(|_| "BROKER_TASK_FAILED".to_string())?
}

#[tauri::command]
pub async fn ai_models(
    app: tauri::AppHandle,
    broker: tauri::State<'_, AiBroker>,
    profile_id: String,
    provider_id: String,
) -> Result<Value, String> {
    let inner = Arc::clone(&broker.inner);
    tauri::async_runtime::spawn_blocking(move || inner.models(&app, &profile_id, &provider_id))
        .await
        .map_err(|_| "BROKER_TASK_FAILED".to_string())?
}

#[tauri::command]
pub async fn ai_infer(
    app: tauri::AppHandle,
    broker: tauri::State<'_, AiBroker>,
    request: InferenceRequest,
) -> Result<Value, String> {
    let inner = Arc::clone(&broker.inner);
    tauri::async_runtime::spawn_blocking(move || inner.infer(&app, request))
        .await
        .map_err(|_| "BROKER_TASK_FAILED".to_string())?
}

#[tauri::command]
pub async fn ai_vision_extract(
    app: tauri::AppHandle,
    broker: tauri::State<'_, AiBroker>,
    request: InferenceRequest,
) -> Result<Value, String> {
    let inner = Arc::clone(&broker.inner);
    tauri::async_runtime::spawn_blocking(move || inner.vision_extract(&app, request))
        .await
        .map_err(|_| "BROKER_TASK_FAILED".to_string())?
}

#[tauri::command]
pub async fn ai_research_lookup(
    app: tauri::AppHandle,
    broker: tauri::State<'_, AiBroker>,
    profile_id: String,
    provider_id: String,
    urls: Vec<String>,
) -> Result<Value, String> {
    let inner = Arc::clone(&broker.inner);
    tauri::async_runtime::spawn_blocking(move || {
        inner.research_lookup(&app, &profile_id, &provider_id, urls)
    })
    .await
    .map_err(|_| "BROKER_TASK_FAILED".to_string())?
}

#[tauri::command]
pub async fn ai_cancel(
    app: tauri::AppHandle,
    broker: tauri::State<'_, AiBroker>,
    target_request_id: String,
) -> Result<Value, String> {
    let inner = Arc::clone(&broker.inner);
    tauri::async_runtime::spawn_blocking(move || inner.cancel(&app, &target_request_id))
        .await
        .map_err(|_| "BROKER_TASK_FAILED".to_string())?
}

#[tauri::command]
pub async fn ai_remove_profile(
    app: tauri::AppHandle,
    broker: tauri::State<'_, AiBroker>,
    profile_id: String,
) -> Result<Value, String> {
    let inner = Arc::clone(&broker.inner);
    tauri::async_runtime::spawn_blocking(move || inner.remove_profile(&app, &profile_id))
        .await
        .map_err(|_| "BROKER_TASK_FAILED".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile() -> ConnectionProfile {
        ConnectionProfile {
            profile_id: "connection-1".into(),
            provider_id: "gateway".into(),
            auth_kind: "api-key".into(),
            model_id: "synthetic-model".into(),
            endpoint: Some("https://gateway.example.com/v1".into()),
            supports_vision: None,
        }
    }

    #[test]
    fn identifiers_are_bounded() {
        assert!(is_identifier("connection-1"));
        assert!(is_identifier("a.b_c:d-e"));
        assert!(!is_identifier(""));
        assert!(!is_identifier("-leading"));
        assert!(!is_identifier("has space"));
        assert!(!is_identifier(&"a".repeat(129)));
    }

    #[test]
    fn profiles_reject_unknown_providers_and_control_characters() {
        assert!(validate_profile(&profile()).is_ok());
        assert!(validate_profile(&ConnectionProfile {
            provider_id: "unknown".into(),
            ..profile()
        })
        .is_err());
        assert!(validate_profile(&ConnectionProfile {
            auth_kind: "oauth".into(),
            ..profile()
        })
        .is_err());
        assert!(validate_profile(&ConnectionProfile {
            endpoint: Some("https://x/v1\nx".into()),
            ..profile()
        })
        .is_err());
    }

    #[test]
    fn credentials_must_be_single_line_and_bounded() {
        assert!(credential_looks_valid("sk-synthetic"));
        assert!(!credential_looks_valid(""));
        assert!(!credential_looks_valid("line\nbreak"));
        assert!(!credential_looks_valid(&"x".repeat(MAX_CREDENTIAL_LEN + 1)));
    }

    #[test]
    fn configure_frames_carry_the_credential_only_in_the_management_frame() {
        let frame = profile_frame(&profile(), Some("sk-synthetic"));
        assert_eq!(
            frame.get("credential").and_then(Value::as_str),
            Some("sk-synthetic")
        );
        assert_eq!(
            frame.get("modelId").and_then(Value::as_str),
            Some("synthetic-model")
        );
        let without = profile_frame(&profile(), None);
        assert!(without.get("credential").is_none());
    }

    #[test]
    fn envelopes_map_to_result_or_redacted_code() {
        assert_eq!(
            interpret(json!({"ok": true, "result": {"text": "hi"}})).unwrap(),
            json!({"text": "hi"})
        );
        let error = interpret(
            json!({"ok": false, "error": {"code": "AUTH_REQUIRED", "message": "raw provider text"}}),
        );
        assert_eq!(error.unwrap_err(), "AUTH_REQUIRED");
        let missing = interpret(json!({"ok": false}));
        assert_eq!(missing.unwrap_err(), "PROVIDER_FAILED");
    }

    #[test]
    fn broker_is_disabled_by_default_and_enabling_does_not_start_a_process() {
        let broker = AiBroker::default();
        assert!(!broker.inner.enabled.load(Ordering::SeqCst));
        broker.inner.set_enabled(true);
        assert!(broker.inner.enabled.load(Ordering::SeqCst));
        assert!(broker.inner.runtime.lock().unwrap().is_none());
        broker.inner.set_enabled(false);
        assert!(!broker.inner.enabled.load(Ordering::SeqCst));
    }

    #[test]
    fn runtime_exit_detection_only_matches_that_code() {
        assert!(is_runtime_exited(
            &json!({ "ok": false, "error": { "code": "RUNTIME_EXITED" } })
        ));
        assert!(!is_runtime_exited(
            &json!({ "ok": false, "error": { "code": "TIMEOUT" } })
        ));
        assert!(!is_runtime_exited(&json!({ "ok": true, "result": {} })));
    }

    fn vision_input() -> Value {
        json!({ "images": [{ "mimeType": "image/png", "data": "aGVsbG8=" }], "text": "读取这张合成截图" })
    }

    #[test]
    fn vision_input_is_bounded_and_fails_closed() {
        assert!(validate_vision_input(&vision_input()).is_ok());
        // 未知字段、空图片列表与非法 MIME 都必须被拒绝。
        assert!(validate_vision_input(&json!({ "images": [], "toolCalls": [] })).is_err());
        assert!(validate_vision_input(
            &json!({ "images": [{ "mimeType": "image/gif", "data": "aGVsbG8=" }] })
        )
        .is_err());
        assert!(validate_vision_input(
            &json!({ "images": [{ "mimeType": "image/png", "data": "not base64!" }] })
        )
        .is_err());
        assert!(validate_vision_input(&json!({ "images": [{ "mimeType": "image/png", "data": "aGVsbG8=", "url": "https://x" }] })).is_err());
        // 单张超限与总量超限返回明确的体积错误码。
        let huge = "A".repeat(MAX_IMAGE_BASE64_CHARS + 1);
        assert_eq!(
            validate_vision_input(
                &json!({ "images": [{ "mimeType": "image/jpeg", "data": huge }] })
            )
            .unwrap_err(),
            "IMAGE_TOO_LARGE"
        );
        let image = json!({ "mimeType": "image/png", "data": "A".repeat(MAX_IMAGE_BASE64_CHARS) });
        assert_eq!(
            validate_vision_input(&json!({ "images": [image.clone(), image.clone(), image] }))
                .unwrap_err(),
            "IMAGE_TOO_LARGE"
        );
        let count = json!({ "images": (0..MAX_IMAGES + 1).map(|_| json!({ "mimeType": "image/png", "data": "aGVsbG8=" })).collect::<Vec<_>>() });
        assert_eq!(
            validate_vision_input(&count).unwrap_err(),
            "INVALID_REQUEST"
        );
    }

    #[test]
    fn research_urls_require_public_https_without_credentials_or_duplicates() {
        assert!(validate_research_urls(&["https://example.com/article".into()]).is_ok());
        for invalid in [
            vec!["http://example.com".to_string()],
            vec!["https://user:pass@example.com".to_string()],
            vec!["https://example.com/a#section".to_string()],
            vec!["https://example.com/a\nGET /".to_string()],
            vec!["https:/example.com".to_string()],
            vec!["".to_string()],
        ] {
            assert_eq!(validate_research_urls(&invalid).unwrap_err(), "INVALID_URL");
        }
        assert_eq!(validate_research_urls(&[]).unwrap_err(), "INVALID_REQUEST");
        assert!(validate_research_urls(&[
            "https://example.com".into(),
            "https://example.com".into()
        ])
        .is_err());
        let many: Vec<String> = (0..MAX_RESEARCH_URLS + 1)
            .map(|index| format!("https://example.com/{index}"))
            .collect();
        assert_eq!(
            validate_research_urls(&many).unwrap_err(),
            "INVALID_REQUEST"
        );
    }

    #[test]
    fn profiles_serialize_the_declared_vision_capability_only_when_set() {
        let declared = ConnectionProfile {
            supports_vision: Some(true),
            ..profile()
        };
        assert_eq!(
            profile_frame(&declared, None)
                .get("supportsVision")
                .and_then(Value::as_bool),
            Some(true)
        );
        assert!(profile_frame(&profile(), None)
            .get("supportsVision")
            .is_none());
    }
}
