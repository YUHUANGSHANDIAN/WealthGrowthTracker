// 生成应用图标源图（1024×1024 PNG）——原创「财富成长」图标：绿色圆底 + 白色上升曲线 + 嫩芽。
// 用法：node scripts/generate-icon.mjs   （输出到 assets/app-icon.png）
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIZE = 1024;
const SUPERSAMPLE = 2; // 2× 超采样抗锯齿
const W = SIZE * SUPERSAMPLE;

// ---- 最小 PNG 编码器 ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- 图标绘制 ----
const rgba = Buffer.alloc(W * W * 4);

function setPx(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= W || y >= W) return;
  const i = (y * W + x) * 4;
  // 简单的 alpha 混合（覆盖式）
  const sa = a / 255;
  const da = rgba[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) return;
  rgba[i] = Math.round((r * sa + rgba[i] * da * (1 - sa)) / oa);
  rgba[i + 1] = Math.round((g * sa + rgba[i + 1] * da * (1 - sa)) / oa);
  rgba[i + 2] = Math.round((b * sa + rgba[i + 2] * da * (1 - sa)) / oa);
  rgba[i + 3] = Math.round(oa * 255);
}

function inCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

const cx = W / 2;
const cy = W / 2;
const R = W * 0.48;

for (let y = 0; y < W; y++) {
  for (let x = 0; x < W; x++) {
    if (!inCircle(x, y, cx, cy, R)) continue;
    // 径向渐变：从浅绿到深绿
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy) / R;
    const t = Math.min(1, Math.max(0, dist));
    const top = 0x34d399;
    const bot = 0x059669;
    const r = ((top >> 16) & 0xff) * (1 - t) + ((bot >> 16) & 0xff) * t;
    const g = ((top >> 8) & 0xff) * (1 - t) + ((bot >> 8) & 0xff) * t;
    const b = (top & 0xff) * (1 - t) + (bot & 0xff) * t;
    setPx(x, y, r, g, b, 255);
  }
}

// 白色上升折线（增长曲线），带粗描边（用多段圆点近似加粗）
function thickLine(x1, y1, x2, y2, thickness) {
  const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    for (let dx = -thickness; dx <= thickness; dx++) {
      for (let dy = -thickness; dy <= thickness; dy++) {
        if (dx * dx + dy * dy <= thickness * thickness) setPx(Math.round(x + dx), Math.round(y + dy), 255, 255, 255, 255);
      }
    }
  }
}

const lw = W * 0.075;
// 折线：左下 → 中上 → 右上
thickLine(W * 0.30, W * 0.68, W * 0.50, W * 0.46, lw);
thickLine(W * 0.50, W * 0.46, W * 0.64, W * 0.56, lw);
thickLine(W * 0.64, W * 0.56, W * 0.76, W * 0.34, lw);

// 末端一枚「金币」圆点
const coinX = W * 0.76;
const coinY = W * 0.34;
const coinR = W * 0.055;
for (let y = 0; y < W; y++) {
  for (let x = 0; x < W; x++) {
    if (inCircle(x, y, coinX, coinY, coinR)) setPx(x, y, 255, 224, 138, 255);
  }
}
// 金币内圈
for (let y = 0; y < W; y++) {
  for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - coinX, y - coinY);
    if (d > coinR * 0.55 && d <= coinR * 0.62) setPx(x, y, 217, 165, 0, 255);
  }
}

// 左上角一株嫩芽（简化：两片叶子）
function leaf(cx0, cy0, ang, len, w) {
  for (let s = 0; s <= len; s++) {
    const t = s / len;
    const x = cx0 + Math.cos(ang) * s;
    const y = cy0 + Math.sin(ang) * s;
    for (let dx = -w; dx <= w; dx++) {
      for (let dy = -w; dy <= w; dy++) {
        if (dx * dx + dy * dy <= w * w) setPx(Math.round(x + dx), Math.round(y + dy), 255, 255, 255, 255);
      }
    }
  }
}
leaf(W * 0.30, W * 0.36, -Math.PI * 0.75, W * 0.16, lw * 0.5);
leaf(W * 0.30, W * 0.36, -Math.PI * 0.30, W * 0.14, lw * 0.5);

// 降采样到目标尺寸
const out = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let sy = 0; sy < SUPERSAMPLE; sy++) {
      for (let sx = 0; sx < SUPERSAMPLE; sx++) {
        const i = ((y * SUPERSAMPLE + sy) * W + (x * SUPERSAMPLE + sx)) * 4;
        r += rgba[i];
        g += rgba[i + 1];
        b += rgba[i + 2];
        a += rgba[i + 3];
      }
    }
    const n = SUPERSAMPLE * SUPERSAMPLE;
    const o = (y * SIZE + x) * 4;
    out[o] = Math.round(r / n);
    out[o + 1] = Math.round(g / n);
    out[o + 2] = Math.round(b / n);
    out[o + 3] = Math.round(a / n);
  }
}

const png = encodePng(SIZE, SIZE, out);
const target = resolve(__dirname, '../assets/app-icon.png');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, png);
console.log(`已生成图标源图: ${target} (${png.length} bytes)`);
