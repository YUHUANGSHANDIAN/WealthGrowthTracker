import { useMemo, useState } from 'react';
import type { FinancialReport } from '../../types';
import { useAppStore } from '../../store/appStore';
import { buildReportSvg, type ReportBackground } from '../../utils/reportImage';
import {
  renderSvgToBlob,
  copyImageToClipboard,
  copyText,
  systemShare,
  systemShareAvailable,
  downloadBlob,
  type ImageFormat,
} from '../../utils/share';
import {
  REPORT_PRIVACY_OPTIONS,
  REPORT_TEMPLATE_OPTIONS,
  reportSummaryWithPrivacy,
  type ReportPrivacy,
  type ReportTemplate,
} from './sharePrivacy';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/primitives';
import { SelectField } from '../../components/ui/form';
import { SliderField } from '../../components/ui/Slider';

/**
 * Share Center —— 报告分享（v1.3）。
 * 支持 4 种模板、4 种隐私模式、3 种格式、多档分辨率、主题/透明背景，并实时预览。
 */
export function ShareReportModal({ report, onClose }: { report: FinancialReport; onClose: () => void }) {
  const pushToast = useAppStore((s) => s.pushToast);
  const [template, setTemplate] = useState<ReportTemplate>('detailed');
  const [privacy, setPrivacy] = useState<ReportPrivacy>('full');
  const [format, setFormat] = useState<ImageFormat>('png');
  const [scale, setScale] = useState(2);
  const [quality, setQuality] = useState(0.9);
  const [background, setBackground] = useState<ReportBackground>('light');
  const [busy, setBusy] = useState(false);

  const svg = useMemo(
    () => buildReportSvg(report, { template, privacy, background }),
    [report, template, privacy, background],
  );
  const previewSrc = useMemo(
    () => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
    [svg],
  );

  async function makeBlob(): Promise<Blob> {
    return renderSvgToBlob(svg, format, scale, quality, background === 'transparent');
  }

  function ext(): string {
    return format === 'jpeg' ? 'jpg' : format;
  }

  async function download() {
    setBusy(true);
    try {
      const blob = await makeBlob();
      downloadBlob(blob, `${report.title.replace(/[/\\]/g, '-')}.${ext()}`);
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
        await copyText(reportSummaryWithPrivacy(report, privacy));
        pushToast('当前环境不支持复制图片，已复制文字摘要', 'info');
      }
    } catch {
      await copyText(reportSummaryWithPrivacy(report, privacy));
      pushToast('已复制文字摘要', 'info');
    } finally {
      setBusy(false);
    }
  }

  async function email() {
    const subject = encodeURIComponent(report.title);
    const body = encodeURIComponent(reportSummaryWithPrivacy(report, privacy));
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
    try {
      const blob = await makeBlob();
      downloadBlob(blob, `${report.title}.${ext()}`);
      pushToast('已打开邮件客户端，请附加刚导出的图片', 'info');
    } catch {
      pushToast('已打开邮件客户端（仅文字摘要）', 'info');
    }
  }

  async function sysShare() {
    setBusy(true);
    try {
      const blob = await makeBlob();
      const file = new File([blob], `${report.title}.${ext()}`, { type: blob.type });
      const ok = await systemShare(report, file, reportSummaryWithPrivacy(report, privacy));
      pushToast(ok ? '已打开系统分享' : '系统分享不可用', ok ? 'success' : 'info');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="分享报告" size="lg">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 左侧：实时预览 */}
        <div className="bg-slate-100 rounded-xl p-3 flex items-center justify-center min-h-[260px]">
          <img
            src={previewSrc}
            alt="分享预览"
            className="max-h-[420px] w-auto rounded-lg shadow border border-slate-200"
            style={{ maxWidth: '100%', objectFit: 'contain' }}
          />
        </div>

        {/* 右侧：选项 */}
        <div className="space-y-3">
          <SelectField
            label="模板"
            value={template}
            onChange={(e) => setTemplate(e.target.value as ReportTemplate)}
            options={REPORT_TEMPLATE_OPTIONS.map((t) => ({ value: t.value, label: `${t.label} · ${t.description}` }))}
          />
          <SelectField
            label="隐私模式"
            value={privacy}
            onChange={(e) => setPrivacy(e.target.value as ReportPrivacy)}
            options={REPORT_PRIVACY_OPTIONS.map((p) => ({ value: p.value, label: `${p.label} · ${p.description}` }))}
          />
          <div className="grid grid-cols-2 gap-2">
            <SelectField
              label="格式"
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
          <SelectField
            label="背景"
            value={background}
            onChange={(e) => setBackground(e.target.value as ReportBackground)}
            options={[
              { value: 'light', label: '白色背景' },
              { value: 'theme', label: '等级主题背景' },
              { value: 'transparent', label: '透明背景（PNG）' },
            ]}
          />
          {format !== 'png' && (
            <div>
              <SliderField label="质量" min={0.5} max={1} step={0.05} value={quality} onChange={setQuality} format={(v) => `${Math.round(v * 100)}%`} ariaLabel="图片质量" />
            </div>
          )}
          {background === 'transparent' && format !== 'png' && (
            <p className="text-xs text-amber-600">JPEG/WebP 不支持透明背景，将回退为白色。</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-4">
        <Button onClick={download} disabled={busy}>⬇ 下载图片</Button>
        <Button variant="outline" onClick={copyImage} disabled={busy}>💚 微信分享（复制图片）</Button>
        <Button variant="outline" onClick={email}>✉ 邮件分享</Button>
        <Button variant="outline" onClick={() => { void copyText(reportSummaryWithPrivacy(report, privacy)).then(() => pushToast('已复制文字摘要', 'success')); }}>📋 复制文字摘要</Button>
        {systemShareAvailable() && (
          <Button variant="outline" onClick={sysShare} disabled={busy}>📤 系统分享</Button>
        )}
      </div>
      <p className="text-xs text-slate-400 mt-3">
        微信分享：复制报告图片到剪贴板，打开微信粘贴即可（无可靠系统级微信直连协议）。隐私模式「隐藏金额/仅百分比」适合公开分享。
      </p>
    </Modal>
  );
}
