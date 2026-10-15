import { createRestrictedFetch, readModelList } from "./network.mjs";
import { ProviderError, toModelInfo, tokenCount } from "./policy.mjs";
import { SYSTEM_PROMPT, userPrompt } from "./prompt.mjs";

async function loadApi(providerId) {
  const api = providerId === "anthropic" ? "anthropic-messages" : providerId === "openai" ? "openai-responses" : "openai-completions";
  const [{ stream }, { normalizeContext }] = await Promise.all([
    import(`@earendil-works/pi-ai/api/${api}`),
    import("@earendil-works/pi-ai/utils/transcript"),
  ]);
  return { api, stream, normalizeContext };
}

export function createPiAdapter(profile, { fetchImpl, apiLoader = loadApi, subscriptionEnabled = false } = {}) {
  const subscription = profile.authKind === "openai-subscription";
  const fetch = createRestrictedFetch({ profile, fetchImpl });
  return {
    state: subscription && !subscriptionEnabled ? "qualification-pending" : "configured",
    async models({ signal }) {
      if (subscription && !subscriptionEnabled) throw new ProviderError("QUALIFICATION_REQUIRED");
      const headers = profile.authKind === "local" ? {} : { Authorization: `Bearer ${profile.credential}` };
      if (profile.providerId === "anthropic") {
        delete headers.Authorization;
        headers["x-api-key"] = profile.credential;
        headers["anthropic-version"] = "2023-06-01";
      }
      const data = await readModelList(await fetch(`${profile.endpoint}/models`, { headers, signal }));
      const entries = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models.filter((model) => model.visibility === "list") : null;
      if (!entries || entries.length > 1_024) throw new ProviderError();
      const models = entries.map(toModelInfo).filter(Boolean).slice(0, 128);
      return { models, providerId: profile.providerId };
    },
    async generate({ task, input, signal }) {
      if (subscription && !subscriptionEnabled) throw new ProviderError("QUALIFICATION_REQUIRED");
      const images = Array.isArray(input?.images) ? input.images : [];
      // 只有用户显式声明该连接可读图时才发送图片；否则失败关闭，不静默丢图后假装识别成功。
      if (images.length > 0 && profile.supportsVision !== true) throw new ProviderError("VISION_UNSUPPORTED");
      const { api, stream, normalizeContext } = await apiLoader(profile.providerId);
      const model = {
        id: profile.modelId, name: profile.modelId, provider: profile.providerId, api,
        baseUrl: profile.providerId === "anthropic" ? profile.endpoint.replace(/\/v1$/, "") : profile.endpoint,
        reasoning: false, input: images.length > 0 ? ["text", "image"] : ["text"],
        // Conservative transport limits, never advertised as verified model capabilities.
        contextWindow: 8_192, maxTokens: 2_048,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        compat: api === "openai-completions" ? { supportsDeveloperRole: false, supportsStore: false, maxTokensField: "max_tokens" } : undefined,
      };
      const context = normalizeContext({
        systemPrompt: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: images.length > 0
            ? [
                { type: "text", text: userPrompt({ task, input }) },
                ...images.map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType })),
              ]
            : userPrompt({ task, input }),
          timestamp: Date.now(),
        }],
        tools: [],
      });
      let mappedError;
      const guardedFetch = async (input, init) => {
        try {
          const request = new Request(input, init);
          // SDK defaults must not inherit organization, project, auth or coding-agent identity headers.
          const headers = new Headers();
          for (const name of ["content-type", "accept", "anthropic-version", "anthropic-beta"]) {
            if (request.headers.has(name)) headers.set(name, request.headers.get(name));
          }
          headers.set("user-agent", "WealthGrowthTracker/1.8.0");
          if (profile.authKind !== "local") headers.set(profile.providerId === "anthropic" ? "x-api-key" : "authorization", profile.providerId === "anthropic" ? profile.credential : `Bearer ${profile.credential}`);
          return await fetch(new Request(request, { headers }));
        } catch (error) { mappedError = error; throw error; }
      };
      const result = await stream(model, context, {
        apiKey: profile.credential ?? "wgt-local-no-credential",
        env: { HTTP_PROXY: undefined, HTTPS_PROXY: undefined, ALL_PROXY: undefined, NO_PROXY: undefined, PI_CACHE_RETENTION: undefined },
        fetch: guardedFetch, signal, maxRetries: 0, timeoutMs: 30_000, maxTokens: 2_048,
        transport: "sse", cacheRetention: "none",
        onPayload(payload) {
          if (!payload || typeof payload !== "object") throw new ProviderError();
          // Provider payload is not model-controlled. Force the policy again at the wire boundary.
          delete payload.tools;
          delete payload.tool_choice;
          delete payload.metadata;
          if (api === "openai-responses") { payload.store = false; payload.stream = true; }
          return payload;
        },
      }).result();
      if (signal.aborted) throw new ProviderError("CANCELLED");
      if (mappedError) throw mappedError;
      if (!result || result.stopReason !== "stop" ||
          !Array.isArray(result.content) || result.content.some((part) => !["text", "thinking"].includes(part.type))) throw new ProviderError();
      const text = result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
      if (!text || text.length > 16_000) throw new ProviderError();
      return {
        text, providerId: profile.providerId, modelId: profile.modelId,
        usage: { inputTokens: tokenCount(result.usage?.input + (result.usage?.cacheRead ?? 0) + (result.usage?.cacheWrite ?? 0)), outputTokens: tokenCount(result.usage?.output) },
      };
    },
    /** 该连接是否可接收图片：由用户声明，未声明一律视为不可读图。 */
    supportsVision() {
      return profile.supportsVision === true;
    },
  };
}
