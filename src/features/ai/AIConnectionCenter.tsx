import { useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState } from '../../components/ui/primitives';
import { TextField, SelectField } from '../../components/ui/form';
import { useAIConnectionStore, type AIConnection } from '../../store/aiConnectionStore';
import { useAppStore } from '../../store/appStore';
import { isTauri } from '../../services/storage/fs';
import {
  inferAI, listAIModels, VISION_PROVIDERS,
  type AuthKind, type ConnectionProfile, type ModelInfo, type ProviderId,
} from '../../services/ai/client';

interface CatalogEntry {
  key: string;
  providerId: ProviderId;
  authKind: AuthKind;
  label: string;
  entitlement: string;
  needsEndpoint: boolean;
  cloud: boolean;
  notes: string;
}

const CATALOG: CatalogEntry[] = [
  { key: 'openai-api', providerId: 'openai', authKind: 'api-key', label: 'OpenAI API', entitlement: '按量 API 计费，不等于订阅', needsEndpoint: false, cloud: true,
    notes: '需要你自备 API Key；费用与额度以 OpenAI 账单为准。' },
  { key: 'openai-subscription', providerId: 'openai', authKind: 'openai-subscription', label: 'OpenAI 开源应用订阅', entitlement: '官方开源应用授权，资格需单独验证', needsEndpoint: false, cloud: true,
    notes: '仅在官方资格获批后可用；未验证前保持“待资格验证”，应用不读取其他程序的登录态。' },
  { key: 'copilot', providerId: 'copilot', authKind: 'copilot-subscription', label: 'GitHub Copilot 订阅', entitlement: '需有效的 Copilot 订阅与官方授权', needsEndpoint: false, cloud: true,
    notes: '使用应用自己的 GitHub OAuth/设备流配置，不嵌入客户端密钥，不复用其他 CLI 登录。' },
  { key: 'anthropic', providerId: 'anthropic', authKind: 'api-key', label: 'Anthropic API', entitlement: '按量 API 计费，不等于订阅', needsEndpoint: false, cloud: true,
    notes: '不支持第三方复用 Claude.ai 订阅登录；只接受 API Key 方式。' },
  { key: 'deepseek', providerId: 'deepseek', authKind: 'api-key', label: 'DeepSeek API', entitlement: '按量 API 计费', needsEndpoint: false, cloud: true,
    notes: 'OpenAI 兼容接口；模型名由你填写，不写死。' },
  { key: 'ollama', providerId: 'ollama', authKind: 'local', label: 'Ollama 本地模型', entitlement: '本地能力，不代表云端额度', needsEndpoint: true, cloud: false,
    notes: 'OpenAI 兼容地址默认 http://localhost:11434/v1；本地服务可能路由到云端，请自行确认。' },
  { key: 'lmstudio', providerId: 'lmstudio', authKind: 'local', label: 'LM Studio 本地端点', entitlement: '本地能力，不代表云端额度', needsEndpoint: true, cloud: false,
    notes: 'OpenAI 兼容地址，例如 http://localhost:1234/v1。' },
  { key: 'gateway', providerId: 'gateway', authKind: 'api-key', label: '用户自建 HTTPS 网关', entitlement: '由你的网关负责认证与账单', needsEndpoint: true, cloud: true,
    notes: '应用不提供默认代理；网关必须是公网 HTTPS 且路径以 /v1 结束。' },
];

const STATE_META: Record<AIConnection['state'], { label: string; tone: 'emerald' | 'blue' | 'amber' | 'slate' }> = {
  configured: { label: '已配置 · 未做合成测试', tone: 'blue' },
  tested: { label: '合成测试通过', tone: 'emerald' },
  'qualification-pending': { label: '待官方资格验证', tone: 'amber' },
  'auth-error': { label: '认证或运行失败', tone: 'amber' },
  disconnected: { label: '未连接', tone: 'slate' },
};

function profileOf(connection: AIConnection): ConnectionProfile {
  return {
    profileId: connection.profileId, providerId: connection.providerId, authKind: connection.authKind,
    modelId: connection.modelId, ...(connection.endpoint ? { endpoint: connection.endpoint } : {}),
    ...(connection.supportsVision ? { supportsVision: true } : {}),
  };
}

