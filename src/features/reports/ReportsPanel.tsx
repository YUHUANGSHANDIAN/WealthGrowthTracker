import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useAppStore } from '../../store/appStore';
import type { FinancialReport, ReportType } from '../../types';
import { formatCNY, diffMoney } from '../../utils/money';
import { assetAtDate, generateReport } from './generate';
import { displayTitle, findReportConflict, repairReportFromHistory } from './reportRepair';
import { weekStart, monthStart, yearStart, todayString, addDays } from '../../utils/date';
import { Card, Button, Badge, EmptyState } from '../../components/ui/primitives';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { SelectField, TextField, TextArea } from '../../components/ui/form';
import { BarChart } from '../../components/charts/BarChart';
import { LineChart } from '../../components/charts/LineChart';
import { saveTextFile, backupFilename } from '../../services/export/download';
import { downloadCSV } from '../../components/charts/export';
import { buildReportsIndexCsv, buildReportsBatchHtml } from './reportIndex';
import { ShareReportModal } from './ShareReportModal';
import {
  sortReports,
  REPORT_SORT_FIELDS,
  REPORT_SORT_PRESETS,
  DEFAULT_REPORT_SORT,
  type ReportSortSpec,
  type ReportSortRule,
} from './reportSort';
import { getLevelByAmount } from '../../constants/levels';

const TYPE_META: Record<ReportType, { label: string; icon: string; tone: 'emerald' | 'blue' | 'purple' }> = {
  weekly: { label: '周报', icon: '📅', tone: 'emerald' },
  monthly: { label: '月报', icon: '📆', tone: 'blue' },
  yearly: { label: '年报', icon: '🗓️', tone: 'purple' },
};

type TypeFilter = 'all' | ReportType | 'archived';
type TimeFilter = 'all' | 'this-year' | 'last-year' | '12m' | 'custom';

