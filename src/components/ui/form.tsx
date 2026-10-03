import React, { useId } from 'react';

const baseInput =
  'w-full px-3 py-2 text-sm text-slate-800 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 placeholder:text-slate-400 disabled:bg-slate-50 disabled:text-slate-400';

function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-slate-400">{hint}</p>
      ) : null}
    </div>
  );
}

export interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function TextField({ label, hint, error, id, ...rest }: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId}>
      <input id={inputId} className={baseInput} {...rest} />
    </Field>
  );
}

export interface MoneyFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label: string;
  value: number | '';
  onChange: (value: number | '') => void;
  hint?: string;
  error?: string;
}

/** 金额输入框：带 ¥ 前缀，输入过程保留字符串，失焦/提交时由父级转 number。 */
export function MoneyField({ label, value, onChange, hint, error, id, ...rest }: MoneyFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId}>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm" aria-hidden>
          ¥
        </span>
        <input
          id={inputId}
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          className={`${baseInput} pl-7 tabular`}
          value={value === '' ? '' : value}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') onChange('');
            else {
              const n = Number(raw);
              onChange(Number.isFinite(n) ? n : value);
            }
          }}
          {...rest}
        />
      </div>
    </Field>
  );
}

export interface SelectFieldProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string;
  error?: string;
  options: { value: string; label: string }[];
}

export function SelectField({ label, hint, error, options, id, ...rest }: SelectFieldProps) {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={selectId}>
      <select id={selectId} className={baseInput} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function TextArea({ label, hint, error, id, ...rest }: TextAreaProps) {
  const autoId = useId();
  const areaId = id ?? autoId;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={areaId}>
      <textarea id={areaId} className={`${baseInput} resize-none`} rows={3} {...rest} />
    </Field>
  );
}
