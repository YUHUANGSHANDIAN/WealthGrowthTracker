/**
 * 灵光运行时环境类型声明（仅在灵光小应用内存在）。
 * 新版应用通过 storage 适配层检测这些全局对象；不存在时回退到浏览器 localStorage，
 * 因此应用本身不依赖灵光运行时即可独立运行。
 */

interface LingguangStorageApi {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

interface LingguangRuntime {
  storage?: LingguangStorageApi;
  saveFile?(options: { data: string; fileName: string }): Promise<unknown>;
  saveImageToPhotosAlbum?(options: { filePath: string }): Promise<unknown>;
}

interface Window {
  lingguang?: LingguangRuntime;
  /** 灵光平台注入的本地 LLM 调用（新版不依赖、不主动调用；保留声明以便类型完整）。 */
  callLLM?: (userMessage: string, systemMessage: string, timeoutMs: number) => Promise<{
    content?: string;
  }>;
}
