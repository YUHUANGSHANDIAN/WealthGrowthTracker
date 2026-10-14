/**
 * 存储适配层接口 —— 统一灵光环境（异步 API）与浏览器 localStorage（同步 API）的差异。
 *
 * 业务组件与 zustand store **不直接** 操作 localStorage / lingguang.storage，
 * 一律经由 StorageService，便于替换底层实现（未来可换成 IndexedDB 而不改业务代码）。
 */
export interface StorageAdapter {
  readonly name: 'browser' | 'lingguang' | 'desktop';
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  /** Commit a complete business write together when the platform supports it. */
  setItems?(entries: ReadonlyArray<{ key: string; value: string }>): Promise<void>;
}
