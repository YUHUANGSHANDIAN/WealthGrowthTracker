import { useNavigationStore } from '../../store/navigationStore';
import { SettingsContent } from './SettingsModal';
import { PageHeader } from '../../components/ui/workspace';

export function SettingsPage() {
  const section = useNavigationStore((state) => state.settingsSection ?? 'profile');
  const navigate = useNavigationStore((state) => state.navigate);
  return (
    <div className="settings-page">
      <PageHeader
        eyebrow="应用设置"
        title="你的工作台偏好"
        description="个人偏好、记录规则与数据边界分区管理。危险操作与能力验证状态分开呈现。"
        context={<><span>普通偏好</span><span>·</span><span>模型连接</span><span>·</span><span>数据健康与恢复</span></>}
      />
      <SettingsContent section={section} onSectionChange={(settingsSection) => navigate({ tab: 'settings', settingsSection })} />
    </div>
  );
}
