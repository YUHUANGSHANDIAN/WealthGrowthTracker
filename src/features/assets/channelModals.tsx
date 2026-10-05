import { useEffect, useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/primitives';
import { TextField, MoneyField } from '../../components/ui/form';
import { EmojiPicker, ColorPicker } from '../../components/ui/Pickers';
import { parseMoney, formatCNY } from '../../utils/money';
import type { Channel } from '../../types';
import type { FirstChildStrategy, LastChildStrategy } from '../../utils/channels';

// ---------------------------------------------------------------------------
// 父渠道 新增/编辑
// ---------------------------------------------------------------------------

export function ChannelFormModal({
  open,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initial?: { name: string; emoji: string; color: string } | null;
  onClose: () => void;
  onSubmit: (data: { name: string; emoji: string; color: string }) => void;
}) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('💰');
  const [color, setColor] = useState('#3B82F6');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '');
      setEmoji(initial?.emoji ?? '💰');
      setColor(initial?.color ?? '#3B82F6');
      setError('');
    }
  }, [open, initial]);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('请输入渠道名称');
      return;
    }
    onSubmit({ name: trimmed, emoji, color });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? '编辑渠道' : '添加渠道'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit}>{initial ? '保存' : '添加'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField
          label="渠道名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={error}
          placeholder="例如：支付宝"
          autoFocus
        />
        <div>
          <span className="block text-sm font-medium text-slate-700 mb-1">图标</span>
          <EmojiPicker value={emoji} onChange={setEmoji} />
        </div>
        <div>
          <span className="block text-sm font-medium text-slate-700 mb-1">颜色</span>
          <ColorPicker value={color} onChange={setColor} />
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// 子渠道 新增/编辑
// ---------------------------------------------------------------------------

export function SubChannelFormModal({
  open,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initial?: { name: string; emoji: string; color: string } | null;
  onClose: () => void;
  onSubmit: (data: { name: string; emoji: string; color: string }) => void;
}) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('💰');
  const [color, setColor] = useState('#10B981');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '');
      setEmoji(initial?.emoji ?? '💰');
      setColor(initial?.color ?? '#10B981');
      setError('');
    }
  }, [open, initial]);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('请输入子渠道名称');
      return;
    }
    onSubmit({ name: trimmed, emoji, color });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? '编辑子渠道' : '添加子渠道'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit}>{initial ? '保存' : '添加'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField
          label="子渠道名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={error}
          placeholder="例如：余额宝"
          autoFocus
        />
        <div>
          <span className="block text-sm font-medium text-slate-700 mb-1">图标</span>
          <EmojiPicker value={emoji} onChange={setEmoji} />
        </div>
        <div>
          <span className="block text-sm font-medium text-slate-700 mb-1">颜色</span>
          <ColorPicker value={color} onChange={setColor} />
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// 金额编辑
// ---------------------------------------------------------------------------

export function AmountModal({
  open,
  title,
  current,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  current: number;
  onClose: () => void;
  onSubmit: (amount: number) => void;
}) {
  const [raw, setRaw] = useState<string>('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setRaw(current ? String(current) : '');
      setError('');
    }
  }, [open, current]);

  function submit() {
    const value = parseMoney(raw);
    if (value === null) {
      setError('请输入有效金额（非负数字）');
      return;
    }
    onSubmit(value);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button onClick={submit}>保存</Button>
        </>
      }
    >
      <div className="space-y-2">
        <p className="text-sm text-slate-500">金额单位：人民币「元」</p>
        <MoneyField
          label="金额"
          value={raw === '' ? '' : Number(raw)}
          onChange={(v) => setRaw(v === '' ? '' : String(v))}
          error={error}
          autoFocus
        />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// 添加首个子渠道（父渠道已有直接金额时，必须先明确金额归属，保证资产守恒）
// ---------------------------------------------------------------------------

