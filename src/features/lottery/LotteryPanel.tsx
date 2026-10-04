import { useMemo, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import type { LotteryTransaction, LotteryTxType, LotteryState } from '../../types';
import { formatCNY } from '../../utils/money';
import { Card, Button, EmptyState } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { MoneyField, TextField, SelectField } from '../../components/ui/form';
import { LineChart } from '../../components/charts/LineChart';
import { BarChart } from '../../components/charts/BarChart';
import { downloadCSV } from '../../components/charts/export';
import { poolBalance, netPL, roi, totalPrize, totalStake, dailyStats, projectSummary, type ProjectSummary } from './lotteryMath';
import { makeLotteryTransaction } from './lotteryTx';
import { LOTTERY_TX_META, LOTTERY_CATEGORY_META } from '../../constants/featureMeta';
import { todayString } from '../../utils/date';

export function LotteryPanel() {
  const lottery = useAppStore((s) => s.lottery);
  const { addLotteryTransaction, deleteLotteryTransaction, setLotteryPool, setLotterySettings } = useAppStore();

  const [txOpen, setTxOpen] = useState(false);
  const [poolOpen, setPoolOpen] = useState(false);

  const balance = poolBalance(lottery);
  const prize = totalPrize(lottery);
  const stake = totalStake(lottery);
  const net = netPL(lottery);
  const r = roi(lottery);
  const days = useMemo(() => dailyStats(lottery), [lottery]);

  const cumulativeSeries = useMemo(
    () => [{ id: 'cum', name: '累计净盈亏', color: '#8B5CF6', points: days.map((d) => ({ date: d.date, value: d.cumulativeNet })), area: true }],
    [days],
  );
  const dailySeries = useMemo(
    () => [{ id: 'net', name: '每日净盈亏', color: '#F59E0B', points: days.map((d) => ({ date: d.date, value: d.netProfitLoss })) }],
    [days],
  );

  const projectItems = useMemo(
    () =>
      lottery.projects.map((p) => {
        const s: ProjectSummary = projectSummary(lottery, p.id);
        return { id: p.id, label: `${p.emoji ?? '🎟️'} ${p.name}`, value: s.netProfitLoss, color: p.category === 'sports-football' ? '#3B82F6' : p.category === 'lotto' ? '#8B5CF6' : '#F59E0B', emoji: p.emoji ?? '🎟️', hint: s.roi != null ? `${s.roi.toFixed(1)}%` : '' };
      }),
    [lottery],
  );

  function exportCsv() {
    const header = ['date', 'time', 'project', 'type', 'amount', 'paymentMethod', 'description', 'status', 'notes'];
    const rows = lottery.transactions.map((t) => {
      const project = lottery.projects.find((p) => p.id === t.projectId)?.name ?? '';
      return [t.occurredAt.slice(0, 10), t.occurredAt.slice(11, 16), project, LOTTERY_TX_META[t.type]?.label ?? t.type, t.amount, t.paymentMethod ?? '', t.description ?? '', t.status ?? '', t.notes ?? ''];
    });
    downloadCSV('lottery_transactions.csv', header, rows);
  }

  const tone = balance > 0 ? 'up' : balance < 0 ? 'down' : undefined;

  return (
    <div className="space-y-4">
      {/* KPI Dashboard */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-800">🎟️ 彩票资金池</h2>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setPoolOpen(true)}>💼 注入 / 取出</Button>
            <Button size="sm" variant="outline" onClick={exportCsv}>⬇ CSV</Button>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Kpi label="资金池余额" value={formatCNY(balance)} tone={tone} />
          <Kpi label="累计中奖收入" value={formatCNY(prize)} tone="up" />
          <Kpi label="累计投注支出" value={formatCNY(stake)} tone="down" />
          <Kpi label="累计净盈亏" value={formatCNY(net)} tone={net >= 0 ? 'up' : 'down'} />
          <Kpi label="净盈亏率" value={r != null ? `${r.toFixed(2)}%` : '—'} />
          <Kpi label="交易笔数" value={String(lottery.transactions.length)} />
        </div>
        <p className="text-[11px] text-slate-400 mt-2">彩票资金池独立于财富资产，不计入总资产、财富等级、目标、预测与标准财务报告。资金池余额可以为负。</p>
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
          <h3 className="text-sm font-medium text-slate-700 mb-2">项目净盈亏</h3>
          <BarChart items={projectItems} ariaLabel="项目净盈亏对比" />
          <div className="mt-3 space-y-1.5">
            {lottery.projects.map((p) => {
              const s = projectSummary(lottery, p.id);
              const meta = LOTTERY_CATEGORY_META[p.category];
              return (
                <div key={p.id} className="flex items-center gap-2 text-sm border-b border-slate-100 py-1.5 last:border-0">
                  <span aria-hidden>{meta?.icon ?? '🎟️'}</span>
                  <span className="flex-1 truncate text-slate-700">{p.name}</span>
                  <span className="text-xs text-slate-400">{p.dataCompleteness === 'summary-only' ? '历史汇总' : `${s.transactionCount} 笔`}</span>
                  <span className={`tabular font-medium ${s.netProfitLoss >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {s.netProfitLoss >= 0 ? '+' : ''}{formatCNY(s.netProfitLoss)}
                  </span>
                </div>
              );
            })}
          </div>
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
          <Button size="sm" onClick={() => setTxOpen(true)}>＋ 记一笔</Button>
        </div>
        {lottery.transactions.length === 0 ? (
          <EmptyState icon="🎟️" title="暂无彩票交易" description="从「注入资金」开始，或导入旧彩票 Excel 账本。" />
        ) : (
          <div className="space-y-1.5">
            {lottery.transactions.slice(0, 200).map((t) => {
              const meta = LOTTERY_TX_META[t.type];
              const positive = ['prize', 'capital-injection'].includes(t.type);
              return (
                <div key={t.id} className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-slate-50 border-b border-slate-50 last:border-0">
                  <span aria-hidden>{meta?.icon ?? '🎟️'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-700 truncate">{meta?.label ?? t.type} {t.description ? `· ${t.description}` : ''}</div>
                    <div className="text-xs text-slate-400">{t.occurredAt.replace('T', ' ').slice(0, 16)}{t.paymentMethod ? ` · ${t.paymentMethod}` : ''}</div>
                  </div>
                  <span className={`tabular font-medium ${positive ? 'text-emerald-600' : 'text-red-600'}`}>
                    {positive ? '+' : '-'}{formatCNY(t.amount)}
                  </span>
                  <button className="text-xs text-slate-300 hover:text-red-500" onClick={() => deleteLotteryTransaction(t.id)} aria-label="删除交易">🗑</button>
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

      <LotteryTxModal open={txOpen} onClose={() => setTxOpen(false)} onSave={(t) => { addLotteryTransaction(t); setTxOpen(false); }} />
      <PoolModal open={poolOpen} onClose={() => setPoolOpen(false)} onSave={(pool) => { setLotteryPool(pool); setPoolOpen(false); }} />
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

function LotteryTxModal({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (t: LotteryTransaction) => void }) {
  const projects = useAppStore((s) => s.lottery.projects);
  const [type, setType] = useState<LotteryTxType>('stake');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayString());
  const [time, setTime] = useState('12:00');
  const [projectId, setProjectId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  function submit() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setError('金额必须大于 0'); return; }
    onSave(makeLotteryTransaction({
      type,
      amount: amt,
      occurredAt: `${date}T${time}:00`,
      projectId: projectId || null,
      paymentMethod: paymentMethod.trim() || undefined,
      description: description.trim() || undefined,
      status: status.trim() || undefined,
      source: 'manual',
    }));
  }

  return (
    <Modal open={open} onClose={onClose} title="记一笔彩票交易" size="md"
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
        <TextField label="支付方式" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} placeholder="零钱通 / 零钱 / 浦发银行" />
        <TextField label="说明" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="投注 / 中奖说明" />
        <TextField label="状态" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="对方已收款 / 已收款" />
      </div>
    </Modal>
  );
}

function PoolModal({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (pool: NonNullable<LotteryState['pool']>) => void }) {
  const pool = useAppStore((s) => s.lottery.pool);
  const [name, setName] = useState(pool?.name ?? '彩票资金池');
  const [opening, setOpening] = useState(pool ? String(pool.openingBalance) : '0');

  return (
    <Modal open={open} onClose={onClose} title="彩票资金池设置" size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>取消</Button><Button onClick={() => onSave({ id: pool?.id ?? 'lottery_pool', name: name.trim() || '彩票资金池', openingBalance: Number(opening) || 0, createdAt: pool?.createdAt ?? new Date().toISOString() })}>保存</Button></>}>
      <div className="space-y-4">
        <p className="text-xs text-slate-400">期初余额是可正可负的基准值；实际余额由交易动态推导（期初 + 注入 − 取出 + 中奖 − 投注 ± 调整）。</p>
        <TextField label="资金池名称" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="期初余额" type="number" value={opening} onChange={(e) => setOpening(e.target.value)} />
        <p className="text-xs text-slate-500">资金注入 / 取出请用「记一笔」选择「资金注入 / 资金取出」类型。</p>
      </div>
    </Modal>
  );
}
