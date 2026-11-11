import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceDraft } from '../../src/hooks/useWorkspaceDraft';
import { emptyWorkspaceDraftState, fingerprintWorkspaceTarget } from '../../src/domain/workspace/state';
import { useAppStore } from '../../src/store/appStore';

const baseline = { title: '当前任务', note: '当前依据' };
const payload = { title: '当前任务', note: '草稿内容' };

describe('useWorkspaceDraft', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useAppStore.setState({
      hydrated: true,
      ledgerIdentity: { schemaVersion: 1, ledgerId: 'ledger-hook', createdAt: '2026-11-01T00:00:00.000Z' },
      workspaceDrafts: emptyWorkspaceDraftState(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('相同基线与 fingerprint 才自动恢复旧稿', async () => {
    const fingerprint = await fingerprintWorkspaceTarget(baseline);
    useAppStore.setState({
      workspaceDrafts: {
        schemaVersion: 1,
        drafts: [{
          draftId: 'finance-task:task-1',
          kind: 'finance-task',
          targetId: 'task-1',
          ledgerId: 'ledger-hook',
          baseRevision: 4,
          baseEntityRevision: 2,
          baseFingerprint: fingerprint,
          payloadVersion: 1,
          updatedAt: '2026-11-07T00:00:00.000Z',
          payload,
        }],
      },
    });
    const restore = vi.fn();
    const { result } = renderHook(() => useWorkspaceDraft({
      kind: 'finance-task',
      targetId: 'task-1',
      baseRevision: 4,
      baseEntityRevision: 2,
      baseline,
      payload,
      onRestore: restore,
    }));
    await waitFor(() => expect(result.current.status).toBe('restored'));
    expect(restore).toHaveBeenCalledWith(payload);
  });

  it('revision 或基线变化时只标记 stale，不自动覆盖', async () => {
    const fingerprint = await fingerprintWorkspaceTarget(baseline);
    useAppStore.setState({
      workspaceDrafts: {
        schemaVersion: 1,
        drafts: [{
          draftId: 'finance-task:task-1',
          kind: 'finance-task',
          targetId: 'task-1',
          ledgerId: 'ledger-hook',
          baseRevision: 3,
          baseEntityRevision: 1,
          baseFingerprint: fingerprint,
          payloadVersion: 1,
          updatedAt: '2026-11-07T00:00:00.000Z',
          payload,
        }],
      },
    });
    const restore = vi.fn();
    const { result } = renderHook(() => useWorkspaceDraft({
      kind: 'finance-task',
      targetId: 'task-1',
      baseRevision: 4,
      baseEntityRevision: 2,
      baseline,
      payload,
      onRestore: restore,
    }));
    await waitFor(() => expect(result.current.status).toBe('stale'));
    expect(restore).not.toHaveBeenCalled();
    expect(result.current.staleDraft?.payload).toEqual(payload);
  });
});
