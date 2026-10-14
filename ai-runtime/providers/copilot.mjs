import { isAbsolute } from "node:path";
import { ProviderError, toModelInfo } from "./policy.mjs";
import { createMemorySessionFs } from "./memoryFs.mjs";
import { SYSTEM_PROMPT, userPrompt } from "./prompt.mjs";

async function loadSdk() { return import("@github/copilot-sdk"); }

export function createCopilotAdapter(profile, {
  qualificationVerified = false, sandboxDirectory, sdkLoader = loadSdk,
} = {}) {
  const ready = qualificationVerified === true && typeof sandboxDirectory === "string" && isAbsolute(sandboxDirectory);
  async function withClient(signal, operation) {
    if (!ready) throw new ProviderError("QUALIFICATION_REQUIRED");
    if (signal.aborted) throw new ProviderError("CANCELLED");
    const { CopilotClient, RuntimeConnection } = await sdkLoader();
    const client = new CopilotClient({
      mode: "empty",
      connection: RuntimeConnection.forStdio({ env: {} }),
      workingDirectory: sandboxDirectory, baseDirectory: sandboxDirectory,
      gitHubToken: profile.credential, useLoggedInUser: false,
      logLevel: "none", builtinPluginDirectories: [],
      sessionFs: { initialCwd: "/wgt", sessionStatePath: "/wgt/session", conventions: "posix", capabilities: { sqlite: false, binary: false } },
    });
    const onAbort = () => { void client.stop().catch(() => {}); };
    signal.addEventListener("abort", onAbort, { once: true });
    try { await client.start(); if (signal.aborted) throw new ProviderError("CANCELLED"); return await operation(client); }
    catch (error) { throw error instanceof ProviderError ? error : new ProviderError(signal.aborted ? "CANCELLED" : "PROVIDER_FAILED"); }
    finally { signal.removeEventListener("abort", onAbort); try { await client.stop(); } catch { /* No raw SDK diagnostics. */ } }
  }
  return {
    state: ready ? "configured" : "qualification-pending",
    async models({ signal }) {
      return withClient(signal, async (client) => {
        const entries = await client.listModels();
        if (!Array.isArray(entries) || entries.length > 1_024) throw new ProviderError();
        return { models: entries.map(toModelInfo).filter(Boolean).slice(0, 128), providerId: "copilot" };
      });
    },
    async generate({ task, input, signal }) {
      return withClient(signal, async (client) => {
        const memoryFs = createMemorySessionFs();
        const session = await client.createSession({
          model: profile.modelId, allowedModels: [profile.modelId],
          availableTools: [], tools: [], excludedTools: ["builtin:*", "mcp:*", "custom:*"],
          systemMessage: { mode: "replace", content: SYSTEM_PROMPT },
          workingDirectory: "/wgt", configDirectory: "/wgt", enableConfigDiscovery: false,
          enableSessionStore: false, enableSkills: false, remoteSession: "off",
          enableHostGitOperations: false, enableFileHooks: false, enableOnDemandInstructionDiscovery: false,
          enableExperimentalMode: false, requestCanvasRenderer: false, requestExtensions: false,
          skipEmbeddingRetrieval: true, embeddingCacheStorage: "in-memory", includedBuiltinSkills: [],
          onPermissionRequest: () => ({ kind: "denied-no-approval-rule-and-could-not-request-from-user" }),
          createSessionFsProvider: () => memoryFs,
        });
        const onAbort = () => { void session.abort().catch(() => {}); };
        signal.addEventListener("abort", onAbort, { once: true });
        try {
          if (signal.aborted) throw new ProviderError("CANCELLED");
          const response = await session.sendAndWait({ prompt: userPrompt({ task, input }) }, 30_000);
          const text = response?.data?.content;
          if (signal.aborted) throw new ProviderError("CANCELLED");
          if (typeof text !== "string" || !text || text.length > 16_000) throw new ProviderError();
          return { text, providerId: "copilot", modelId: profile.modelId, usage: { inputTokens: null, outputTokens: null } };
        } finally {
          signal.removeEventListener("abort", onAbort);
          try { await session.disconnect(); } catch { /* No raw SDK diagnostics. */ }
        }
      });
    },
  };
}
