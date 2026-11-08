import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { fingerprintWorkspaceTarget, workspaceDraftId } from '../domain/workspace/state';
import type { WorkspaceDraft, WorkspaceDraftKind } from '../domain/workspace/types';

export type DraftSaveStatus = 'idle' | 'restored' | 'dirty' | 'saving' | 'saved' | 'stale' | 'error';

export function useWorkspaceDraft<T extends Record<string, unknown>>({
  kind,
  targetId,
  baseRevision,
  baseEntityRevision = 0,
  baseline,
  payload,
  enabled = true,
  onRestore,
}: {
  kind: WorkspaceDraftKind;
  targetId: string;
  baseRevision: number;
  baseEntityRevision?: number;
  baseline: T;
  payload: T;
  enabled?: boolean;
  onRestore?: (payload: T) => void;
}) {
  const ledgerId = useAppStore((state) => state.ledgerIdentity.ledgerId);
  const drafts = useAppStore((state) => state.workspaceDrafts);
  const saveWorkspaceDraft = useAppStore((state) => state.saveWorkspaceDraft);
  const removeWorkspaceDraft = useAppStore((state) => state.removeWorkspaceDraft);
  const draftId = workspaceDraftId(kind, targetId);
  const existing = drafts.drafts.find((draft) => draft.draftId === draftId && draft.ledgerId === ledgerId);
  const [status, setStatusState] = useState<DraftSaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [staleDraft, setStaleDraft] = useState<WorkspaceDraft | null>(null);
  const initializedKey = useRef('');
  const lastSavedSignature = useRef('');
  const mountedRef = useRef(true);
  const statusRef = useRef<DraftSaveStatus>('idle');
  const operationChain = useRef<Promise<void>>(Promise.resolve());
  const saveCurrentRef = useRef<() => Promise<void>>(async () => {});
  const baselineSignature = useMemo(() => JSON.stringify(baseline), [baseline]);
  const payloadSignature = useMemo(() => JSON.stringify(payload), [payload]);

  const setStatus = useCallback((next: DraftSaveStatus) => {
    statusRef.current = next;
    if (mountedRef.current) setStatusState(next);
  }, []);

  const enqueue = useCallback(<R,>(operation: () => Promise<R>): Promise<R> => {
    const run = operationChain.current.then(operation, operation);
    operationChain.current = run.then(() => undefined, () => undefined);
    return run;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (statusRef.current === 'dirty') void saveCurrentRef.current?.();
    };
  }, []);

  useEffect(() => {
    const key = `${ledgerId}:${draftId}:${baseRevision}:${baseEntityRevision}`;
    if (initializedKey.current === key) return;
    initializedKey.current = key;
    lastSavedSignature.current = '';
    setError(null);
    if (!existing) {
      setStatus('idle');
      setStaleDraft(null);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const fingerprint = await fingerprintWorkspaceTarget(baseline);
        if (!active) return;
        if (existing.baseRevision === baseRevision
          && existing.baseEntityRevision === baseEntityRevision
          && fingerprint === existing.baseFingerprint) {
          onRestore?.(existing.payload as T);
          lastSavedSignature.current = JSON.stringify(existing.payload);
          setStatus('restored');
          setStaleDraft(null);
        } else {
          setStatus('stale');
          setStaleDraft(existing);
        }
      } catch (cause) {
        if (!active) return;
        setStatus('error');
        setError(cause instanceof Error ? cause.message : '草稿读取失败');
      }
    })();
    return () => { active = false; };
    // The revision-scoped key captures the authoritative source baseline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseEntityRevision, baseRevision, draftId, existing?.draftId, ledgerId]);

  const saveNow = useCallback(async () => {
    if (!enabled || !targetId || payloadSignature === baselineSignature || payloadSignature === lastSavedSignature.current) return;
    const captured = {
      ledgerId,
      kind,
      targetId,
      draftId,
      baseRevision,
      baseEntityRevision,
      baseline,
      payload,
      payloadSignature,
    };
    setStatus('saving');
    setError(null);
    try {
      await enqueue(async () => {
        if (useAppStore.getState().ledgerIdentity.ledgerId !== captured.ledgerId) {
          throw new Error('数据根已切换，旧账本草稿未写入');
        }
        const fingerprint = await fingerprintWorkspaceTarget(captured.baseline);
        if (useAppStore.getState().ledgerIdentity.ledgerId !== captured.ledgerId) {
          throw new Error('数据根已切换，旧账本草稿未写入');
        }
        await saveWorkspaceDraft({
          draftId: captured.draftId,
          kind: captured.kind,
          targetId: captured.targetId,
          ledgerId: captured.ledgerId,
          baseRevision: captured.baseRevision,
          baseEntityRevision: captured.baseEntityRevision,
          baseFingerprint: fingerprint,
          payloadVersion: 1,
          updatedAt: new Date().toISOString(),
          payload: captured.payload,
        });
      });
      lastSavedSignature.current = captured.payloadSignature;
      if (mountedRef.current) setStatus('saved');
    } catch (cause) {
      if (mountedRef.current) {
        setStatus('error');
        setError(cause instanceof Error ? cause.message : '草稿保存失败');
      }
    }
  }, [
    baseEntityRevision,
    baseRevision,
    baseline,
    baselineSignature,
    draftId,
    enabled,
    enqueue,
    kind,
    ledgerId,
    payload,
    payloadSignature,
    saveWorkspaceDraft,
    setStatus,
    targetId,
  ]);
  saveCurrentRef.current = saveNow;

  useEffect(() => {
    if (!enabled || payloadSignature === baselineSignature || payloadSignature === lastSavedSignature.current) return;
    setStatus('dirty');
    const timer = window.setTimeout(() => { void saveNow(); }, 500);
    return () => window.clearTimeout(timer);
  }, [baselineSignature, enabled, payloadSignature, saveNow, setStatus]);

  const flush = useCallback(async () => {
    if (statusRef.current === 'dirty') await saveNow();
    else await operationChain.current;
  }, [saveNow]);

  useEffect(() => {
    const onPageHide = () => { void flush(); };
    const visibility = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [flush]);

  const discard = useCallback(async () => {
    await enqueue(() => removeWorkspaceDraft(draftId, ledgerId));
    lastSavedSignature.current = '';
    if (mountedRef.current) {
      setStaleDraft(null);
      setError(null);
      setStatus('idle');
    }
  }, [draftId, enqueue, ledgerId, removeWorkspaceDraft, setStatus]);

  const applyStaleDraft = useCallback((restored: T = staleDraft?.payload as T) => {
    if (!restored) return;
    onRestore?.(restored);
    lastSavedSignature.current = '';
    setStaleDraft(null);
    setStatus('dirty');
  }, [onRestore, setStatus, staleDraft]);

  const clear = useCallback(async () => {
    await enqueue(() => removeWorkspaceDraft(draftId, ledgerId));
    lastSavedSignature.current = payloadSignature;
    if (mountedRef.current) {
      setStatus('idle');
      setError(null);
    }
  }, [draftId, enqueue, ledgerId, payloadSignature, removeWorkspaceDraft, setStatus]);

  return {
    draftId,
    status,
    error,
    staleDraft,
    saveNow,
    flush,
    discard,
    applyStaleDraft,
    clear,
  };
}
