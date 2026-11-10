import React from 'react';
import type { Channel, SubChannel } from '../../types';
import { channelAmount } from '../../utils/channels';
import { formatCNY } from '../../utils/money';
import { classificationForChannel, productClassifications, type AssetClassificationState } from '../../domain/assets/classification';

export interface AmountTarget {
  parentId: string;
  childId?: string;
}

export interface ChannelHandlers {
  onToggle: (id: string) => void;
  onEditChannel: (c: Channel) => void;
  onDeleteChannel: (c: Channel) => void;
  onAddSub: (parentId: string) => void;
  onEditSub: (parentId: string, sub: SubChannel) => void;
  onDeleteSub: (parentId: string, sub: SubChannel) => void;
  onEditAmount: (target: AmountTarget, current: number, label: string) => void;
  onTogglePin: (id: string) => void;
  onToggleArchive: (channel: Channel) => void;
}

function ActionButton({
  label,
  onClick,
  children,
  tone = 'slate',
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  tone?: 'slate' | 'red';
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
      className={`h-7 px-2 inline-flex items-center gap-1 text-xs rounded-md transition-colors ${
        tone === 'red'
          ? 'text-red-500 hover:bg-red-50'
          : 'text-slate-500 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}

function productKindLabel(value: string): string {
  if (value === 'fund-etf-feeder') return 'ETF 联接基金';
  if (value === 'bank-gold-accumulation') return '银行黄金积存';
  if (value === 'fund-other') return '基金';
  if (value === 'cash') return '现金';
  if (value === 'fixed-income') return '固收';
  return '分类待核对';
}

export function ChannelItem({
  channel,
  handlers,
  isPinned = false,
  isHighlighted = false,
  classifications,
}: {
  channel: Channel;
  handlers: ChannelHandlers;
  isPinned?: boolean;
  isHighlighted?: boolean;
  classifications: AssetClassificationState;
}) {
  const amount = channelAmount(channel);
  const children = channel.children ?? [];
  const hasChildren = children.length > 0;

  return (
    <div className={`border rounded-xl bg-white overflow-hidden ${isHighlighted ? 'ring-2 ring-emerald-500 ring-offset-2' : ''} ${channel.archived ? 'border-slate-300 opacity-80' : 'border-slate-200'}`}>
      {/* 父渠道行 */}
      <div
        className="flex items-center gap-2 px-3 py-3 cursor-pointer hover:bg-slate-50/70 transition-colors"
        onClick={() => handlers.onToggle(channel.id)}
        role="button"
        aria-expanded={channel.isExpanded}
      >
        <span
          className="h-9 w-9 shrink-0 rounded-lg flex items-center justify-center text-lg"
          style={{ background: `${channel.color}1a` }}
          aria-hidden
        >
          {channel.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-800 truncate">{channel.name}</span>
            {channel.archived && <span className="text-[11px] text-slate-500 shrink-0">已归档，余额仍计入</span>}
            {hasChildren && (
              <span className="text-[11px] text-slate-500 shrink-0">{children.length} 个子渠道</span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-semibold text-slate-800 tabular">{formatCNY(amount)}</div>
        </div>
        <span
          className="text-slate-300 transition-transform shrink-0"
          style={{ transform: channel.isExpanded ? 'rotate(180deg)' : undefined }}
          aria-hidden
        >
          ▾
        </span>
      </div>

      {/* 操作栏：任何父渠道都始终提供「＋ 子渠道」；无子渠道时额外提供「¥ 金额」 */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-t border-slate-100 bg-slate-50/50">
        <ActionButton label="添加子渠道" onClick={() => handlers.onAddSub(channel.id)}>
          ＋ 子渠道
        </ActionButton>
        {!hasChildren && (
          <ActionButton label="设置金额" onClick={() => handlers.onEditAmount({ parentId: channel.id }, channel.amount, channel.name)}>
            ¥ 金额
          </ActionButton>
        )}
        <ActionButton label="编辑渠道" onClick={() => handlers.onEditChannel(channel)}>
          ✏️ 编辑
        </ActionButton>
        <ActionButton label={isPinned ? '取消置顶' : '置顶'} onClick={() => handlers.onTogglePin(channel.id)}>
          {isPinned ? '📌 已置顶' : '📍 置顶'}
        </ActionButton>
        <ActionButton label={channel.archived ? '恢复渠道' : '归档渠道'} onClick={() => handlers.onToggleArchive(channel)}>
          {channel.archived ? '↩ 恢复' : '🗃 归档'}
        </ActionButton>
        <div className="flex-1" />
        <ActionButton label="删除渠道" onClick={() => handlers.onDeleteChannel(channel)} tone="red">
          🗑️ 删除
        </ActionButton>
      </div>

      {/* 子渠道列表 */}
      {channel.isExpanded && (
        <div className="border-t border-slate-100 divide-y divide-slate-50">
          {hasChildren ? (
            children.map((sub) => (
              <div key={sub.id} className="flex items-center gap-2 px-4 py-2.5 hover:bg-slate-50/70">
                <span className="text-base" aria-hidden>
                  {sub.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-700">{sub.name}</span>
                  {(classificationForChannel(classifications, sub.id) || productClassifications(classifications, sub.id).length > 0) && (
                    <span className="block truncate text-[10px] text-slate-400">
                      {[
                        productKindLabel(classificationForChannel(classifications, sub.id)?.productKind ?? 'other'),
                        ...productClassifications(classifications, sub.id).map((item) => item.snapshot.displayName),
                        ...(classificationForChannel(classifications, sub.id)?.exposureTags ?? []).map((tag) => `${tag} 敞口`),
                      ].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
                <button
                  className="text-sm font-medium text-slate-700 tabular hover:text-emerald-600 transition-colors"
                  onClick={() =>
                    handlers.onEditAmount(
                      { parentId: channel.id, childId: sub.id },
                      sub.amount,
                      `${channel.name} · ${sub.name}`,
                    )
                  }
                  aria-label={`编辑 ${sub.name} 金额`}
                  title="编辑金额"
                >
                  {formatCNY(sub.amount)}
                </button>
                <ActionButton label={`编辑 ${sub.name}`} onClick={() => handlers.onEditSub(channel.id, sub)}>
                  ✎
                </ActionButton>
                <ActionButton label={`删除 ${sub.name}`} onClick={() => handlers.onDeleteSub(channel.id, sub)} tone="red">
                  🗑
                </ActionButton>
              </div>
            ))
          ) : (
            <div className="px-4 py-3 text-sm text-slate-400">该父渠道暂无子渠道，余额显示为父渠道直接金额（未细分）。</div>
          )}
        </div>
      )}
    </div>
  );
}
