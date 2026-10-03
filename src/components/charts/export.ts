/**
 * 图表导出：SVG / PNG / CSV。
 * 桌面版（Tauri）后续可走原生保存对话框；Web 版使用浏览器下载。
 */

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** 序列化 SVG（补齐 width/height，保证可被 Image/canvas 正确栅格化）。 */
function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const vb = svg.viewBox.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) {
    clone.setAttribute('width', String(vb.width));
    clone.setAttribute('height', String(vb.height));
  }
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(clone);
}

export function downloadSVG(svg: SVGSVGElement, filename: string): void {
  const xml = serializeSvg(svg);
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadPNG(svg: SVGSVGElement, filename: string): Promise<void> {
  const xml = serializeSvg(svg);
  const svg64 = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('SVG 栅格化失败'));
    img.src = svg64;
  });
  const vb = svg.viewBox.baseVal;
  const w = vb && vb.width ? vb.width : svg.clientWidth || 800;
  const h = vb && vb.height ? vb.height : svg.clientHeight || 400;
  const scale = Math.max(1, Math.min(3, 1600 / w));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/png');
  triggerDownload(dataUrl, filename);
}

/** 下载 CSV。header 为表头，rows 为数据行。 */
export function downloadCSV(filename: string, header: string[], rows: (string | number)[][]): void {
  const escape = (v: string | number) => {
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [header.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))];
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }); // BOM 便于 Excel 识别
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
