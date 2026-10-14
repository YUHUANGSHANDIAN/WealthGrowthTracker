import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProviderAdapter } from "../providers/index.mjs";
import { createRestrictedFetch, readModelList } from "../providers/network.mjs";
import { isPublicAddress, validateProfile } from "../providers/policy.mjs";
import { createMemorySessionFs } from "../providers/memoryFs.mjs";
import { AIRuntime } from "../runtime.mjs";
import { parseRequest } from "../protocol.mjs";

const profile = (overrides = {}) => ({ profileId: "connection-1", providerId: "openai", authKind: "api-key", modelId: "synthetic-model", credential: "synthetic-private-credential", ...overrides });
const input = { text: "Explain synthetic totals", facts: [{ factId: "f1", label: "Change", value: "-120.00", unit: "CNY" }] };
const generation = () => ({ task: "analysis-question", input, signal: new AbortController().signal });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const sse = (events) => new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });

test("profile policy fixes cloud origins and separates local, gateway and subscription rights", () => {
  assert.equal(validateProfile(profile()).endpoint, "https://api.openai.com/v1");
  for (const invalid of [
    profile({ endpoint: "https://evil.invalid/v1" }),
    profile({ providerId: "copilot", authKind: "api-key" }),
    profile({ providerId: "anthropic", authKind: "openai-subscription" }),
    profile({ providerId: "anthropic", credential: "sk-ant-oat-synthetic-forbidden" }),
    profile({ providerId: "ollama", authKind: "local", credential: undefined, endpoint: "http://localhost:11434/v1" }),
    profile({ providerId: "ollama", authKind: "local", credential: undefined, endpoint: "http://127.0.0.1:11434/v1", modelId: "model:cloud" }),
    profile({ providerId: "gateway", endpoint: "https://127.0.0.1:9999/v1" }),
    profile({ providerId: "gateway", endpoint: "https://10.0.0.1/v1" }),
  ]) assert.throws(() => validateProfile(invalid), { code: "INVALID_PROFILE" });
  assert.equal(validateProfile(profile({ providerId: "lmstudio", authKind: "local", credential: undefined, endpoint: "http://[::1]:1234/v1" })).endpoint, "http://[::1]:1234/v1");
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "198.18.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "2001:db8::1"]) assert.equal(isPublicAddress(address), false);
});

test("restricted transport permits only selected origin, operation and sanitized status codes", async () => {
  let calls = 0;
  const fetch = createRestrictedFetch({ profile: validateProfile(profile()), fetchImpl: async (request) => {
    calls++; assert.equal(request.redirect, "error"); assert.equal(request.credentials, "omit"); return json({ data: [] });
  } });
  await fetch("https://api.openai.com/v1/models");
  for (const [url, init] of [
    ["https://evil.invalid/v1/models"], ["https://api.openai.com/v1/models?token=x"],
    ["https://api.openai.com/v1/chat/completions", { method: "POST" }],
    ["https://api.openai.com/v1/models", { headers: { Cookie: "secret" } }],
    ["https://api.openai.com/v1/responses", { method: "DELETE" }],
  ]) await assert.rejects(fetch(url, init), { code: "PROVIDER_FAILED" });
  assert.equal(calls, 1);
  for (const [status, code] of [[401, "AUTH_REQUIRED"], [403, "ACCESS_DENIED"], [429, "RATE_LIMITED"], [302, "PROVIDER_FAILED"]]) {
    const failing = createRestrictedFetch({ profile: validateProfile(profile()), fetchImpl: async () => json({ token: "do-not-leak" }, status) });
    await assert.rejects(failing("https://api.openai.com/v1/models"), (error) => error.code === code && !error.message.includes("do-not-leak"));
  }
});

test("model catalog parsing is bounded, keeps only selectable SIWC models and never exposes credentials", async () => {
  let request;
  const adapter = createProviderAdapter(profile(), { pi: { fetchImpl: async (value) => { request = value; return json({ models: [
    { slug: "listed", display_name: "Listed", visibility: "list" }, { slug: "hidden", visibility: "hide" },
  ] }); } } });
  const models = await adapter.models(generation());
  assert.equal(request.headers.get("Authorization"), "Bearer synthetic-private-credential");
  assert.deepEqual(models.models.map((value) => value.id), ["listed"]);
  assert.doesNotMatch(JSON.stringify(models), /credential/);
  await assert.rejects(readModelList(json({ padding: "x".repeat(65_537) })), { code: "PROVIDER_FAILED" });
  await assert.rejects(readModelList(new Response("{}", { headers: { "Content-Type": "text/plain" } })), { code: "PROVIDER_FAILED" });
});

