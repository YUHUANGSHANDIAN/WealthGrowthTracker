import { describe, expect, it, vi } from 'vitest';
import { restoreWithReadback, type RestoreActions } from '../../src/services/storage/restore';

function setup(failing?: keyof RestoreActions) {
  const calls: string[] = [];
  const action = (name: string) => vi.fn(async () => {
    calls.push(name);
    if (name === failing) throw new Error(`${name} failed`);
  });
  const actions: RestoreActions = {
    drain: action('drain'), restore: action('restore'), reload: action('reload'), hydrate: action('hydrate'),
    pause: () => { calls.push('pause'); }, resume: () => { calls.push('resume'); },
    enterRecovery: vi.fn(() => { calls.push('recovery'); }),
  };
  return { calls, actions };
}

describe('restore serialization and readback', () => {
  it('drains the old writer before replacement, reads back before upgrades', async () => {
    const { calls, actions } = setup();
    await restoreWithReadback(actions);
    expect(calls).toEqual(['drain', 'pause', 'restore', 'reload', 'resume', 'hydrate']);
    expect(actions.enterRecovery).not.toHaveBeenCalled();
  });

  it('does not attempt restore after a drain/backup error', async () => {
    const { calls, actions } = setup('drain');
    await expect(restoreWithReadback(actions)).rejects.toThrow('drain failed');
    expect(calls).toEqual(['drain']);
    expect(actions.enterRecovery).not.toHaveBeenCalled();
  });

  it.each(['restore', 'reload', 'hydrate'] as const)('keeps writes paused when %s fails', async phase => {
    const { calls, actions } = setup(phase);
    await expect(restoreWithReadback(actions)).rejects.toThrow(`${phase} failed`);
    expect(calls.slice(-2)).toEqual(['pause', 'recovery']);
    expect(actions.enterRecovery).toHaveBeenCalledOnce();
    if (phase !== 'hydrate') expect(calls).not.toContain('resume');
  });
});
