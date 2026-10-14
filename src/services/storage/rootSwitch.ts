import type { DataRootConfig } from './fs';

export class StorageRootSwitchError extends Error {
  constructor(readonly restored: boolean, readonly cause: unknown, readonly rollbackCause?: unknown) {
    super(restored ? '存储配置切换失败，原配置已读回验证' : '存储配置切换与恢复验证失败');
    this.name = 'StorageRootSwitchError';
  }
}

/** A failed atomic write can still have replaced the config; always verify rollback. */
export async function switchStorageRootConfig(
  previous: DataRootConfig,
  next: DataRootConfig,
  actions: { writeConfig: (config: DataRootConfig) => Promise<void>; verifyCurrentRoot: () => Promise<void> },
): Promise<void> {
  try {
    await actions.writeConfig(next);
    await actions.verifyCurrentRoot();
  } catch (cause) {
    try {
      await actions.writeConfig(previous);
      await actions.verifyCurrentRoot();
    } catch (rollbackCause) {
      throw new StorageRootSwitchError(false, cause, rollbackCause);
    }
    throw new StorageRootSwitchError(true, cause);
  }
}
