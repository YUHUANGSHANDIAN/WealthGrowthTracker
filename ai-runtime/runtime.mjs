import { errorResponse, PROTOCOL_VERSION, parseRequest, MAX_FRAME_BYTES, MAX_MANAGEMENT_FRAME_BYTES } from "./protocol.mjs";
import { createProviderAdapter } from "./providers/index.mjs";
import { ProviderError, tokenCount } from "./providers/policy.mjs";
import { createResearchProvider } from "./providers/research.mjs";

const PROVIDER_IDS = ["openai", "copilot", "anthropic", "deepseek", "ollama", "lmstudio", "gateway"];
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_LENGTH = 16_000;
const MAX_CONCURRENT_REQUESTS = 8;
/** 研究结果的字段白名单：运行时只把已知字段交给渲染层。 */
const RESEARCH_ENTRY_KEYS = new Set(["url", "ok", "status", "contentType", "bytes", "truncated", "title", "excerpt", "fetchedAt", "error"]);
/** 只有这些错误码可以原样返回给 Broker；其余一律收敛为 PROVIDER_FAILED，避免泄漏内部细节。 */
const PASS_THROUGH_CODES = new Set(["TIMEOUT", "CANCELLED", "AI_DISABLED", "PROVIDER_UNAVAILABLE", "REQUEST_IN_PROGRESS",
  "PROFILE_UNAVAILABLE", "INVALID_PROFILE", "QUALIFICATION_REQUIRED", "AUTH_REQUIRED", "ACCESS_DENIED", "RATE_LIMITED",
  "VISION_UNSUPPORTED", "IMAGE_TOO_LARGE", "RESEARCH_UNAVAILABLE", "INVALID_URL", "FETCH_FAILED"]);

export class AIRuntime {
  #enabled;
  #adapters;
  #timeoutMs;
  #longTimeoutMs;
  #allowManagement;
  #adapterFactory;
  #researchFactory;
  #profiles = new Map();
  #active = new Map();
  #research = null;

  constructor({ enabled = false, adapters = new Map(), timeoutMs = DEFAULT_TIMEOUT_MS,
    allowManagement = false, adapterFactory = createProviderAdapter,
    researchFactory = allowManagement ? createResearchProvider : null } = {}) {
    this.#enabled = enabled === true;
    this.#adapters = adapters;
    this.#allowManagement = allowManagement === true;
    this.#adapterFactory = adapterFactory;
    this.#researchFactory = researchFactory;
    this.#timeoutMs = Number.isSafeInteger(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 120_000) : DEFAULT_TIMEOUT_MS;
    // 图片与其他大载荷需要更长预算，但绝不超过协议上限。
    this.#longTimeoutMs = Math.min(this.#timeoutMs * 3, 120_000);
  }

  async handleLine(rawLine) {
    let request;
    try {
      request = parseRequest(rawLine, { allowManagement: this.#allowManagement });
    } catch (error) {
      const code = error?.code ?? "INVALID_REQUEST";
      return errorResponse(error?.requestId, code);
    }

    try {
      if (request.operation === "status") return this.#status(request.requestId);
      if (request.operation === "cancel") return this.#cancel(request);
      if (request.operation === "configure") return this.#configure(request);
      if (request.operation === "removeProfile") return this.#removeProfile(request);
      if (request.operation === "models") return await this.#models(request);
      if (request.operation === "vision-extract") return await this.#visionExtract(request);
      if (request.operation === "research-lookup") return await this.#researchLookup(request);
      return await this.#infer(request);
    } catch (error) {
      const code = PASS_THROUGH_CODES.has(error?.code) ? error.code : "PROVIDER_FAILED";
      return errorResponse(request.requestId, code);
    }
  }

  #status(requestId) {
    return {
      protocolVersion: PROTOCOL_VERSION,
      requestId,
      ok: true,
      result: {
        runtime: this.#enabled ? "enabled" : "disabled",
        providers: PROVIDER_IDS.map((providerId) => {
          const matches = [...this.#profiles.values()].filter((entry) => entry.profile.providerId === providerId);
          return { providerId, state: matches.some((entry) => entry.adapter.state === "configured") ? "configured" :
            matches.length ? "qualification-pending" : "unsupported" };
        }),
        credentials: this.#allowManagement ? "private-broker-memory-only" : "not-accepted",
        tools: [],
      },
    };
  }

  #cancel(request) {
    const active = this.#active.get(request.targetRequestId);
    if (active) active.controller.abort("cancelled");
    return {
      protocolVersion: PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      result: { cancelled: Boolean(active) },
    };
  }

  #success(requestId, result) {
    const response = { protocolVersion: PROTOCOL_VERSION, requestId, ok: true, result };
    // 私有 Broker 通道允许更大的回复帧：研究摘录是多来源合并结果，仍在协议上限内。
    const limit = this.#allowManagement ? MAX_MANAGEMENT_FRAME_BYTES : MAX_FRAME_BYTES;
    if (Buffer.byteLength(JSON.stringify(response), "utf8") > limit) throw new ProviderError();
    return response;
  }

