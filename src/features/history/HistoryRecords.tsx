import { useEffect, useState } from 'react';
import { Badge, Button } from '../../components/ui/primitives';
import { useAppStore } from '../../store/appStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { formatCNY } from '../../utils/money';
import type { HistoryPoint } from '../../types';
import { HistoryEventNoteModal } from './HistoryEventNoteModal';
import { historyRecordTime, historySource, type HistoryRow } from './historyView';

interface HistoryRecordsProps {
  rows: HistoryRow[];
  selected: ReadonlySet<string>;
  onToggleSelect: (date: string) => void;
  onEdit: (date: string, amount: number) => void;
  onDelete: (date: string) => void;
}

function RecordTime({ point }: { point: HistoryPoint }) {
  const recordTime = historyRecordTime(point);
  return recordTime
    ? <span>{recordTime.label}：<time dateTime={recordTime.iso}>{recordTime.text}</time></span>
    : <span>记录时间未记录</span>;
}

function Difference({ row, hidden }: { row: HistoryRow; hidden: boolean }) {
  if (row.difference === null) {
    return <p className="text-sm text-slate-500">{row.future || !row.validDate || row.coverage.kind === 'invalid' ? '无法比较' : '无更早有效记录'}</p>;
  }
  const direction = row.difference > 0 ? '增加' : row.difference < 0 ? '减少' : '持平';
  return (
    <>
      <p className={`text-sm font-medium tabular ${hidden || row.difference === 0 ? 'text-slate-700' : row.difference > 0 ? 'text-emerald-700' : 'text-red-700'}`}>
        {hidden ? formatCNY(row.difference) : `${direction} ${formatCNY(Math.abs(row.difference))}`}
      </p>
      <p className="mt-1 text-xs text-slate-500">较 <time dateTime={row.previousDate!}>{row.previousDate}</time></p>
    </>
  );
}

function EventNote({ point, hidden }: { point: HistoryPoint; hidden: boolean }) {
  return point.eventNote
    ? <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{hidden ? '事件备注已隐藏' : point.eventNote}</p>
    : <span className="text-xs text-slate-500">暂无事件备注</span>;
}