export function FirstChildModal({
  open,
  parent,
  totalAssets,
  onClose,
  onSubmit,
}: {
  open: boolean;
  parent: Channel;
  totalAssets: number;
  onClose: () => void;
  onSubmit: (data: { name: string; emoji: string; color: string; strategy: FirstChildStrategy }) => void;
}) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('💰');
  const [color, setColor] = useState('#10B981');
  const [strategy, setStrategy] = useState<FirstChildStrategy>('transfer');
  const [clearConfirmed, setClearConfirmed] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setName('');
      setEmoji('💰');
      setColor('#10B981');
      setStrategy('transfer');
      setClearConfirmed(false);
      setError('');
    }
  }, [open]);

  const directAmount = parent.amount;
  const afterTotal = strategy === 'clear' ? totalAssets - directAmount : totalAssets;

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('请输入子渠道名称');
      return;
    }
    if (strategy === 'clear' && !clearConfirmed) {
      setError('清空父渠道直接金额会减少总资产，请先勾选确认');
      return;
    }
    onSubmit({ name: trimmed, emoji, color, strategy });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="添加首个子渠道"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={submit}>添加</Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          当前「<span className="font-medium text-slate-800">{parent.name}</span>」直接记录了{' '}
          <span className="font-medium text-emerald-600">{formatCNY(directAmount)}</span>。
          添加子渠道后，父渠道金额将改为由子渠道汇总。请选择已有金额如何处理：
        </p>

        <TextField
          label="子渠道名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={error && !error.includes('清空') ? error : ''}
          placeholder="例如：余额宝"
          autoFocus
        />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="block text-sm font-medium text-slate-700 mb-1">图标</span>
            <EmojiPicker value={emoji} onChange={setEmoji} />
          </div>
          <div>
            <span className="block text-sm font-medium text-slate-700 mb-1">颜色</span>
            <ColorPicker value={color} onChange={setColor} />
          </div>
        </div>

        <div className="space-y-2">
          <label className={`flex items-start gap-2 rounded-lg border p-3 cursor-pointer ${strategy === 'transfer' ? 'border-emerald-500 bg-emerald-50/50' : 'border-slate-200'}`}>
            <input type="radio" className="mt-0.5" checked={strategy === 'transfer'} onChange={() => setStrategy('transfer')} />
            <span className="text-sm">
              <span className="font-medium text-slate-800">转入新建子渠道</span>
              <span className="block text-xs text-slate-500">推荐：新子渠道金额 = {formatCNY(directAmount)}，总资产不变。</span>
            </span>
          </label>
          <label className={`flex items-start gap-2 rounded-lg border p-3 cursor-pointer ${strategy === 'uncategorized' ? 'border-emerald-500 bg-emerald-50/50' : 'border-slate-200'}`}>
            <input type="radio" className="mt-0.5" checked={strategy === 'uncategorized'} onChange={() => setStrategy('uncategorized')} />
            <span className="text-sm">
              <span className="font-medium text-slate-800">创建「未分类」子渠道</span>
              <span className="block text-xs text-slate-500">创建「未分类」承接 {formatCNY(directAmount)}，同时创建你的新子渠道（金额 0）。</span>
            </span>
          </label>
          <label className={`flex items-start gap-2 rounded-lg border p-3 cursor-pointer ${strategy === 'clear' ? 'border-amber-500 bg-amber-50/50' : 'border-slate-200'}`}>
            <input type="radio" className="mt-0.5" checked={strategy === 'clear'} onChange={() => setStrategy('clear')} />
            <span className="text-sm">
              <span className="font-medium text-slate-800">清空父渠道直接金额</span>
              <span className="block text-xs text-amber-700">会导致总资产减少 {formatCNY(directAmount)}（变更前 {formatCNY(totalAssets)} → 变更后 {formatCNY(afterTotal)}）。</span>
            </span>
          </label>
        </div>

        {strategy === 'clear' && (
          <label className="flex items-center gap-2 text-sm text-amber-700">
            <input type="checkbox" className="h-4 w-4" checked={clearConfirmed} onChange={(e) => setClearConfirmed(e.target.checked)} />
            我确认要清空 {formatCNY(directAmount)}，总资产将减少到 {formatCNY(afterTotal)}。
          </label>
        )}
        {strategy === 'clear' && error.includes('清空') && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// 删除最后一个子渠道（显式金额语义，杜绝隐式保留）
// ---------------------------------------------------------------------------

export function LastChildModal({
  open,
  parentName,
  childName,
  childAmount,
  totalAssets,
  onClose,
  onSubmit,
}: {
  open: boolean;
  parentName: string;
  childName: string;
  childAmount: number;
  totalAssets: number;
  onClose: () => void;
  onSubmit: (strategy: LastChildStrategy) => void;
}) {
  const [strategy, setStrategy] = useState<LastChildStrategy>('keep-direct');

  useEffect(() => {
    if (open) setStrategy('keep-direct');
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="删除最后一个子渠道"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button onClick={() => { onSubmit(strategy); onClose(); }}>确认</Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          「<span className="font-medium text-slate-800">{parentName}</span>」的子渠道「
          <span className="font-medium text-slate-800">{childName}</span>」持有{' '}
          <span className="font-medium text-emerald-600">{formatCNY(childAmount)}</span>
          ，是最后一个子渠道。删除后该金额如何处理？
        </p>

        <div className="space-y-2">
          <label className={`flex items-start gap-2 rounded-lg border p-3 cursor-pointer ${strategy === 'keep-direct' ? 'border-emerald-500 bg-emerald-50/50' : 'border-slate-200'}`}>
            <input type="radio" className="mt-0.5" checked={strategy === 'keep-direct'} onChange={() => setStrategy('keep-direct')} />
            <span className="text-sm">
              <span className="font-medium text-slate-800">保留为父渠道直接金额</span>
              <span className="block text-xs text-slate-500">推荐：父渠道变为直接持有 {formatCNY(childAmount)}，总资产不变。</span>
            </span>
          </label>
          <label className={`flex items-start gap-2 rounded-lg border p-3 cursor-pointer ${strategy === 'drop-amount' ? 'border-amber-500 bg-amber-50/50' : 'border-slate-200'}`}>
            <input type="radio" className="mt-0.5" checked={strategy === 'drop-amount'} onChange={() => setStrategy('drop-amount')} />
            <span className="text-sm">
              <span className="font-medium text-slate-800">同时删除该金额</span>
              <span className="block text-xs text-amber-700">警告：总资产将减少 {formatCNY(childAmount)}（{formatCNY(totalAssets)} → {formatCNY(totalAssets - childAmount)}）。</span>
            </span>
          </label>
        </div>
      </div>
    </Modal>
  );
}
