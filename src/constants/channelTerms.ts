export const CHANNEL_TERMS = Object.freeze({
  parent: '父渠道',
  subchannel: '子渠道',
  parentRollup: '父渠道汇总金额',
  parentDirect: '父渠道直接金额（未细分）',
  detailLevel: '子渠道明细（含未细分金额）',
  noDoubleCount: '父渠道汇总与子渠道明细不重复计入',
});

export function parentDirectLabel(name: string): string {
  return `${name}（未细分）`;
}

export function channelPath(parentName: string | null, name: string): string {
  return parentName ? `${parentName} / ${name}` : name;
}