export function HistoryRecords({ rows, selected, onToggleSelect, onEdit, onDelete }: HistoryRecordsProps) {
  const [view, setView] = useState<'timeline' | 'table'>('timeline');
  const [noteTarget, setNoteTarget] = useState<{ date: string; initialNote: string; baseRevision: number } | null>(null);
  const hidden = useWorkspaceStore(state => state.amountsHidden);
  const setHistoryEventNote = useAppStore(state => state.setHistoryEventNote);

  useEffect(() => { if (hidden) setNoteTarget(null); }, [hidden]);

  function editNote(date: string) {
    if (hidden) return;
    const state = useAppStore.getState();
    const point = state.history.find(candidate => candidate.date === date);
    if (!point) return;
    setNoteTarget({ date, initialNote: point.eventNote ?? '', baseRevision: state.dataRevision });
  }

  function actions(point: HistoryPoint) {
    return (
      <div className="flex flex-wrap gap-1">
        <Button variant="ghost" size="sm" className="min-h-[44px]" disabled={hidden} title={hidden ? '关闭金额隐私后可编辑事件备注' : undefined} aria-label={`${point.date} ${point.eventNote ? '编辑' : '添加'}事件备注`} onClick={() => editNote(point.date)}>
          {point.eventNote ? '编辑' : '添加'}事件备注
        </Button>
        <Button variant="ghost" size="sm" className="min-h-[44px]" aria-label={`${point.date} 编辑历史记录`} onClick={() => onEdit(point.date, point.totalAmount)}>编辑</Button>
        <Button variant="ghost" size="sm" className="min-h-[44px] text-red-600" aria-label={`${point.date} 删除历史记录`} onClick={() => onDelete(point.date)}>删除</Button>
      </div>
    );
  }

  function sourceAndCoverage(row: HistoryRow) {
    const source = historySource(row.point.source);
    return (
      <div className="flex flex-wrap gap-1.5">
        <Badge tone={source.tone}>{source.label}</Badge>
        <Badge tone={row.coverage.tone}>{row.coverage.label}</Badge>
        {row.future && <Badge tone="amber">未来日期</Badge>}
        {!row.validDate && <Badge tone="red">日期无效</Badge>}
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-200">
        <p className="text-xs text-slate-500">每天一条记录 · 资产差额不代表收入、支出或投资收益</p>
        <div className="flex gap-1" role="group" aria-label="历史展示方式">
          <Button size="sm" className="min-h-[44px]" variant={view === 'timeline' ? 'outline' : 'ghost'} aria-pressed={view === 'timeline'} onClick={() => setView('timeline')}>时间轴</Button>
          <Button size="sm" className="min-h-[44px]" variant={view === 'table' ? 'outline' : 'ghost'} aria-pressed={view === 'table'} onClick={() => setView('table')}>数据表</Button>
        </div>
      </div>
      {view === 'timeline' ? (
        <ol aria-label="按日历史记录" className="divide-y divide-slate-100">
          {rows.map((row, index) => (
            <li key={`${row.point.date}-${index}`} className="p-4 sm:p-5">
              <article aria-label={`${row.point.date} 历史记录`} className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <label className="flex min-h-[44px] items-center gap-3 font-semibold text-slate-800">
                    <input type="checkbox" checked={selected.has(row.point.date)} onChange={() => onToggleSelect(row.point.date)} className="h-5 w-5 rounded text-emerald-600" aria-label={`选择 ${row.point.date}`} />
                    <time dateTime={row.validDate ? row.point.date : undefined}>{row.point.date}</time>
                  </label>
                  {sourceAndCoverage(row)}
                </div>
                {row.point.name && <p className="break-words text-sm text-slate-600">{row.point.name}</p>}
                <div className="grid grid-cols-1 gap-4 min-[360px]:grid-cols-2 lg:grid-cols-[1fr_1fr_1.4fr]">
                  <div>
                    <p className="text-xs text-slate-500">总资产</p>
                    <p className="mt-1 break-all text-lg font-semibold tabular text-slate-800">{formatCNY(row.point.totalAmount)}</p>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-slate-500">前一有效记录变化</p>
                    <Difference row={row} hidden={hidden} />
                  </div>
                  <p className="col-span-full text-xs leading-relaxed text-slate-500 lg:col-span-1">{row.future ? '日期尚未到来，不参与历史趋势和变化比较。' : row.coverage.detail}</p>
                </div>
                <div className="border-l-2 border-slate-200 pl-3">
                  <p className="mb-1 text-xs font-medium text-slate-500">事件备注</p>
                  <EventNote point={row.point} hidden={hidden} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <p className="text-xs text-slate-500"><RecordTime point={row.point} /></p>
                  {actions(row.point)}
                </div>
              </article>
            </li>
          ))}
        </ol>
      ) : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="历史记录数据表，可横向滚动">
          <table className="w-full min-w-[960px] text-left text-sm">
            <caption className="sr-only">按日期倒序的资产历史；差额与前一有效记录比较，事件备注不构成现金流台账。</caption>
            <thead className="bg-slate-50 text-xs text-slate-500"><tr>
              {['选择', '日期 / 总资产', '前一有效记录变化', '来源 / 覆盖', '事件备注', '记录时间 / 操作'].map(label => <th scope="col" className="px-4 py-3 font-medium" key={label}>{label}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, index) => <tr key={`${row.point.date}-${index}`}>
                <td className="px-4 py-3 align-top"><label className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center"><input type="checkbox" checked={selected.has(row.point.date)} onChange={() => onToggleSelect(row.point.date)} className="h-5 w-5 rounded text-emerald-600" aria-label={`选择 ${row.point.date}`} /></label></td>
                <th scope="row" className="px-4 py-4 align-top font-normal"><time dateTime={row.validDate ? row.point.date : undefined}>{row.point.date}</time><p className="mt-2 font-semibold tabular">{formatCNY(row.point.totalAmount)}</p>{row.point.name && <p className="mt-1 max-w-48 break-words text-xs text-slate-500">{row.point.name}</p>}</th>
                <td className="px-4 py-4 align-top"><Difference row={row} hidden={hidden} /></td>
                <td className="max-w-64 px-4 py-4 align-top">{sourceAndCoverage(row)}<p className="mt-2 text-xs leading-relaxed text-slate-500">{row.future ? '不参与历史趋势和变化比较。' : row.coverage.detail}</p></td>
                <td className="min-w-48 max-w-72 px-4 py-4 align-top"><EventNote point={row.point} hidden={hidden} /></td>
                <td className="px-4 py-4 align-top"><p className="mb-2 text-xs text-slate-500"><RecordTime point={row.point} /></p>{actions(row.point)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      )}
      {noteTarget && !hidden && <HistoryEventNoteModal {...noteTarget} onClose={() => setNoteTarget(null)} onSave={setHistoryEventNote} />}
    </>
  );
}
