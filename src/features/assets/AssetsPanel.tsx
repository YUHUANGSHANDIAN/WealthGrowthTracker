import React, { useMemo, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import type { Channel, CustomSortRule, SubChannel } from '../../types';
import { sortChannels, sortChannelsByRule, sortChannelsMulti, totalAssets } from '../../utils/channels';
import { computeChannelGrowths, sortChannelsSmart } from '../../utils/smartSort';
import { Button, Card, Badge, EmptyState } from '../../components/ui/primitives';
import { WealthHeroCard } from '../dashboard/WealthHeroCard';
import { LevelExplorer } from '../levels/LevelExplorer';
import { Modal, ConfirmDialog } from '../../components/ui/Modal';
import { TextField, SelectField } from '../../components/ui/form';
import { ChannelItem, type AmountTarget, type ChannelHandlers } from './ChannelItem';
import { ChannelFormModal, SubChannelFormModal, AmountModal, FirstChildModal, LastChildModal } from './channelModals';
import { AmountBatchModal } from './AmountBatchModal';
import { AIActionButton } from '../ai/AIActionButton';
import type { FirstChildStrategy, LastChildStrategy } from '../../utils/channels';
import type { ChannelGrowth } from '../../types';
import { HoldingClassificationPanel } from './HoldingClassificationPanel';
import { useNavigationStore } from '../../store/navigationStore';
import { FilterBar, MetricCard, PageHeader, SavedViewBar } from '../../components/ui/workspace';
import { projectMonthlyPlanningClassification, type AssetClassificationState } from '../../domain/assets/classification';
import type { MonthlyPlanningState } from '../../domain/portfolio/types';
import { formatCNY } from '../../utils/money';

type SortConfig =
  | { mode: 'default' }
  | { mode: 'smart' }
  | { mode: 'single'; ruleId: string }
  | { mode: 'multi'; ruleIds: string[] };

type SubSort = { field: 'amount' | 'name' | 'g7d' | 'g30d' | 'g90d' | 'g365d'; direction: 'asc' | 'desc' };

/** 子渠道排序（金额/名称/各周期增长）。 */
function sortSubChildren(children: SubChannel[], sort: SubSort, growths: Map<string, ChannelGrowth>): SubChannel[] {
  const dir = sort.direction === 'asc' ? 1 : -1;
  const value = (s: SubChannel): number | string | null => {
    switch (sort.field) {
      case 'name':
        return s.name;
      case 'g7d':
      case 'g30d':
      case 'g90d':
      case 'g365d':
        return growths.get(s.id)?.[sort.field] ?? null;
      case 'amount':
      default:
        return s.amount;
    }
  };
  return [...children].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === 'string' && typeof vb === 'string') return dir * va.localeCompare(vb, 'zh');
    if (typeof va === 'number' && typeof vb === 'number') return dir * (va - vb);
    return 0;
  });
}

