import { useMemo, useState } from 'react';
import { Badge, Button, Card } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { useAppStore } from '../../store/appStore';
import { storageService } from '../../services/storage';
import { saveFullBackupArchive } from '../../services/storage/fs';
import { buildFullBackup } from '../../services/export/fullBackup';
import { bytesToBase64 } from '../../services/monthlyPlanning/attachments';
import {
  applyAlipayClassificationMigration,
  buildAlipayClassificationMigrationPlan,
  revertAlipayClassificationMigration,
} from '../../domain/assets/classificationMigration';
import { ALIPAY_GOLD_CLASSIFICATION_MIGRATION_ID } from '../../domain/assets/classification';

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function ClassificationMigrationCard() {
  const channels = useAppStore((state) => state.channels);
  const history = useAppStore((state) => state.history);
  const reports = useAppStore((state) => state.reports);
  const planning = useAppStore((state) => state.monthlyPlanning);
  const classifications = useAppStore((state) => state.assetClassification);
  const applyClassification = useAppStore((state) => state.applyAssetClassification);
  const pushToast = useAppStore((state) => state.pushToast);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDesktop = storageService.getAdapterName() === 'desktop';
  const plan = useMemo(
    () => buildAlipayClassificationMigrationPlan({
      channels, history, reports, planning, classifications,
    }),
    [channels, history, reports, planning, classifications],
  );

  async function createFullBackup(label: string): Promise<{ relativePath: string; sha256: string }> {
    await storageService.flush();
    const state = useAppStore.getState();
    const result = await buildFullBackup({
      revision: state.dataRevision,
      monthlyPlanning: state.monthlyPlanning,
      aiMetadata: localStorage.getItem('wealth_ai_connections_v1'),
    });
    const relativePath = await saveFullBackupArchive(result.filename, bytesToBase64(result.archive), result.sha256);
    pushToast(`${label}完整备份：${relativePath} · SHA-256 ${result.sha256.slice(0, 12)}…`, 'success');
    return { relativePath, sha256: result.sha256 };
  }

  async function applyMigration() {
    if (busy || !isDesktop || plan.status !== 'ready') return;
    setBusy(true);
    setError(null);
    try {
      const pre = await createFullBackup('升级前');
      const next = await applyAlipayClassificationMigration({
        plan,
        state: classifications,
        backupSha256: pre.sha256,
      });
      await applyClassification(next, '正在应用资产分类迁移');
      setOpen(false);
      pushToast('支付宝银行黄金/基金分类迁移完成；渠道金额未改变', 'success');
      try {
        await createFullBackup('迁移后');
      } catch (cause) {
        pushToast(`迁移已应用，但迁移后完整备份失败：${message(cause, '未知错误')}`, 'error');
      }
    } catch (cause) {
      setError(message(cause, '分类迁移失败'));
    } finally {
      setBusy(false);
    }
  }

  async function revertMigration() {
    if (busy || !isDesktop || plan.status !== 'applied') return;
    if (!window.confirm('撤销只追加反向分类事件，不删除审计历史。确定撤销本次支付宝分类迁移吗？')) return;
    setBusy(true);
    setError(null);
    try {
      await createFullBackup('撤销前');
      const next = await revertAlipayClassificationMigration({ state: classifications });
      await applyClassification(next, '正在撤销资产分类迁移');
      setOpen(false);
      pushToast('支付宝分类迁移已通过追加反向事件撤销', 'success');
    } catch (cause) {
      setError(message(cause, '撤销分类迁移失败'));
    } finally {
      setBusy(false);
    }
  }

  const applied = plan.status === 'applied';
  return (
    <>
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-slate-800">资产分类迁移</h2>
              <Badge tone={applied ? 'emerald' : plan.status === 'blocked' ? 'red' : 'amber'}>
                {applied ? '已应用' : plan.status === 'blocked' ? '受阻' : '待预览'}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              支付宝「银行黄金」只记录积存金产品语义；黄金 ETF 基金保留独立 holdingId，并增加基金归属和黄金敞口。
            </p>
          </div>
          <Button
            variant={applied ? 'outline' : 'primary'}
            disabled={!isDesktop || plan.status === 'blocked'}
            onClick={() => setOpen(true)}
          >
            {applied ? '查看分类账本' : '预览分类迁移'}
          </Button>
        </div>
        {!isDesktop && <p className="mt-3 text-xs text-amber-700">分类迁移需要桌面完整备份与恢复能力。</p>}
      </Card>

      <Modal
        open={open}
        onClose={() => { if (!busy) setOpen(false); }}
        title={applied ? '资产分类账本已应用' : '预览支付宝分类迁移'}
        size="md"
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              {applied ? '关闭' : '取消'}
            </Button>
            {!applied && (
              <Button disabled={busy || plan.status !== 'ready'} onClick={() => void applyMigration()}>
                {busy ? '备份并迁移中…' : '创建完整备份并应用'}
              </Button>
            )}
            {applied && classifications.migrations[ALIPAY_GOLD_CLASSIFICATION_MIGRATION_ID]?.status === 'applied' && (
              <Button variant="outline" disabled={busy} onClick={() => void revertMigration()}>
                {busy ? '处理中…' : '撤销迁移'}
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Summary label="渠道变更" value={plan.counts.channelChanges} />
            <Summary label="产品描述" value={plan.counts.productDescriptors} />
            <Summary label="基金持仓" value={plan.counts.holdingChanges} />
            <Summary label="待核对" value={plan.counts.pending} />
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <p className="font-medium">金额守恒检查</p>
            <p className="mt-1">总资产变化：{plan.invariant.totalDelta === 0 ? '0（通过）' : '非 0，禁止应用'}；渠道金额：{plan.invariant.channelAmountsStable ? '不变' : '发生变化'}。</p>
            <p className="mt-1 text-xs">历史 {plan.invariant.historyCount} 条、报告 {plan.invariant.reportCount} 份、任务修订 {plan.invariant.taskRevisionCount} 个均不重写。</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <p className="font-medium">迁移规则</p>
            <ul className="mt-2 space-y-1 text-xs leading-relaxed">
              <li>只改变 Alipay 的产品分类、基金叶子归属和风险标签。</li>
              <li>A/C 与每个 holdingId 保持独立；不根据任务持仓重算当前渠道余额。</li>
              <li>积存金是 `alipay_gold` 的产品描述，金额基准为渠道总额，不会复制金额。</li>
              <li>其他平台名称不变；重复基金代码保留原记录并进入待核对。</li>
            </ul>
          </div>
          {plan.pending.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <p className="font-medium">{plan.pending.length} 条记录保留待核对</p>
              <p className="mt-1 text-xs">包括同父级重复基金代码或分类证据不足项。本迁移不会合并、删除或覆盖它们。</p>
            </div>
          )}
          {plan.blockers.length > 0 && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {plan.blockers.join('；')}
            </div>
          )}
          {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          {!applied && (
            <p className="text-xs text-slate-500">应用按钮会先生成升级前完整备份，再以单次事务写入追加式分类事件；随后自动生成迁移后完整备份。</p>
          )}
        </div>
      </Modal>
    </>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2 text-center">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="font-semibold tabular text-slate-700">{value}</div>
    </div>
  );
}
