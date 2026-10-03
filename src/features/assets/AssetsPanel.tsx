import React, { useMemo, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import type { Channel, CustomSortRule, SubChannel } from '../../types';
import { sortChannels, sortChannelsByRule, sortChannelsMulti, totalAssets } from '../../utils/channels';
import { formatCNY } from '../../utils/money';
import { getLevelByAmount, WEALTH_LEVELS } from '../../constants/levels';
import { Button, Card, Badge, ProgressBar, EmptyState } from '../../components/ui/primitives';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { TextField, SelectField } from '../../components/ui/form';
import { ChannelItem, type AmountTarget, type ChannelHandlers } from './ChannelItem';
import { ChannelFormModal, SubChannelFormModal, AmountModal } from './channelModals';

type SortConfig =
  | { mode: 'default' }
  | { mode: 'single'; ruleId: string }
  | { mode: 'multi'; ruleIds: string[] };

export function AssetsPanel() {
  const channels = useAppStore((s) => s.channels);
  const sortRules = useAppStore((s) => s.sortRules);
  const {
    addParentChannel,
    updateParentChannel,
    deleteParentChannel,
    toggleChannel,
    addSubChannel,
    updateSubChannelInfo,
    deleteSubChannel,
    setAmount,
    addSortRule,
    deleteSortRule,
    recordSortHistory,
  } = useAppStore();

  const [sortConfig, setSortConfig] = useState<SortConfig>({ mode: 'default' });
  const [multiOpen, setMultiOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  // 渠道表单
  const [channelForm, setChannelForm] = useState<{ open: boolean; editing: Channel | null }>({ open: false, editing: null });
  // 子渠道表单
  const [subForm, setSubForm] = useState<{ open: boolean; parentId: string; editing: SubChannel | null }>({ open: false, parentId: '', editing: null });
  // 金额表单
  const [amountForm, setAmountForm] = useState<{ open: boolean; target: AmountTarget; current: number; label: string }>({ open: false, target: { parentId: '' }, current: 0, label: '' });
  // 删除确认
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void }>({ open: false, title: '', message: '', onConfirm: () => {} });

  const total = totalAssets(channels);
  const level = getLevelByAmount(total);

  const sortedChannels = useMemo(() => {
    if (sortConfig.mode === 'single') {
      const rule = sortRules.find((r) => r.id === sortConfig.ruleId);
      if (rule) return sortChannelsByRule(channels, rule, { totalAmount: total });
    }
    if (sortConfig.mode === 'multi') {
      const rules = sortConfig.ruleIds
        .map((id) => sortRules.find((r) => r.id === id))
        .filter((r): r is CustomSortRule => !!r);
      if (rules.length) return sortChannelsMulti(channels, rules, { totalAmount: total });
    }
    return sortChannels(channels);
  }, [channels, sortConfig, sortRules, total]);

  function applySingle(ruleId: string) {
    const rule = sortRules.find((r) => r.id === ruleId);
    if (!rule) {
      setSortConfig({ mode: 'default' });
      return;
    }
    setSortConfig({ mode: 'single', ruleId });
    recordSortHistory(rule.key, rule.label);
  }

  const handlers: ChannelHandlers = {
    onToggle: toggleChannel,
    onEditChannel: (c) => setChannelForm({ open: true, editing: c }),
    onDeleteChannel: (c) =>
      setDeleteConfirm({
        open: true,
        title: '删除渠道',
        message: `确定删除「${c.name}」吗？${c.children?.length ? `其 ${c.children.length} 个子渠道也会一并删除。` : ''}此操作无法撤销。`,
        onConfirm: () => {
          deleteParentChannel(c.id);
          setDeleteConfirm((s) => ({ ...s, open: false }));
        },
      }),
    onAddSub: (parentId) => setSubForm({ open: true, parentId, editing: null }),
    onEditSub: (parentId, sub) => setSubForm({ open: true, parentId, editing: sub }),
    onDeleteSub: (parentId, sub) =>
      setDeleteConfirm({
        open: true,
        title: '删除子渠道',
        message: `确定删除子渠道「${sub.name}」吗？此操作无法撤销。`,
        onConfirm: () => {
          deleteSubChannel(parentId, sub.id);
          setDeleteConfirm((s) => ({ ...s, open: false }));
        },
      }),
    onEditAmount: (target, current, label) =>
      setAmountForm({ open: true, target, current, label }),
  };

  const nextLevel = WEALTH_LEVELS.find((l) => l.minAmount > total);
  const levelProgress = nextLevel
    ? Math.min(100, ((total - level.minAmount) / (nextLevel.minAmount - level.minAmount)) * 100)
    : 100;

  return (
    <div className="space-y-4">
      {/* 财富等级进度卡 */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-2xl" aria-hidden>{level.badge}</span>
            <div>
              <div className="font-semibold text-slate-800">{level.name}</div>
              <div className="text-xs text-slate-500">{level.description}</div>
            </div>
          </div>
          {nextLevel ? (
            <div className="text-right">
              <div className="text-xs text-slate-400">距 {nextLevel.name}</div>
              <div className="text-sm font-semibold text-slate-700 tabular">{formatCNY(nextLevel.minAmount - total)}</div>
            </div>
          ) : (
            <Badge tone="amber">🏆 已达最高等级</Badge>
          )}
        </div>
        <ProgressBar value={levelProgress} barClassName="bg-gradient-to-r from-emerald-400 to-emerald-600" />
        <div className="mt-1 text-xs text-slate-400 flex justify-between tabular">
          <span>{formatCNY(level.minAmount)}</span>
          <span>{nextLevel ? formatCNY(nextLevel.minAmount) : '∞'}</span>
        </div>
      </Card>

      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <label className="text-sm text-slate-500 shrink-0">排序</label>
          <select
            className="flex-1 px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
            value={sortConfig.mode === 'single' ? sortConfig.ruleId : 'default'}
            onChange={(e) => applySingle(e.target.value)}
            aria-label="排序方式"
          >
            <option value="default">默认（金额从高到低）</option>
            {sortRules.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <Button variant="outline" size="sm" onClick={() => setMultiOpen(true)}>
          ⇶ 多维排序
        </Button>
        <Button variant="outline" size="sm" onClick={() => setRulesOpen(true)}>
          ⚙ 排序规则
        </Button>
        <Button size="sm" onClick={() => setChannelForm({ open: true, editing: null })}>
          ＋ 添加渠道
        </Button>
      </div>

      {/* 渠道列表 */}
      {sortedChannels.length === 0 ? (
        <Card>
          <EmptyState
            icon="🏦"
            title="还没有资产渠道"
            description="点击「添加渠道」开始记录你的第一笔资产。"
            action={<Button onClick={() => setChannelForm({ open: true, editing: null })}>添加渠道</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {sortedChannels.map((c) => (
            <ChannelItem key={c.id} channel={c} handlers={handlers} />
          ))}
        </div>
      )}

      {/* 表单弹窗 */}
      <ChannelFormModal
        open={channelForm.open}
        initial={channelForm.editing}
        onClose={() => setChannelForm({ open: false, editing: null })}
        onSubmit={(data) => {
          if (channelForm.editing) updateParentChannel(channelForm.editing.id, data);
          else addParentChannel(data.name, data.emoji, data.color);
        }}
      />
      <SubChannelFormModal
        open={subForm.open}
        initial={subForm.editing}
        onClose={() => setSubForm({ open: false, parentId: '', editing: null })}
        onSubmit={(data) => {
          if (subForm.editing) updateSubChannelInfo(subForm.parentId, subForm.editing.id, data);
          else addSubChannel(subForm.parentId, data.name, data.emoji, data.color);
        }}
      />
      <AmountModal
        open={amountForm.open}
        title={`编辑金额 · ${amountForm.label}`}
        current={amountForm.current}
        onClose={() => setAmountForm((s) => ({ ...s, open: false }))}
        onSubmit={(amount) => setAmount(amountForm.target, amount)}
      />
      <ConfirmDialog
        open={deleteConfirm.open}
        title={deleteConfirm.title}
        message={deleteConfirm.message}
        onCancel={() => setDeleteConfirm((s) => ({ ...s, open: false }))}
        onConfirm={deleteConfirm.onConfirm}
      />

      <MultiSortModal
        open={multiOpen}
        sortRules={sortRules}
        initialIds={sortConfig.mode === 'multi' ? sortConfig.ruleIds : []}
        onClose={() => setMultiOpen(false)}
        onApply={(ids) => {
          setSortConfig(ids.length ? { mode: 'multi', ruleIds: ids } : { mode: 'default' });
          setMultiOpen(false);
        }}
      />
      <RulesModal
        open={rulesOpen}
        sortRules={sortRules}
        onClose={() => setRulesOpen(false)}
        onAdd={(rule) => addSortRule(rule)}
        onDelete={deleteSortRule}
      />
    </div>
  );
}

function MultiSortModal({
  open,
  sortRules,
  initialIds,
  onClose,
  onApply,
}: {
  open: boolean;
  sortRules: CustomSortRule[];
  initialIds: string[];
  onClose: () => void;
  onApply: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(initialIds);
  React.useEffect(() => setSelected(initialIds), [initialIds, open]);

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="多维排序"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={() => onApply(selected)}>应用</Button>
        </>
      }
    >
      <p className="text-sm text-slate-500 mb-3">勾选多个规则，按顺序依次作为排序键。</p>
      <div className="space-y-1.5 max-h-80 overflow-y-auto">
        {sortRules.map((r) => (
          <label key={r.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.includes(r.id)}
              onChange={() => toggle(r.id)}
              className="h-4 w-4 text-emerald-600 rounded"
            />
            <span className="text-sm text-slate-700">{r.label}</span>
          </label>
        ))}
      </div>
    </Modal>
  );
}

function RulesModal({
  open,
  sortRules,
  onClose,
  onAdd,
  onDelete,
}: {
  open: boolean;
  sortRules: CustomSortRule[];
  onClose: () => void;
  onAdd: (rule: Omit<CustomSortRule, 'id' | 'createdAt'>) => void;
  onDelete: (id: string) => void;
}) {
  const [label, setLabel] = useState('');
  const [field, setField] = useState('amount');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [error, setError] = useState('');

  function add() {
    const trimmed = label.trim();
    if (!trimmed) {
      setError('请输入规则名称');
      return;
    }
    onAdd({
      key: `custom_${Date.now().toString(36)}`,
      label: trimmed,
      field,
      direction,
      category: '自定义',
      tags: [],
    });
    setLabel('');
    setError('');
  }

  return (
    <Modal open={open} onClose={onClose} title="排序规则管理" size="md">
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <TextField label="规则名称" value={label} onChange={(e) => setLabel(e.target.value)} error={error} placeholder="例如：按更新时间" />
            <SelectField
              label="方向"
              value={direction}
              onChange={(e) => setDirection(e.target.value as 'asc' | 'desc')}
              options={[
                { value: 'desc', label: '从高到低' },
                { value: 'asc', label: '从低到高' },
              ]}
            />
          </div>
          <SelectField
            label="排序字段"
            value={field}
            onChange={(e) => setField(e.target.value)}
            options={[
              { value: 'amount', label: '金额' },
              { value: 'name', label: '名称' },
              { value: 'percentage', label: '占比' },
              { value: 'children', label: '子渠道数量' },
              { value: 'updatedAt', label: '最近更新' },
              { value: 'growth', label: '增长率' },
            ]}
          />
          <Button size="sm" onClick={add}>添加规则</Button>
        </div>

        <div className="border-t border-slate-100 pt-3">
          <div className="text-sm font-medium text-slate-700 mb-2">现有规则</div>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {sortRules.map((r) => (
              <div key={r.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50">
                <span className="text-sm text-slate-700 flex-1 truncate">{r.label}</span>
                {r.isSystem ? (
                  <Badge tone="slate">系统</Badge>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => onDelete(r.id)} className="text-red-500">
                    删除
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
