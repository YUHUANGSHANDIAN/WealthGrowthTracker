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
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

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

enum RuntimeTransport {
    Standard { child: Child, stdin: ChildStdin },
    Sidecar { child: CommandChild },
}

impl RuntimeTransport {
    fn write(&mut self, bytes: &[u8]) -> Result<(), String> {
        match self {
            Self::Standard { stdin, .. } => stdin
                .write_all(bytes)
                .and_then(|_| stdin.flush())
                .map_err(|error| error.to_string()),
            Self::Sidecar { child } => child.write(bytes).map_err(|error| error.to_string()),
        }
    }

    fn status(&mut self) -> String {
        match self {
            Self::Standard { child, .. } => child
                .try_wait()
                .ok()
                .flatten()
                .map(|status| status.to_string())
                .unwrap_or_else(|| "still-running-or-unknown".to_string()),
            Self::Sidecar { .. } => "plugin-managed-sidecar".to_string(),
        }
    }

    fn pid(&self) -> u32 {
        match self {
            Self::Standard { child, .. } => child.id(),
            Self::Sidecar { child } => child.pid(),
        }
    }

    fn terminate(self) -> String {
        match self {
            Self::Standard { mut child, stdin } => {
                drop(stdin);
                let _ = child.kill();
                child
                    .wait()
                    .map(|status| status.to_string())
                    .unwrap_or_else(|error| format!("wait failed: {error}"))
            }
            Self::Sidecar { child } => {
                let pid = child.pid();
                match child.kill() {
                    Ok(()) => format!("plugin-managed kill requested; pid={pid}"),
                    Err(error) => format!("plugin-managed kill failed; pid={pid}: {error}"),
                }
            }
        }
    }
}

struct RuntimeProcess {
    transport: RuntimeTransport,
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

/// 无界面自检：用与 Broker 完全相同的启动参数（env_clear、工作目录、stdin/stdout 管道）
/// 拉起随包运行时，依次发 status / configure / infer 三帧并收集响应与 stderr。
/// 只用于 `--ai-selftest`，便于在没有 GUI 的情况下验证运行时链路。
/// 走**真实 AiBroker**（含 pending/reader/重试层）的自检：不必打开窗口即可复现 GUI 路径。
pub fn run_broker_selftest() -> Value {
    run_broker_selftest_variant("openai", "gpt-4o-mini", false)
}

/// 用 Broker 路径跑一次 deepseek 配置（复现 GUI 里的真实参数差异）。
pub fn run_broker_selftest_deepseek() -> Value {
    // 与用户实际参数一致：model=deepseek-flash、credential 35 位纯 ASCII。
    run_broker_selftest_variant("deepseek", "deepseek-flash", true)
}

/// 在真实 Tauri GUI 进程中验证官方 sidecar 传输能启动并配置 Runtime。
/// 仅由 `--ai-plugin-selftest` 调用；不读取用户凭据、不访问供应商。
pub fn run_plugin_configure_selftest(app: &tauri::AppHandle) -> Value {
    let broker = AiBroker::default();
    broker.inner.set_enabled(true);
    let profile = ConnectionProfile {
        profile_id: "selftest".into(),
        provider_id: "deepseek".into(),
        auth_kind: "api-key".into(),
        model_id: "deepseek-flash".into(),
        endpoint: None,
        supports_vision: None,
    };
    let configure = broker.inner.configure(
        Some(app),
        profile,
        Some(format!("sk-{}", "a".repeat(32))),
        true,
    );
    let report = json!({
        "ok": configure.is_ok(),
        "configure": configure.unwrap_or_else(|error| json!({ "brokerError": error })),
    });
    let _ = broker.inner.remove_profile(Some(app), "selftest", false);
    broker.inner.set_enabled(false);
    append_runtime_log(&format!("plugin GUI selftest: {report}"));
    report
}

/// 应用启动时在**自身 GUI 进程**里跑一次自检并写日志（不阻塞界面、不写凭据）。
/// 这样能回答一个关键问题：子进程在 GUI 父进程下是否也会被杀。
pub fn log_gui_selftest() {
    std::thread::spawn(|| {
        let report = run_broker_selftest_with(false);
        append_runtime_log(&format!("gui selftest: {report}"));
    });
}

/// 与 GUI 默认一致的「持久化凭据」自检：真实写一次系统安全存储，结束时删除该测试项。
pub fn run_broker_selftest_persist() -> Value {
    run_broker_selftest_with(true)
}

fn run_broker_selftest_with(persist: bool) -> Value {
    run_broker_selftest_variant("openai", "gpt-4o-mini", persist)
}

fn run_broker_selftest_variant(provider_id: &str, model_id: &str, persist: bool) -> Value {
    let broker = AiBroker::default();
    broker.inner.set_enabled(true);
    let profile = ConnectionProfile {
        profile_id: "selftest".into(),
        provider_id: provider_id.into(),
        auth_kind: "api-key".into(),
        model_id: model_id.into(),
        endpoint: None,
        supports_vision: None,
    };
    let configure = broker.inner.configure(
        None,
        profile,
        Some(if provider_id == "deepseek" {
            format!("sk-{}", "a".repeat(32))
        } else {
            "sk-synthetic-selftest".to_string()
        }),
        persist,
    );
    let infer = broker.inner.infer(
        None,
        InferenceRequest {
            request_id: "selftest-infer".into(),
            profile_id: "selftest".into(),
            provider_id: provider_id.into(),
            task: "analysis-question".into(),
            input: json!({ "text": "synthetic", "facts": [] }),
        },
    );
    let runtime_alive = broker
        .inner
        .runtime
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|process| !process.dead.load(Ordering::SeqCst));
    let report = json!({
        "ok": configure.is_ok() && infer.is_ok(),
        "persist": persist,
        "configure": configure.unwrap_or_else(|error| json!({ "brokerError": error })),
        "infer": infer.unwrap_or_else(|error| json!({ "brokerError": error })),
        "runtimeAliveBeforeShutdown": runtime_alive,
    });
    if persist {
        // 清掉测试期间写进系统安全存储的条目。
        let _ = broker.inner.remove_profile(None, "selftest", false);
    }
    broker.inner.set_enabled(false);
    report
}

