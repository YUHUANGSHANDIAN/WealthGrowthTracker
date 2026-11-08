import { useId, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { APP_VERSION } from '../../constants/version';
import { BUILD_COMMIT, BUILD_ID, BUILD_TIME } from '../../constants/buildInfo';
import { getDefaultTimezone, TIMEZONE_OPTIONS } from '../../utils/countdown';
import { checkForUpdate, recommendAsset, type ReleaseAsset } from '../../utils/updateCheck';
import { platformCapabilities } from '../../utils/platform';
import { REPORT_SCHEMA_VERSION } from '../reports/normalize';
import { storageService } from '../../services/storage';
import { Modal } from '../../components/ui/Modal';
import { Button, Badge } from '../../components/ui/primitives';
import { SliderField } from '../../components/ui/Slider';
import { TextField, SelectField, TextArea } from '../../components/ui/form';
import { EmojiPicker } from '../../components/ui/Pickers';
import { SETTINGS_SECTIONS, type SettingsSectionId } from '../../constants/settings';
import { useNavigationStore } from '../../store/navigationStore';
import { useAIConnectionStore } from '../../store/aiConnectionStore';

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [section, setSection] = useState<SettingsSectionId>('profile');
  return (
    <Modal open={open} onClose={onClose} title="设置" size="lg">
      <SettingsContent section={section} onSectionChange={setSection} />
    </Modal>
  );
}

export function SettingsContent({ section, onSectionChange }: { section: SettingsSectionId; onSectionChange: (section: SettingsSectionId) => void }) {
  const current = SETTINGS_SECTIONS.find((item) => item.id === section)!;
  const titleId = useId();
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const filteredSections = SETTINGS_SECTIONS.filter((item) =>
    !needle || `${item.label} ${item.description} ${item.keywords}`.toLowerCase().includes(needle));
  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="设置分类">
        <label className="settings-search">
          <span className="sr-only">搜索设置</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索设置…"
          />
        </label>
        {filteredSections.map((item) => (
          <button key={item.id} type="button" onClick={() => onSectionChange(item.id)} aria-current={section === item.id ? 'page' : undefined}>
            {item.label}
          </button>
        ))}
        {!filteredSections.length && <p className="px-2 py-3 text-xs text-slate-500">没有匹配的设置项</p>}
      </nav>
      <section className="settings-section" aria-labelledby={titleId}>
        <header className="settings-section-heading">
          <h2 id={titleId}>{current.label}</h2>
          <p>{current.description}</p>
        </header>
        {section === 'profile' && <ProfileSection />}
        {section === 'appearance' && <AppearanceSection />}
        {section === 'records' && <RecordsSection />}
        {section === 'ai' && <AISection />}
        {section === 'storage' && <StorageSection />}
        {section === 'account' && <AccountSection />}
        {section === 'update' && <UpdateSection />}
        {section === 'privacy' && <PrivacySection />}
        {section === 'about' && <AboutSection />}
      </section>
    </div>
  );
}

function RecordsSection() {
  const navigate = useNavigationStore((state) => state.navigate);
  return (
    <div className="space-y-5">
      <div className="settings-note">
        <h3>每日快照与周期报告</h3>
        <p>修改渠道金额会同步当天历史快照；历史页面也可补充或覆盖指定日期。周报、月报和年报在报告页面主动生成与确认。改变默认时区不会重排既有历史日期。</p>
      </div>
      <div className="settings-actions">
        <Button variant="outline" onClick={() => navigate({ tab: 'history' })}>管理历史快照</Button>
        <Button variant="outline" onClick={() => navigate({ tab: 'reports' })}>打开报告工作区</Button>
      </div>
      <div className="settings-note">
        <div className="flex flex-wrap items-center gap-2"><h3>定时记录与报告计划</h3><Badge tone="slate">尚未实现</Badge></div>
        <p>渠道修改触发的当天快照与定时任务不同。当前未提供定时记录、定时生成或云端同步设置。</p>
      </div>
    </div>
  );
}