test("actual pinned Pi Responses parser uses the selected token, no tools and store:false", async () => {
  let payload;
  const text = "Synthetic explanation [fact:f1]";
  const adapter = createProviderAdapter(profile(), { pi: { fetchImpl: async (request) => {
    assert.equal(request.url, "https://api.openai.com/v1/responses");
    assert.equal(request.headers.get("Authorization"), "Bearer synthetic-private-credential");
    payload = await request.json();
    return sse([
      { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg-1", role: "assistant", content: [] } },
      { type: "response.output_text.delta", output_index: 0, delta: text },
      { type: "response.output_item.done", output_index: 0, item: { type: "message", id: "msg-1", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] } },
      { type: "response.completed", response: { id: "synthetic-response", status: "completed", output: [
      { type: "message", id: "msg-1", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] },
    ], usage: { input_tokens: 12, output_tokens: 6, input_tokens_details: { cached_tokens: 4 } } } },
    ]);
  } } });
  const result = await adapter.generate(generation());
  assert.equal(result.text, text);
  assert.equal(result.modelId, "synthetic-model");
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 6 });
  assert.equal(payload.store, false); assert.equal(payload.stream, true);
  assert.equal(Object.hasOwn(payload, "tools"), false); assert.equal(Object.hasOwn(payload, "metadata"), false);
  assert.match(JSON.stringify(payload.input), /authorizedFacts/);
});

