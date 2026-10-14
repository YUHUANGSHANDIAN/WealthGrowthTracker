import { errorResponse, PROTOCOL_VERSION, parseRequest, MAX_FRAME_BYTES } from "./protocol.mjs";
import { createProviderAdapter } from "./providers/index.mjs";
import { ProviderError, tokenCount } from "./providers/policy.mjs";

const PROVIDER_IDS = ["openai", "copilot", "anthropic", "deepseek", "ollama", "lmstudio", "gateway"];
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_LENGTH = 16_000;
const MAX_CONCURRENT_REQUESTS = 8;

export class AIRuntime {
  #enabled;
  #adapters;
  #timeoutMs;
  #allowManagement;
  #adapterFactory;
  #profiles = new Map();
  #active = new Map();

  constructor({ enabled = false, adapters = new Map(), timeoutMs = DEFAULT_TIMEOUT_MS,
    allowManagement = false, adapterFactory = createProviderAdapter } = {}) {
    this.#enabled = enabled === true;
    this.#adapters = adapters;
    this.#allowManagement = allowManagement === true;
    this.#adapterFactory = adapterFactory;
    this.#timeoutMs = Number.isSafeInteger(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 120_000) : DEFAULT_TIMEOUT_MS;
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
      return await this.#infer(request);
    } catch (error) {
      const code = new Set(["TIMEOUT", "CANCELLED", "AI_DISABLED", "PROVIDER_UNAVAILABLE", "REQUEST_IN_PROGRESS",
        "PROFILE_UNAVAILABLE", "INVALID_PROFILE", "QUALIFICATION_REQUIRED", "AUTH_REQUIRED", "ACCESS_DENIED", "RATE_LIMITED"]).has(error?.code) ? error.code : "PROVIDER_FAILED";
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
    if (Buffer.byteLength(JSON.stringify(response), "utf8") > MAX_FRAME_BYTES) throw new ProviderError();
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
            JSON.stringify(model.input) !== '["text"]' ||
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
    });
  }

  async #operation(request, operation) {
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
    }, this.#timeoutMs);

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
