import { describe, expect, it } from 'vitest';
import type { DataRootConfig } from '../../src/services/storage/fs';
import { StorageRootSwitchError, switchStorageRootConfig } from '../../src/services/storage/rootSwitch';

const previous: DataRootConfig = { dataRootMode: 'default', updatedAt: '2026-10-01T00:00:00Z' };
const next: DataRootConfig = { dataRootMode: 'custom', customDataRoot: 'D:/new-root', updatedAt: '2026-10-13T00:00:00Z' };

describe('storage root config switch', () => {
  it('verifies the new root before reporting success', async () => {
    const calls: string[] = [];
    await switchStorageRootConfig(previous, next, {
      writeConfig: async config => { calls.push(config.dataRootMode); },
      verifyCurrentRoot: async () => { calls.push('verified'); },
    });
    expect(calls).toEqual(['custom', 'verified']);
  });

  it('rolls back a write that replaced the config before returning an error', async () => {
    let current = previous;
    const calls: string[] = [];
    await expect(switchStorageRootConfig(previous, next, {
      writeConfig: async config => {
        current = config;
        calls.push(config.dataRootMode);
        if (config === next) throw new Error('parent fsync failed after replacement');
      },
      verifyCurrentRoot: async () => { calls.push('verified'); expect(current).toEqual(previous); },
    })).rejects.toMatchObject({ restored: true });
    expect(current).toEqual(previous);
    expect(calls).toEqual(['custom', 'default', 'verified']);
  });

  it('restores and verifies the old root when reading the new root fails', async () => {
    let current = previous;
    await expect(switchStorageRootConfig(previous, next, {
      writeConfig: async config => { current = config; },
      verifyCurrentRoot: async () => { if (current === next) throw new Error('new root is unreadable'); },
    })).rejects.toMatchObject({ restored: true });
    expect(current).toEqual(previous);
  });

  it.each(['write', 'verify'])('does not claim restoration when rollback %s fails', async phase => {
    let current = previous;
    const operation = switchStorageRootConfig(previous, next, {
      writeConfig: async config => {
        if (config === previous && phase === 'write') throw new Error('rollback write failed');
        current = config;
      },
      verifyCurrentRoot: async () => {
        if (current === next || phase === 'verify') throw new Error('readback failed');
      },
    });
    await expect(operation).rejects.toBeInstanceOf(StorageRootSwitchError);
    await expect(operation).rejects.toMatchObject({ restored: false, rollbackCause: expect.any(Error) });
  });
});
