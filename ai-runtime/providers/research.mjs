import { lookup } from "node:dns/promises";
import { ProviderError, isPrivateHost, isPublicAddress } from "./policy.mjs";

/**
 * 研究检索：只抓取用户显式给出的公网 HTTPS 链接，再交给模型总结。
 * 安全边界：DNS 解析后所有地址必须是公网、禁止重定向、无凭据、无 Cookie、限制体积与超时。
 * 本模块不会调用任何搜索引擎或模型来“生成 URL”。
 */
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_EXCERPT_CHARS = 2_000;
const TIMEOUT_MS = 20_000;
const ALLOWED_CONTENT = /^(text\/html|application\/xhtml\+xml|application\/json|text\/plain)/i;

function withTimeout(signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new ProviderError("TIMEOUT")), TIMEOUT_MS);
  const forward = () => controller.abort(new ProviderError("CANCELLED"));
  if (signal) {
    if (signal.aborted) forward();
    else signal.addEventListener("abort", forward, { once: true });
  }
  return { controller, done: () => { clearTimeout(timer); signal?.removeEventListener("abort", forward); } };
}

async function assertPublicHost(hostname, lookupImpl) {
  if (isPrivateHost(hostname)) throw new ProviderError("INVALID_URL");
  let addresses;
  try {
    addresses = await (lookupImpl ?? lookup)(hostname, { all: true, verbatim: true });
  } catch {
    throw new ProviderError("FETCH_FAILED");
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new ProviderError("INVALID_URL");
  }
}

export function stripHtml(value) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function readBounded(response) {
  const reader = response.body?.getReader();
  if (!reader) return { text: "", bytes: 0, truncated: false };
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let bytes = 0;
  let text = "";
  let truncated = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      truncated = true;
      await reader.cancel();
      break;
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return { text, bytes, truncated };
}

export async function fetchResearchSource(url, { fetchImpl, signal, lookupImpl } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { url, ok: false, error: "INVALID_URL" };
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    return { url, ok: false, error: "INVALID_URL" };
  }
  const { controller, done } = withTimeout(signal);
  try {
    await assertPublicHost(parsed.hostname, lookupImpl);
    const doFetch = fetchImpl ?? fetch;
    const response = await doFetch(parsed.href, {
      method: "GET",
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8",
        "user-agent": "WealthGrowthTracker/1.11.0-preview.2 research",
      },
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok) return { url, ok: false, status: response.status, error: "FETCH_FAILED" };
    if (!ALLOWED_CONTENT.test(contentType)) return { url, ok: false, status: response.status, error: "FETCH_FAILED" };
    const { text, bytes, truncated } = await readBounded(response);
    const stripped = /json|xml/i.test(contentType) ? text.trim() : stripHtml(text);
    const title = /<title>([\s\S]{1,200}?)<\/title>/i.exec(text)?.[1]?.trim() ?? null;
    return {
      url,
      ok: true,
      status: response.status,
      contentType: contentType.split(";")[0].trim(),
      bytes,
      truncated,
      title: title ? stripHtml(title).slice(0, 200) : null,
      excerpt: stripped.slice(0, MAX_EXCERPT_CHARS),
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    // 内部控制器只会带 ProviderError 原因中止：区分用户取消、超时与真实抓取失败。
    const reason = controller.signal.reason;
    const code = error instanceof ProviderError ? error.code
      : reason instanceof ProviderError ? reason.code : "FETCH_FAILED";
    return { url, ok: false, error: code };
  } finally {
    done();
  }
}

export function createResearchProvider(options = {}) {
  return {
    state: "configured",
    async lookup({ urls, signal }) {
      const results = [];
      for (const url of urls) {
        results.push(await fetchResearchSource(url, { fetchImpl: options.fetchImpl, lookupImpl: options.lookupImpl, signal }));
      }
      return { results };
    },
  };
}

export const RESEARCH_LIMITS = Object.freeze({ MAX_RESPONSE_BYTES, MAX_EXCERPT_CHARS, TIMEOUT_MS });
