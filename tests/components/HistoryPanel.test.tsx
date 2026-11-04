import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { HistoryPanel } from '../../src/features/history/HistoryPanel';
import { useAppStore } from '../../src/store/appStore';
import { useWorkspaceStore } from '../../src/store/workspaceStore';
import type { HistoryPoint } from '../../src/types';

const history: HistoryPoint[] = [
  { date: '2020-10-11', totalAmount: 100, source: 'manual', timestamp: Date.parse('2020-10-11T08:00:00.000Z') },
  { date: '2020-10-13', totalAmount: 125, source: 'live-snapshot', eventNote: '调整分类，备注金额 888.88', channels: [{ id: 'cash', name: '现金', emoji: '💵', amount: 125, color: '#000', isParent: true, isExpanded: false }] },
];
const initial = useAppStore.getState();
let saveNote: Mock<typeof initial.setHistoryEventNote>;
let deletePoints: Mock<typeof initial.deleteHistoryPoints>;
let confirmEdit: Mock<typeof initial.confirmHistoryEdit>;

beforeEach(() => {
  saveNote = vi.fn<typeof initial.setHistoryEventNote>().mockResolvedValue(undefined);
  deletePoints = vi.fn<typeof initial.deleteHistoryPoints>();
  confirmEdit = vi.fn<typeof initial.confirmHistoryEdit>().mockResolvedValue(undefined);
  useWorkspaceStore.setState({ amountsHidden: false });
  useAppStore.setState({ history, hydrated: true, recoveryError: null, maintenanceLabel: null, setHistoryEventNote: saveNote, deleteHistoryPoints: deletePoints, confirmHistoryEdit: confirmEdit });
});

afterEach(() => {
  cleanup();
  useWorkspaceStore.setState({ amountsHidden: false });
  useAppStore.setState({ history: initial.history, hydrated: initial.hydrated, setHistoryEventNote: initial.setHistoryEventNote, deleteHistoryPoints: initial.deleteHistoryPoints, confirmHistoryEdit: initial.confirmHistoryEdit });
});

