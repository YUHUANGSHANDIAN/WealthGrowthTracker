import { useEffect, useState } from 'react';

/**
 * 每秒刷新一次的真实系统时间（Date.now()）。
 * 倒计时基于该值重新计算，避免睡眠/后台恢复后的时间漂移；卸载时正确清理定时器。
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
