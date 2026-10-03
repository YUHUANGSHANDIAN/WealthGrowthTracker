/** 线性标尺：把 [d0,d1] 映射到 [r0,r1]。 */
export function linearScale(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** 生成均匀刻度（约 n 个，取整到 "nice" 值）。 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) return [min];
  const span = max - min;
  const step = niceStep(span / Math.max(1, count));
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 1e-6; v += step) {
    ticks.push(Number(v.toFixed(10)));
  }
  return ticks;
}

function niceStep(raw: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  if (n <= 1) return pow;
  if (n <= 2) return 2 * pow;
  if (n <= 5) return 5 * pow;
  return 10 * pow;
}

/** 金额轴刻度格式化：大额缩写。 */
export function formatMoneyTick(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}百万`;
  if (Math.abs(v) >= 10_000) return `${(v / 10_000).toFixed(1)}万`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}千`;
  return `${Math.round(v)}`;
}