describe('history workspace', () => {
  it('shows daily source, composition coverage, preceding observation, and recorded time with a table alternative', () => {
    render(<HistoryPanel />);
    const latest = screen.getByRole('article', { name: '2020-10-13 历史记录' });
    expect(within(latest).getByText('实时快照')).toBeInTheDocument();
    expect(within(latest).getByText('构成一致')).toBeInTheDocument();
    expect(within(latest).getByText('增加 ¥25.00')).toBeInTheDocument();
    expect(within(latest).getByText('调整分类，备注金额 888.88')).toBeInTheDocument();
    expect(screen.getByText(/记录时间：/)).toBeInTheDocument();
    expect(screen.getByText('仅有总额')).toBeInTheDocument();
    expect(screen.getByText(/不构成现金流台账/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '数据表' }));
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '来源 / 覆盖' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '数据表' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('uses one filtered range for rows and links to the unified trend workspace', () => {
    render(<HistoryPanel />);
    fireEvent.change(screen.getByLabelText('起始日期'), { target: { value: '2020-10-13' } });
    expect(screen.queryByRole('article', { name: '2020-10-11 历史记录' })).not.toBeInTheDocument();
    expect(screen.getByText('增加 ¥25.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开资产历史趋势' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2020-10-12' } });
    expect(screen.getByRole('alert')).toHaveTextContent('起始日期不能晚于结束日期');
    expect(screen.getByRole('button', { name: '打开资产历史趋势' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(screen.getByRole('article', { name: '2020-10-11 历史记录' })).toBeInTheDocument();
  });

  it('keeps note edits local until explicit save and supplies the opening revision', async () => {
    render(<HistoryPanel />);
    const revision = useAppStore.getState().dataRevision;
    fireEvent.click(screen.getByRole('button', { name: '2020-10-13 编辑事件备注' }));
    const editor = screen.getByRole('textbox', { name: '事件备注' });
    fireEvent.change(editor, { target: { value: '  家庭计划调整  ' } });
    expect(saveNote).not.toHaveBeenCalled();
    expect(useAppStore.getState().history).toEqual(history);
    fireEvent.click(screen.getByRole('button', { name: '保存备注' }));
    await waitFor(() => expect(saveNote).toHaveBeenCalledWith('2020-10-13', '家庭计划调整', revision));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('protects unsaved notes on cancel and leaves original records unchanged after discard', () => {
    render(<HistoryPanel />);
    fireEvent.click(screen.getByRole('button', { name: '2020-10-11 添加事件备注' }));
    fireEvent.change(screen.getByRole('textbox', { name: '事件备注' }), { target: { value: '尚未保存的事件' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.getByRole('dialog', { name: '放弃未保存的备注？' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.getByRole('textbox', { name: '事件备注' })).toHaveValue('尚未保存的事件');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '放弃修改' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(saveNote).not.toHaveBeenCalled();
    expect(useAppStore.getState().history).toEqual(history);
  });

  it('retains the note draft and displays a stale-revision or save error', async () => {
    saveNote.mockRejectedValue(new Error('数据已变化，请关闭后重新编辑'));
    render(<HistoryPanel />);
    fireEvent.click(screen.getByRole('button', { name: '2020-10-11 添加事件备注' }));
    fireEvent.change(screen.getByRole('textbox', { name: '事件备注' }), { target: { value: '保留我的草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '保存备注' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('数据已变化');
    expect(screen.getByRole('textbox', { name: '事件备注' })).toHaveValue('保留我的草稿');
  });

  it('hides note text and totals and closes an open note editor when privacy turns on', () => {
    render(<HistoryPanel />);
    fireEvent.click(screen.getByRole('button', { name: '2020-10-13 编辑事件备注' }));
    act(() => useWorkspaceStore.setState({ amountsHidden: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/888\.88/)).not.toBeInTheDocument();
    expect(screen.queryByText(/125\.00|100\.00|25\.00/)).not.toBeInTheDocument();
    expect(screen.getByText('事件备注已隐藏')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2020-10-13 编辑事件备注' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '数据表' }));
    expect(screen.queryByText(/888\.88|125\.00/)).not.toBeInTheDocument();
    expect(saveNote).not.toHaveBeenCalled();
  });

  it('requires confirmation before deleting a history record and its note', () => {
    render(<HistoryPanel />);
    fireEvent.click(screen.getByRole('button', { name: '2020-10-13 删除历史记录' }));
    expect(deletePoints).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '删除历史记录' })).toHaveTextContent('事件备注也会移除');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(deletePoints).not.toHaveBeenCalled();
  });

  it('previews an occupied date move and submits one proposal only after explicit overwrite', async () => {
    render(<HistoryPanel />);
    fireEvent.click(screen.getByRole('button', { name: '2020-10-13 编辑历史记录' }));
    fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2020-10-11' } });
    fireEvent.change(screen.getByLabelText('总资产'), { target: { value: '1,234.56' } });
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }));
    const preview = screen.getByRole('dialog', { name: '确认历史变更' });
    expect(preview).toHaveTextContent('原日期记录将在同一次保存中移除');
    expect(preview).toHaveTextContent('原渠道构成将移除');
    expect(preview).toHaveTextContent('目标日期已有');
    expect(confirmEdit).not.toHaveBeenCalled();
    expect(useAppStore.getState().history).toEqual(history);
    fireEvent.click(within(preview).getByRole('button', { name: '确认覆盖并保存' }));
    await waitFor(() => expect(confirmEdit).toHaveBeenCalledTimes(1));
    expect(confirmEdit).toHaveBeenCalledWith(expect.objectContaining({ command: { sourceDate: '2020-10-13', date: '2020-10-11', totalAmount: 1234.56 } }), true);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('retains a failed preview and prevents a stale editor from preparing a write', async () => {
    confirmEdit.mockRejectedValue(new Error('备份不可用，请重试'));
    render(<HistoryPanel />);
    fireEvent.click(screen.getByRole('button', { name: '2020-10-13 编辑历史记录' }));
    fireEvent.change(screen.getByLabelText('总资产'), { target: { value: '126' } });
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }));
    fireEvent.click(screen.getByRole('button', { name: '确认保存' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: '确认历史变更' })).toHaveTextContent('备份不可用'));
    fireEvent.click(screen.getByRole('button', { name: '返回编辑' }));
    act(() => useAppStore.setState({ history: [...history, { date: '2020-10-14', totalAmount: 200 }] }));
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }));
    expect(screen.getByRole('dialog', { name: '编辑历史记录' })).toHaveTextContent('数据已变化');
    expect(screen.queryByRole('dialog', { name: '确认历史变更' })).not.toBeInTheDocument();
  });

  it('discards a preview without committing and clears it when privacy is enabled', () => {
    render(<HistoryPanel />);
    fireEvent.click(screen.getByRole('button', { name: '2020-10-13 编辑历史记录' }));
    fireEvent.change(screen.getByLabelText('总资产'), { target: { value: '126' } });
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }));
    fireEvent.click(screen.getByRole('button', { name: '返回编辑' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.getByRole('dialog', { name: '放弃未保存的历史变更？' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }));
    act(() => useWorkspaceStore.setState({ amountsHidden: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(confirmEdit).not.toHaveBeenCalled();
  });
});
