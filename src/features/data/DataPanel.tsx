import React, { useRef, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { Card, Button, Badge } from '../../components/ui/primitives';
import { Modal } from '../../components/ui/Modal';
import { storageService } from '../../services/storage';
import { parseBackup } from '../../services/export';

export function DataPanel() {
  const { exportData, importData, pushToast } = useAppStore();
  const [preview, setPreview] = useState<{ text: string; channels: number; history: number; reports: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const adapterName = storageService.getAdapterName();

  async function handleExport() {
    await exportData();
  }

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const result = parseBackup(text);
    if (!result.ok) {
      pushToast(result.error, 'error');
    } else {
      setPreview({
        text,
        channels: result.data.channels.length,
        history: result.data.history.length,
        reports: result.data.reports.length,
      });
    }
    e.target.value = '';
  }

  async function confirmImport() {
    if (!preview) return;
    setImporting(true);
    const res = await importData(preview.text);
    setImporting(false);
    setPreview(null);
    pushToast(res.message, res.ok ? 'success' : 'error');
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="font-semibold text-slate-800 mb-2">导出数据</h2>
        <p className="text-sm text-slate-500 mb-3">
          将全部资产渠道、历史记录、财务报告与设置导出为 JSON 文件，可用于备份或迁移到其他设备。
        </p>
        <Button onClick={handleExport}>⬇ 导出 JSON 备份</Button>
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold text-slate-800 mb-2">导入数据</h2>
        <p className="text-sm text-slate-500 mb-3">
          从之前导出的 JSON 文件恢复数据。支持灵光旧版导出的备份文件。
        </p>
        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          ⬆ 选择 JSON 文件导入
        </Button>
        <input ref={fileRef} type="file" accept=".json,application/json" onChange={onFileChosen} className="hidden" aria-label="选择导入文件" />
      </Card>

      <Card className="p-4">
        <h2 className="font-semibold text-slate-800 mb-2">存储与隐私</h2>
        <div className="space-y-2 text-sm text-slate-600">
          <div className="flex items-center gap-2">
            <span>存储后端：</span>
            <Badge tone={adapterName === 'lingguang' ? 'purple' : 'blue'}>
              {adapterName === 'lingguang' ? '灵光运行时' : '浏览器本地存储 (localStorage)'}
            </Badge>
          </div>
          <p>
            你的所有资产数据默认只保存在<strong>你自己的浏览器本地</strong>，不会上传到任何服务器。
            「AI 分析」为本地规则算法，不联网、不调用第三方服务。
          </p>
          <p className="text-xs text-slate-400">
            提示：浏览器清理站点数据会导致本地数据丢失，请定期导出 JSON 备份。
          </p>
        </div>
      </Card>

      {/* 导入预览确认 */}
      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        title="确认导入数据"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPreview(null)} disabled={importing}>取消</Button>
            <Button variant="danger" onClick={confirmImport} disabled={importing}>
              {importing ? '导入中…' : '覆盖导入'}
            </Button>
          </>
        }
      >
        {preview && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              检测到备份包含：
            </p>
            <ul className="text-sm text-slate-700 space-y-1">
              <li>· {preview.channels} 个渠道</li>
              <li>· {preview.history} 条历史记录</li>
              <li>· {preview.reports} 份财务报告</li>
            </ul>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700 space-y-1">
              <p>⚠️ 导入操作将<strong>完全覆盖</strong>当前所有数据，且无法撤销。</p>
              <p>建议在导入前先导出当前数据作为备份。</p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
