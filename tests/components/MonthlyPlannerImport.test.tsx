import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MonthlyPlannerPanel } from '../../src/features/monthlyPlanning/MonthlyPlannerPanel';
import { useAppStore } from '../../src/store/appStore';
import { createDraftSession } from '../../src/domain/portfolio/session';
import { emptyMonthlyPlanningState } from '../../src/services/monthlyPlanning/storage';
import { writeZip } from '../../src/services/documents/zip';
import { setAttachmentBackendForTest } from '../../src/services/monthlyPlanning/attachmentStore';
import { todayString } from '../../src/utils/date';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const cell = (text: string) => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
const row = (...texts: string[]) => `<w:tr>${texts.map(cell).join('')}</w:tr>`;
const docxBytes = (): Uint8Array => writeZip([{
  name: 'word/document.xml',
  data: `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body><w:tbl>`
    + row('序号NO.', '基金名称Fund name', '基金代码Fund code', '查询份额Fund shares', '查询市值(元)Market value(CNY)')
    + row('01', '华泰柏瑞鼎利混合C', '004011', '1,234.56', '8,000.00')
    + row('02', '国泰黄金ETF联接C', '004253', '500.00', '1,200.00')
    + '</w:tbl></w:body></w:document>',
}]);

const initialState = useAppStore.getState();
const month = todayString().slice(0, 7);

beforeEach(() => {
  // jsdom 的 File 没有 arrayBuffer()，真实 WebView 有；这里用 FileReader 补齐。
  if (!('arrayBuffer' in File.prototype)) {
    Object.defineProperty(File.prototype, 'arrayBuffer', {
      configurable: true,
      value(this: File) {
        return new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = () => reject(reader.error);
          reader.readAsArrayBuffer(this);
        });
      },
    });
  }
  setAttachmentBackendForTest(null);
  const session = createDraftSession({ planningMonth: month, timezone: 'Asia/Shanghai', today: todayString(), now: new Date().toISOString() });
  useAppStore.setState({
    ...initialState,
    hydrated: true,
    recoveryError: null,
    channels: [{ id: 'channel-alipay', name: '支付宝', amount: 0, emoji: '', color: '#1677ff', isParent: true, isExpanded: false }],
    history: [],
    reports: [],
    monthlyPlanning: { ...emptyMonthlyPlanningState(), sessions: [session] },
  });
});

afterEach(() => {
  cleanup();
  useAppStore.setState(initialState);
});

describe('月度理财导入', () => {
  it('选中文件后同步快照列表，入库并生成候选（回归：FileList 被清空导致 0 入库）', async () => {
    const user = userEvent.setup();
    render(<MonthlyPlannerPanel />);
    await user.click(screen.getByRole('button', { name: '资料与对账' }));

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    const file = new File([docxBytes() as unknown as BlobPart], '20260720支付宝渠道.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    await user.upload(input, file);

    await waitFor(() => {
      expect(screen.getByText(/上次导入结果/)).toBeTruthy();
    });
    expect(screen.getAllByText(/已入库/).length).toBeGreaterThan(0);
    expect(screen.getByText(/候选 2 条（已生成本地候选）/)).toBeTruthy();
    const saved = useAppStore.getState().monthlyPlanning.sessions.find((item) => item.key === `monthly-planning:${month}`);
    expect(saved?.documents).toHaveLength(1);
    expect(saved?.holdings).toHaveLength(2);
    expect(saved?.documents[0]?.declaredDate).toBe('2026-07-20');
  });
});