export function AssetsPanel() {
  const channels = useAppStore((s) => s.channels);
  const assetClassification = useAppStore((s) => s.assetClassification);
  const monthlyPlanning = useAppStore((s) => s.monthlyPlanning);
  const history = useAppStore((s) => s.history);
  const sortRules = useAppStore((s) => s.sortRules);
  const pinnedChannelIds = useAppStore((s) => s.pinnedChannelIds);
  const smartSortConfig = useAppStore((s) => s.smartSortConfig);
  const activeSortKey = useAppStore((s) => s.activeSortKey);
  const {
    addParentChannel,
    updateParentChannel,
    setChannelArchived,
    deleteParentChannel,
    toggleChannel,
    addSubChannel,
    updateSubChannelInfo,
    deleteSubChannel,
    setAmount,
    prepareAmountBatch,
    confirmAmountBatch,
    addSortRule,
    deleteSortRule,
    recordSortHistory,
    setActiveSortKey,
    togglePinChannel,
    setSmartSortConfig,
  } = useAppStore();
  const navigate = useNavigationStore((state) => state.navigate);
  const routeChannelId = useNavigationStore((state) => state.channelId);
  const routeAssetView = useNavigationStore((state) => state.assetView);
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(true);

  const [sortConfig, setSortConfig] = useState<SortConfig>(
    activeSortKey === 'smart' ? { mode: 'smart' } : activeSortKey === 'default' ? { mode: 'default' } : { mode: 'single', ruleId: activeSortKey },
  );
  const [multiOpen, setMultiOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [levelExplorerOpen, setLevelExplorerOpen] = useState(false);
  const [amountBatchOpen, setAmountBatchOpen] = useState(false);
  const [subSort, setSubSort] = useState<{ field: 'amount' | 'name' | 'g7d' | 'g30d' | 'g90d' | 'g365d'; direction: 'asc' | 'desc' }>({ field: 'amount', direction: 'desc' });

  // 渠道表单
  const [channelForm, setChannelForm] = useState<{ open: boolean; editing: Channel | null }>({ open: false, editing: null });
  // 子渠道表单
  const [subForm, setSubForm] = useState<{ open: boolean; parentId: string; editing: SubChannel | null }>({ open: false, parentId: '', editing: null });
  // 金额表单
  const [amountForm, setAmountForm] = useState<{ open: boolean; target: AmountTarget; current: number; label: string }>({ open: false, target: { parentId: '' }, current: 0, label: '' });
  // 首个子渠道（父渠道已有直接金额时）
  const [firstChild, setFirstChild] = useState<{ open: boolean; parent: Channel | null }>({ open: false, parent: null });
  // 删除最后一个子渠道
  const [lastChild, setLastChild] = useState<{ open: boolean; parentId: string; childId: string; parentName: string; childName: string; childAmount: number }>({ open: false, parentId: '', childId: '', parentName: '', childName: '', childAmount: 0 });
  // 删除确认
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void }>({ open: false, title: '', message: '', onConfirm: () => {} });

  const total = totalAssets(channels);
  const assetView = routeAssetView ?? 'balances';

  const growths = useMemo(() => computeChannelGrowths(history, channels), [history, channels]);
  const growthByChannel = useMemo(() => {
    const m = new Map<string, number>();
    for (const [id, g] of growths) m.set(id, g.g30d ?? -Infinity);
    return m;
  }, [growths]);
  const pinned = useMemo(() => new Set(pinnedChannelIds), [pinnedChannelIds]);

  const sortedChannels = useMemo(() => {
    let base: Channel[];
    const source = channels.filter((channel) => {
      if (!showArchived && channel.archived) return false;
      const needle = query.trim().toLowerCase();
      if (!needle) return true;
      return `${channel.name} ${channel.emoji} ${(channel.children ?? []).map((child) => child.name).join(' ')}`.toLowerCase().includes(needle);
    });
    if (sortConfig.mode === 'single') {
      const rule = sortRules.find((r) => r.id === sortConfig.ruleId);
      base = rule ? sortChannelsByRule(source, rule, { totalAmount: total, growthByChannel }) : sortChannels(source);
    } else if (sortConfig.mode === 'multi') {
      const rules = sortConfig.ruleIds
        .map((id) => sortRules.find((r) => r.id === id))
        .filter((r): r is CustomSortRule => !!r);
      base = rules.length ? sortChannelsMulti(source, rules, { totalAmount: total, growthByChannel }) : sortChannels(source);
    } else if (sortConfig.mode === 'smart') {
      const order = sortChannelsSmart(source, growths, total, new Set(), smartSortConfig);
      const orderMap = new Map(order.map((o, i) => [o.id, i]));
      base = [...source].sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
    } else {
      base = sortChannels(source);
    }
    // 子渠道排序
    const withSortedChildren = base.map((c) =>
      c.children && c.children.length > 0 ? { ...c, children: sortSubChildren(c.children, subSort, growths) } : c,
    );
    if (pinned.size === 0) return withSortedChildren;
    return [...withSortedChildren].sort((a, b) => (pinned.has(a.id) ? 0 : 1) - (pinned.has(b.id) ? 0 : 1));
  }, [channels, query, showArchived, sortConfig, sortRules, total, growthByChannel, growths, pinned, smartSortConfig, subSort]);

  function applySingle(ruleId: string) {
    if (ruleId === 'smart') {
      setSortConfig({ mode: 'smart' });
      setActiveSortKey('smart');
      return;
    }
    if (ruleId === 'default') {
      setSortConfig({ mode: 'default' });
      setActiveSortKey('default');
      return;
    }
    const rule = sortRules.find((r) => r.id === ruleId);
    if (!rule) {
      setSortConfig({ mode: 'default' });
      setActiveSortKey('default');
      return;
    }
    setSortConfig({ mode: 'single', ruleId });
    setActiveSortKey(ruleId);
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
    onAddSub: (parentId) => {
      const parent = channels.find((c) => c.id === parentId);
      if (parent && (parent.children?.length ?? 0) === 0 && parent.amount > 0) {
        setFirstChild({ open: true, parent });
      } else {
        setSubForm({ open: true, parentId, editing: null });
      }
    },
    onEditSub: (parentId, sub) => setSubForm({ open: true, parentId, editing: sub }),
    onDeleteSub: (parentId, sub) => {
      const parent = channels.find((c) => c.id === parentId);
      const isLast = (parent?.children?.length ?? 0) <= 1;
      if (isLast && sub.amount > 0) {
        setLastChild({ open: true, parentId, childId: sub.id, parentName: parent?.name ?? '', childName: sub.name, childAmount: sub.amount });
      } else {
        setDeleteConfirm({
          open: true,
          title: '删除子渠道',
          message: `确定删除子渠道「${sub.name}」吗？此操作无法撤销。`,
          onConfirm: () => {
            deleteSubChannel(parentId, sub.id);
            setDeleteConfirm((s) => ({ ...s, open: false }));
          },
        });
      }
    },
    onEditAmount: (target, current, label) =>
      setAmountForm({ open: true, target, current, label }),
    onTogglePin: togglePinChannel,
    onToggleArchive: (channel) => {
      setChannelArchived(channel.id, !channel.archived);
    },
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="权威资产账本"
        title="渠道余额与持仓证据"
        description="渠道余额决定总资产；任务中的持仓观察用于产品、风险与证据治理，不会被当作实时余额二次汇总。"
        context={<><span>{channels.length} 个父渠道</span><span>·</span><span>{channels.reduce((sum, channel) => sum + (channel.children?.length ?? 0), 0)} 个子渠道</span></>}
        primaryAction={<Button onClick={() => setAmountBatchOpen(true)}>批量更新金额</Button>}
        secondaryActions={<Button variant="outline" onClick={() => setChannelForm({ open: true, editing: null })}>添加渠道</Button>}
      />
      {/* 财富 Dashboard */}
      <WealthHeroCard onOpenLevels={() => setLevelExplorerOpen(true)} />

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          label="当前权威总资产"
          value={formatCNY(total)}
          detail="父渠道余额汇总，归档渠道仍计入"
          tone="accent"
          context={{ basis: '当前渠道余额', status: 'confirmed', scope: '全部父渠道，含归档余额' }}
        />
        <MetricCard label="当前渠道" value={`${channels.filter((channel) => !channel.archived).length} 个`} detail={`${channels.filter((channel) => channel.archived).length} 个已归档`} context={{ basis: '渠道结构', status: 'confirmed' }} />
        <MetricCard label="金额口径" value="当前余额" detail="不是任务观察值，也不是投资收益" tone="unknown" context={{ basis: '余额与观察值分离', status: 'confirmed' }} />
      </div>

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="资产视图">
        {([['balances', '渠道余额'], ['holdings', '历史持仓观察'], ['risk', '产品与风险敞口']] as const).map(([view, label]) => (
          <button key={view} type="button" role="tab" aria-selected={assetView === view} className="trend-view-tab" onClick={() => navigate({ tab: 'assets', assetView: view, channelId: routeChannelId })}>{label}</button>
        ))}
      </div>
      <SavedViewBar
        page="assets"
        tab="assets"
        filters={{ query, showArchived, assetView }}
        onApply={(filters) => {
          setQuery(typeof filters.query === 'string' ? filters.query : '');
          setShowArchived(typeof filters.showArchived === 'boolean' ? filters.showArchived : true);
        }}
        routeForFilters={(filters) => ({
          assetView: filters.assetView === 'holdings' || filters.assetView === 'risk' ? filters.assetView : 'balances',
        })}
      />

      {assetView === 'balances' && <>
      <FilterBar
        resultCount={sortedChannels.length}
      >
        <label className="text-xs text-slate-500">搜索渠道
          <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" placeholder="名称、Emoji 或子渠道" aria-label="搜索资产渠道" />
        </label>
        <label className="trend-check"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />显示已归档</label>
      </FilterBar>

      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <label className="text-sm text-slate-500 shrink-0">排序</label>
          <select
            className="flex-1 px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
            value={sortConfig.mode === 'single' ? sortConfig.ruleId : sortConfig.mode}
            onChange={(e) => applySingle(e.target.value)}
            aria-label="排序方式"
          >
            <option value="default">默认（金额从高到低）</option>
            <option value="smart">✨ 智能综合排序</option>
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
        <AIActionButton task="entry-draft">AI 余额录入草稿</AIActionButton>
        {sortConfig.mode === 'smart' && (
          <select
            value={smartSortConfig.timeRange ?? '30d'}
            onChange={(e) => setSmartSortConfig({ ...smartSortConfig, timeRange: e.target.value as typeof smartSortConfig.timeRange })}
            className="px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
            aria-label="智能排序增长时间范围"
          >
            <option value="7d">近 7 天增长</option>
            <option value="30d">近 30 天增长</option>
            <option value="90d">近 90 天增长</option>
            <option value="365d">近 1 年增长</option>
          </select>
        )}
        <select
          value={subSort.field}
          onChange={(e) => setSubSort((s) => ({ ...s, field: e.target.value as SubSort['field'] }))}
          className="px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
          aria-label="子渠道排序"
          title="子渠道排序"
        >
          <option value="amount">子渠道：金额↓</option>
          <option value="name">子渠道：名称</option>
          <option value="g7d">子渠道：近7天增长</option>
          <option value="g30d">子渠道：近30天增长</option>
          <option value="g90d">子渠道：近90天增长</option>
          <option value="g365d">子渠道：近1年增长</option>
        </select>
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
            <ChannelItem key={c.id} channel={c} handlers={handlers} isPinned={pinned.has(c.id)} isHighlighted={routeChannelId === c.id || (c.children ?? []).some((child) => child.id === routeChannelId)} classifications={assetClassification} />
          ))}
        </div>
      )}
      </>}
      {assetView === 'holdings' && <HoldingClassificationPanel />}
      {assetView === 'risk' && <AssetRiskOverview planning={monthlyPlanning} classifications={assetClassification} />}

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
      {amountBatchOpen && (
        <AmountBatchModal
          channels={channels}
          onClose={() => setAmountBatchOpen(false)}
          onPrepare={prepareAmountBatch}
          onConfirm={confirmAmountBatch}
        />
      )}
      <ConfirmDialog
        open={deleteConfirm.open}
        title={deleteConfirm.title}
        message={deleteConfirm.message}
        onCancel={() => setDeleteConfirm((s) => ({ ...s, open: false }))}
        onConfirm={deleteConfirm.onConfirm}
      />
      {firstChild.parent && (
        <FirstChildModal
          open={firstChild.open}
          parent={firstChild.parent}
          totalAssets={total}
          onClose={() => setFirstChild({ open: false, parent: null })}
          onSubmit={(data) => {
            addSubChannel(firstChild.parent!.id, data.name, data.emoji, data.color, data.strategy as FirstChildStrategy);
          }}
        />
      )}
      <LastChildModal
        open={lastChild.open}
        parentName={lastChild.parentName}
        childName={lastChild.childName}
        childAmount={lastChild.childAmount}
        totalAssets={total}
        onClose={() => setLastChild((s) => ({ ...s, open: false }))}
        onSubmit={(strategy: LastChildStrategy) => deleteSubChannel(lastChild.parentId, lastChild.childId, strategy)}
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
      <LevelExplorer open={levelExplorerOpen} onClose={() => setLevelExplorerOpen(false)} />
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