function AISection() {
  const navigate = useNavigationStore((state) => state.navigate);
  const enabled = useAIConnectionStore((state) => state.enabled);
  const profiles = useAIConnectionStore((state) => state.profiles);
  const tested = profiles.filter((profile) => profile.state === 'tested').length;
  return (
    <div className="space-y-5">
      <div className="settings-note">
        <div className="flex flex-wrap items-center gap-2"><h3>AI 接入状态</h3>{enabled ? <Badge tone="emerald">已启用</Badge> : <Badge tone="slate">未启用</Badge>}<Badge tone="slate">连接 {profiles.length}</Badge><Badge tone="slate">合成测试通过 {tested}</Badge></div>
        <p>AI 默认关闭，每次启动需重新启用；核心功能完全离线可用。业务请求必须在 AI 工作区逐次授权数据范围，凭据只交给系统安全存储或临时会话。</p>
      </div>
      <Button variant="outline" onClick={() => navigate({ tab: 'ai', settingsSection: 'ai' })}>打开模型连接</Button>
      <div className="settings-note">
        <h3>订阅与发布边界</h3>
        <p>合成测试通过只证明端点与凭据当前可用。正式发布要求至少两类厂商许可的订阅路径完成真实认证、推理与撤销验收；API Key、本地模型和 mock 都不计入该发布门。</p>
      </div>
    </div>
  );
}

function StorageSection() {
  const navigate = useNavigationStore((state) => state.navigate);
  const isDesktop = storageService.getAdapterName() === 'desktop';
  return (
    <div className="space-y-5">
      <div className="settings-note">
        <h3>当前存储</h3>
        <p>存储后端：{storageService.getAdapterName()}。核心数据在当前设备本地保存，未提供云端账户或自动云同步。</p>
      </div>
      <div className="settings-note">
        <h3>导入、备份与恢复</h3>
        <p>在数据中心检查数据健康、导入备份和导出数据。{isDesktop ? '桌面备份与存储位置也在数据中心管理。' : '当前平台可通过文件导出保留备份；桌面目录管理在此平台不可用。'}</p>
      </div>
      <Button variant="outline" onClick={() => navigate({ tab: 'data' })}>打开数据中心</Button>
      <p className="text-sm text-slate-600">普通备份是数据文件，不等于加密备份。请自行保管备份文件，并在分享前检查其内容。</p>
    </div>
  );
}

function ProfileSection() {
  const profile = useAppStore((s) => s.profile);
  const setProfile = useAppStore((s) => s.setProfile);
  const pushToast = useAppStore((s) => s.pushToast);
  const [nickname, setNickname] = useState(profile.nickname ?? '');
  const [avatar, setAvatar] = useState(profile.avatarEmoji ?? '👤');
  const [signature, setSignature] = useState(profile.signature ?? '');
  const [timezone, setTimezone] = useState(profile.defaultTimezone ?? getDefaultTimezone());

  return (
    <div className="space-y-4">
      <TextField label="昵称" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="留空则为匿名" />
      <div>
        <span className="block text-sm font-medium text-slate-700 mb-1">头像</span>
        <EmojiPicker value={avatar} onChange={setAvatar} />
      </div>
      <TextArea label="个性签名" value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="写点什么…" />
      <SelectField label="默认时区" value={timezone} onChange={(e) => setTimezone(e.target.value)}
        options={[...new Set([timezone, getDefaultTimezone(), ...TIMEZONE_OPTIONS])].map((t) => ({ value: t, label: t }))} />
      <Button onClick={() => { setProfile({ nickname: nickname.trim() || undefined, avatarEmoji: avatar, signature: signature.trim() || undefined, defaultCurrency: 'CNY', defaultTimezone: timezone }); pushToast('资料已保存', 'success'); }}>
        保存资料
      </Button>
    </div>
  );
}