export function ReportsPanel() {
  const reports = useAppStore((s) => s.reports);
  const history = useAppStore((s) => s.history);
  const channels = useAppStore((s) => s.channels);
  const reportSortSpec = useAppStore((s) => s.reportSortSpec);
  const { commitReport, archiveReport, deleteReport, deleteReports, setReportSortSpec, updateReportMetadata, repairReport, pushToast } = useAppStore();

  const [reportType, setReportType] = useState<ReportType>('weekly');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [customYear, setCustomYear] = useState(String(new Date().getFullYear()));
  const [detail, setDetail] = useState<FinancialReport | null>(null);
  const [conflict, setConflict] = useState<{ generated: FinancialReport; existing: FinancialReport } | null>(null);
  const [editMeta, setEditMeta] = useState<FinancialReport | null>(null);
  const [repairTarget, setRepairTarget] = useState<FinancialReport | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sortEditorOpen, setSortEditorOpen] = useState(false);

  const today = todayString();
  const nowYear = new Date().getFullYear();

  const kpis = useMemo(() => {
    const totalNow = history.length ? history[history.length - 1]!.totalAmount : 0;
    return {
      total: reports.length,
      weekChange: diffMoney(totalNow, assetAtDate(history, weekStart(today))),
      monthChange: diffMoney(totalNow, assetAtDate(history, monthStart(today))),
      yearChange: diffMoney(totalNow, assetAtDate(history, yearStart(today))),
      lastGenerated: reports.length
        ? new Date(Math.max(...reports.map((r) => new Date(r.createdAt).getTime()))).toLocaleDateString('zh-CN')
        : '—',
      avgCompleteness: reports.length
        ? Math.round(reports.reduce((a, r) => a + (r.dataCompleteness ?? 0), 0) / reports.length)
        : null,
    };
  }, [reports, history, today]);

  const counts = useMemo(
    () => ({
      all: reports.length,
      weekly: reports.filter((r) => r.reportType === 'weekly').length,
      monthly: reports.filter((r) => r.reportType === 'monthly').length,
      yearly: reports.filter((r) => r.reportType === 'yearly').length,
      archived: reports.filter((r) => r.isArchived).length,
    }),
    [reports],
  );

  const filtered = useMemo(() => {
    let list = reports;
    if (typeFilter === 'archived') list = list.filter((r) => r.isArchived);
    else if (typeFilter !== 'all') list = list.filter((r) => r.reportType === typeFilter);

    if (timeFilter === 'this-year') list = list.filter((r) => r.year === nowYear);
    else if (timeFilter === 'last-year') list = list.filter((r) => r.year === nowYear - 1);
    else if (timeFilter === '12m') list = list.filter((r) => r.endDate >= addDays(today, -365));
    else if (timeFilter === 'custom') {
      const y = Number(customYear);
      if (Number.isFinite(y)) list = list.filter((r) => r.year === y);
    }

    const q = search.trim().toLowerCase();
    if (q) list = list.filter((r) => r.title.toLowerCase().includes(q));
    return sortReports(list, reportSortSpec);
  }, [reports, typeFilter, timeFilter, customYear, nowYear, today, search, reportSortSpec]);

  function generate() {
    const generated = generateReport(history, reportType, today, channels);
    const existing = findReportConflict(reports, generated.periodKey);
    if (existing) {
      // 不静默覆盖：弹出冲突对话框，让用户选择更新/另存/取消
      setConflict({ generated, existing });
    } else {
      commitReport(generated, 'update');
    }
  }

  function toggleSelect(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectedItems(): FinancialReport[] {
    return reports.filter((r) => selected.has(r.id));
  }

  async function exportSelected(format: 'json' | 'csv' | 'html' = 'json') {
    const items = selectedItems();
    if (items.length === 0) return;
    if (format === 'csv') {
      const { header, rows } = buildReportsIndexCsv(items);
      downloadCSV(backupFilename('financial_reports_index'), header, rows);
      pushToast(`已导出 ${items.length} 份报告的 CSV 索引`, 'success');
      return;
    }
    if (format === 'html') {
      const html = buildReportsBatchHtml(items);
      await saveTextFile(backupFilename('financial_reports_batch_html', '.html'), html);
      pushToast(`已导出 ${items.length} 份报告的 HTML 合集`, 'success');
      return;
    }
    const payload = {
      version: '1.4.0',
      exportDate: new Date().toISOString(),
      exportType: 'financial_reports_batch',
      reports: items,
      totalCount: items.length,
    };
    await saveTextFile(backupFilename('financial_reports_batch'), JSON.stringify(payload, null, 2));
    pushToast(`已导出 ${items.length} 份报告`, 'success');
  }

  return (
    <div className="space-y-4">
      {/* Dashboard 头部 */}
      <Card className="p-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Kpi label="报告总数" value={String(kpis.total)} />
          <Kpi label="本周变化" value={formatCNY(kpis.weekChange)} tone={kpis.weekChange >= 0 ? 'up' : 'down'} />
          <Kpi label="本月变化" value={formatCNY(kpis.monthChange)} tone={kpis.monthChange >= 0 ? 'up' : 'down'} />
          <Kpi label="本年变化" value={formatCNY(kpis.yearChange)} tone={kpis.yearChange >= 0 ? 'up' : 'down'} />
          <Kpi label="最近生成" value={kpis.lastGenerated} />
          <Kpi label="数据完整度" value={kpis.avgCompleteness != null ? `${kpis.avgCompleteness}%` : '—'} />
        </div>
      </Card>

      {/* 快速生成 */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[160px]">
            <SelectField
              label="生成报告"
              value={reportType}
              onChange={(e) => setReportType(e.target.value as ReportType)}
              options={[
                { value: 'weekly', label: '周度财务报告' },
                { value: 'monthly', label: '月度财务报告' },
                { value: 'yearly', label: '年度财务报告' },
              ]}
            />
          </div>
          <Button onClick={generate}>生成 / 更新当前周期</Button>
          <Button variant="outline" onClick={() => { const g = generateReport(history, reportType, today, channels); commitReport(g, 'saveAs', findReportConflict(reports, g.periodKey)); }}>另存一份</Button>
        </div>
      </Card>

      {/* 类型切换 + 时间筛选 + 排序 */}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={typeFilter}
          onChange={(v) => setTypeFilter(v as TypeFilter)}
          options={[
            { value: 'all', label: `全部 ${counts.all}` },
            { value: 'weekly', label: `周报 ${counts.weekly}` },
            { value: 'monthly', label: `月报 ${counts.monthly}` },
            { value: 'yearly', label: `年报 ${counts.yearly}` },
            { value: 'archived', label: `归档 ${counts.archived}` },
          ]}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索报告标题…"
          className="flex-1 min-w-[140px] px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
          aria-label="搜索报告"
        />
        <select
          value={timeFilter}
          onChange={(e) => setTimeFilter(e.target.value as TimeFilter)}
          className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
          aria-label="时间筛选"
        >
          <option value="all">全部时间</option>
          <option value="this-year">今年</option>
          <option value="last-year">去年</option>
          <option value="12m">最近 12 个月</option>
          <option value="custom">自定义年份</option>
        </select>
        {timeFilter === 'custom' && (
          <input
            type="number"
            value={customYear}
            onChange={(e) => setCustomYear(e.target.value)}
            className="w-24 px-3 py-2 text-sm border border-slate-300 rounded-lg"
            aria-label="自定义年份"
          />
        )}
        <select
          value={presetIdOf(reportSortSpec)}
          onChange={(e) => {
            const p = REPORT_SORT_PRESETS.find((x) => x.id === e.target.value);
            if (p) setReportSortSpec(p.spec);
          }}
          className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
          aria-label="排序预设"
        >
          {REPORT_SORT_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <Button variant="outline" size="sm" onClick={() => setSortEditorOpen(true)}>⇶ 多维排序</Button>
        {selected.size > 0 && (
          <>
            <Button variant="outline" size="sm" onClick={() => exportSelected('json')}>⬇ JSON</Button>
            <Button variant="outline" size="sm" onClick={() => exportSelected('html')}>HTML</Button>
            <Button variant="outline" size="sm" onClick={() => exportSelected('csv')}>CSV 索引</Button>
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>删除所选 ({selected.size})</Button>
          </>
        )}
      </div>

      {/* 列表 */}
      {filtered.length === 0 ? (
        <Card>
          <EmptyState icon="📄" title="没有匹配的报告" description="生成周报/月报/年报，追踪你的财富变化。" />
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <ReportRow
              key={r.id}
              report={r}
              selected={selected.has(r.id)}
              onToggle={() => toggleSelect(r.id)}
              onOpen={() => setDetail(r)}
              onArchive={() => archiveReport(r.id)}
              onDelete={() => deleteReport(r.id)}
            />
          ))}
        </div>
      )}

      {detail && (
        <ReportDetailModal
          report={detail}
          reports={reports}
          history={history}
          onClose={() => setDetail(null)}
          onEditMetadata={(r) => { setDetail(null); setEditMeta(r); }}
          onRepair={(r) => { setDetail(null); setRepairTarget(r); }}
        />
      )}

      {conflict && (
        <ReportConflictDialog
          existing={conflict.existing}
          onClose={() => setConflict(null)}
          onUpdate={() => { commitReport(conflict.generated, 'update', conflict.existing); setConflict(null); }}
          onSaveAs={() => { commitReport(conflict.generated, 'saveAs', conflict.existing); setConflict(null); }}
        />
      )}

      {editMeta && (
        <EditReportMetadataModal
          report={editMeta}
          onClose={() => setEditMeta(null)}
          onSave={(patch) => { updateReportMetadata(editMeta.id, patch); setEditMeta(null); pushToast('报告元数据已保存', 'success'); }}
        />
      )}

      {repairTarget && (
        <RepairReportModal
          report={repairTarget}
          history={history}
          onClose={() => setRepairTarget(null)}
          onApply={(repaired) => { repairReport(repairTarget.id, repaired); setRepairTarget(null); pushToast('报告已修复（历史事实已按真实数据恢复）', 'success'); }}
        />
      )}

      <ReportSortEditor
        open={sortEditorOpen}
        spec={reportSortSpec}
        onClose={() => setSortEditorOpen(false)}
        onApply={setReportSortSpec}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="批量删除报告"
        message={`确定删除选中的 ${selected.size} 份报告吗？此操作无法撤销。`}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          deleteReports([...selected]);
          setSelected(new Set());
          setConfirmDelete(false);
        }}
      />
    </div>
  );
}

