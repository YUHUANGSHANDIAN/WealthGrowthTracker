import { useEffect, useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/primitives';
import { TextField, MoneyField } from '../../components/ui/form';
import { EmojiPicker, ColorPicker } from '../../components/ui/Pickers';
import { parseMoney } from '../../utils/money';

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
