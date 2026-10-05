import { useMemo, useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/primitives';
import { TextField, MoneyField, SelectField, TextArea } from '../../components/ui/form';
import { formatCNY, round2 } from '../../utils/money';
import type { FinancialReport, Channel, SubChannel, ReportRepairAudit } from '../../types';
import { canonicalWeeklyPeriod } from '../../utils/isoWeek';
import { monthStart, monthEnd, yearStart, yearEnd, pad2 } from '../../utils/date';
import { buildAssetComposition, buildChannelDetails } from './normalize';
import { diffReportFields, buildManualEditAudit } from '../../utils/reportEdit';

type Tab = 'basic' | 'assets' | 'stats' | 'source';

const TABS: { id: Tab; label: string }[] = [
  { id: 'basic', label: '基本信息' },
  { id: 'assets', label: '资产数据' },
  { id: 'stats', label: '统计' },
  { id: 'source', label: '数据来源' },
];

export function ReportEditorModal({ report, onClose, onSave }: {
  report: FinancialReport;
  onClose: () => void;
  onSave: (edited: FinancialReport, audit: ReportRepairAudit[], opts: { syncHistory: boolean }) => void;
}) {
  const [tab, setTab] = useState<Tab>('basic');
  const [titleMode, setTitleMode] = useState<FinancialReport['titleMode']>(report.titleMode ?? 'auto');
  const [customTitle, setCustomTitle] = useState(report.customTitle ?? '');
  const [dataAsOf, setDataAsOf] = useState(report.dataAsOf ?? report.endDate);
  const [tags, setTags] = useState((report.tags ?? []).join(', '));
  const [summary, setSummary] = useState(report.customSummary ?? '');
  const [reason, setReason] = useState('');

  // 周期选择
  const [periodYear, setPeriodYear] = useState(report.isoWeekYear ?? report.year ?? new Date(report.endDate).getFullYear());
  const [periodWeek, setPeriodWeek] = useState(report.isoWeek ?? report.weekNumber ?? 1);
  const [periodMonth, setPeriodMonth] = useState(report.monthNumber ?? new Date(report.endDate).getMonth() + 1);

  // 资产数据
  const [totalAmount, setTotalAmount] = useState(report.totalAmount);
  const [previousTotalAmount, setPreviousTotalAmount] = useState(report.previousTotalAmount ?? 0);
  const [channels, setChannels] = useState<Channel[]>(() => JSON.parse(JSON.stringify(report.channels ?? [])));

  // 统计
  const ext = (report.reportType === 'weekly' ? [report.weeklyMax, report.weeklyMin, report.weeklyAvg] : report.reportType === 'monthly' ? [report.monthlyMax, report.monthlyMin, report.monthlyAvg] : [report.yearlyMax, report.yearlyMin, report.yearlyAvg]);
  const [statMax, setStatMax] = useState(ext[0] ?? report.totalAmount);
  const [statMin, setStatMin] = useState(ext[1] ?? report.totalAmount);
  const [statAvg, setStatAvg] = useState(ext[2] ?? report.totalAmount);

  const channelSum = useMemo(() => {
    const sumParent = (c: Channel) => (c.children && c.children.length ? c.children.reduce((a, s) => a + (s.amount || 0), 0) : c.amount || 0);
    return round2((channels as Channel[]).reduce((a, c) => a + sumParent(c), 0));
  }, [channels]);

  const totalMismatch = channels.length > 0 && round2(totalAmount) !== round2(channelSum);

  /** 由当前周期选择构造编辑后的报告。 */
  function buildEdited(): FinancialReport {
    let startDate = report.startDate;
    let endDate = report.endDate;
    let periodKey = report.periodKey;
    let standardTitle = report.standardTitle ?? report.title;
    let isoWeek = report.isoWeek;
    let isoWeekYear = report.isoWeekYear;
    let weekNumber = report.weekNumber;
    let monthNumber = report.monthNumber;
    let year = report.year;

    if (report.reportType === 'weekly') {
      const c = canonicalWeeklyPeriod({ isoWeekYear: periodYear, isoWeek: periodWeek });
      startDate = c.startDate; endDate = c.endDate; periodKey = c.periodKey; standardTitle = c.standardTitle;
      isoWeek = c.isoWeek; isoWeekYear = c.isoWeekYear; weekNumber = c.isoWeek; year = c.isoWeekYear;
    } else if (report.reportType === 'monthly') {
      const d = `${periodYear}-${pad2(periodMonth)}-01`;
      startDate = monthStart(d); endDate = monthEnd(d); periodKey = `monthly:${periodYear}-${pad2(periodMonth)}`;
      standardTitle = `${periodYear}年${periodMonth}月月度财务报告`; monthNumber = periodMonth; year = periodYear;
    } else {
      const d = `${periodYear}-01-01`;
      startDate = yearStart(d); endDate = yearEnd(d); periodKey = `yearly:${periodYear}`;
      standardTitle = `${periodYear}年年度财务报告`; year = periodYear;
    }

    const total = channels.length > 0 ? channelSum : round2(totalAmount);
    const edited: FinancialReport = {
      ...report,
      titleMode,
      customTitle: titleMode === 'custom' ? customTitle.trim() : undefined,
      title: titleMode === 'custom' && customTitle.trim() ? customTitle.trim() : standardTitle,
      standardTitle,
      startDate, endDate, periodKey, dataAsOf, year,
      ...(isoWeek !== undefined ? { isoWeek } : {}),
      ...(isoWeekYear !== undefined ? { isoWeekYear } : {}),
      ...(weekNumber !== undefined ? { weekNumber } : {}),
      ...(monthNumber !== undefined ? { monthNumber } : {}),
      totalAmount: total,
      previousTotalAmount: round2(previousTotalAmount),
      tags: tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
      customSummary: summary.trim() || undefined,
      channels: channels.length ? channels : report.channels,
      ...(report.reportType === 'weekly' ? { weeklyMax: statMax, weeklyMin: statMin, weeklyAvg: statAvg } : {}),
      ...(report.reportType === 'monthly' ? { monthlyMax: statMax, monthlyMin: statMin, monthlyAvg: statAvg } : {}),
      ...(report.reportType === 'yearly' ? { yearlyMax: statMax, yearlyMin: statMin, yearlyAvg: statAvg } : {}),
    };
    // 重算派生字段
    const total2 = edited.totalAmount;
    const prev = edited.previousTotalAmount ?? 0;
    edited.changeAmount = round2(total2 - prev);
    edited.changePercentage = prev > 0 ? round2(((total2 - prev) / prev) * 100) : 0;
    if (channels.length) {
      edited.assetComposition = buildAssetComposition(channels as Channel[], total2);
      edited.channelDetails = buildChannelDetails(channels as Channel[], total2);
    }
    return edited;
  }

  const edited = buildEdited();
  const diffs = diffReportFields(report, edited);

  const [confirmDiff, setConfirmDiff] = useState(false);

  function save() {
    if (report.reportType === 'weekly' && (periodWeek < 1 || periodWeek > 53)) {
      return;
    }
    setConfirmDiff(true);
  }

  function doSave(syncHistory: boolean) {
    const finalAudit = buildManualEditAudit(report, edited, reason);
    onSave(edited, finalAudit, { syncHistory });
  }

  function updateParentAmount(id: string, amount: number) {
    setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, amount: round2(amount) } : c)));
  }
  function updateChildAmount(parentId: string, childId: string, amount: number) {
    setChannels((cs) => cs.map((c) => c.id === parentId ? { ...c, children: (c.children ?? []).map((s) => s.id === childId ? { ...s, amount: round2(amount) } : s) } : c));
  }

  return (
    <Modal open onClose={onClose} title="高级编辑报告" size="lg"
      footer={<>
        <Button variant="ghost" onClick={onClose}>取消</Button>
        <Button onClick={save}>保存</Button>
      </>}>
      <div className="space-y-4">
        <div className="flex gap-1 flex-wrap">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`px-3 py-1.5 text-sm rounded-lg ${tab === t.id ? 'bg-emerald-50 text-emerald-700 font-medium' : 'text-slate-500 hover:bg-slate-50'}`}>{t.label}</button>
          ))}
        </div>

        {tab === 'basic' && (
          <div className="space-y-4">
            <SelectField label="标题模式" value={titleMode ?? 'auto'} onChange={(e) => setTitleMode(e.target.value as FinancialReport['titleMode'])}
              options={[{ value: 'auto', label: `自动（${report.standardTitle ?? report.title}）` }, { value: 'custom', label: '自定义标题' }]} />
            {titleMode === 'custom' && <TextField label="自定义标题" value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} />}
            <div className="grid grid-cols-3 gap-3">
              <TextField label="年份" type="number" value={String(periodYear)} onChange={(e) => setPeriodYear(Number(e.target.value))} />
              {report.reportType === 'weekly' && <TextField label="ISO 周编号" type="number" value={String(periodWeek)} onChange={(e) => setPeriodWeek(Number(e.target.value))} />}
              {report.reportType === 'monthly' && <TextField label="月份" type="number" value={String(periodMonth)} onChange={(e) => setPeriodMonth(Number(e.target.value))} />}
            </div>
            <p className="text-xs text-slate-400">周期：{edited.startDate} ~ {edited.endDate}（{edited.periodKey}）</p>
            <TextField label="数据截至（Data As Of）" type="date" value={dataAsOf} onChange={(e) => setDataAsOf(e.target.value)} />
            <TextField label="标签（逗号分隔）" value={tags} onChange={(e) => setTags(e.target.value)} />
            <TextArea label="摘要" value={summary} onChange={(e) => setSummary(e.target.value)} />
          </div>
        )}

        {tab === 'assets' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <MoneyField label="期初资产" value={previousTotalAmount} onChange={(v) => setPreviousTotalAmount(v === '' ? 0 : v)} />
              <MoneyField label={channels.length ? '期末总资产（由渠道求和）' : '期末总资产'} value={totalAmount} onChange={(v) => setTotalAmount(v === '' ? 0 : v)} disabled={channels.length > 0} />
            </div>
            {totalMismatch && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
                总资产 ¥{formatCNY(totalAmount)} ≠ 渠道合计 ¥{formatCNY(channelSum)}（差额 ¥{formatCNY(round2(totalAmount - channelSum))}）。保存时将使用渠道合计。
              </div>
            )}
            {channels.length > 0 ? (
              <div className="space-y-2 max-h-72 overflow-y-auto border border-slate-100 rounded-lg p-3">
                {channels.map((c) => (
                  <div key={c.id} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-700 flex-1">{c.emoji} {c.name}</span>
                      {c.children && c.children.length > 0 ? (
                        <span className="text-sm text-slate-400 tabular">父金额 = 子渠道之和</span>
                      ) : (
                        <input type="number" min={0} step="0.01" className="w-32 px-2 py-1 text-sm border border-slate-300 rounded-lg tabular" value={c.amount} onChange={(e) => updateParentAmount(c.id, Number(e.target.value) || 0)} aria-label={`${c.name} 金额`} />
                      )}
                    </div>
                    {c.children && c.children.length > 0 && c.children.map((s: SubChannel) => (
                      <div key={s.id} className="flex items-center gap-2 pl-5">
                        <span className="text-sm text-slate-600 flex-1">{s.emoji} {s.name}</span>
                        <input type="number" min={0} step="0.01" className="w-32 px-2 py-1 text-sm border border-slate-300 rounded-lg tabular" value={s.amount} onChange={(e) => updateChildAmount(c.id, s.id, Number(e.target.value) || 0)} aria-label={`${s.name} 金额`} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">该报告无渠道快照，仅可编辑总资产。</p>
            )}
          </div>
        )}

        {tab === 'stats' && (
          <div className="grid grid-cols-3 gap-3">
            <MoneyField label="期间最高" value={statMax} onChange={(v) => setStatMax(v === '' ? 0 : v)} />
            <MoneyField label="期间最低" value={statMin} onChange={(v) => setStatMin(v === '' ? 0 : v)} />
            <MoneyField label="期间平均" value={statAvg} onChange={(v) => setStatAvg(v === '' ? 0 : v)} />
          </div>
        )}

        {tab === 'source' && (
          <div className="space-y-3 text-sm">
            <div>
              <div className="font-medium text-slate-700 mb-1">字段来源（Provenance）</div>
              {report.fieldProvenance && Object.keys(report.fieldProvenance).length > 0
                ? <ul className="text-xs text-slate-500 list-disc list-inside">{Object.entries(report.fieldProvenance).map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul>
                : <p className="text-xs text-slate-400">无</p>}
            </div>
            <div>
              <div className="font-medium text-slate-700 mb-1">修复审计（Repair Audit）</div>
              {report.repairAudit && report.repairAudit.length > 0
                ? <ul className="text-xs text-slate-500 list-disc list-inside max-h-40 overflow-y-auto">{report.repairAudit.map((a, i) => <li key={i}>{a.field}: {String(a.oldValue ?? '—')} → {String(a.newValue ?? '—')}</li>)}</ul>
                : <p className="text-xs text-slate-400">无</p>}
            </div>
            {report.dataWarnings && report.dataWarnings.length > 0 && (
              <div>
                <div className="font-medium text-slate-700 mb-1">Warnings</div>
                <ul className="text-xs text-amber-600 list-disc list-inside">{report.dataWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
              </div>
            )}
          </div>
        )}

        <TextField label="编辑原因（写入审计）" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例如：修正总资产 / 修正渠道金额" />
      </div>

      {confirmDiff && (
        <Modal open onClose={() => setConfirmDiff(false)} title="确认修改（Diff）" size="md"
          footer={<>
            <Button variant="ghost" onClick={() => setConfirmDiff(false)}>取消</Button>
            <Button onClick={() => { doSave(false); setConfirmDiff(false); onClose(); }}>仅保存报告</Button>
            <Button onClick={() => { doSave(true); setConfirmDiff(false); onClose(); }}>保存并同步 History</Button>
          </>}>
          <div className="space-y-3">
            <p className="text-sm text-slate-500">将修改 {diffs.length} 个字段：</p>
            <div className="max-h-60 overflow-y-auto space-y-1 text-sm">
              {diffs.map((d, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-24 shrink-0 text-slate-400">{d.label}</span>
                  <span className="text-slate-500 line-through">{String(d.oldValue ?? '—')}</span>
                  <span className="text-slate-400">→</span>
                  <span className="text-emerald-600">{String(d.newValue ?? '—')}</span>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