function AppearanceSection() {
  const appearance = useAppStore((s) => s.appearance);
  const setAppearance = useAppStore((s) => s.setAppearance);
  return (
    <div className="space-y-4">
      <SelectField label="主题模式" value={appearance.themeMode}
        onChange={(e) => setAppearance({ ...appearance, themeMode: e.target.value as typeof appearance.themeMode })}
        options={[
          { value: 'light', label: '浅色' },
          { value: 'system', label: '跟随系统' },
          { value: 'dark', label: '深色' },
        ]} />
      <SelectField label="内容密度" value={appearance.density ?? 'comfortable'}
        onChange={(e) => setAppearance({ ...appearance, density: e.target.value as 'comfortable' | 'compact' })}
        options={[
          { value: 'comfortable', label: '舒适' },
          { value: 'compact', label: '紧凑' },
        ]} />
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={appearance.followWealthTheme} onChange={(e) => setAppearance({ ...appearance, followWealthTheme: e.target.checked })}
          className="h-4 w-4 text-emerald-600 rounded" />
        <span className="text-sm text-slate-700">跟随财富等级主题</span>
      </label>
      <SelectField label="动画强度" value={appearance.animationIntensity}
        onChange={(e) => setAppearance({ ...appearance, animationIntensity: e.target.value as typeof appearance.animationIntensity })}
        options={[
          { value: 'off', label: '关闭' },
          { value: 'low', label: '低' },
          { value: 'normal', label: '标准' },
          { value: 'high', label: '高' },
        ]} />
      <SelectField label="减少动画" value={appearance.reduceMotion}
        onChange={(e) => setAppearance({ ...appearance, reduceMotion: e.target.value as typeof appearance.reduceMotion })}
        options={[
          { value: 'system', label: '跟随系统' },
          { value: 'always', label: '始终减少动画' },
        ]} />
      <div>
        <SliderField label="背景动效透明度" min={5} max={50} step={5} value={appearance.backgroundOpacity}
          onChange={(v) => setAppearance({ ...appearance, backgroundOpacity: v })} format={(v) => `${v}%`} ariaLabel="背景动效透明度" />
      </div>
    </div>
  );
}

function AccountSection() {
  const account = useAppStore((s) => s.account);
  const authRecord = useAppStore((s) => s.authRecord);
  const { setupAccount, login, logout, disableAccount, pushToast } = useAppStore();
  const [name, setName] = useState('');
  const [method, setMethod] = useState<'pin' | 'password'>('pin');
  const [secret, setSecret] = useState('');
  const [loginSecret, setLoginSecret] = useState('');

  if (!account || !authRecord) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-600">设置本地应用锁（PIN 或密码）。这是<strong>本地应用锁</strong>，不等于磁盘数据加密。</p>
        <TextField label="显示名称" value={name} onChange={(e) => setName(e.target.value)} placeholder="你的名字" />
        <SelectField label="锁类型" value={method} onChange={(e) => setMethod(e.target.value as 'pin' | 'password')}
          options={[{ value: 'pin', label: 'PIN 码' }, { value: 'password', label: '密码' }]} />
        <TextField label={method === 'pin' ? 'PIN 码' : '密码'} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={method === 'pin' ? '4-6 位数字' : '至少 6 位'} />
        <Button onClick={async () => {
          if (secret.length < (method === 'pin' ? 4 : 6)) { pushToast('长度不足', 'error'); return; }
          await setupAccount(name.trim() || '我的账户', method, secret);
          setSecret('');
          pushToast('账户已创建', 'success');
        }}>创建账户</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-2xl" aria-hidden>{account.avatarEmoji}</span>
        <div>
          <div className="font-semibold text-slate-800">{account.displayName}</div>
          <div className="text-xs text-slate-500">已启用 {account.lockMethod === 'pin' ? 'PIN' : '密码'} 锁</div>
        </div>
      </div>
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
        PIN/密码仅作为本地应用锁，不加密磁盘上的数据文件。磁盘数据加密尚未实现，请保护设备账户和备份文件。
      </div>
      <TextField label="验证并锁定" type="password" value={loginSecret} onChange={(e) => setLoginSecret(e.target.value)} placeholder="输入 PIN/密码" />
      <div className="flex gap-2">
        <Button onClick={async () => {
          const ok = await login(loginSecret);
          pushToast(ok ? '已解锁' : '密码错误', ok ? 'success' : 'error');
          if (ok) setLoginSecret('');
        }}>验证解锁</Button>
        <Button variant="outline" onClick={() => { logout(); pushToast('已锁定（登出不删除资产数据）', 'info'); }}>锁定</Button>
        <Button variant="danger" onClick={() => { disableAccount(); pushToast('已移除本地账户锁', 'info'); }}>移除账户锁</Button>
      </div>
    </div>
  );
}

