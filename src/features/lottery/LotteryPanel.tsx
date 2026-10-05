import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import type { LotteryTransaction, LotteryTxType, LotteryState, LotteryProject, LotteryProjectStatus, LotteryProjectCategory } from '../../types';
import { formatCNY } from '../../utils/money';
import { Card, Button, EmptyState, Badge } from '../../components/ui/primitives';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { MoneyField, TextField, SelectField, TextArea } from '../../components/ui/form';
import { LineChart } from '../../components/charts/LineChart';
import { downloadCSV } from '../../components/charts/export';
import {
  poolBalance,
  totalPrize,
  totalStake,
  totalInjection,
  totalWithdrawal,
  lifetimeStats,
  dailyStats,
  projectSummary,
  type ProjectSummary,
} from './lotteryMath';
import { makeLotteryTransaction } from './lotteryTx';
import { LOTTERY_TX_META, LOTTERY_CATEGORY_META } from '../../constants/featureMeta';
import { LotteryExcelImportModal } from './LotteryExcelImportModal';
import { todayString } from '../../utils/date';

type ProjectFilter = 'all' | 'active' | 'closed' | 'archived' | 'detailed' | 'summary-only';
type ProjectSort = 'net' | 'roi' | 'stake' | 'prize' | 'txn';

export function LotteryPanel() {
  const lottery = useAppStore((s) => s.lottery);
  const {
    addLotteryTransaction,
    updateLotteryTransaction,
    deleteLotteryTransaction,
    setLotteryPool,
    setLotterySettings,
    upsertLotteryProject,
    archiveLotteryProject,
    deleteLotteryProject,
  } = useAppStore();

  const [txOpen, setTxOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<LotteryTransaction | null>(null);
  const [poolOpen, setPoolOpen] = useState(false);
  const [capitalOpen, setCapitalOpen] = useState<{ open: boolean; type: 'capital-injection' | 'capital-withdrawal' }>({ open: false, type: 'capital-injection' });
  const [importOpen, setImportOpen] = useState(false);
  const [deleteTx, setDeleteTx] = useState<LotteryTransaction | null>(null);
  const [projectOpen, setProjectOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<LotteryProject | null>(null);
  const [detailProjectId, setDetailProjectId] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>('all');
  const [projectSort, setProjectSort] = useState<ProjectSort>('net');
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<LotteryProject | null>(null);

  const balance = poolBalance(lottery);
  const injection = totalInjection(lottery);
  const withdrawal = totalWithdrawal(lottery);
  const ledgerPrize = totalPrize(lottery);
  const ledgerStake = totalStake(lottery);
  const lifetime = useMemo(() => lifetimeStats(lottery), [lottery]);
  const days = useMemo(() => dailyStats(lottery), [lottery]);

  const detailProject = detailProjectId ? lottery.projects.find((p) => p.id === detailProjectId) ?? null : null;

  const cumulativeSeries = useMemo(
    () => [{ id: 'cum', name: '累计净盈亏', color: '#8B5CF6', points: days.map((d) => ({ date: d.date, value: d.cumulativeNet })), area: true }],
    [days],
  );
  const dailySeries = useMemo(
    () => [{ id: 'net', name: '每日净盈亏', color: '#F59E0B', points: days.map((d) => ({ date: d.date, value: d.netProfitLoss })) }],
    [days],
  );

  const filteredProjects = useMemo(() => {
    let list = lottery.projects;
    switch (projectFilter) {
      case 'active': list = list.filter((p) => p.status === 'active'); break;
      case 'closed': list = list.filter((p) => p.status === 'closed'); break;
      case 'archived': list = list.filter((p) => p.status === 'archived'); break;
      case 'detailed': list = list.filter((p) => p.dataCompleteness === 'detailed'); break;
      case 'summary-only': list = list.filter((p) => p.dataCompleteness === 'summary-only'); break;
    }
    const withSummary = list.map((p) => ({ p, s: projectSummary(lottery, p.id) }));
    const by: Record<ProjectSort, (a: typeof withSummary[number], b: typeof withSummary[number]) => number> = {
      net: (a, b) => b.s.netProfitLoss - a.s.netProfitLoss,
      roi: (a, b) => (b.s.roi ?? -Infinity) - (a.s.roi ?? -Infinity),
      stake: (a, b) => b.s.stakeExpense - a.s.stakeExpense,
      prize: (a, b) => b.s.prizeIncome - a.s.prizeIncome,
      txn: (a, b) => b.s.transactionCount - a.s.transactionCount,
    };
    withSummary.sort(by[projectSort]);
    return withSummary;
  }, [lottery, projectFilter, projectSort]);

  const projectBarItems = filteredProjects.map(({ p, s }) => ({
    id: p.id,
    label: `${p.emoji ?? '🎟️'} ${p.name}`,
    value: s.netProfitLoss,
    summary: s,
    detailType: p.dataCompleteness,
  }));

  function exportCsv() {
    const header = ['date', 'time', 'project', 'type', 'amount', 'paymentMethod', 'description', 'status', 'notes'];
    const rows = lottery.transactions.map((t) => {
      const project = lottery.projects.find((p) => p.id === t.projectId)?.name ?? '';
      return [t.occurredAt.slice(0, 10), t.occurredAt.slice(11, 16), project, LOTTERY_TX_META[t.type]?.label ?? t.type, t.amount, t.paymentMethod ?? '', t.description ?? '', t.status ?? '', t.notes ?? ''];
    });
    downloadCSV('lottery_transactions.csv', header, rows);
  }

  function exportProjectCsv() {
    const header = ['project', 'startDate', 'endDate', 'prizeIncome', 'stakeExpense', 'netProfitLoss', 'roi', 'transactionCount', 'dataCompleteness'];
    const rows = lottery.projects.map((p) => {
      const s = projectSummary(lottery, p.id);
      return [p.name, p.startDate ?? '', p.endDate ?? '', s.prizeIncome, s.stakeExpense, s.netProfitLoss, s.roi != null ? s.roi : '', s.transactionCount, p.dataCompleteness];
    });
    downloadCSV('lottery_project_summary.csv', header, rows);
  }

  return (
    <div className="space-y-4">
      {/* —— 第一组：当前资金池（真实 ledger）—— */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="font-semibold text-slate-800">🎟️ 当前资金池</h2>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => setCapitalOpen({ open: true, type: 'capital-injection' })}>➕ 资金注入</Button>
            <Button size="sm" variant="outline" onClick={() => setCapitalOpen({ open: true, type: 'capital-withdrawal' })}>↩️ 资金取出</Button>
            <Button size="sm" variant="outline" onClick={() => setPoolOpen(true)}>⚙️ 资金池设置</Button>
            <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>📥 导入旧 Excel</Button>
            <Button size="sm" variant="outline" onClick={exportCsv}>⬇ 交易 CSV</Button>
            <Button size="sm" variant="outline" onClick={exportProjectCsv}>⬇ 项目 CSV</Button>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <Kpi label="资金池余额" value={formatCNY(balance)} tone={balance > 0 ? 'up' : balance < 0 ? 'down' : undefined} />
          <Kpi label="累计注入" value={formatCNY(injection)} tone="up" />
          <Kpi label="累计取出" value={formatCNY(withdrawal)} tone="down" />
          <Kpi label="Ledger 中奖" value={formatCNY(ledgerPrize)} tone="up" />
          <Kpi label="Ledger 投注" value={formatCNY(ledgerStake)} tone="down" />
        </div>
        <p className="text-[11px] text-slate-400 mt-2">当前资金池只基于真实 ledger 交易（期初 + 注入 − 取出 + 中奖 − 投注 ± 调整），历史汇总数据不影响资金池。资金池余额可以为负。</p>
      </Card>

      {/* —— 第二组：历史彩票表现（含 summary-only 项目）—— */}
      <Card className="p-4">
        <h2 className="font-semibold text-slate-800 mb-3">📜 历史彩票表现</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Kpi label="全生命周期中奖" value={formatCNY(lifetime.prize)} tone="up" />
          <Kpi label="全生命周期支出" value={formatCNY(lifetime.stake)} tone="down" />
          <Kpi label="全生命周期净盈亏" value={formatCNY(lifetime.net)} tone={lifetime.net >= 0 ? 'up' : 'down'} />
          <Kpi label="净盈亏率" value={lifetime.roi != null ? `${lifetime.roi.toFixed(2)}%` : '—'} />
          <Kpi label="项目数量" value={String(lifetime.projectCount)} />
          <Kpi label="历史数据完整度" value={`${lifetime.detailedCount} 详细 / ${lifetime.summaryOnlyCount} 汇总`} />
        </div>
        <p className="text-[11px] text-slate-400 mt-2">历史表现包含详细项目（从交易推导）、summary-only 历史项目（从历史汇总）与未归属交易。彩票独立于财富资产，不计入总资产、财富等级、目标与标准财务报告。</p>
      </Card>

      {/* 图表 */}
      {days.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-medium text-slate-700 mb-2">累计净盈亏</h3>
          <LineChart series={cumulativeSeries} ariaLabel="累计净盈亏" />
        </Card>
      )}
      {days.length > 1 && (
        <Card className="p-4">
          <h3 className="text-sm font-medium text-slate-700 mb-2">每日净盈亏</h3>
          <LineChart series={dailySeries} ariaLabel="每日净盈亏" />
        </Card>
      )}

      {/* 项目 */}
      {lottery.projects.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-sm font-medium text-slate-700">项目净盈亏</h3>
            <div className="flex gap-2 flex-wrap items-center">
              <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value as ProjectFilter)} className="px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-lg" aria-label="项目筛选">
                <option value="all">全部</option>
                <option value="active">进行中</option>
                <option value="closed">已结束</option>
                <option value="archived">已归档</option>
                <option value="detailed">详细交易</option>
                <option value="summary-only">历史汇总</option>
              </select>
              <select value={projectSort} onChange={(e) => setProjectSort(e.target.value as ProjectSort)} className="px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-lg" aria-label="项目排序">
                <option value="net">按净盈亏</option>
                <option value="roi">按 ROI</option>
                <option value="stake">按支出</option>
                <option value="prize">按收入</option>
                <option value="txn">按交易数</option>
              </select>
              <Button size="sm" variant="outline" onClick={() => { setEditingProject(null); setProjectOpen(true); }}>＋ 新增项目</Button>
            </div>
          </div>
          {projectBarItems.length > 0 ? (
            <ProjectPLBars items={projectBarItems} onSelect={(id) => setDetailProjectId(id)} />
          ) : (
            <p className="text-sm text-slate-400">当前筛选下没有项目。</p>
          )}
        </Card>
      )}

      {/* 每日统计 */}
      {days.length > 0 && (
        <Card className="p-4 overflow-x-auto">
          <h3 className="text-sm font-medium text-slate-700 mb-2">每日统计</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-100">
                <th className="py-2 pr-2 font-medium">日期</th>
                <th className="py-2 px-2 font-medium text-right">中奖收入</th>
                <th className="py-2 px-2 font-medium text-right">投注支出</th>
                <th className="py-2 px-2 font-medium text-right">净盈亏</th>
                <th className="py-2 px-2 font-medium text-right">交易数</th>
                <th className="py-2 px-2 font-medium text-right">累计净盈亏</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date} className="border-b border-slate-50">
                  <td className="py-1.5 pr-2 tabular">{d.date}</td>
                  <td className="py-1.5 px-2 tabular text-right text-emerald-600">{formatCNY(d.prizeIncome)}</td>
                  <td className="py-1.5 px-2 tabular text-right text-red-600">{formatCNY(d.stakeExpense)}</td>
                  <td className={`py-1.5 px-2 tabular text-right ${d.netProfitLoss >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{d.netProfitLoss >= 0 ? '+' : ''}{formatCNY(d.netProfitLoss)}</td>
                  <td className="py-1.5 px-2 tabular text-right">{d.transactionCount}</td>
                  <td className={`py-1.5 px-2 tabular text-right ${d.cumulativeNet >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{d.cumulativeNet >= 0 ? '+' : ''}{formatCNY(d.cumulativeNet)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* 交易列表 */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-slate-700">交易明细（{lottery.transactions.length}）</h3>
          <Button size="sm" onClick={() => { setEditingTx(null); setTxOpen(true); }}>＋ 记一笔</Button>
        </div>
        {lottery.transactions.length === 0 ? (
          <EmptyState icon="🎟️" title="暂无彩票交易" description="从「资金注入」开始，或导入旧彩票 Excel 账本。" />
        ) : (
          <div className="space-y-1.5">
            {lottery.transactions.slice(0, 300).map((t) => {
              const meta = LOTTERY_TX_META[t.type];
              const positive = ['prize', 'capital-injection'].includes(t.type);
              const project = lottery.projects.find((p) => p.id === t.projectId);
              return (
                <div key={t.id} className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-slate-50 border-b border-slate-50 last:border-0">
                  <span aria-hidden>{meta?.icon ?? '🎟️'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-700 truncate">{meta?.label ?? t.type} {t.description ? `· ${t.description}` : ''}</div>
                    <div className="text-xs text-slate-400">
                      {t.occurredAt.replace('T', ' ').slice(0, 16)}
                      {project ? ` · ${project.name}` : ''}
                      {t.paymentMethod ? ` · ${t.paymentMethod}` : ''}
                    </div>
                  </div>
                  <span className={`tabular font-medium ${positive ? 'text-emerald-600' : 'text-red-600'}`}>
                    {positive ? '+' : '-'}{formatCNY(t.amount)}
                  </span>
                  <button className="text-xs text-slate-300 hover:text-blue-500" onClick={() => { setEditingTx(t); setTxOpen(true); }} aria-label="编辑交易">✏️</button>
                  <button className="text-xs text-slate-300 hover:text-red-500" onClick={() => setDeleteTx(t)} aria-label="删除交易">🗑️</button>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* 设置 */}
      <Card className="p-4">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={lottery.settings.showLotteryAppendix} onChange={(e) => setLotterySettings({ ...lottery.settings, showLotteryAppendix: e.target.checked })} className="h-4 w-4 text-emerald-600 rounded" />
          <span className="text-sm text-slate-700">在财富报告中显示彩票摘要（独立附录，不计入总资产）</span>
        </label>
      </Card>

      {/* 弹窗 */}
      <LotteryTxModal open={txOpen} initial={editingTx} onClose={() => { setTxOpen(false); setEditingTx(null); }} onSave={(t) => { if (editingTx) updateLotteryTransaction(editingTx.id, t); else addLotteryTransaction(t); setTxOpen(false); setEditingTx(null); }} />
      <PoolModal open={poolOpen} onClose={() => setPoolOpen(false)} onSave={(pool) => { setLotteryPool(pool); setPoolOpen(false); }} />
      <CapitalTxModal open={capitalOpen.open} type={capitalOpen.type} onClose={() => setCapitalOpen((s) => ({ ...s, open: false }))} onSave={(t) => { addLotteryTransaction(t); setCapitalOpen((s) => ({ ...s, open: false })); }} />
      <LotteryExcelImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      <ProjectFormModal
        open={projectOpen}
        initial={editingProject}
        onClose={() => setProjectOpen(false)}
        onSubmit={(p) => { upsertLotteryProject(p); setProjectOpen(false); }}
      />
      {detailProject && (
        <ProjectDetailModal
          project={detailProject}
          transactions={lottery.transactions.filter((t) => t.projectId === detailProject.id)}
          onClose={() => setDetailProjectId(null)}
          onEdit={() => { setEditingProject(detailProject); setProjectOpen(true); }}
          onArchive={() => archiveLotteryProject(detailProject.id)}
          onDelete={() => { setDeleteProjectTarget(detailProject); }}
        />
      )}
      <ConfirmDialog
        open={deleteTx != null}
        title="删除彩票交易"
        message={deleteTx ? `确定删除这笔「${LOTTERY_TX_META[deleteTx.type]?.label ?? deleteTx.type}」交易吗？\n日期：${deleteTx.occurredAt.replace('T', ' ').slice(0, 16)}\n金额：${formatCNY(deleteTx.amount)}\n${deleteTx.projectId ? `项目：${lottery.projects.find((p) => p.id === deleteTx.projectId)?.name ?? ''}` : '（资金池级交易）'}` : ''}
        onCancel={() => setDeleteTx(null)}
        onConfirm={() => { if (deleteTx) deleteLotteryTransaction(deleteTx.id); setDeleteTx(null); }}
      />
      {deleteProjectTarget && (
        <ProjectDeleteModal
          project={deleteProjectTarget}
          transactionCount={lottery.transactions.filter((t) => t.projectId === deleteProjectTarget.id).length}
          onClose={() => setDeleteProjectTarget(null)}
          onArchive={() => { archiveLotteryProject(deleteProjectTarget.id); setDeleteProjectTarget(null); }}
          onDelete={() => { deleteLotteryProject(deleteProjectTarget.id); setDeleteProjectTarget(null); setDetailProjectId(null); }}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  const color = tone === 'up' ? 'text-emerald-600' : tone === 'down' ? 'text-red-600' : 'text-slate-800';
  return (
    <div className="bg-slate-50 rounded-xl px-3 py-2.5">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-sm font-semibold tabular truncate ${color}`}>{value}</div>
    </div>
  );
}

/** 横向正负 Bar：0 为中线，正值绿色向右，负值红色向左。 */
function ProjectPLBars({ items, onSelect }: {
  items: { id: string; label: string; value: number; summary: ProjectSummary; detailType: 'detailed' | 'summary-only' }[];
  onSelect: (id: string) => void;
}) {
  const maxAbs = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  return (
    <div className="space-y-1">
      {items.map((it) => {
        const pos = it.value >= 0;
        const wPct = Math.max(2, (Math.abs(it.value) / maxAbs) * 46);
        const summary = it.summary;
        return (
          <button key={it.id} className="w-full text-left py-1 px-1 rounded hover:bg-slate-50" onClick={() => onSelect(it.id)} title={`收入 ${formatCNY(summary.prizeIncome)} · 支出 ${formatCNY(summary.stakeExpense)} · 净盈亏 ${formatCNY(summary.netProfitLoss)}${summary.roi != null ? ` · ROI ${summary.roi.toFixed(1)}%` : ''} · ${it.detailType === 'detailed' ? '详细交易' : '历史汇总'}`}>
            <div className="flex items-center gap-2 text-sm">
              <span className="w-44 shrink-0 truncate text-slate-700">{it.label}</span>
              <span className="flex-1 relative h-4 bg-slate-50 rounded-full overflow-hidden">
                <span className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-300" aria-hidden />
                {pos ? (
                  <span className="absolute left-1/2 top-0 bottom-0 bg-emerald-500 rounded-r-full" style={{ width: `${wPct}%` }} aria-hidden />
                ) : (
                  <span className="absolute right-1/2 top-0 bottom-0 bg-red-500 rounded-l-full" style={{ width: `${wPct}%` }} aria-hidden />
                )}
              </span>
              <span className={`w-28 shrink-0 text-right tabular font-medium ${pos ? 'text-emerald-600' : 'text-red-600'}`}>
                {pos ? '+' : ''}{formatCNY(it.value)}
              </span>
              <span className="w-12 shrink-0 text-right text-xs text-slate-400 tabular">{summary.roi != null ? `${summary.roi.toFixed(1)}%` : '—'}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function LotteryTxModal({ open, initial, onClose, onSave }: {
  open: boolean;
  initial: LotteryTransaction | null;
  onClose: () => void;
  onSave: (t: LotteryTransaction) => void;
}) {
  const projects = useAppStore((s) => s.lottery.projects);
  const [type, setType] = useState<LotteryTxType>('stake');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayString());
  const [time, setTime] = useState('12:00');
  const [projectId, setProjectId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  // 打开/初始值变化时填充表单（编辑）
  useEffect(() => {
    if (open) {
      setType(initial?.type ?? 'stake');
      setAmount(initial ? String(initial.amount) : '');
      setDate(initial?.occurredAt.slice(0, 10) ?? todayString());
      setTime(initial?.occurredAt.slice(11, 16) ?? '12:00');
      setProjectId(initial?.projectId ?? '');
      setPaymentMethod(initial?.paymentMethod ?? '');
      setDescription(initial?.description ?? '');
      setStatus(initial?.status ?? '');
      setNotes(initial?.notes ?? '');
      setError('');
    }
  }, [open, initial]);

  function submit() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setError('金额必须大于 0'); return; }
    onSave({
      ...(initial ?? {}),
      type,
      amount: amt,
      occurredAt: `${date}T${time}:00`,
      projectId: projectId || null,
      paymentMethod: paymentMethod.trim() || undefined,
      description: description.trim() || undefined,
      status: status.trim() || undefined,
      notes: notes.trim() || undefined,
      source: initial?.source ?? 'manual',
    } as LotteryTransaction);
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? '编辑彩票交易' : '记一笔彩票交易'} size="md"
      footer={<><Button variant="ghost" onClick={onClose}>取消</Button><Button onClick={submit}>保存</Button></>}>
      <div className="space-y-4">
        <SelectField label="类型" value={type} onChange={(e) => setType(e.target.value as LotteryTxType)}
          options={Object.entries(LOTTERY_TX_META).map(([k, v]) => ({ value: k, label: `${v.icon} ${v.label}` }))} />
        <MoneyField label="金额（正数）" value={amount === '' ? '' : Number(amount)} onChange={(v) => setAmount(v === '' ? '' : String(v))} error={error} />
        <div className="grid grid-cols-2 gap-3">
          <TextField label="日期" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <TextField label="时间" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <SelectField label="项目（可选）" value={projectId} onChange={(e) => setProjectId(e.target.value)}
          options={[{ value: '', label: '— 资金池级（无项目）' }, ...projects.map((p) => ({ value: p.id, label: `${p.emoji ?? '🎟️'} ${p.name}` }))]} />
        <TextField label="支付方式" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} placeholder="例如：零钱 / 银行卡" />
        <TextField label="说明" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="投注 / 中奖说明" />
        <TextField label="状态" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="已收款 / 对方已收款" />
        <TextField label="备注" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="可选" />
      </div>
    </Modal>
  );
}

function PoolModal({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (pool: NonNullable<LotteryState['pool']>) => void }) {
  const pool = useAppStore((s) => s.lottery.pool);
  const [name, setName] = useState(pool?.name ?? '彩票资金池');
  const [opening, setOpening] = useState(pool ? String(pool.openingBalance) : '0');
  const [notes, setNotes] = useState(pool?.notes ?? '');

  return (
    <Modal open={open} onClose={onClose} title="资金池设置" size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>取消</Button><Button onClick={() => onSave({ id: pool?.id ?? 'lottery_pool', name: name.trim() || '彩票资金池', openingBalance: Number(opening) || 0, createdAt: pool?.createdAt ?? new Date().toISOString(), ...(notes.trim() ? { notes: notes.trim() } : {}) })}>保存</Button></>}>
      <div className="space-y-4">
        <p className="text-xs text-slate-400">期初余额是可正可负的基准值；实际余额由交易动态推导（期初 + 注入 − 取出 + 中奖 − 投注 ± 调整）。</p>
        <TextField label="资金池名称" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="期初余额" type="number" value={opening} onChange={(e) => setOpening(e.target.value)} />
        <TextField label="备注" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="可选" />
        <p className="text-xs text-slate-500">资金注入 / 取出请使用面板上的「➕ 资金注入」「↩️ 资金取出」按钮。</p>
      </div>
    </Modal>
  );
}

function CapitalTxModal({ open, type, onClose, onSave }: {
  open: boolean;
  type: 'capital-injection' | 'capital-withdrawal';
  onClose: () => void;
  onSave: (t: LotteryTransaction) => void;
}) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayString());
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setAmount(''); setDate(todayString()); setDescription(''); setError(''); }
  }, [open]);

  function submit() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setError('金额必须大于 0'); return; }
    onSave(makeLotteryTransaction({
      type,
      amount: amt,
      occurredAt: `${date}T12:00:00`,
      projectId: null,
      description: description.trim() || undefined,
      source: 'manual',
    }));
  }

  const label = type === 'capital-injection' ? '资金注入' : '资金取出';
  const icon = type === 'capital-injection' ? '➕' : '↩️';

  return (
    <Modal open={open} onClose={onClose} title={`${icon} ${label}`} size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>取消</Button><Button onClick={submit}>确认</Button></>}>
      <div className="space-y-4">
        <MoneyField label={`${label}金额（正数）`} value={amount === '' ? '' : Number(amount)} onChange={(v) => setAmount(v === '' ? '' : String(v))} error={error} />
        <TextField label="日期" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <TextField label="说明" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="例如：补充资金池本金" />
        <p className="text-xs text-slate-400">将创建一笔「{LOTTERY_TX_META[type]?.label}」交易，计入当前资金池余额。</p>
      </div>
    </Modal>
  );
}

function ProjectFormModal({ open, initial, onClose, onSubmit }: {
  open: boolean;
  initial: LotteryProject | null;
  onClose: () => void;
  onSubmit: (p: LotteryProject) => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<LotteryProjectCategory>('other');
  const [status, setStatus] = useState<LotteryProjectStatus>('active');
  const [emoji, setEmoji] = useState('🎟️');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '');
      setCategory(initial?.category ?? 'other');
      setStatus(initial?.status ?? 'active');
      setEmoji(initial?.emoji ?? '🎟️');
      setStartDate(initial?.startDate ?? '');
      setEndDate(initial?.endDate ?? '');
      setNotes(initial?.notes ?? '');
      setError('');
    }
  }, [open, initial]);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) { setError('请输入项目名称'); return; }
    const now = new Date().toISOString();
    onSubmit({
      id: initial?.id ?? `lp_${Date.now().toString(36)}`,
      name: trimmed,
      category,
      status,
      emoji: emoji || undefined,
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
      dataCompleteness: initial?.dataCompleteness ?? 'detailed',
      ...(initial?.legacySummary ? { legacySummary: initial.legacySummary } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    });
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? '编辑项目' : '新增项目'} size="md"
      footer={<><Button variant="ghost" onClick={onClose}>取消</Button><Button onClick={submit}>保存</Button></>}>
      <div className="space-y-4">
        <TextField label="项目名称" value={name} onChange={(e) => setName(e.target.value)} error={error} placeholder="例如：竞彩足球" autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="类别" value={category} onChange={(e) => setCategory(e.target.value as LotteryProjectCategory)}
            options={Object.entries(LOTTERY_CATEGORY_META).map(([k, v]) => ({ value: k, label: `${v.icon} ${v.label}` }))} />
          <SelectField label="状态" value={status} onChange={(e) => setStatus(e.target.value as LotteryProjectStatus)}
            options={[{ value: 'active', label: '进行中' }, { value: 'closed', label: '已结束' }, { value: 'archived', label: '已归档' }]} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="图标（Emoji）" value={emoji} onChange={(e) => setEmoji(e.target.value)} />
          <TextField label="开始日期" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <TextField label="结束日期" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        <TextArea label="备注" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="可选" />
      </div>
    </Modal>
  );
}

function ProjectDetailModal({ project, transactions, onClose, onEdit, onArchive, onDelete }: {
  project: LotteryProject;
  transactions: LotteryTransaction[];
  onClose: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const meta = LOTTERY_CATEGORY_META[project.category];
  const isSummaryOnly = project.dataCompleteness === 'summary-only';
  const summary = projectSummary(useAppStore.getState().lottery, project.id);

  return (
    <Modal open onClose={onClose} title={`${project.emoji ?? meta?.icon ?? '🎟️'} ${project.name}`} size="lg"
      footer={<>
        <Button variant="ghost" onClick={onEdit}>✏️ 编辑</Button>
        {project.status !== 'archived' && <Button variant="outline" onClick={onArchive}>🗃️ 归档</Button>}
        <Button variant="danger" onClick={onDelete}>🗑️ 删除</Button>
      </>}>
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge tone={project.status === 'active' ? 'emerald' : project.status === 'archived' ? 'slate' : 'amber'}>
            {project.status === 'active' ? '进行中' : project.status === 'archived' ? '已归档' : '已结束'}
          </Badge>
          <Badge tone={isSummaryOnly ? 'amber' : 'emerald'}>{isSummaryOnly ? '历史汇总数据' : '详细交易'}</Badge>
          {project.startDate && <span className="text-xs text-slate-400">{project.startDate}{project.endDate ? ` ~ ${project.endDate}` : ''}</span>}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="中奖收入" value={formatCNY(summary.prizeIncome)} tone="up" />
          <Stat label="彩票支出" value={formatCNY(summary.stakeExpense)} tone="down" />
          <Stat label="净盈亏" value={`${summary.netProfitLoss >= 0 ? '+' : ''}${formatCNY(summary.netProfitLoss)}`} tone={summary.netProfitLoss >= 0 ? 'up' : 'down'} />
          <Stat label="ROI" value={summary.roi != null ? `${summary.roi.toFixed(2)}%` : '—'} />
        </div>

        {isSummaryOnly ? (
          <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-3">这是历史汇总项目（summary-only），没有明细交易；0 笔不代表没有发生过交易。</p>
        ) : (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-slate-700">交易明细（{transactions.length} 笔）</h4>
            {transactions.length === 0 ? (
              <p className="text-sm text-slate-400">暂无明细交易。</p>
            ) : (
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {[...transactions].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1)).map((t) => {
                  const positive = t.type === 'prize';
                  const tm = LOTTERY_TX_META[t.type];
                  return (
                    <div key={t.id} className="flex items-center gap-2 px-2 py-1.5 text-sm border-b border-slate-50">
                      <span aria-hidden>{tm?.icon ?? '🎟️'}</span>
                      <span className="flex-1 truncate text-slate-600">{t.occurredAt.replace('T', ' ').slice(0, 16)}{t.description ? ` · ${t.description}` : ''}</span>
                      <span className={`tabular font-medium ${positive ? 'text-emerald-600' : 'text-red-600'}`}>{positive ? '+' : '-'}{formatCNY(t.amount)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {project.notes && (
          <div>
            <h4 className="text-sm font-medium text-slate-700 mb-1">备注</h4>
            <p className="text-sm text-slate-600">{project.notes}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ProjectDeleteModal({ project, transactionCount, onClose, onArchive, onDelete }: {
  project: LotteryProject;
  transactionCount: number;
  onClose: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const hasTx = transactionCount > 0;
  return (
    <Modal open onClose={onClose} title="删除项目" size="sm"
      footer={<>
        <Button variant="ghost" onClick={onClose}>取消</Button>
        {hasTx && <Button variant="outline" onClick={onArchive}>改为归档</Button>}
        {!hasTx && <Button variant="danger" onClick={onDelete}>确认删除</Button>}
      </>}>
      <div className="space-y-3 text-sm text-slate-600">
        {hasTx ? (
          <>
            <p>「{project.name}」有 <span className="font-semibold">{transactionCount}</span> 笔交易，不能直接删除（否则会产生孤立交易）。</p>
            <p>建议：归档项目（保留历史），或在编辑交易中先把交易重新分配到其它项目。</p>
          </>
        ) : (
          <p>确定删除项目「{project.name}」吗？此操作无法撤销。</p>
        )}
      </div>
    </Modal>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  const color = tone === 'up' ? 'text-emerald-600' : tone === 'down' ? 'text-red-600' : 'text-slate-800';
  return (
    <div className="bg-slate-50 rounded-xl px-3 py-2.5">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-sm font-semibold tabular truncate ${color}`}>{value}</div>
    </div>
  );
}
