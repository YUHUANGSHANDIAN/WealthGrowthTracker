import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertFactPackCurrent, buildFactPack, type ContextSelection } from '../../src/services/ai/context';
import { useAppStore } from '../../src/store/appStore';
import type { FinancialReport } from '../../src/types';

const selection: ContextSelection = {
  includeChannels: false,
  includeHistory: false,
  includeLottery: false,
};
const initialState = useAppStore.getState();

beforeEach(() => {
  useAppStore.setState({ hydrated: true, recoveryError: null, channels: [], history: [], reports: [] });
});
afterEach(() => useAppStore.setState(initialState));

describe('trusted AI context', () => {
  it('reads facts and revision only from the current local store', () => {
    useAppStore.setState({
      channels: [{ id: 'c1', name: '现金', amount: 10, emoji: '', color: '#000', isParent: true, isExpanded: false }],
      history: [{ date: '2026-10-01', totalAmount: 10 }],
    });
    const pack = buildFactPack({ ...selection, includeChannels: true, includeHistory: true, baseRevision: -1 } as ContextSelection);
    expect(pack.manifest.baseRevision).toBe(useAppStore.getState().dataRevision);
    expect(pack.facts.map((fact) => fact.factId)).toContain('channel.c1');
    expect(pack.facts.some((fact) => fact.factId.includes('lottery'))).toBe(false);
    expect(() => assertFactPackCurrent(pack)).not.toThrow();
  });

  it('excludes unselected reports and selects by stable report id', () => {
    const report = { id: 'r', totalAmount: 123, revision: 2 } as FinancialReport;
    useAppStore.setState({ reports: [report] });
    expect(buildFactPack(selection).facts).toHaveLength(0);
    expect(() => buildFactPack({ ...selection, reportId: 'other' })).toThrow('不一致');
    expect(buildFactPack({ ...selection, reportId: 'r' }).facts[0]?.source).toContain('revision:2');
  });

  it('uses child rollup rather than parent direct amount', () => {
    useAppStore.setState({ channels: [{
      id: 'p', name: '银行', amount: 0, emoji: '', color: '#000', isParent: true, isExpanded: false,
      children: [{ id: 's', name: '余额', amount: 42, emoji: '', color: '#000', parentId: 'p' }],
    }] });
    expect(buildFactPack({ ...selection, includeChannels: true }).facts[0]?.value).toBe('42');
  });

  it('rejects lottery scope, duplicate facts and invalid calendar dates', () => {
    expect(() => buildFactPack({ ...selection, includeLottery: true } as unknown as ContextSelection)).toThrow('彩票');
    expect(() => buildFactPack({ ...selection, range: { start: '2026-02-30', end: '2026-03-01' } })).toThrow('范围');
    useAppStore.setState({ history: [{ date: '2026-01-01', totalAmount: 1 }, { date: '2026-01-01', totalAmount: 2 }] });
    expect(() => buildFactPack({ ...selection, includeHistory: true })).toThrow('重复');
  });

  it('rejects stale context after a local ledger change', () => {
    const pack = buildFactPack(selection);
    useAppStore.setState({ history: [{ date: '2026-01-01', totalAmount: 1 }] });
    expect(() => assertFactPackCurrent(pack)).toThrow('过期');
  });

  it('rejects copied or modified packs even if they claim the current revision', () => {
    const pack = buildFactPack(selection);
    expect(() => assertFactPackCurrent(structuredClone(pack))).toThrow('本地校验');
    pack.manifest.baseRevision = useAppStore.getState().dataRevision + 1;
    expect(() => assertFactPackCurrent(pack)).toThrow('已被修改');
  });

  it('cannot construct context before hydration or during recovery', () => {
    useAppStore.setState({ hydrated: false });
    expect(() => buildFactPack(selection)).toThrow('尚不可用');
    useAppStore.setState({ hydrated: true, recoveryError: '无法读取数据' });
    expect(() => buildFactPack(selection)).toThrow('尚不可用');
  });

  it('keeps unrecognized input fields out of the generated manifest', () => {
    const pack = buildFactPack({ ...selection, token: 'untrusted', endpoint: 'https://example.test' } as ContextSelection);
    expect(pack.manifest).not.toHaveProperty('token');
    expect(pack.manifest).not.toHaveProperty('endpoint');
  });
});
