
export const EMOJI_CHOICES = [
  '💰', '🏦', '💙', '💚', '🔶', '🎓', '🏛️', '👛', '💎', '📈', '📊', '🎯', '🌱', '🥇', '🔒', '🎫', '⭐', '🌈', '🧧', '🪙',
] as const;

export const COLOR_CHOICES = [
  '#3B82F6', '#10B981', '#F59E0B', '#06B6D4', '#8B5CF6', '#EC4899', '#EF4444', '#64748B', '#14B8A6', '#F97316', '#84CC16', '#6366F1',
] as const;

export function EmojiPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (emoji: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {EMOJI_CHOICES.map((e) => (
        <button
          key={e}
          type="button"
          onClick={() => onChange(e)}
          aria-label={`选择 ${e}`}
          aria-pressed={value === e}
          className={`h-9 w-9 flex items-center justify-center text-lg rounded-lg border transition-colors ${
            value === e
              ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200'
              : 'border-slate-200 hover:bg-slate-50'
          }`}
        >
          {e}
        </button>
      ))}
    </div>
  );
}

export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {COLOR_CHOICES.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={`选择颜色 ${c}`}
          aria-pressed={value === c}
          className={`h-9 w-9 rounded-lg border-2 transition-transform ${
            value === c ? 'border-slate-800 scale-110' : 'border-transparent'
          }`}
          style={{ background: c }}
        />
      ))}
    </div>
  );
}
