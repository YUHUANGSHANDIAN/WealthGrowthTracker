import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Badge, Card } from './primitives';
import { Modal } from './Modal';
import { Button } from './primitives';
import { useAppStore } from '../../store/appStore';
import { useNavigationStore, type Route, type TabId } from '../../store/navigationStore';
import type { ChangeImpact, MetricContext, NamedView } from '../../domain/workspace/types';
import { formatCNY } from '../../utils/money';

export function PageHeader({
  eyebrow,
  title,
  description,
  context,
  primaryAction,
  secondaryActions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  context?: ReactNode;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
}) {
  return (
    <header className="workspace-page-header">
      <div className="min-w-0">
        {eyebrow && <p className="workspace-eyebrow">{eyebrow}</p>}
        <h2>{title}</h2>
        {description && <p className="workspace-page-description">{description}</p>}
        {context && <div className="workspace-context-line">{context}</div>}
      </div>
      {(primaryAction || secondaryActions) && (
        <div className="workspace-page-actions">
          {secondaryActions}
          {primaryAction}
        </div>
      )}
    </header>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  tone = 'neutral',
  source,
  action,
  context,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: 'neutral' | 'positive' | 'negative' | 'warning' | 'unknown' | 'accent';
  source?: ReactNode;
  action?: ReactNode;
  context?: MetricContext;
}) {
  const statusLabel = context?.status === 'confirmed' ? '已确认'
    : context?.status === 'pending' ? '待核对'
      : context?.status === 'stale' ? '需重算'
        : context?.status === 'assumption' ? '情景假设'
          : '口径未确认';
  return (
    <Card className={`metric-card metric-${tone}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value tabular">{value}</div>
      {detail && <div className="metric-detail">{detail}</div>}
      {context && (
        <div className="metric-context">
          <DataStateBadge state={context.status}>{statusLabel}</DataStateBadge>
          <span>{context.basis}</span>
          {context.asOf && <span>截至 {context.asOf}</span>}
          {context.scope && <span>{context.scope}</span>}
        </div>
      )}
      {(source || action) && <div className="metric-footer">{source ?? <span />}{action}</div>}
    </Card>
  );
}

export function DataStateBadge({
  state,
  children,
}: {
  state: 'confirmed' | 'pending' | 'deferred' | 'stale' | 'unknown' | 'error' | 'assumption';
  children: ReactNode;
}) {
  const tone = state === 'confirmed' ? 'emerald'
    : state === 'error' ? 'red'
      : state === 'pending' || state === 'deferred' || state === 'stale' || state === 'assumption' ? 'amber'
        : 'slate';
  const symbol = state === 'confirmed' ? '✓'
    : state === 'error' ? '✕'
      : state === 'pending' ? '○'
        : state === 'deferred' ? 'Ⅱ'
          : state === 'stale' ? '↻'
            : state === 'assumption' ? '≈'
              : '?';
  return <Badge tone={tone}><span aria-hidden>{symbol}</span>{children}</Badge>;
}

export function FilterBar({
  children,
  resultCount,
  actions,
}: {
  children: ReactNode;
  resultCount?: number;
  actions?: ReactNode;
}) {
  return (
    <div className="workspace-filter-bar" role="search">
      <div className="workspace-filter-fields">{children}</div>
      <div className="workspace-filter-meta">
        {resultCount !== undefined && <span>{resultCount} 条结果</span>}
        {actions}
      </div>
    </div>
  );
}

export function EmptyStateAction({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="workspace-empty-state">
      <div className="workspace-empty-mark" aria-hidden>∅</div>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function TaskStepper({
  steps,
  label = '任务步骤',
}: {
  steps: Array<{
    id: string;
    label: string;
    state: 'complete' | 'current' | 'pending' | 'blocked' | 'not-applicable';
    detail?: string;
  }>;
  label?: string;
}) {
  return (
    <ol className="workspace-task-steps" aria-label={label}>
      {steps.map((step, index) => (
        <li key={step.id} data-state={step.state} aria-current={step.state === 'current' ? 'step' : undefined}>
          <span className="workspace-step-index" aria-hidden>
            {step.state === 'complete' ? '✓' : step.state === 'blocked' ? '!' : step.state === 'not-applicable' ? '—' : index + 1}
          </span>
          <span className="min-w-0">
            <strong>{step.label}</strong>
            <span className="sr-only">：{step.state === 'complete' ? '已完成' : step.state === 'current' ? '当前步骤' : step.state === 'blocked' ? '阻塞' : step.state === 'not-applicable' ? '不适用' : '待处理'}</span>
            {step.detail && <small>{step.detail}</small>}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function DetailDrawer({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} placement="right" size="lg" footer={footer}>
      {children}
    </Modal>
  );
}

export function ChangePreviewPanel({
  impacts,
  blockers = [],
  baseRevision,
  children,
}: {
  impacts: ChangeImpact[];
  blockers?: string[];
  baseRevision?: number;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-slate-800">变更影响预览</strong>
        {baseRevision !== undefined && <span className="text-xs text-slate-500">基线 revision {baseRevision}</span>}
      </div>
      <ul className="mt-2 space-y-1 text-xs text-slate-600">
        {impacts.map((impact, index) => (
          <li key={`${impact.kind}:${impact.label}:${index}`}>
            <span className="font-medium">{impact.label}</span>：{impact.description}
          </li>
        ))}
      </ul>
      {blockers.length > 0 && (
        <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          {blockers.map((blocker) => <p key={blocker}>阻塞：{blocker}</p>)}
        </div>
      )}
      {children}
    </section>
  );
}

export function MaskedAmount({ value, className }: { value: number | null | undefined; className?: string }) {
  return <span className={`tabular ${className ?? ''}`}>{value === null || value === undefined ? '—' : formatCNY(value)}</span>;
}

export function SourceLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="min-h-[32px] text-xs font-medium text-emerald-700 underline decoration-emerald-300 underline-offset-2" onClick={onClick}>
      {children}
    </button>
  );
}

export function DataTable({
  label,
  children,
  empty,
}: {
  label: string;
  children: ReactNode;
  empty?: ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200" role="region" aria-label={`${label}，可横向滚动`} tabIndex={0}>
      {empty ?? <table className="w-full min-w-[720px] text-left text-sm">{children}</table>}
    </div>
  );
}

export function ChartFrame({
  title,
  description,
  context,
  actions,
  children,
}: {
  title: string;
  description?: string;
  context?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-800">{title}</h3>
          {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
          {context && <div className="mt-1 text-xs text-slate-500">{context}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      <div className="mt-3 min-w-0">{children}</div>
    </section>
  );
}

export function DangerZone({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-red-200 bg-red-50/50 p-4">
      <h3 className="font-semibold text-red-800">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-red-700">{description}</p>
      <div className="mt-3 flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

export function SavedViewBar({
  page,
  tab,
  filters,
  onApply,
  routeForFilters,
}: {
  page: NamedView['page'];
  tab: TabId;
  filters: NamedView['filters'];
  onApply: (filters: NamedView['filters']) => void;
  routeForFilters?: (filters: NamedView['filters']) => Partial<Omit<Route, 'tab' | 'viewId'>>;
}) {
  const views = useAppStore((state) => state.workspaceViews.namedViews);
  const saveNamedView = useAppStore((state) => state.saveNamedView);
  const deleteNamedView = useAppStore((state) => state.deleteNamedView);
  const navigate = useNavigationStore((state) => state.navigate);
  const routeViewId = useNavigationStore((state) => state.viewId ?? '');
  const applyRef = useRef(onApply);
  applyRef.current = onApply;
  const routeFactoryRef = useRef(routeForFilters);
  routeFactoryRef.current = routeForFilters;
  const pageViews = useMemo(() => views.filter((view) => view.page === page), [page, views]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!routeViewId) return;
    const view = pageViews.find((item) => item.id === routeViewId);
    if (view) {
      applyRef.current(view.filters);
      navigate({ tab, viewId: view.id, ...(routeFactoryRef.current?.(view.filters) ?? {}) });
    }
  }, [navigate, pageViews, routeViewId, tab]);

  function apply(id: string) {
    const view = pageViews.find((item) => item.id === id);
    if (!view) return;
    onApply(view.filters);
    navigate({ tab, viewId: view.id, ...(routeForFilters?.(view.filters) ?? {}) });
  }

  function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('请填写视图名称');
      return;
    }
    const now = new Date().toISOString();
    const existing = pageViews.find((view) => view.name === trimmed);
    const view: NamedView = {
      id: existing?.id ?? crypto.randomUUID(),
      page,
      name: trimmed,
      filters,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    saveNamedView(view);
    navigate({ tab, viewId: view.id, ...(routeForFilters?.(view.filters) ?? {}) });
    setSaveOpen(false);
    setName('');
    setError('');
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="应用已保存视图"
        value={routeViewId}
        onChange={(event) => apply(event.target.value)}
        className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
      >
        <option value="">已保存视图</option>
        {pageViews.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
      </select>
      <Button size="sm" variant="outline" onClick={() => setSaveOpen(true)}>保存当前视图</Button>
      {routeViewId && pageViews.some((view) => view.id === routeViewId) && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            deleteNamedView(routeViewId);
            navigate({ tab });
          }}
        >
          删除视图
        </Button>
      )}
      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="保存当前筛选视图"
        size="sm"
        footer={<>
          <Button variant="ghost" onClick={() => setSaveOpen(false)}>取消</Button>
          <Button onClick={save}>保存视图</Button>
        </>}
      >
        <div className="space-y-3">
          <label className="block text-sm text-slate-600">视图名称
            <input
              value={name}
              onChange={(event) => { setName(event.target.value); setError(''); }}
              maxLength={80}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="例如：待核对持仓、最近一年历史"
            />
          </label>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <p className="text-xs text-slate-500">只保存筛选条件与显示口径，不复制金额、附件、凭据或财务事实。</p>
        </div>
      </Modal>
    </div>
  );
}