export function AIConnectionCenter() {
  const enabled = useAIConnectionStore(s => s.enabled);
  const busy = useAIConnectionStore(s => s.busy);
  const profiles = useAIConnectionStore(s => s.profiles);
  const activeProfileId = useAIConnectionStore(s => s.activeProfileId);
  const setEnabled = useAIConnectionStore(s => s.setEnabled);
  const connect = useAIConnectionStore(s => s.connect);
  const disconnect = useAIConnectionStore(s => s.disconnect);
  const toggleEnabled = useAIConnectionStore(s => s.toggleEnabled);
  const activate = useAIConnectionStore(s => s.activate);
  const markTested = useAIConnectionStore(s => s.markTested);
  const markHealth = useAIConnectionStore(s => s.markHealth);
  const pushToast = useAppStore(s => s.pushToast);
  const desktop = isTauri();

  const [catalogKey, setCatalogKey] = useState('gateway');
  const [label, setLabel] = useState('');
  const [modelId, setModelId] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [credential, setCredential] = useState('');
  const [persistCredential, setPersistCredential] = useState(true);
  const [supportsVision, setSupportsVision] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [modelTarget, setModelTarget] = useState<string | null>(null);
  const [testOutput, setTestOutput] = useState<{ profileId: string; text: string; usage: { inputTokens: number | null; outputTokens: number | null } } | null>(null);
  const [working, setWorking] = useState(false);

  const entry = useMemo(() => CATALOG.find(item => item.key === catalogKey) ?? CATALOG[0]!, [catalogKey]);
  const platformBlocked = !desktop && entry.cloud;

  async function toggle(next: boolean) {
    setError(null);
    try { await setEnabled(next); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法切换 AI 状态'); }
  }

  async function connectNow() {
    setError(null);
    if (!label.trim()) { setError('请填写连接名称'); return; }
    if (!modelId.trim()) { setError('请填写模型标识'); return; }
    if (entry.needsEndpoint && !endpoint.trim()) { setError('请填写端点地址'); return; }
    if (platformBlocked) { setError('此平台不直接连接官方云服务；请使用用户自建 HTTPS 网关或本地端点。'); return; }
    const editing = editingProfileId
      ? profiles.find((item) => item.profileId === editingProfileId)
      : undefined;
    if (entry.authKind === 'api-key' && !credential.trim() && !editing?.credentialPersisted) {
      setError('请填写 API Key 或网关令牌');
      return;
    }
    const profile: ConnectionProfile = {
      profileId: editingProfileId ?? crypto.randomUUID(), providerId: entry.providerId, authKind: entry.authKind,
      modelId: modelId.trim(), ...(entry.needsEndpoint ? { endpoint: endpoint.trim() } : {}),
      ...(supportsVision && VISION_PROVIDERS.includes(entry.providerId) ? { supportsVision: true } : {}),
    };
    try {
      await connect(profile, label.trim(), entry.authKind === 'local' ? undefined : credential.trim(), persistCredential && desktop);
      setCredential('');
      setEditingProfileId(null);
      pushToast(desktop && persistCredential ? '连接已注册，凭据交由系统安全存储' : '连接已注册（凭据仅当前会话有效）', 'success');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '连接失败'); }
  }

  async function loadModels(connection: AIConnection) {
    setError(null); setModels(null); setModelTarget(connection.profileId);
    setWorking(true);
    try {
      setModels(await listAIModels(profileOf(connection)));
      markHealth(connection.profileId, 'healthy');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '模型列表获取失败';
      setError(message);
      markHealth(connection.profileId, 'failed', message);
    }
    finally { setWorking(false); }
  }

  async function testConnection(connection: AIConnection) {
    setError(null); setTestOutput(null);
    setWorking(true);
    try {
      const result = await inferAI({
        requestId: crypto.randomUUID(), profileId: connection.profileId, providerId: connection.providerId,
        task: 'data-health-explanation',
        input: { text: '这是连接测试的合成消息。请用一句话确认你能收到这条消息；不要推测任何财务数据。', facts: [] },
      });
      markTested(connection.profileId);
      setTestOutput({ profileId: connection.profileId, text: result.text.slice(0, 500), usage: result.usage });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '合成消息测试失败';
      setError(message);
      markHealth(connection.profileId, 'failed', message);
    }
    finally { setWorking(false); }
  }

  return (
    <div className="space-y-5">
      <div className="workspace-intro">
        <div>
          <h2>AI 连接中心</h2>
          <p>AI 默认关闭，核心功能完全离线。启用后，每次业务请求仍会在工作区中逐次授权数据范围。</p>
        </div>
        {enabled ? <Badge tone="emerald">AI 已启用</Badge> : <Badge tone="slate">AI 未启用</Badge>}
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">总开关</h3>
            <p className="mt-1 text-sm text-slate-600">关闭时不启动 Runtime、不枚举模型、不刷新令牌；每次启动默认为关闭。</p>
          </div>
          <Button variant={enabled ? 'outline' : 'primary'} disabled={busy} onClick={() => void toggle(!enabled)}>
            {enabled ? '关闭 AI' : '启用 AI'}
          </Button>
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      </Card>

      {enabled && (
        <Card className="p-4">
          <h3 className="font-semibold">新增连接</h3>
          <p className="mt-1 text-sm text-slate-600">
            认证方式与权益方式分开记录：OAuth/设备流不等于可用订阅，API Key 是按量计费，本地模型不显示云端额度。
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <SelectField label="连接类型" value={catalogKey} onChange={event => { setCatalogKey(event.target.value); setModels(null); setError(null); setSupportsVision(false); }}
              options={CATALOG.map(item => ({ value: item.key, label: `${item.label}（${item.entitlement}）` }))} />
            <TextField label="连接名称" value={label} maxLength={80} onChange={event => setLabel(event.target.value)} placeholder="例如：我的 Copilot 订阅" />
            <TextField label="模型标识" value={modelId} maxLength={128} onChange={event => setModelId(event.target.value)} placeholder="例如：gpt-5 / claude-sonnet-4-5" />
            {entry.needsEndpoint && (
              <TextField label="端点地址" value={endpoint} maxLength={512} onChange={event => setEndpoint(event.target.value)}
                placeholder={entry.providerId === 'ollama' ? 'http://localhost:11434/v1' : entry.providerId === 'lmstudio' ? 'http://localhost:1234/v1' : 'https://gateway.example.com/v1'} />
            )}
            {entry.authKind !== 'local' && (
              <TextField label="API Key / 令牌" type="password" value={credential} maxLength={16384} onChange={event => setCredential(event.target.value)}
                placeholder={desktop ? '仅交给本机安全存储或临时会话' : 'Web 仅保留在内存，关闭页面即失效'} />
            )}
          </div>
          {entry.authKind !== 'local' && (
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={persistCredential && desktop} disabled={!desktop || busy} onChange={event => setPersistCredential(event.target.checked)} />
              保存到系统安全存储（Keyring / Android Keystore）{!desktop && '；此平台仅支持临时会话'}
            </label>
          )}
          {VISION_PROVIDERS.includes(entry.providerId) && (
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={supportsVision} disabled={busy} onChange={event => setSupportsVision(event.target.checked)} />
              此连接可接收图片（用于票据截图与对账单识别）
            </label>
          )}
          {VISION_PROVIDERS.includes(entry.providerId) && (
            <p className="mt-1 text-xs text-slate-500">
              读图能力由你声明，应用不会替你探测：未勾选时上传图片会在发送前失败关闭，不会退化成“看不出图片却给结论”。
            </p>
          )}
          <p className="mt-2 text-xs text-slate-500">{entry.notes}</p>
          {platformBlocked && <p className="mt-2 text-sm text-amber-700">此平台不直接连接官方云服务，请改用用户自建 HTTPS 网关或本地端点。</p>}
          <Button className="mt-4" disabled={busy || working || platformBlocked} onClick={() => void connectNow()}>连接并注册</Button>
        </Card>
      )}

      <Card className="p-4">
        <h3 className="font-semibold">连接列表</h3>
        {profiles.length === 0 ? (
          <EmptyState title="没有连接" description={enabled ? '在上方新增一个连接。' : '启用 AI 后可以新增连接。'} />
        ) : (
          <div className="mt-3 space-y-3">
            {profiles.map(connection => {
              const meta = STATE_META[connection.state];
              const isActive = connection.profileId === activeProfileId;
              return (
                <div key={connection.profileId} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-sm break-all">{connection.label}</strong>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        {isActive && <Badge tone="blue">当前使用</Badge>}
                      </div>
                      <div className="mt-1 text-xs text-slate-500 break-all">
                        {connection.providerId} · {connection.authKind} · {connection.modelId}
                        {connection.endpoint ? ` · ${connection.endpoint}` : ''}
                        {connection.supportsVision ? ' · 可读图' : ''}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {connection.enabled ? '连接已启用' : '连接已停用'} · 健康状态 {connection.health} · 配置 rev {connection.configRevision}
                        {connection.lastError ? ` · ${connection.lastError}` : ''}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || !enabled || (!connection.enabled && !desktop && connection.authKind !== 'local')}
                        onClick={() => void toggleEnabled(connection.profileId, !connection.enabled)
                          .catch(cause => setError(cause instanceof Error ? cause.message : '切换连接启停失败'))}
                      >
                        {connection.enabled ? '停用连接' : '启用连接'}
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy || working || !enabled} onClick={() => {
                        const catalog = CATALOG.find((item) =>
                          item.providerId === connection.providerId && item.authKind === connection.authKind);
                        if (!catalog) {
                          setError('此连接类型当前不在可编辑目录中');
                          return;
                        }
                        setCatalogKey(catalog.key);
                        setEditingProfileId(connection.profileId);
                        setLabel(connection.label);
                        setModelId(connection.modelId);
                        setEndpoint(connection.endpoint ?? '');
                        setSupportsVision(connection.supportsVision === true);
                        setCredential('');
                        setModels(null);
                      }}>编辑</Button>
                      {!isActive && connection.enabled && (
                        <Button size="sm" variant="outline" disabled={busy || !enabled}
                          onClick={() => void activate(connection.profileId)
                            .catch(cause => setError(cause instanceof Error ? cause.message : '切换当前连接失败'))}>
                          设为当前
                        </Button>
                      )}
                      <Button size="sm" variant="outline" disabled={busy || working || !enabled || !connection.enabled} onClick={() => void loadModels(connection)}>模型列表</Button>
                      <Button size="sm" variant="outline" disabled={busy || working || !enabled || !connection.enabled || connection.state === 'qualification-pending'} onClick={() => void testConnection(connection)}>合成消息测试</Button>
                      <Button size="sm" variant="ghost" disabled={busy || working} onClick={() => {
                        if (window.confirm(`确认移除“${connection.label}”并删除其凭据引用？其他连接若共享授权不会被停用。`)) {
                          void disconnect(connection.profileId).catch(cause => setError(cause instanceof Error ? cause.message : '移除失败'));
                        }
                      }}>移除连接</Button>
                    </div>
                  </div>
                  {modelTarget === connection.profileId && models && (
                    <div className="mt-2 text-xs text-slate-600">
                      <span className="font-medium">可选模型：</span>
                      {models.length === 0 ? '服务未返回模型' : models.map(model => (
                        <button key={model.id} type="button" className="mr-2 mt-1 rounded border border-slate-300 px-2 py-0.5 hover:bg-slate-50"
                          onClick={() => { setModelId(model.id); pushToast(`已填入模型标识：${model.id}，重新连接后生效`, 'success'); }}>
                          {model.id}
                        </button>
                      ))}
                    </div>
                  )}
                  {testOutput?.profileId === connection.profileId && (
                    <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                      <p className="break-all">{testOutput.text}</p>
                      <p className="mt-1 text-slate-400">输入 tokens：{testOutput.usage.inputTokens ?? '服务未提供'} · 输出 tokens：{testOutput.usage.outputTokens ?? '服务未提供'}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="settings-note mt-4">
          <h3>权益与发布边界</h3>
          <p>
            合成测试只证明端点与凭据当前可用，不代表订阅权益或模型质量验证。正式发布要求至少两类厂商许可的订阅路径完成真实认证、推理与撤销验收；
            API Key、本地模型和 mock 不计入该门。应用不读取 Codex、Claude、GitHub CLI 或其他程序的登录令牌，也不嵌入 OAuth 客户端密钥。
          </p>
        </div>
      </Card>
    </div>
  );
}