function UpdateSection() {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [isNewer, setIsNewer] = useState(false);
  const [url, setUrl] = useState('');
  const [asset, setAsset] = useState<ReleaseAsset | null>(null);

  async function check() {
    setChecking(true);
    setResult(null);
    setAsset(null);
    setIsNewer(false);
    setUrl('');
    try {
      const r = await checkForUpdate(APP_VERSION);
      setUrl(r.url);
      setIsNewer(r.isNewer);
      setAsset(recommendAsset(r.assets));
      setResult(r.isNewer ? `发现新版本 v${r.latest}` : '当前已是最新版');
    } catch (err) {
      setResult(`检查更新失败：${err instanceof Error ? err.message : '网络错误'}`);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-600">
        当前版本：<Badge tone="emerald">v{APP_VERSION}</Badge>
      </div>
      <Button onClick={check} disabled={checking}>{checking ? '检查中…' : '检查更新'}</Button>
      {result && (
        <div className="text-sm text-slate-700" role="status">
          {result}
          {isNewer && url && (
            <div className="mt-2 space-y-2">
              {asset && (
                <Button size="sm" onClick={() => window.open(asset.downloadUrl, '_blank', 'noopener,noreferrer')}>下载 {asset.name}</Button>
              )}
              <div>
                <Button size="sm" variant="outline" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>查看 Release 全部资产</Button>
              </div>
            </div>
          )}
        </div>
      )}
      <p className="text-xs text-slate-400">仅在点击「检查更新」时联网访问 GitHub API，不发送任何资产或个人数据。</p>
    </div>
  );
}

function PrivacySection() {
  return (
    <div className="space-y-4 text-sm text-slate-600">
      <div className="settings-note"><h3>本地核心数据</h3><p>资产、历史和报告保存在当前设备使用的本地存储中。当前应用未集成广告或遥测 SDK；核心财富功能可离线使用。</p></div>
      <div className="settings-note"><h3>AI 与联网边界</h3><p>AI 每次启动默认关闭。每条连接可以单独启用或停用，当前连接在重启后保留，但只有你再次开启 AI 后才会加载运行时。桌面凭据只进入系统安全存储；Web/PWA 仅保留当前会话凭据。业务请求仍会逐次展示最小授权范围，切换供应商不会自动外发历史数据。普通结构备份不含 AI 附注或密钥。</p></div>
      <div className="settings-note"><h3>界面隐藏与分享</h3><p>顶部金额隐藏用于遮挡界面，不代表数据加密。导出、分享和备份需单独检查内容并选择适用的脱敏选项；备份文件可能包含完整数据。</p></div>
      <div className="settings-note"><h3>本地活动日志</h3><p>活动日志记录操作时间、实体与描述；部分渠道结构操作的描述可能包含渠道名称和金额。分享备份或诊断内容前请检查，不应视为完全匿名。</p></div>
    </div>
  );
}

function AboutSection() {
  const caps = platformCapabilities();
  return (
    <div className="space-y-2 text-sm text-slate-600">
      <div className="flex items-center gap-2">
        <span className="text-2xl" aria-hidden>🌱</span>
          <span className="font-semibold text-slate-800">WealthGrowthTracker（财富成长记）</span>
      </div>
      <p>本地优先的个人财富管理工具（Local-First, Privacy-First）。</p>
      <div className="bg-slate-50 rounded-lg p-3 space-y-1 text-xs text-slate-600">
        <div>应用版本：<span className="font-medium">v{APP_VERSION}</span></div>
        <div>平台：<span className="font-medium">{platformLabel(caps.platform)}</span></div>
        <div>架构：<span className="font-medium">{caps.arch}</span></div>
        <div>存储后端：<span className="font-medium">{storageService.getAdapterName()}</span></div>
        <div>报告 Schema 版本：<span className="font-medium">{REPORT_SCHEMA_VERSION}</span></div>
        <div>构建身份：<span className="font-medium break-all">{BUILD_ID}</span></div>
        <div>提交：<span className="font-medium">{BUILD_COMMIT}</span></div>
        {BUILD_TIME && <div>构建时间：<span className="font-medium">{BUILD_TIME}</span></div>}
      </div>
      <p>本应用的财富等级是游戏化成长体系，不代表投资能力评级或真实社会财富地位。</p>
    </div>
  );
}

function platformLabel(p: string): string {
  switch (p) {
    case 'windows': return 'Windows';
    case 'macos': return 'macOS';
    case 'linux': return 'Linux';
    case 'android': return 'Android';
    case 'ios': return 'iOS';
    default: return 'Web';
  }
}
