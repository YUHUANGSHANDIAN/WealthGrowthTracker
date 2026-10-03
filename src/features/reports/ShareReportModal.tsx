import { useState } from 'react';
import type { FinancialReport } from '../../types';
import { useAppStore } from '../../store/appStore';
import { buildReportSvg } from '../../utils/reportImage';
import {
  renderSvgToBlob,
  copyImageToClipboard,
  copyText,
  buildMailtoLink,
  systemShare,
  systemShareAvailable,
  reportTextSummary,
  downloadBlob,
  type ImageFormat,
} from '../../utils/share';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/primitives';
import { SelectField } from '../../components/ui/form';

export function ShareReportModal({ report, onClose }: { report: FinancialReport; onClose: () => void }) {
  const pushToast = useAppStore((s) => s.pushToast);
  const [format, setFormat] = useState<ImageFormat>('png');
  const [scale, setScale] = useState(2);
  const [quality, setQuality] = useState(0.9);
  const [busy, setBusy] = useState(false);

  const themeColor = report.wealthLevelColor ?? '#10B981';

  async function makeBlob(): Promise<Blob> {
    const svg = buildReportSvg(report, themeColor);
    return renderSvgToBlob(svg, format, scale, quality);
  }

  async function download() {
    setBusy(true);
    try {
      const blob = await makeBlob();
      const ext = format === 'jpeg' ? 'jpg' : format;
      downloadBlob(blob, `${report.title.replace(/[/\\]/g, '-')}.${ext}`);
      pushToast('图片已导出', 'success');
    } catch (err) {
      console.error(err);
      pushToast('图片生成失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function copyImage() {
    setBusy(true);
    try {
      const blob = await makeBlob();
      const ok = await copyImageToClipboard(blob);
      if (ok) pushToast('报告图片已复制，请打开微信并粘贴发送', 'success');
      else {
        await copyText(reportTextSummary(report));
        pushToast('当前环境不支持复制图片，已复制文字摘要', 'info');
      }
    } catch {
      await copyText(reportTextSummary(report));
      pushToast('已复制文字摘要', 'info');
    } finally {
      setBusy(false);
    }
  }

  async function email() {
    const link = buildMailtoLink(report);
    window.location.href = link;
    // 同时导出图片，提示用户手动附加
    try {
      const blob = await makeBlob();
      downloadBlob(blob, `${report.title}.${format === 'jpeg' ? 'jpg' : format}`);
      pushToast('已打开邮件客户端，请附加刚导出的图片', 'info');
    } catch {
      pushToast('已打开邮件客户端（仅文字摘要）', 'info');
    }
  }

  async function sysShare() {
    setBusy(true);
    try {
      const blob = await makeBlob();
      const file = new File([blob], `${report.title}.${format === 'jpeg' ? 'jpg' : format}`, { type: blob.type });
      const ok = await systemShare(report, file);
      pushToast(ok ? '已打开系统分享' : '系统分享不可用', ok ? 'success' : 'info');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="分享报告" size="md">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{report.title}</p>
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label="图片格式"
            value={format}
            onChange={(e) => setFormat(e.target.value as ImageFormat)}
            options={[
              { value: 'png', label: 'PNG（无损）' },
              { value: 'jpeg', label: 'JPEG（较小）' },
              { value: 'webp', label: 'WebP（推荐）' },
            ]}
          />
          <SelectField
            label="分辨率"
            value={String(scale)}
            onChange={(e) => setScale(Number(e.target.value))}
            options={[
              { value: '1', label: '1x' },
              { value: '2', label: '2x' },
              { value: '3', label: '3x' },
            ]}
          />
        </div>
        {format !== 'png' && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              质量 <span className="text-slate-400 tabular">{Math.round(quality * 100)}%</span>
            </label>
            <input type="range" min={0.5} max={1} step={0.05} value={quality} onChange={(e) => setQuality(Number(e.target.value))} className="w-full accent-emerald-600" aria-label="图片质量" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button onClick={download} disabled={busy}>⬇ 下载图片</Button>
          <Button variant="outline" onClick={copyImage} disabled={busy}>💚 微信分享（复制图片）</Button>
          <Button variant="outline" onClick={email}>✉ 邮件分享</Button>
          <Button variant="outline" onClick={() => { void copyText(reportTextSummary(report)).then(() => pushToast('已复制文字摘要', 'success')); }}>📋 复制文字摘要</Button>
          {systemShareAvailable() && (
            <Button variant="outline" onClick={sysShare} disabled={busy}>📤 系统分享</Button>
          )}
        </div>
        <p className="text-xs text-slate-400">
          微信分享：点击后复制报告图片到剪贴板，打开微信粘贴即可（无可靠系统级微信直连协议，不假装已分享）。
        </p>
      </div>
    </Modal>
  );
}
