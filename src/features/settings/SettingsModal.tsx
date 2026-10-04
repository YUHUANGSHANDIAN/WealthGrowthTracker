import { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { APP_VERSION } from '../../constants/version';
import { getDefaultTimezone, TIMEZONE_OPTIONS } from '../../utils/countdown';
import { checkForUpdate, recommendAsset, type ReleaseAsset } from '../../utils/updateCheck';
import { platformCapabilities } from '../../utils/platform';
import { REPORT_SCHEMA_VERSION } from '../reports/normalize';
import { storageService } from '../../services/storage';
import { Modal } from '../../components/ui/Modal';
import { Button, Badge } from '../../components/ui/primitives';
import { TextField, SelectField, TextArea } from '../../components/ui/form';
import { EmojiPicker } from '../../components/ui/Pickers';

type Section = 'profile' | 'appearance' | 'account' | 'update' | 'privacy' | 'about';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'profile', label: '个人资料' },
  { id: 'appearance', label: '外观' },
  { id: 'account', label: '账号与安全' },
  { id: 'update', label: '版本更新' },
  { id: 'privacy', label: '隐私' },
  { id: 'about', label: '关于' },
];

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [section, setSection] = useState<Section>('profile');
  return (
    <Modal open={open} onClose={onClose} title="设置" size="lg">
      <div className="flex gap-4 min-h-[320px]">
        <nav className="w-32 shrink-0 space-y-1 border-r border-slate-100 pr-3" aria-label="设置分类">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`w-full text-left px-2 py-1.5 rounded-lg text-sm transition-colors ${section === s.id ? 'bg-emerald-50 text-emerald-700 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}
              aria-current={section === s.id ? 'page' : undefined}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="flex-1 min-w-0">
          {section === 'profile' && <ProfileSection />}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'account' && <AccountSection />}
          {section === 'update' && <UpdateSection />}
          {section === 'privacy' && <PrivacySection />}
          {section === 'about' && <AboutSection />}
        </div>
      </div>
    </Modal>
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
          { value: 'dark', label: '深色（即将推出）' },
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
        <label className="block text-sm font-medium text-slate-700 mb-1">
          背景动效透明度 <span className="text-slate-400 tabular">{appearance.backgroundOpacity}%</span>
        </label>
        <input type="range" min={5} max={50} step={5} value={appearance.backgroundOpacity}
          onChange={(e) => setAppearance({ ...appearance, backgroundOpacity: Number(e.target.value) })}
          className="w-full accent-emerald-600" aria-label="背景动效透明度" />
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
        说明：PIN/密码仅作为本地应用锁，不加密磁盘上的数据文件（app-state.json 仍为明文 JSON）。真正的加密列入 FUTURE。
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
        <div className="text-sm text-slate-700">
          {result}
          {isNewer && url && (
            <div className="mt-2 space-y-2">
              {asset && (
                <Button size="sm" onClick={() => window.open(asset.downloadUrl, '_blank')}>⬇ 下载 {asset.name}</Button>
              )}
              <div>
                <Button size="sm" variant="outline" onClick={() => window.open(url, '_blank')}>查看 Release 全部资产</Button>
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
    <div className="space-y-2 text-sm text-slate-600">
      <p>· 所有资产数据仅保存在你自己的电脑本地，不上传服务器。</p>
      <p>· 无 analytics / telemetry / 广告 SDK。</p>
      <p>· 「AI 分析」为本地规则算法，不联网、不调用第三方 LLM。</p>
      <p>· 唯一联网行为：用户主动「检查更新」时访问 GitHub API。</p>
      <p>· 日志不记录任何金额/资产数据。</p>
    </div>
  );
}

function AboutSection() {
  const caps = platformCapabilities();
  return (
    <div className="space-y-2 text-sm text-slate-600">
      <div className="flex items-center gap-2">
        <span className="text-2xl" aria-hidden>🌱</span>
        <span className="font-semibold text-slate-800">财富成长记 / 财富梦想实现家</span>
      </div>
      <p>本地优先的个人财富管理工具（Local-First, Privacy-First）。</p>
      <div className="bg-slate-50 rounded-lg p-3 space-y-1 text-xs text-slate-600">
        <div>应用版本：<span className="font-medium">v{APP_VERSION}</span></div>
        <div>平台：<span className="font-medium">{platformLabel(caps.platform)}</span></div>
        <div>架构：<span className="font-medium">{caps.arch}</span></div>
        <div>存储后端：<span className="font-medium">{storageService.getAdapterName()}</span></div>
        <div>报告 Schema 版本：<span className="font-medium">{REPORT_SCHEMA_VERSION}</span></div>
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
