import { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { storageService } from '../../services/storage';
import { Badge, Button, Card } from '../../components/ui/primitives';

export function ReportProjectionStatus() {
  const queue = useAppStore(state => state.reportProjectionQueue);
  const retry = useAppStore(state => state.retryReportProjection);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (storageService.getAdapterName() !== 'desktop') return null;
  const pending = queue.indexPending || queue.reportIds.length > 0;
  return <Card className="p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="font-semibold text-slate-800">报告文件与索引</h3>
      <Badge tone={pending ? 'amber' : 'emerald'}>{pending ? '等待同步' : '已同步'}</Badge>
    </div>
    <p className="mt-2 text-sm text-slate-600">应用主数据是报告依据。文件和索引可在主数据保存后重新生成；更名和删除前的旧文件保留，索引只指向当前报告。</p>
    {pending && <p className="mt-2 text-sm text-slate-600">待写入 {queue.reportIds.length} 份报告{queue.indexPending ? '及索引' : ''}，已尝试 {queue.attempts} 次。</p>}
    {(queue.lastError || error) && <p role="alert" className="mt-2 text-sm text-red-600">{error || queue.lastError}</p>}
    {pending && <Button className="mt-3" disabled={busy} onClick={() => {
      setBusy(true); setError('');
      void retry().catch(cause => setError(cause instanceof Error ? cause.message : '重试失败')).finally(() => setBusy(false));
    }}>{busy ? '正在同步…' : '重试文件同步'}</Button>}
  </Card>;
}
