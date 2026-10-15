import { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { Button } from '../../components/ui/primitives';
import { TextField } from '../../components/ui/form';

/** 本地账户锁屏（登出/自动锁时显示，验证通过才解锁；登出不删除资产数据）。 */
export function LockScreen() {
  const account = useAppStore((s) => s.account);
  const login = useAppStore((s) => s.login);
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');

  async function unlock() {
    const ok = await login(secret);
    if (ok) {
      setSecret('');
      setError('');
    } else {
      setError(account?.lockMethod === 'pin' ? 'PIN 错误' : '密码错误');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-slate-50">
      <div className="w-full max-w-xs bg-white rounded-2xl shadow-lg border border-slate-200 p-6">
        <div className="text-center mb-4">
          <div className="text-4xl mb-2" aria-hidden>{account?.avatarEmoji ?? '🔒'}</div>
        <h1 className="text-lg font-semibold text-slate-800">{account?.displayName ?? 'WealthGrowthTracker'}</h1>
          <p className="text-xs text-slate-400">已锁定 · 请输入{account?.lockMethod === 'pin' ? ' PIN 码' : '密码'}</p>
        </div>
        <div className="space-y-3">
          <TextField
            label={account?.lockMethod === 'pin' ? 'PIN 码' : '密码'}
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            error={error}
            onKeyDown={(e) => { if (e.key === 'Enter') void unlock(); }}
            autoFocus
          />
          <Button className="w-full" onClick={() => void unlock()}>解锁</Button>
        </div>
      </div>
    </div>
  );
}
