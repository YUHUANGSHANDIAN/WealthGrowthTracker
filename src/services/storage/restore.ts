export interface RestoreActions {
  drain: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  restore: () => Promise<void>;
  reload: () => Promise<void>;
  hydrate: () => Promise<void>;
  enterRecovery: (message: string) => void;
}

/** Caller owns the ledger maintenance lease throughout this operation. */
export async function restoreWithReadback(actions: RestoreActions): Promise<void> {
  let attempted = false;
  try {
    // Never replace the file while an old in-memory snapshot can still reach disk.
    await actions.drain();
    actions.pause();
    attempted = true;
    await actions.restore();
    await actions.reload();
    // hydrate can perform version upgrades only after the restored root is readable.
    actions.resume();
    await actions.hydrate();
  } catch (error) {
    if (attempted) {
      actions.pause();
      actions.enterRecovery('恢复未完成读回验证。原主文件已保留；请在恢复界面检查文件，暂时停止编辑。');
    }
    throw error;
  }
}