  #configure(request) {
    if (!this.#enabled) throw new ProviderError("AI_DISABLED");
    if (this.#profiles.size >= 24 && !this.#profiles.has(request.profile.profileId)) throw new ProviderError("INVALID_PROFILE");
    const profile = Object.freeze({ ...request.profile });
    const adapter = this.#adapterFactory(profile);
    for (const active of this.#active.values()) if (active.profileId === profile.profileId) active.controller.abort("reconfigured");
    this.#profiles.set(profile.profileId, { profile, adapter });
    return this.#success(request.requestId, { profileId: profile.profileId, providerId: profile.providerId, state: adapter.state });
  }

  #removeProfile(request) {
    for (const active of this.#active.values()) if (active.profileId === request.profileId) active.controller.abort("removed");
    return this.#success(request.requestId, { removed: this.#profiles.delete(request.profileId) });
  }

  #getAdapter(request) {
    if (!this.#enabled) throw new ProviderError("AI_DISABLED");
    const entry = this.#profiles.get(request.profileId);
    if (entry) {
      if (entry.profile.providerId !== request.providerId) throw new ProviderError("PROFILE_UNAVAILABLE");
      return entry;
    }
    const synthetic = this.#adapters.get(request.providerId);
    if (synthetic) return { adapter: synthetic, profile: null };
    throw new ProviderError(this.#allowManagement ? "PROFILE_UNAVAILABLE" : "PROVIDER_UNAVAILABLE");
  }

  async #models(request) {
    const { adapter } = this.#getAdapter(request);
    if (typeof adapter.models !== "function") throw new ProviderError("PROVIDER_UNAVAILABLE");
    return this.#operation(request, async (signal) => {
      const result = await adapter.models({ signal });
      if (!result || result.providerId !== request.providerId || Object.keys(result).some((key) => !["models", "providerId"].includes(key)) ||
          !Array.isArray(result.models) || result.models.length > 128 || result.models.some((model) =>
            !model || Object.keys(model).sort().join(",") !== "contextWindow,id,input,maxOutputTokens,name" ||
            typeof model.id !== "string" || model.id.length > 160 || typeof model.name !== "string" || model.name.length > 160 ||
            !Array.isArray(model.input) || !model.input.includes("text") ||
            model.input.some((value) => value !== "text" && value !== "image") ||
            (model.contextWindow !== null && tokenCount(model.contextWindow) === null) ||
            (model.maxOutputTokens !== null && tokenCount(model.maxOutputTokens) === null))) throw new ProviderError();
      return this.#success(request.requestId, result);
    });
  }