test("actual pinned Pi compatible parser supports DeepSeek and explicitly configured loopback", async () => {
  for (const settings of [profile({ providerId: "deepseek" }), profile({ providerId: "lmstudio", authKind: "local", credential: undefined, endpoint: "http://127.0.0.1:1234/v1" })]) {
    const adapter = createProviderAdapter(settings, { pi: { fetchImpl: async (request) => {
      assert.match(request.url, /\/v1\/chat\/completions$/);
      const payload = await request.json();
      assert.equal(Object.hasOwn(payload, "tools"), false);
      return new Response(`data: ${JSON.stringify({ id: "synthetic", choices: [{ index: 0, delta: { role: "assistant", content: "Synthetic [fact:f1]" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 3 } })}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
    } } });
    assert.equal((await adapter.generate(generation())).text, "Synthetic [fact:f1]");
  }
});

test("actual pinned Pi Anthropic parser uses x-api-key and excludes tools", async () => {
  let wire, syntheticDiagnostic;
  const adapter = createProviderAdapter(profile({ providerId: "anthropic" }), { pi: { fetchImpl: async (request) => {
    try {
    wire = { url: request.url, headers: Object.fromEntries(request.headers), raw: await request.text() };
    return sse([
      { type: "message_start", message: { id: "synthetic", type: "message", role: "assistant", content: [], model: "synthetic-model", stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Synthetic [fact:f1]" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 4 } },
      { type: "message_stop" },
    ]);
    } catch (error) { syntheticDiagnostic = error.message; throw error; }
  } } });
  const result = await adapter.generate(generation()).catch((error) => { assert.fail(syntheticDiagnostic ?? error.code); });
  assert.equal(result.text, "Synthetic [fact:f1]");
  // The pinned SDK routes through the beta namespace with exactly this marker query.
  assert.equal(wire.url, "https://api.anthropic.com/v1/messages?beta=true");
  assert.equal(wire.headers["x-api-key"], "synthetic-private-credential");
  assert.equal(Object.hasOwn(wire.headers, "authorization"), false);
  assert.equal(Object.hasOwn(JSON.parse(wire.raw), "tools"), false);
});

test("Pi rejects truncated and tool-bearing responses instead of saving partial output", async () => {
  for (const stopReason of ["length", "toolUse", "error", "aborted"]) {
    const adapter = createProviderAdapter(profile(), { pi: { apiLoader: async () => ({ api: "openai-responses", normalizeContext: (value) => value,
      stream: () => ({ result: async () => ({ stopReason, content: [{ type: "text", text: "partial" }] }) }),
    }) } });
    await assert.rejects(adapter.generate(generation()), { code: "PROVIDER_FAILED" });
  }
});

test("subscription eligibility gates prevent SDK loading and network calls by default", async () => {
  let loaded = 0;
  for (const settings of [profile({ authKind: "openai-subscription" }), profile({ providerId: "copilot", authKind: "copilot-subscription" })]) {
    const adapter = createProviderAdapter(settings, { pi: { apiLoader: () => { loaded++; } }, copilot: { sdkLoader: () => { loaded++; } } });
    assert.equal(adapter.state, "qualification-pending");
    await assert.rejects(adapter.generate(generation()), { code: "QUALIFICATION_REQUIRED" });
    await assert.rejects(adapter.models(generation()), { code: "QUALIFICATION_REQUIRED" });
  }
  assert.equal(loaded, 0);
});

test("Copilot uses empty mode, an empty child environment, no inherited login and no tools", async () => {
  let clientOptions, sessionOptions, stopped = 0, disconnected = 0;
  const sdkLoader = async () => ({
    RuntimeConnection: { forStdio: (options) => ({ kind: "stdio", options }) },
    CopilotClient: class {
      constructor(options) { clientOptions = options; }
      async start() {} async stop() { stopped++; }
      async createSession(options) { sessionOptions = options; return { sendAndWait: async () => ({ data: { content: "Synthetic [fact:f1]" } }), disconnect: async () => { disconnected++; }, abort: async () => {} }; }
    },
  });
  const adapter = createProviderAdapter(profile({ providerId: "copilot", authKind: "copilot-subscription" }), { copilot: { qualificationVerified: true, sandboxDirectory: join(tmpdir(), "wgt-synthetic-isolated"), sdkLoader } });
  assert.equal((await adapter.generate(generation())).text, "Synthetic [fact:f1]");
  assert.equal(clientOptions.mode, "empty"); assert.deepEqual(clientOptions.connection.options.env, {});
  assert.equal(clientOptions.useLoggedInUser, false); assert.equal(clientOptions.gitHubToken, "synthetic-private-credential");
  assert.deepEqual(sessionOptions.availableTools, []); assert.deepEqual(sessionOptions.tools, []);
  assert.equal(sessionOptions.enableSessionStore, false); assert.equal(sessionOptions.enableSkills, false); assert.equal(sessionOptions.remoteSession, "off");
  assert.equal(sessionOptions.enableConfigDiscovery, false); assert.equal(sessionOptions.enableHostGitOperations, false);
  assert.equal(sessionOptions.onPermissionRequest().kind, "denied-no-approval-rule-and-could-not-request-from-user");
  assert.equal(stopped, 1); assert.equal(disconnected, 1);
  assert.equal(await sessionOptions.createSessionFsProvider().exists("/wgt/session"), true);
});

test("Copilot aborts and closes both session and client when cancelled", async () => {
  let aborted = 0, stopped = 0, disconnected = 0, rejectSend, entered;
  const ready = new Promise((resolve) => { entered = resolve; });
  const adapter = createProviderAdapter(profile({ providerId: "copilot", authKind: "copilot-subscription" }), { copilot: {
    qualificationVerified: true, sandboxDirectory: join(tmpdir(), "wgt-synthetic-isolated"), sdkLoader: async () => ({
      RuntimeConnection: { forStdio: () => ({}) }, CopilotClient: class {
        async start() {} async stop() { stopped++; }
        async createSession() { return { sendAndWait: () => new Promise((_, reject) => { rejectSend = reject; entered(); }), abort: async () => { aborted++; rejectSend(new Error("private-token")); }, disconnect: async () => { disconnected++; } }; }
      },
    }),
  } });
  const signal = new AbortController(); const pending = adapter.generate({ ...generation(), signal: signal.signal });
  await ready; signal.abort();
  await assert.rejects(pending, (error) => error.code === "CANCELLED" && !error.message.includes("private-token"));
  assert.equal(aborted, 1); assert.ok(stopped >= 1); assert.equal(disconnected, 1);
});

test("Copilot virtual filesystem matches SDK metadata and cannot escape or recursively remove", async () => {
  const fs = createMemorySessionFs();
  await fs.mkdir("/wgt/session", true);
  await fs.writeFile("/wgt/session/note.txt", "synthetic");
  assert.equal((await fs.stat("/wgt/session/note.txt")).mtime, "1970-01-01T00:00:00.000Z");
  assert.deepEqual(await fs.readdirWithTypes("/wgt/session"), [{ name: "note.txt", type: "file" }]);
  for (const path of ["/etc/passwd", "../../outside", "C:\\private", "/wgt/../outside"]) await assert.rejects(fs.writeFile(path, "x"), { code: "PROVIDER_FAILED" });
  await assert.rejects(fs.rm("/wgt/session", true, true), { code: "PROVIDER_FAILED" });
  await assert.rejects(fs.writeFile("/wgt/huge", "x".repeat(1_048_577)), { code: "PROVIDER_FAILED" });
  assert.equal(await fs.exists("/wgt/huge"), false);
});

test("private profile configuration is isolated from renderer requests and model/provider mismatch", async () => {
  const configure = { protocolVersion: 1, requestId: "cfg", operation: "configure", profile: profile() };
  assert.throws(() => parseRequest(JSON.stringify(configure)), { code: "INVALID_REQUEST" });
  const runtime = new AIRuntime({ enabled: true, allowManagement: true, adapterFactory: (settings) => ({ state: "configured", models: async () => ({ providerId: settings.providerId, models: [] }), generate: async () => ({ text: settings.profileId, modelId: settings.modelId }) }) });
  assert.equal((await runtime.handleLine(JSON.stringify(configure))).ok, true);
  const request = { protocolVersion: 1, requestId: "infer", operation: "infer", profileId: "connection-1", providerId: "openai", task: "analysis-question", input };
  assert.equal((await runtime.handleLine(JSON.stringify(request))).result.text, "connection-1");
  assert.equal((await runtime.handleLine(JSON.stringify({ ...request, providerId: "deepseek" }))).error.code, "PROFILE_UNAVAILABLE");
  assert.equal((await runtime.handleLine(JSON.stringify({ ...request, profileId: "connection-other" }))).error.code, "PROFILE_UNAVAILABLE");
  assert.deepEqual((await runtime.handleLine(JSON.stringify({ protocolVersion: 1, requestId: "remove", operation: "removeProfile", profileId: "connection-1" }))).result, { removed: true });
  assert.equal((await runtime.handleLine(JSON.stringify(request))).error.code, "PROFILE_UNAVAILABLE");
});
