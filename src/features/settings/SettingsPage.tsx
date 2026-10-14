import { useNavigationStore } from '../../store/navigationStore';
import { SettingsContent } from './SettingsModal';

export function SettingsPage() {
  const section = useNavigationStore((state) => state.settingsSection ?? 'profile');
  const navigate = useNavigationStore((state) => state.navigate);
  return (
    <div className="settings-page">
      <div className="workspace-intro">
        <div>
          <h2>你的工作台偏好</h2>
          <p>个人设置、记录规则和数据边界；每个分类都可通过链接直接打开。</p>
        </div>
      </div>
      <SettingsContent section={section} onSectionChange={(settingsSection) => navigate({ tab: 'settings', settingsSection })} />
    </div>
  );
}
