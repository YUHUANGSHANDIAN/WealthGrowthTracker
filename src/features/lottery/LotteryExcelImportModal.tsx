import { useRef, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { Modal } from '../../components/ui/Modal';
import { Button, Badge } from '../../components/ui/primitives';
import { readLotteryExcelFile, type LotteryExcelPreview } from './excelImport';

/** 旧彩票 Excel 导入（用户主动选择，幂等）。 */
export function LotteryExcelImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { applyLotteryExcelImport, pushToast } = useAppStore();
  const [preview, setPreview] = useState<LotteryExcelPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const p = await readLotteryExcelFile(file);
      setPreview(p);
    } catch (err) {
      setError(`解析失败：${err instanceof Error ? err.message : '未知错误'}`);
      setPreview(null);
    } finally {
      setBusy(false);
    }
    e.target.value = '';
  }

  function confirm() {
    if (!preview) return;
    const res = applyLotteryExcelImport(preview);
    pushToast(`已导入 ${res.projectsAdded} 个项目、${res.transactionsAdded} 笔交易`, 'success');
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="导入旧彩票 Excel" size="md"
      footer={
        preview ? (
          <>
            <Button variant="ghost" onClick={onClose}>取消</Button>
            <Button onClick={confirm} disabled={busy}>确认导入</Button>
          </>
        ) : undefined
      }>
      <div className="space-y-4">
        <p className="text-sm text-slate-500">选择《财富成长记AI系统_彩票收支统计.xlsx》，系统会识别「汇总表 / 每日统计 / 交易明细」并预览。导入幂等：同一 Excel 重复导入不会产生重复交易。</p>
        <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? '解析中…' : '📥 选择 Excel 文件'}</Button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={onFile} className="hidden" aria-label="选择彩票 Excel" />
        {error && <p className="text-sm text-red-600">{error}</p>}

        {preview && (
          <div className="bg-slate-50 rounded-lg p-3 space-y-1 text-sm">
            <div className="font-medium text-slate-700">导入预览</div>
            <div>项目：<Badge tone="purple">{preview.projectCount}</Badge></div>
            <div>详细交易：<Badge tone="blue">{preview.detailedTransactionCount}</Badge></div>
            <div>全部收入：<span className="tabular text-emerald-600">¥{preview.legacyIncome.toFixed(2)}</span></div>
            <div>全部支出：<span className="tabular text-red-600">¥{preview.legacyExpense.toFixed(2)}</span></div>
            <div>净盈亏：<span className="tabular font-medium">¥{preview.legacyNet.toFixed(2)}</span></div>
            {preview.warnings.map((w) => <div key={w} className="text-xs text-amber-600">⚠️ {w}</div>)}
          </div>
        )}
      </div>
    </Modal>
  );
}