pub fn run_selftest() -> Value {
    let exe = std::env::current_exe().unwrap_or_default();
    let dir = exe.parent().map(PathBuf::from).unwrap_or_default();
    let entry = dir.join("ai-runtime").join("main.mjs");
    let node = dir.join("node.exe");
    if !entry.is_file() || !node.is_file() {
        return json!({ "ok": false, "error": "AI_RUNTIME_MISSING", "entry": entry.to_string_lossy(), "node": node.to_string_lossy() });
    }
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
        .stderr(Stdio::piped());
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
    command.env("PATH", dir.to_string_lossy().to_string());
    let Ok(mut child) = command.spawn() else {
        return json!({ "ok": false, "error": "SPAWN_FAILED" });
    };
    let stderr_tail = Arc::new(Mutex::new(String::new()));
    if let Some(stderr) = child.stderr.take() {
        let sink = Arc::clone(&stderr_tail);
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let mut sink = sink.lock().unwrap();
                sink.push_str(&line);
                sink.push('\n');
            }
        });
    }
    let mut stdin = match child.stdin.take() {
        Some(stdin) => stdin,
        None => return json!({ "ok": false, "error": "STDIN_UNAVAILABLE" }),
    };
    let stdout = child.stdout.take();
    let (sender, receiver) = channel::<String>();
    if let Some(stdout) = stdout {
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if sender.send(line).is_err() {
                    break;
                }
            }
        });
    }
    let frames = [
        json!({ "protocolVersion": 1, "requestId": "selftest-status", "operation": "status" })
            .to_string(),
        json!({
            "protocolVersion": 1, "requestId": "selftest-configure", "operation": "configure",
            "profile": { "profileId": "selftest", "providerId": "openai", "authKind": "api-key",
                         "modelId": "gpt-4o-mini", "credential": "sk-synthetic-selftest" }
        })
        .to_string(),
        json!({
            "protocolVersion": 1, "requestId": "selftest-infer", "operation": "infer",
            "profileId": "selftest", "providerId": "openai", "task": "analysis-question",
            "input": { "text": "synthetic", "facts": [] }
        })
        .to_string(),
    ];
    let mut responses = Vec::new();
    for frame in frames {
        if writeln!(stdin, "{frame}").is_err() {
            break;
        }
        let _ = stdin.flush();
        match receiver.recv_timeout(Duration::from_secs(45)) {
            Ok(line) => responses
                .push(serde_json::from_str::<Value>(&line).unwrap_or(json!({ "raw": line }))),
            Err(_) => responses.push(json!({ "error": "NO_RESPONSE_IN_TIME" })),
        }
    }
    drop(stdin);
    let status = child.wait().ok().map(|status| status.to_string());
    json!({
        "ok": true,
        "responses": responses,
        "runtimeStatus": status,
        "stderr": stderr_tail.lock().unwrap().clone(),
    })
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
fn runtime_entry(app: Option<&tauri::AppHandle>) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("WEALTH_AI_RUNTIME") {
        let candidate = PathBuf::from(path);
        if candidate.is_file() {
            return Ok(candidate);
        }
        return Err("AI_RUNTIME_MISSING".into());
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(resources) = app.and_then(|app| app.path().resource_dir().ok()) {
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

fn sanitize_runtime_stderr(line: &str) -> String {
    let lower = line.to_ascii_lowercase();
    if lower.contains("sk-") || lower.contains("bearer") || lower.contains("api_key") {
        "[redacted line containing credential-like text]".to_string()
    } else {
        line.chars().take(500).collect::<String>()
    }
}

fn dispatch_runtime_response(line: &str, pending: &Arc<Mutex<HashMap<String, Sender<Value>>>>) {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return;
    };
    let Some(id) = value
        .get("requestId")
        .and_then(Value::as_str)
        .map(str::to_string)
    else {
        return;
    };
    if let Some(sender) = pending.lock().unwrap().remove(&id) {
        let _ = sender.send(value);
    }
}

fn finish_runtime_reader(
    pending: &Arc<Mutex<HashMap<String, Sender<Value>>>>,
    dead: &Arc<AtomicBool>,
) {
    dead.store(true, Ordering::SeqCst);
    for (_, sender) in pending.lock().unwrap().drain() {
        let _ = sender.send(error_result("RUNTIME_EXITED"));
    }
}

/// Tauri resource lookup returns Windows verbatim paths (`\\?\D:\...`). Node's
/// launcher can parse-check those paths but may exit before evaluating them when
/// launched from a GUI process. Convert only the representation; the target stays
/// the same file and is still validated above.
fn node_compatible_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let text = path.to_string_lossy();
        if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{unc}"));
        }
        if let Some(local) = text.strip_prefix(r"\\?\") {
            return PathBuf::from(local);
        }
    }
    path
}

