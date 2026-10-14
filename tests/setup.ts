import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';

// Node >= 22 暴露实验性的原生 localStorage（未提供 --localstorage-file 时为
// undefined），而 vitest/jsdom 在个别组合下不会把 DOM 存储挂到全局。这里统一
// 解析或用内存实现补齐，保证在 Node 24/26 与 CI 上行为一致。
const domWindow = (globalThis as { window?: Window & typeof globalThis }).window;
let resolvedStorage: Storage | null = null;
try { resolvedStorage = domWindow?.localStorage ?? null; } catch { resolvedStorage = null; }
if (!resolvedStorage && typeof Storage !== 'undefined') {
  // 用 Storage.prototype 实现内存存储：实例方法仍走原型链，
  // 因此 vi.spyOn(Storage.prototype, 'setItem') 之类的测试仍可拦截。
  const backing = new WeakMap<object, Map<string, string>>();
  const storeOf = (target: object): Map<string, string> => {
    let store = backing.get(target);
    if (!store) { store = new Map(); backing.set(target, store); }
    return store;
  };
  const define = (name: string, descriptor: PropertyDescriptor) => {
    try { Object.defineProperty(Storage.prototype, name, descriptor); } catch { /* 环境中不可重定义（如 length）时跳过 */ }
  };
  define('length', { configurable: true, get(this: object) { return storeOf(this).size; } });
  define('clear', { configurable: true, value(this: object) { storeOf(this).clear(); } });
  define('getItem', { configurable: true, value(this: object, key: string) { return storeOf(this).get(String(key)) ?? null; } });
  define('setItem', { configurable: true, value(this: object, key: string, value: string) { storeOf(this).set(String(key), String(value)); } });
  define('removeItem', { configurable: true, value(this: object, key: string) { storeOf(this).delete(String(key)); } });
  define('key', { configurable: true, value(this: object, index: number) { return [...storeOf(this).keys()][index] ?? null; } });
  resolvedStorage = Object.create(Storage.prototype) as Storage;
}
const activeStorage = resolvedStorage ?? ({ getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 } as unknown as Storage);
for (const target of [globalThis, domWindow].filter(Boolean) as Array<typeof globalThis>) {
  try {
    Object.defineProperty(target, 'localStorage', { value: activeStorage, configurable: true, writable: true });
  } catch { /* 无法覆盖时保持原状 */ }
}
