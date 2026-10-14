import { Button } from '../../components/ui/primitives';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useAIWorkspaceStore, type AIWorkspaceTarget } from '../../store/aiWorkspaceStore';

export function AIActionButton({ children, ...target }: AIWorkspaceTarget & { children: React.ReactNode }) {
  const hidden = useWorkspaceStore(s => s.amountsHidden);
  return <Button variant="outline" disabled={hidden} title={hidden ? '金额隐私开启时暂停 AI 业务上下文' : '选择数据后逐次授权发送'}
    onClick={() => useAIWorkspaceStore.getState().open(target)}>{children}</Button>;
}
