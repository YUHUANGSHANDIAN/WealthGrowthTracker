/** 生成短随机 id（用于渠道、报告等实体）。 */

const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function randomId(prefix = ''): string {
  let s = '';
  for (let i = 0; i < 12; i++) {
    s += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  const stamp = Date.now().toString(36).slice(-6);
  return `${prefix ? `${prefix}_` : ''}${stamp}${s}`;
}

/** 生成 UUID（用于需要更长唯一性的场景）。 */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${randomId()}${randomId()}`;
}