function presetIdOf(spec: ReportSortSpec): string {
  const key = JSON.stringify(spec);
  const match = REPORT_SORT_PRESETS.find((p) => JSON.stringify(p.spec) === key);
  return match?.id ?? 'recent';
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

function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="inline-flex flex-wrap rounded-lg bg-slate-100 p-1 gap-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1.5 text-xs rounded-md transition-colors ${
            value === o.value ? 'bg-white text-slate-800 shadow-sm font-medium' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ReportRow({ report, selected, onToggle, onOpen, onArchive, onDelete }: {
  report: FinancialReport;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const meta = TYPE_META[report.reportType];
  const positive = report.changeAmount >= 0;
  const rev = report.revision && report.revision > 1 ? ` · 修订 ${report.revision}` : '';
  return (
    <Card className={`p-4 ${report.isArchived ? 'opacity-70' : ''}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="h-4 w-4 text-emerald-600 rounded mt-1"
          aria-label={`选择 ${report.title}`}
        />
        <button className="flex-1 text-left min-w-0" onClick={onOpen}>
          <div className="flex items-center gap-2 flex-wrap">
            <span aria-hidden>{meta.icon}</span>
            <h3 className="font-semibold text-slate-800 truncate">{displayTitle(report)}</h3>
            <Badge tone={meta.tone}>{meta.label}</Badge>
            {report.isArchived && <Badge tone="slate">已归档</Badge>}
            {report.dataCompleteness != null && report.dataCompleteness < 90 && (
              <Badge tone="amber">{report.dataCompletenessLabel ?? `${report.dataCompleteness}%`}</Badge>
            )}
          </div>
          <div className="flex items-center gap-4 mt-2 text-sm flex-wrap">
            <span className="text-slate-500 tabular text-xs">{report.startDate} ~ {report.endDate}</span>
            <span className="font-semibold text-slate-800 tabular">{formatCNY(report.totalAmount)}</span>
            <span className={`tabular text-xs font-medium ${positive ? 'text-emerald-600' : 'text-red-600'}`}>
              {positive ? '▲' : '▼'} {Math.abs(report.changePercentage).toFixed(1)}%
            </span>
            {report.wealthLevelName && <span className="text-xs text-slate-400">{report.wealthLevelName}</span>}
            <span className="text-xs text-slate-300">{rev}</span>
          </div>
        </button>
        <div className="flex flex-col gap-1 shrink-0">
          <button className="text-xs text-slate-500 hover:text-blue-600" onClick={onArchive}>
            {report.isArchived ? '取消归档' : '归档'}
          </button>
          <button className="text-xs text-slate-400 hover:text-red-500" onClick={onDelete}>删除</button>
        </div>
      </div>
    </Card>
  );
}

function ReportDetailModal({ report, reports, history, onClose, onEditMetadata, onRepair }: {
  report: FinancialReport;
  reports: FinancialReport[];
  history: import('../../types').HistoryPoint[];
  onClose: () => void;
  onEditMetadata: (r: FinancialReport) => void;
  onRepair: (r: FinancialReport) => void;
}) {
  const [shareOpen, setShareOpen] = useState(false);
  const positive = report.changeAmount >= 0;
  const level = getLevelByAmount(report.totalAmount);

  const max = report.reportType === 'weekly' ? report.weeklyMax : report.reportType === 'monthly' ? report.monthlyMax : report.yearlyMax;
  const min = report.reportType === 'weekly' ? report.weeklyMin : report.reportType === 'monthly' ? report.monthlyMin : report.yearlyMin;
  const avg = report.reportType === 'weekly' ? report.weeklyAvg : report.reportType === 'monthly' ? report.monthlyAvg : report.yearlyAvg;

  // 周期趋势（仅真实历史点，不虚构平滑数据）
  const trend = useMemo(() => {
    const inPeriod = history.filter((p) => p.date >= report.startDate && p.date <= report.endDate).sort((a, b) => (a.date < b.date ? -1 : 1));
    return inPeriod.map((p) => ({ date: p.date, value: p.totalAmount }));
  }, [history, report.startDate, report.endDate]);

  // 历史比较：上一周期报告
  const prevReport = useMemo(() => {
    const sameType = reports.filter((r) => r.reportType === report.reportType && r.periodKey !== report.periodKey);
    sameType.sort((a, b) => (a.periodKey! < b.periodKey! ? -1 : 1));
    const idx = sameType.findIndex((r) => (r.periodKey ?? '') > (report.periodKey ?? ''));
    return idx > 0 ? sameType[idx - 1] : sameType.length ? sameType[sameType.length - 1] : null;
  }, [reports, report]);

  const items = report.channelDetails.map((c) => ({
    id: c.id,
    label: c.name,
    value: c.amount,
    color: '#2a78d6',
    emoji: c.emoji,
    hint: `${c.percentage.toFixed(1)}%`,
  }));

  return (
    <Modal open onClose={onClose} title={displayTitle(report)} size="lg">
      <div className="space-y-5">
        {/* Overview */}
        <section>
          <SectionTitle>概览</SectionTitle>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="期末总资产" value={formatCNY(report.totalAmount)} />
            <Stat label="期初总资产" value={formatCNY(report.previousTotalAmount ?? 0)} />
            <Stat label="本期变化" value={`${positive ? '+' : ''}${formatCNY(report.changeAmount)}`} tone={positive ? 'up' : 'down'} />
            <Stat label="变化率" value={`${positive ? '+' : ''}${report.changePercentage.toFixed(1)}%`} tone={positive ? 'up' : 'down'} />
          </div>
        </section>

        {/* 周期统计 */}
        <section>
          <SectionTitle>周期统计</SectionTitle>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="期间最高" value={max !== undefined ? formatCNY(max) : '—'} />
            <Stat label="期间最低" value={min !== undefined ? formatCNY(min) : '—'} />
            <Stat label="期间平均" value={avg !== undefined ? formatCNY(avg) : '—'} />
          </div>
        </section>

        {/* 趋势 */}
        <section>
          <SectionTitle>周期趋势</SectionTitle>
          {trend.length >= 2 ? (
            <LineChart
              series={[{ id: 'trend', name: '总资产', color: '#2a78d6', points: trend, area: true }]}
              ariaLabel="报告周期趋势"
            />
          ) : (
            <p className="text-sm text-slate-400">历史点不足，无法绘制周期趋势（不虚构平滑数据）。</p>
          )}
        </section>

        {/* 渠道构成 */}
        <section>
          <SectionTitle>资产构成</SectionTitle>
          {items.length > 0 ? (
            <BarChart items={items} ariaLabel="报告资产构成" />
          ) : (
            <p className="text-sm text-slate-400">无渠道明细{report.channelSnapshotMissing ? '（旧版历史仅保存总资产，无法还原渠道构成）' : ''}</p>
          )}
        </section>

        {/* 历史比较 */}
        <section>
          <SectionTitle>历史比较（上一周期）</SectionTitle>
          {prevReport ? (
            <div className="grid grid-cols-2 gap-3">
              <Stat label={`上一${TYPE_META[report.reportType].label}期末`} value={formatCNY(prevReport.totalAmount)} />
              <Stat
                label="总资产变化"
                value={`${positive ? '+' : ''}${formatCNY(diffMoney(report.totalAmount, prevReport.totalAmount))}`}
                tone={report.totalAmount >= prevReport.totalAmount ? 'up' : 'down'}
              />
            </div>
          ) : (
            <p className="text-sm text-slate-400">数据不足（N/A）</p>
          )}
        </section>

        {/* 财富等级 */}
        <section>
          <SectionTitle>财富等级</SectionTitle>
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <span className="text-xl" aria-hidden>{level.badge}</span>
            <span className="font-medium">{report.wealthLevelName ?? level.name}</span>
            <span className="text-slate-400">（依据报告期末总资产）</span>
          </div>
        </section>

        {/* 数据质量 */}
        <section>
          <SectionTitle>数据质量</SectionTitle>
          {report.dataCompleteness != null ? (
            <div className="space-y-1">
              <div className="text-sm text-slate-600">
                完整度 <span className="font-semibold tabular">{report.dataCompleteness}%</span> · {report.dataCompletenessLabel}
                {report.channelSnapshotMissing ? ' · 缺少渠道快照' : ''}
              </div>
              {report.dataWarnings && report.dataWarnings.length > 0 && (
                <ul className="text-xs text-slate-400 list-disc list-inside">
                  {report.dataWarnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-400">—</p>
          )}
        </section>

        {/* 备注 */}
        {report.archiveNote && (
          <section>
            <SectionTitle>归档备注</SectionTitle>
            <p className="text-sm text-slate-600">{report.archiveNote}</p>
          </section>
        )}

        <div className="text-xs text-slate-400">
          生成时间：{report.createdAt ? new Date(report.createdAt).toLocaleString('zh-CN') : '—'}
          {report.revision && report.revision > 1 ? ` · 修订 ${report.revision}` : ''}
          {report.sourceVersion ? ` · 版本 v${report.sourceVersion}` : ''}
        </div>

        <div className="border-t border-slate-100 pt-3 flex flex-wrap gap-2">
          <Button onClick={() => setShareOpen(true)}>📤 分享报告</Button>
          <Button variant="outline" onClick={() => onEditMetadata(report)}>✏️ 编辑元数据</Button>
          <Button variant="outline" onClick={() => onRepair(report)}>🧰 数据修复</Button>
        </div>
      </div>
      {shareOpen && <ShareReportModal report={report} onClose={() => setShareOpen(false)} />}
    </Modal>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h4 className="text-sm font-semibold text-slate-700 mb-2">{children}</h4>;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  const color = tone === 'up' ? 'text-emerald-600' : tone === 'down' ? 'text-red-600' : 'text-slate-800';
  return (
    <div className="bg-slate-50 rounded-xl px-3 py-2.5">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-sm font-semibold tabular ${color}`}>{value}</div>
    </div>
  );
}

function ReportSortEditor({ open, spec, onClose, onApply }: {
  open: boolean;
  spec: ReportSortSpec;
  onClose: () => void;
  onApply: (spec: ReportSortSpec) => void;
}) {
  const [rules, setRules] = useState<ReportSortRule[]>(spec);

  useEffect(() => {
    if (open) setRules(spec);
  }, [open, spec]);

  function update(i: number, patch: Partial<ReportSortRule>) {
    setRules((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function remove(i: number) {
    setRules((rs) => rs.filter((_, idx) => idx !== i));
  }
  function add() {
    setRules((rs) => [...rs, { field: 'totalAmount', direction: 'desc' }]);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="报告多维排序"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={() => { onApply(rules.length ? rules : DEFAULT_REPORT_SORT); onClose(); }}>应用</Button>
        </>
      }
    >
      <p className="text-sm text-slate-500 mb-3">按规则优先级依次作为排序键；缺失字段（N/A）始终排到最后。</p>
      <div className="space-y-2">
        {rules.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-slate-400 w-5">{i + 1}</span>
            <select
              value={r.field}
              onChange={(e) => update(i, { field: e.target.value as ReportSortRule['field'] })}
              className="flex-1 px-2 py-1.5 text-sm border border-slate-300 rounded-lg"
              aria-label={`排序字段 ${i + 1}`}
            >
              {REPORT_SORT_FIELDS.map((f) => <option key={f.field} value={f.field}>{f.label}</option>)}
            </select>
            <select
              value={r.direction}
              onChange={(e) => update(i, { direction: e.target.value as ReportSortRule['direction'] })}
              className="px-2 py-1.5 text-sm border border-slate-300 rounded-lg"
              aria-label={`排序方向 ${i + 1}`}
            >
              <option value="desc">降序</option>
              <option value="asc">升序</option>
            </select>
            <Button variant="ghost" size="sm" onClick={() => remove(i)} className="text-red-500">✕</Button>
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={add} className="mt-3">＋ 添加规则</Button>
    </Modal>
  );
}

function ReportConflictDialog({ existing, onClose, onUpdate, onSaveAs }: {
  existing: FinancialReport;
  onClose: () => void;
  onUpdate: () => void;
  onSaveAs: () => void;
}) {
  const archived = existing.isArchived;
  const comp = existing.dataCompleteness != null ? `${existing.dataCompleteness}%` : '—';
  return (
    <Modal open onClose={onClose} title={archived ? '该周期已有归档报告' : '本周期已经存在财务报告'} size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          {!archived && <Button onClick={onUpdate}>更新现有报告（推荐）</Button>}
          <Button variant="outline" onClick={onSaveAs}>另存为新版本</Button>
        </>
      }>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl" aria-hidden>📄</span>
          <div>
            <div className="font-semibold text-slate-800">{displayTitle(existing)}</div>
            <div className="text-xs text-slate-500">{existing.startDate} ~ {existing.endDate}</div>
          </div>
        </div>
        <div className="bg-slate-50 rounded-lg p-3 text-sm text-slate-600 space-y-1">
          <div>已生成：{existing.createdAt ? new Date(existing.createdAt).toLocaleString('zh-CN') : '—'}</div>
          <div>当前修订：Revision {existing.revision ?? 1}</div>
          <div>数据完整度：{comp}</div>
          {existing.isArchived && <div className="text-amber-600">该报告已归档。</div>}
        </div>
        {archived ? (
          <p className="text-sm text-slate-500">该周期报告已归档，默认不会覆盖。如需替代归档报告，请先取消归档；这里可选择「另存为新版本」。</p>
        ) : (
          <p className="text-sm text-slate-500">「更新现有报告」将根据最新历史数据重新生成，保留报告 ID、创建时间、自定义标题与备注，并递增修订号。</p>
        )}
      </div>
    </Modal>
  );
}

type ReportMetadataPatch = Partial<Pick<FinancialReport, 'titleMode' | 'standardTitle' | 'customTitle' | 'tags' | 'customSummary' | 'archiveNote'>>;

function EditReportMetadataModal({ report, onClose, onSave }: {
  report: FinancialReport;
  onClose: () => void;
  onSave: (patch: ReportMetadataPatch) => void;
}) {
  const [mode, setMode] = useState<FinancialReport['titleMode']>(report.titleMode ?? 'auto');
  const [customTitle, setCustomTitle] = useState(report.customTitle ?? '');
  const [tags, setTags] = useState((report.tags ?? []).join(', '));
  const [customSummary, setCustomSummary] = useState(report.customSummary ?? '');
  const [archiveNote, setArchiveNote] = useState(report.archiveNote ?? '');

  function save() {
    const tagList = tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
    onSave({
      titleMode: mode,
      customTitle: mode === 'custom' ? customTitle.trim() : undefined,
      tags: tagList.length ? tagList : undefined,
      customSummary: customSummary.trim() || undefined,
      archiveNote: archiveNote.trim() || undefined,
    });
  }

  return (
    <Modal open onClose={onClose} title="编辑报告元数据" size="md"
      footer={<>
        <Button variant="ghost" onClick={onClose}>取消</Button>
        <Button onClick={save}>保存</Button>
      </>}>
      <div className="space-y-4">
        <p className="text-xs text-slate-400">仅可修改标题、备注、标签、摘要与归档说明；历史金额/渠道构成属于历史事实，请在「数据修复」中处理。</p>
        <SelectField label="标题模式" value={mode ?? 'auto'} onChange={(e) => setMode(e.target.value as FinancialReport['titleMode'])}
          options={[
            { value: 'auto', label: `自动（${report.standardTitle ?? report.title}）` },
            { value: 'custom', label: '自定义标题' },
          ]} />
        {mode === 'custom' && (
          <TextField label="自定义标题" value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} placeholder="例如：2026年第40周｜国庆假期资产报告" />
        )}
        <TextField label="标签（逗号分隔）" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="年度总结, 旅行, 重要节点" />
        <TextArea label="自定义摘要（可选）" value={customSummary} onChange={(e) => setCustomSummary(e.target.value)} placeholder="留空则使用默认摘要" />
        <TextArea label="归档说明" value={archiveNote} onChange={(e) => setArchiveNote(e.target.value)} placeholder="归档备注" />
      </div>
    </Modal>
  );
}

function RepairReportModal({ report, history, onClose, onApply }: {
  report: FinancialReport;
  history: import('../../types').HistoryPoint[];
  onClose: () => void;
  onApply: (repaired: FinancialReport) => void;
}) {
  const preview = useMemo(() => repairReportFromHistory(report, history), [report, history]);
  const [reason, setReason] = useState('');

  function apply() {
    const repaired: FinancialReport = {
      ...preview.report,
      repairAudit: [...(preview.report.repairAudit ?? [])],
    };
    // 记录修复原因（若用户填写）
    if (reason.trim() && repaired.repairAudit?.length) {
      repaired.repairAudit = repaired.repairAudit.map((a) => ({ ...a, reason: `${a.reason}（用户补充：${reason.trim()}）` }));
    }
    onApply(repaired);
  }

  return (
    <Modal open onClose={onClose} title="数据修复（历史事实）" size="md"
      footer={<>
        <Button variant="ghost" onClick={onClose}>取消</Button>
        <Button onClick={apply} disabled={preview.repairedFields.length === 0}>应用修复</Button>
      </>}>
      <div className="space-y-4">
        <p className="text-xs text-amber-600">修复会写入真实历史数据；应用前系统会自动备份当前数据。</p>
        {preview.repairedFields.length > 0 ? (
          <div className="bg-slate-50 rounded-lg p-3 space-y-2">
            <div className="text-sm font-medium text-slate-700">将恢复 {preview.repairedFields.length} 个字段：</div>
            <ul className="text-sm text-slate-600 list-disc list-inside">
              {preview.repairedFields.map((f) => <li key={f}>{f}（来源：history-snapshot）</li>)}
            </ul>
            {preview.report.repairAudit && preview.report.repairAudit.length > 0 && (
              <div className="text-xs text-slate-500 border-t border-slate-200 pt-2">
                {preview.report.repairAudit.map((a, i) => (
                  <div key={i}>{a.field}: {String(a.oldValue ?? '缺失')} → {String(a.newValue)}</div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-400">没有可从历史数据恢复的字段。</p>
        )}
        {preview.warnings.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
            {preview.warnings.map((w) => <p key={w}>⚠️ {w}</p>)}
          </div>
        )}
        <TextArea label="修复原因（可选）" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例如：补充早期缺失的历史快照" />
      </div>
    </Modal>
  );
}
