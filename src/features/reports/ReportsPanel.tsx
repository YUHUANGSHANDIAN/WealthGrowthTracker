import { useMemo, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import type { FinancialReport, ReportType } from '../../types';
import { formatCNY } from '../../utils/money';
import { Card, Button, Badge, EmptyState } from '../../components/ui/primitives';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { SelectField } from '../../components/ui/form';
import { BarChart } from '../../components/charts/BarChart';
import { saveTextFile, backupFilename } from '../../services/export/download';

const TYPE_META: Record<ReportType, { label: string; icon: string; tone: 'emerald' | 'blue' | 'purple' }> = {
  weekly: { label: '周报', icon: '📅', tone: 'emerald' },
  monthly: { label: '月报', icon: '📆', tone: 'blue' },
  yearly: { label: '年报', icon: '🗓️', tone: 'purple' },
};

export function ReportsPanel() {
  const reports = useAppStore((s) => s.reports);
  const { generateReportNow, archiveReport, deleteReport, deleteReports, pushToast } = useAppStore();

  const [reportType, setReportType] = useState<ReportType>('weekly');
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | ReportType>('all');
  const [detail, setDetail] = useState<FinancialReport | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);

  const filtered = useMemo(() => {
    let list = reports;
    if (filterType !== 'all') list = list.filter((r) => r.reportType === filterType);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((r) => r.title.toLowerCase().includes(q));
    return list;
  }, [reports, filterType, search]);

  function generate() {
    generateReportNow(reportType);
  }

  function toggleSelect(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function exportSelected() {
    const items = reports.filter((r) => selected.has(r.id));
    if (items.length === 0) return;
    const payload = {
      version: '1.0.0',
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
      {/* 生成器 */}
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
          <Button onClick={generate}>生成报告</Button>
        </div>
      </Card>

      {/* 筛选 */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索报告标题…"
          className="flex-1 min-w-[160px] px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
          aria-label="搜索报告"
        />
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as 'all' | ReportType)}
          className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
          aria-label="按类型筛选"
        >
          <option value="all">全部类型</option>
          <option value="weekly">周报</option>
          <option value="monthly">月报</option>
          <option value="yearly">年报</option>
        </select>
        {selected.size > 0 && (
          <>
            <Button variant="outline" size="sm" onClick={exportSelected}>
              ⬇ 导出所选
            </Button>
            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
              删除所选 ({selected.size})
            </Button>
          </>
        )}
      </div>

      {/* 列表 */}
      {filtered.length === 0 ? (
        <Card>
          <EmptyState icon="📄" title="还没有财务报告" description="生成周报/月报/年报，追踪你的财富变化。" />
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const meta = TYPE_META[r.reportType];
            const positive = r.changeAmount >= 0;
            return (
              <Card key={r.id} className={`p-4 ${r.isArchived ? 'opacity-70' : ''}`}>
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggleSelect(r.id)}
                    className="h-4 w-4 text-emerald-600 rounded mt-1"
                    aria-label={`选择 ${r.title}`}
                  />
                  <button className="flex-1 text-left min-w-0" onClick={() => setDetail(r)}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span aria-hidden>{meta.icon}</span>
                      <h3 className="font-semibold text-slate-800 truncate">{r.title}</h3>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      {r.isArchived && <Badge tone="slate">已归档</Badge>}
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-sm flex-wrap">
                      <span className="text-slate-500 tabular text-xs">{r.startDate} ~ {r.endDate}</span>
                      <span className="font-semibold text-slate-800 tabular">{formatCNY(r.totalAmount)}</span>
                      <span className={`tabular text-xs font-medium ${positive ? 'text-emerald-600' : 'text-red-600'}`}>
                        {positive ? '▲' : '▼'} {Math.abs(r.changePercentage).toFixed(1)}%
                      </span>
                      {r.wealthLevelName && <span className="text-xs text-slate-400">{r.wealthLevelName}</span>}
                    </div>
                  </button>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button className="text-xs text-slate-500 hover:text-blue-600" onClick={() => archiveReport(r.id)}>
                      {r.isArchived ? '取消归档' : '归档'}
                    </button>
                    <button className="text-xs text-slate-400 hover:text-red-500" onClick={() => deleteReport(r.id)}>
                      删除
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {detail && <ReportDetailModal report={detail} onClose={() => setDetail(null)} />}

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

function ReportDetailModal({ report, onClose }: { report: FinancialReport; onClose: () => void }) {
  const positive = report.changeAmount >= 0;
  const items = report.channelDetails.map((c) => ({
    id: c.id,
    label: c.name,
    value: c.amount,
    color: '#2a78d6',
    emoji: c.emoji,
    hint: `${c.percentage.toFixed(1)}%`,
  }));
  const max = report.reportType === 'weekly' ? report.weeklyMax : report.reportType === 'monthly' ? report.monthlyMax : report.yearlyMax;
  const min = report.reportType === 'weekly' ? report.weeklyMin : report.reportType === 'monthly' ? report.monthlyMin : report.yearlyMin;
  const avg = report.reportType === 'weekly' ? report.weeklyAvg : report.reportType === 'monthly' ? report.monthlyAvg : report.yearlyAvg;

  return (
    <Modal open onClose={onClose} title={report.title} size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="期末总资产" value={formatCNY(report.totalAmount)} />
          <Stat label="期初总资产" value={formatCNY(report.previousTotalAmount ?? 0)} />
          <Stat
            label="本期变化"
            value={`${positive ? '+' : ''}${formatCNY(report.changeAmount)}`}
            tone={positive ? 'up' : 'down'}
          />
          <Stat
            label="变化率"
            value={`${positive ? '+' : ''}${report.changePercentage.toFixed(1)}%`}
            tone={positive ? 'up' : 'down'}
          />
        </div>

        {(max !== undefined || avg !== undefined) && (
          <div className="grid grid-cols-3 gap-3">
            <Stat label="最高" value={max !== undefined ? formatCNY(max) : '—'} />
            <Stat label="最低" value={min !== undefined ? formatCNY(min) : '—'} />
            <Stat label="平均" value={avg !== undefined ? formatCNY(avg) : '—'} />
          </div>
        )}

        {report.wealthLevelName && (
          <div className="text-sm text-slate-600">
            当前财富等级：<span className="font-medium">{report.wealthLevelName}</span>
          </div>
        )}

        <div>
          <h4 className="text-sm font-medium text-slate-700 mb-2">资产构成</h4>
          {items.length > 0 ? (
            <BarChart items={items} ariaLabel="报告资产构成" />
          ) : (
            <p className="text-sm text-slate-400">无渠道明细</p>
          )}
        </div>

        {report.topChannels && report.topChannels.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-slate-700 mb-2">TOP 渠道</h4>
            <div className="flex flex-wrap gap-2">
              {report.topChannels.map((c, i) => (
                <Badge key={i} tone="emerald">
                  {c.emoji} {c.name} · {c.percentage.toFixed(1)}%
                </Badge>
              ))}
            </div>
          </div>
        )}

        <div className="text-xs text-slate-400">
          生成时间：{report.createdAt ? new Date(report.createdAt).toLocaleString('zh-CN') : '—'}
        </div>
      </div>
    </Modal>
  );
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