function AssetRiskOverview({
  planning,
  classifications,
}: {
  planning: MonthlyPlanningState;
  classifications: AssetClassificationState;
}) {
  const projected = useMemo(
    () => projectMonthlyPlanningClassification(planning, classifications),
    [classifications, planning],
  );
  const exposures = useMemo(() => {
    const totals = new Map<string, number>();
    const unmapped: string[] = [];
    for (const task of projected.sessions) {
      const values = new Map(task.observations.map((observation) => [observation.holdingId, observation.marketValue]));
      for (const holding of task.holdings) {
        const value = values.get(holding.id);
        if (value === null || value === undefined) {
          unmapped.push(holding.originalName);
          continue;
        }
        for (const tag of holding.exposureTags) totals.set(tag, (totals.get(tag) ?? 0) + value);
      }
    }
    return {
      rows: [...totals.entries()].sort((a, b) => b[1] - a[1]),
      unmapped,
    };
  }, [projected.sessions]);

  if (exposures.rows.length === 0 && exposures.unmapped.length === 0) {
    return <Card><EmptyState title="暂无历史持仓观察" description="导入或建立理财任务后，这里显示产品与风险敞口；不会用渠道余额推算持仓。" /></Card>;
  }
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
        风险敞口来自任务观察值，可能存在重叠，不构成互斥的 100% 构成图；观察日不同的数据不会直接合并成实时持仓。
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {exposures.rows.map(([tag, value]) => <MetricCard key={tag} label={`${tag} 敞口`} value={formatCNY(value)} detail="任务观察值合计；可能与其他标签重叠" tone={tag === 'gold' ? 'warning' : 'neutral'} />)}
      </div>
      {exposures.unmapped.length > 0 && (
        <Card className="p-4">
          <h3 className="font-semibold">金额未知的观察</h3>
          <p className="mt-1 text-sm text-slate-500">{exposures.unmapped.length} 条持仓没有可用市值，未按 0 处理。</p>
        </Card>
      )}
    </div>
  );
}