fn spawn_runtime(app: Option<&tauri::AppHandle>) -> Result<RuntimeProcess, String> {
    let entry = node_compatible_path(runtime_entry(app)?);
    let node = resolve_node();
    let working_dir = node_compatible_path(std::env::temp_dir().join("wealth-ai-runtime"));
    let _ = std::fs::create_dir_all(&working_dir);
    append_runtime_log(&format!(
        "runtime launch preparing: node={node} entry={} cwd={}",
        entry.to_string_lossy(),
        working_dir.to_string_lossy()
    ));

    // On Windows the GUI process's direct std::process pipes can be closed before
    // node evaluates main.mjs. Tauri's official shell transport uses explicit
    // os_pipe handles and SharedChild, avoiding that GUI-only startup race.
    #[cfg(windows)]
    if let Some(app) = app {
        return spawn_plugin_runtime(app, &node, &entry, working_dir);
    }

    spawn_standard_runtime(&node, &entry, working_dir)
}

fn spawn_plugin_runtime(
    app: &tauri::AppHandle,
    node: &str,
    entry: &std::path::Path,
    working_dir: PathBuf,
) -> Result<RuntimeProcess, String> {
    let mut command = app
        .shell()
        .command(node)
        .arg(entry)
        .arg("--stdio")
        .arg("--enable-ai-runtime")
        .current_dir(&working_dir)
        .env_clear()
        .env("PATH", node_path_hint(node))
        .env("WGT_AI_DIAGNOSTICS", "1");
    #[cfg(windows)]
    {
        if let Ok(system_root) = std::env::var("SystemRoot") {
            command = command.env("SystemRoot", system_root);
        }
        if let Ok(temp) = std::env::var("TEMP") {
            command = command.env("TEMP", temp);
        }
    }
    let (mut events, child) = command.spawn().map_err(|error| {
        append_runtime_log(&format!("plugin runtime spawn failed: {error}"));
        "AI_RUNTIME_MISSING".to_string()
    })?;
    append_runtime_log(&format!("plugin runtime spawned (pid {})", child.pid()));
    let pending: Arc<Mutex<HashMap<String, Sender<Value>>>> = Arc::new(Mutex::new(HashMap::new()));
    let dead = Arc::new(AtomicBool::new(false));
    let reader_pending = Arc::clone(&pending);
    let reader_dead = Arc::clone(&dead);
    std::thread::spawn(move || {
        while let Some(event) = tauri::async_runtime::block_on(events.recv()) {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    dispatch_runtime_response(line.trim_end_matches(['\r', '\n']), &reader_pending);
                }
                CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    append_runtime_log(&sanitize_runtime_stderr(line.trim_end()));
                }
                CommandEvent::Error(error) => {
                    append_runtime_log(&format!("plugin runtime event error: {error}"));
                    break;
                }
                CommandEvent::Terminated(payload) => {
                    append_runtime_log(&format!(
                        "plugin runtime terminated: code={:?} signal={:?}",
                        payload.code, payload.signal
                    ));
                    break;
                }
                _ => {}
            }
        }
        finish_runtime_reader(&reader_pending, &reader_dead);
    });
    Ok(RuntimeProcess {
        transport: RuntimeTransport::Sidecar { child },
        pending,
        dead,
    })
}