  async #infer(request) {
    const { adapter, profile } = this.#getAdapter(request);
    if (!adapter || typeof adapter.generate !== "function") {
      throw Object.assign(new Error(), { code: "PROVIDER_UNAVAILABLE" });
    }
    return this.#operation(request, async (signal) => {
      return this.#generate(request, adapter, profile, signal);
    });
  }

  /** 视觉提取：仅当连接被用户声明为可读图时才发送图片，否则失败关闭。 */
  async #visionExtract(request) {
    const { adapter, profile } = this.#getAdapter(request);
    if (!adapter || typeof adapter.generate !== "function") throw new ProviderError("PROVIDER_UNAVAILABLE");
    if (adapter.supportsVision?.() !== true) throw new ProviderError("VISION_UNSUPPORTED");
    return this.#operation(request, async (signal) => this.#generate(request, adapter, profile, signal), this.#longTimeoutMs);
  }

  async #generate(request, adapter, profile, signal) {
    const result = await adapter.generate({
      profileId: request.profileId, providerId: request.providerId, task: request.task, input: request.input, signal,
    });
    if (!result || typeof result !== "object" || Object.keys(result).some((key) => !["text", "providerId", "modelId", "usage"].includes(key)) ||
        typeof result.text !== "string" || result.text.length > MAX_OUTPUT_LENGTH ||
        (result.providerId !== undefined && result.providerId !== request.providerId) ||
        (result.modelId !== undefined && (typeof result.modelId !== "string" || result.modelId.length > 160 ||
          (profile && result.modelId !== profile.modelId))) ||
        (result.usage !== undefined && (!result.usage || Object.keys(result.usage).sort().join(",") !== "inputTokens,outputTokens" ||
          Object.values(result.usage).some((count) => count !== null && tokenCount(count) === null)))) throw new ProviderError();
    return this.#success(request.requestId, {
      text: result.text, providerId: request.providerId, modelId: result.modelId ?? profile?.modelId ?? "synthetic",
      usage: result.usage ?? { inputTokens: null, outputTokens: null },
    });
  }

  /** 研究检索：由运行时抓取用户给出的公网 HTTPS 链接；未配置检索能力时如实报不可用。 */
  async #researchLookup(request) {
    if (!this.#enabled) throw new ProviderError("AI_DISABLED");
    if (!this.#allowManagement || !this.#researchFactory) throw new ProviderError("RESEARCH_UNAVAILABLE");
    this.#research ??= this.#researchFactory();
    return this.#operation(request, async (signal) => {
      const result = await this.#research.lookup({ urls: request.urls, signal });
      if (!result || Object.keys(result).some((key) => key !== "results") || !Array.isArray(result.results) ||
          result.results.length !== request.urls.length) throw new ProviderError();
      for (const entry of result.results) {
        if (!entry || typeof entry.url !== "string" || typeof entry.ok !== "boolean" || !request.urls.includes(entry.url) ||
            Object.keys(entry).some((key) => !RESEARCH_ENTRY_KEYS.has(key))) {
          throw new ProviderError();
        }
        if (entry.ok) {
          if (typeof entry.excerpt !== "string" || entry.excerpt.length > 2_000 ||
              typeof entry.bytes !== "number" || entry.bytes > 512 * 1024 ||
              (entry.title != null && (typeof entry.title !== "string" || entry.title.length > 200)) ||
              (entry.contentType != null && (typeof entry.contentType !== "string" || entry.contentType.length > 100))) {
            throw new ProviderError();
          }
        } else if (typeof entry.error !== "string" || entry.error.length > 40) {
          throw new ProviderError();
        }
      }
      return this.#success(request.requestId, result);
    }, this.#longTimeoutMs);
  }

  async #operation(request, operation, timeoutMs = this.#timeoutMs) {
    if (this.#active.has(request.requestId)) {
      throw Object.assign(new Error(), { code: "REQUEST_IN_PROGRESS" });
    }
    if (this.#active.size >= MAX_CONCURRENT_REQUESTS) {
      throw Object.assign(new Error(), { code: "PROVIDER_UNAVAILABLE" });
    }

    const controller = new AbortController();
    const active = { controller, timedOut: false, profileId: request.profileId };
    this.#active.set(request.requestId, active);
    const timeout = setTimeout(() => {
      active.timedOut = true;
      controller.abort("timeout");
    }, timeoutMs);

    let onAbort;
    try {
      return await Promise.race([
        Promise.resolve().then(() => operation(controller.signal)),
        new Promise((_, reject) => {
          onAbort = () => {
            reject(Object.assign(new Error(), { code: active.timedOut ? "TIMEOUT" : "CANCELLED" }));
          };
          controller.signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener("abort", onAbort);
      this.#active.delete(request.requestId);
    }
  }
}