fn spawn_standard_runtime(
    node: &str,
    entry: &std::path::Path,
    working_dir: PathBuf,
) -> Result<RuntimeProcess, String> {
    let mut command = Command::new(node);
    command
        .arg(entry)
        .arg("--stdio")
        .arg("--enable-ai-runtime")
        .current_dir(&working_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
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
    command.env("PATH", node_path_hint(node));
    command.env("WGT_AI_DIAGNOSTICS", "1");

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }

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
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                append_runtime_log(&sanitize_runtime_stderr(&line));
            }
        });
    }
    let pending: Arc<Mutex<HashMap<String, Sender<Value>>>> = Arc::new(Mutex::new(HashMap::new()));
    let dead = Arc::new(AtomicBool::new(false));
    let reader_pending = Arc::clone(&pending);
    let reader_dead = Arc::clone(&dead);
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            dispatch_runtime_response(&line, &reader_pending);
        }
        finish_runtime_reader(&reader_pending, &reader_dead);
    });
    Ok(RuntimeProcess {
        transport: RuntimeTransport::Standard { child, stdin },
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
        app: Option<&tauri::AppHandle>,
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
            let written = process.transport.write(line.as_bytes());
            if written.is_err() {
                let status = process.transport.status();
                append_runtime_log(&format!(
                    "stdin write failed; runtime status={status}; dropping runtime (request will fail RUNTIME_EXITED)"
                ));
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
            Err(RecvTimeoutError::Disconnected) => {
                // 读线程结束说明子进程的 stdout 已关闭：把退出码一起记下来。
                let status = self
                    .runtime
                    .lock()
                    .unwrap()
                    .as_mut()
                    .map(|process| process.transport.status())
                    .unwrap_or_else(|| "still-running-or-unknown".to_string());
                append_runtime_log(&format!(
                    "request {id} got RUNTIME_EXITED; child status={status}"
                ));
                Ok(error_result("RUNTIME_EXITED"))
            }
        }
    }

    fn configure_frame(&self, profile: &ConnectionProfile, credential: Option<&str>) -> Value {
        json!({
            "protocolVersion": 1,
            "requestId": self.next_request_id(),
            "operation": "configure",
            "profile": profile_frame(profile, credential),
        })
    }

    /// Drop a runtime whose stdout closed before the first response. `Child` does not
    /// terminate the process on drop, so explicitly clean up an orphan before retrying.
    fn discard_runtime(&self, reason: &str) {
        let Some(process) = self.runtime.lock().unwrap().take() else {
            return;
        };
        let pid = process.transport.pid();
        let status = process.transport.terminate();
        append_runtime_log(&format!(
            "discarded runtime ({reason}); pid={pid} status={status}"
        ));
    }

    fn configure(
        &self,
        app: Option<&tauri::AppHandle>,
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
        append_runtime_log(&format!(
            "configure start: provider={} auth={} model={} persist={} endpoint={} credentialLen={} credentialClasses={}",
            profile.provider_id,
            profile.auth_kind,
            profile.model_id.chars().take(64).collect::<String>(),
            persist,
            profile.endpoint.is_some(),
            effective.as_deref().map(str::len).unwrap_or(0),
            effective
                .as_deref()
                .map(|value| {
                    let mut classes = Vec::new();
                    if value.chars().all(|c| c.is_ascii_alphanumeric()) { classes.push("alnum"); }
                    if value.chars().all(|c| c.is_ascii_graphic()) { classes.push("ascii-graphic"); }
                    if value.chars().any(|c| c == '+') { classes.push("plus"); }
                    if value.chars().any(|c| c == '/') { classes.push("slash"); }
                    if value.chars().any(|c| c == '=') { classes.push("equals"); }
                    if value.chars().any(|c| c.is_whitespace()) { classes.push("whitespace"); }
                    if !value.is_ascii() {
                        classes.push("non-ascii");
                    }
                    classes.join(",")
                })
                .unwrap_or_default()
        ));
        let frame = self.configure_frame(&profile, effective.as_deref());
        let mut outcome = self
            .request(app, frame, CONFIGURE_TIMEOUT)
            .and_then(interpret);
        if matches!(&outcome, Err(code) if code == "RUNTIME_EXITED") {
            // Node can occasionally lose its inherited stdio handles on the first
            // launch in a Windows GUI session. The process itself is still healthy;
            // rebuilding once avoids surfacing a transient startup race.
            self.discard_runtime("configure received RUNTIME_EXITED");
            let retry_frame = self.configure_frame(&profile, effective.as_deref());
            outcome = self
                .request(app, retry_frame, CONFIGURE_TIMEOUT)
                .and_then(interpret);
            append_runtime_log(&format!(
                "configure retry after runtime rebuild: {}",
                match &outcome {
                    Ok(_) => "ok".to_string(),
                    Err(code) => code.clone(),
                }
            ));
        }
        append_runtime_log(&format!(
            "configure result: {}",
            match &outcome {
                Ok(_) => "ok".to_string(),
                Err(code) => code.clone(),
            }
        ));
        if matches!(&outcome, Err(code) if code == "RUNTIME_EXITED") {
            let status = self
                .runtime
                .lock()
                .unwrap()
                .as_mut()
                .map(|process| process.transport.status())
                .unwrap_or_else(|| "still-running-or-unknown".to_string());
            append_runtime_log(&format!("configure RUNTIME_EXITED child status={status}"));
        }
        match outcome {
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
    fn ensure_configured(
        &self,
        app: Option<&tauri::AppHandle>,
        profile_id: &str,
    ) -> Result<(), String> {
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
        app: Option<&tauri::AppHandle>,
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

    fn infer(
        &self,
        app: Option<&tauri::AppHandle>,
        request: InferenceRequest,
    ) -> Result<Value, String> {
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
        app: Option<&tauri::AppHandle>,
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
        app: Option<&tauri::AppHandle>,
        profile_id: &str,
        provider_id: &str,
        request_id: &str,
        urls: Vec<String>,
    ) -> Result<Value, String> {
        if !self.enabled.load(Ordering::SeqCst) {
            return Ok(error_result("AI_DISABLED"));
        }
        if !is_identifier(profile_id)
            || !is_identifier(request_id)
            || !PROVIDERS.contains(&provider_id)
        {
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
            "requestId": request_id,
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

    fn cancel(
        &self,
        app: Option<&tauri::AppHandle>,
        target_request_id: &str,
    ) -> Result<Value, String> {
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

    fn remove_profile(
        &self,
        app: Option<&tauri::AppHandle>,
        profile_id: &str,
        preserve_credential: bool,
    ) -> Result<Value, String> {
        if !is_identifier(profile_id) {
            return Ok(error_result("INVALID_REQUEST"));
        }
        let removed = self.profiles.lock().unwrap().contains_key(profile_id);
        self.disable_profile(app, profile_id)?;
        if !preserve_credential {
            delete_credential(profile_id);
        }
        Ok(ok_result(json!({ "removed": removed })))
    }

    fn disable_profile(
        &self,
        app: Option<&tauri::AppHandle>,
        profile_id: &str,
    ) -> Result<Value, String> {
        if !is_identifier(profile_id) {
            return Ok(error_result("INVALID_REQUEST"));
        }
        let removed = self.profiles.lock().unwrap().remove(profile_id).is_some();
        self.configured.lock().unwrap().remove(profile_id);
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
        Ok(ok_result(json!({ "disabled": removed })))
    }

    fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::SeqCst);
        if !enabled {
            append_runtime_log("AI disabled by user: killing runtime on purpose");
            if let Some(process) = self.runtime.lock().unwrap().take() {
                let status = process.transport.terminate();
                append_runtime_log(&format!(
                    "runtime killed after user disabled AI; status={status}"
                ));
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
            Some(&app),
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
    tauri::async_runtime::spawn_blocking(move || {
        inner.models(Some(&app), &profile_id, &provider_id)
    })
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
    tauri::async_runtime::spawn_blocking(move || inner.infer(Some(&app), request))
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
    tauri::async_runtime::spawn_blocking(move || inner.vision_extract(Some(&app), request))
        .await
        .map_err(|_| "BROKER_TASK_FAILED".to_string())?
}

#[tauri::command]
pub async fn ai_research_lookup(
    app: tauri::AppHandle,
    broker: tauri::State<'_, AiBroker>,
    profile_id: String,
    provider_id: String,
    target_request_id: String,
    urls: Vec<String>,
) -> Result<Value, String> {
    let inner = Arc::clone(&broker.inner);
    tauri::async_runtime::spawn_blocking(move || {
        inner.research_lookup(
            Some(&app),
            &profile_id,
            &provider_id,
            &target_request_id,
            urls,
        )
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
    tauri::async_runtime::spawn_blocking(move || inner.cancel(Some(&app), &target_request_id))
        .await
        .map_err(|_| "BROKER_TASK_FAILED".to_string())?
}

#[tauri::command]
pub async fn ai_remove_profile(
    app: tauri::AppHandle,
    broker: tauri::State<'_, AiBroker>,
    profile_id: String,
    preserve_credential: Option<bool>,
) -> Result<Value, String> {
    let inner = Arc::clone(&broker.inner);
    tauri::async_runtime::spawn_blocking(move || {
        inner.remove_profile(
            Some(&app),
            &profile_id,
            preserve_credential.unwrap_or(false),
        )
    })
    .await
    .map_err(|_| "BROKER_TASK_FAILED".to_string())?
}

#[tauri::command]
pub async fn ai_disable_profile(
    app: tauri::AppHandle,
    broker: tauri::State<'_, AiBroker>,
    profile_id: String,
) -> Result<Value, String> {
    let inner = Arc::clone(&broker.inner);
    tauri::async_runtime::spawn_blocking(move || inner.disable_profile(Some(&app), &profile_id))
        .await
        .map_err(|error| error.to_string())?
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

    #[cfg(windows)]
    #[test]
    fn node_paths_do_not_use_windows_verbatim_prefix() {
        assert_eq!(
            node_compatible_path(PathBuf::from(r"\\?\D:\runtime\main.mjs")),
            PathBuf::from(r"D:\runtime\main.mjs")
        );
        assert_eq!(
            node_compatible_path(PathBuf::from(r"\\?\UNC\server\share\main.mjs")),
            PathBuf::from(r"\\server\share\main.mjs")
        );
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
