import test from "node:test";
import assert from "node:assert/strict";
import { AIRuntime } from "../runtime.mjs";
import {
  parseRequest, MAX_IMAGES, MAX_IMAGE_BASE64_CHARS, MAX_TOTAL_IMAGE_BASE64_CHARS,
  MAX_MANAGEMENT_FRAME_BYTES, MAX_RESEARCH_URLS,
} from "../protocol.mjs";
import { createProviderAdapter } from "../providers/index.mjs";
import { createResearchProvider, fetchResearchSource, stripHtml } from "../providers/research.mjs";

const IMAGE = { mimeType: "image/png", data: "aGVsbG8=" };

const visionRequest = (overrides = {}) => ({
  protocolVersion: 1, requestId: "vision-1", operation: "vision-extract",
  profileId: "profile-1", providerId: "gateway", task: "document-extraction",
  input: { images: [IMAGE] }, ...overrides,
});
const researchRequest = (overrides = {}) => ({
  protocolVersion: 1, requestId: "research-1", operation: "research-lookup",
  profileId: "profile-1", providerId: "gateway", urls: ["https://example.com/a"], ...overrides,
});
const line = (value) => JSON.stringify(value);
const management = { allowManagement: true };

test("vision and research operations are private Broker IPC and never renderer input", () => {
  assert.throws(() => parseRequest(line(visionRequest())), { code: "INVALID_REQUEST" });
  assert.throws(() => parseRequest(line(researchRequest())), { code: "INVALID_REQUEST" });
  assert.equal(parseRequest(line(visionRequest()), management).operation, "vision-extract");
  assert.equal(parseRequest(line(researchRequest()), management).operation, "research-lookup");
});

test("vision frames reject unknown fields, bad MIME, bad base64 and wrong tasks", () => {
  const reject = (value) => assert.throws(() => parseRequest(line(value), management), { code: "INVALID_REQUEST" });
  assert.equal(parseRequest(line(visionRequest({ input: { images: [IMAGE], text: "读取这张合成截图", facts: [] } })), management).operation, "vision-extract");
  reject(visionRequest({ toolDefinitions: [] }));
  reject(visionRequest({ task: "analysis-question" }));
  reject(visionRequest({ providerId: "not-a-provider" }));
  reject(visionRequest({ input: { images: [] } }));
  reject(visionRequest({ input: { images: [{ mimeType: "image/gif", data: "aGVsbG8=" }] } }));
  reject(visionRequest({ input: { images: [{ mimeType: "image/png", data: "not base64!" }] } }));
  reject(visionRequest({ input: { images: [{ mimeType: "image/png", data: "aGVsbG8=", url: "https://example.com" }] } }));
  reject(visionRequest({ input: { images: [IMAGE], tool: "shell" } }));
  reject(visionRequest({ input: { images: [IMAGE], text: "x".repeat(8_001) } }));
  reject(visionRequest({ input: { images: [IMAGE], facts: [{ factId: "f", label: "l", value: "1", unit: "CNY", extra: true }] } }));
  const many = { images: Array.from({ length: MAX_IMAGES + 1 }, () => IMAGE) };
  reject(visionRequest({ input: many }));
});

test("vision frames enforce per-image, total and frame size limits", () => {
  const oversized = { images: [{ mimeType: "image/jpeg", data: "A".repeat(MAX_IMAGE_BASE64_CHARS + 1) }] };
  assert.throws(() => parseRequest(line(visionRequest({ input: oversized })), management), { code: "IMAGE_TOO_LARGE" });
  const each = "A".repeat(1_100_000);
  const total = { images: [0, 1, 2].map(() => ({ mimeType: "image/png", data: each })) };
  assert.throws(() => parseRequest(line(visionRequest({ input: total })), management), { code: "IMAGE_TOO_LARGE" });
  const frame = { images: Array.from({ length: 4 }, () => ({ mimeType: "image/png", data: "A".repeat(MAX_TOTAL_IMAGE_BASE64_CHARS) })) };
  assert.throws(() => parseRequest(line(visionRequest({ input: frame })), management), { code: "FRAME_TOO_LARGE" });
  assert.ok(MAX_MANAGEMENT_FRAME_BYTES > MAX_TOTAL_IMAGE_BASE64_CHARS);
});

test("research frames accept only unique public HTTPS URLs without credentials or fragments", () => {
  const reject = (value, code = "INVALID_URL") => assert.throws(() => parseRequest(line(value), management), { code });
  assert.equal(parseRequest(line(researchRequest({ urls: ["https://example.com/a", "https://example.com/b?q=1"] })), management).operation, "research-lookup");
  reject(researchRequest({ urls: [] }), "INVALID_REQUEST");
  reject(researchRequest({ urls: ["http://example.com/a"] }));
  reject(researchRequest({ urls: ["https://user:pass@example.com/a"] }));
  reject(researchRequest({ urls: ["https://example.com/a#section"] }));
  reject(researchRequest({ urls: ["ftp://example.com/a"] }));
  reject(researchRequest({ urls: [12] }));
  reject(researchRequest({ urls: [`https://example.com/${"a".repeat(2_049)}`] }));
  reject(researchRequest({ urls: ["https://example.com/a", "https://example.com/a"] }), "INVALID_REQUEST");
  reject(researchRequest({ urls: Array.from({ length: MAX_RESEARCH_URLS + 1 }, (_, index) => `https://example.com/${index}`) }), "INVALID_REQUEST");
  reject(researchRequest({ urls: ["https://example.com/a"], profileId: "profile 1" }), "INVALID_REQUEST");
});

test("vision is refused unless the adapter declares image input", async () => {
  const runtime = new AIRuntime({ enabled: true, allowManagement: true, adapters: new Map([["gateway", {
    state: "configured",
    generate: () => ({ text: "should not run" }),
  }]]) });
  const response = await runtime.handleLine(line(visionRequest()));
  assert.equal(response.error.code, "VISION_UNSUPPORTED");

  const capable = new AIRuntime({ enabled: true, allowManagement: true, adapters: new Map([["gateway", {
    state: "configured",
    supportsVision: () => true,
    generate: ({ input }) => ({ text: `收到 ${input.images.length} 张图片` }),
  }]]) });
  const vision = await capable.handleLine(line(visionRequest()));
  assert.equal(vision.ok, true);
  assert.equal(vision.result.text, "收到 1 张图片");
  assert.equal(vision.result.modelId, "synthetic");
});

test("vision and research stay disabled when the runtime is disabled", async () => {
  const runtime = new AIRuntime({ allowManagement: true });
  assert.equal((await runtime.handleLine(line(visionRequest()))).error.code, "AI_DISABLED");
  assert.equal((await runtime.handleLine(line(researchRequest()))).error.code, "AI_DISABLED");
});

test("research reports unavailability instead of pretending to browse", async () => {
  const unavailable = new AIRuntime({ enabled: true, allowManagement: true, researchFactory: null });
  assert.equal((await unavailable.handleLine(line(researchRequest()))).error.code, "RESEARCH_UNAVAILABLE");
  const textOnly = new AIRuntime({ enabled: true, adapters: new Map([["gateway", { generate: () => ({ text: "x" }) }]]) });
  assert.equal((await textOnly.handleLine(line(researchRequest()))).error.code, "INVALID_REQUEST");
});

test("research results are bounded, ordered and validated", async () => {
  const source = { url: "https://example.com/a", ok: true, status: 200, contentType: "text/html", bytes: 128, truncated: false, title: "合成标题", excerpt: "合成摘录", fetchedAt: "2026-10-15T00:00:00.000Z" };
  const runtime = new AIRuntime({ enabled: true, allowManagement: true, adapters: new Map([["gateway", { generate: () => ({ text: "x" }) }]]),
    researchFactory: () => ({ state: "configured", lookup: async ({ urls }) => ({ results: urls.map((url) => ({ ...source, url })) }) }) });
  const response = await runtime.handleLine(line(researchRequest({ urls: ["https://example.com/a", "https://example.com/b"] })));
  assert.equal(response.ok, true);
  assert.equal(response.result.results.length, 2);
  assert.equal(response.result.results[1].url, "https://example.com/b");

  for (const broken of [
    { results: [source, { ...source, url: "https://example.com/extra" }] },
    { results: [] },
    { results: [{ ...source, url: "https://other.example/x" }] },
    { results: [{ ...source, excerpt: "x".repeat(2_001) }] },
    { results: [{ ...source, bytes: 600_000 }] },
    { results: [{ url: "https://example.com/a", ok: false, error: "x".repeat(41) }] },
    { results: [{ ...source, extra: "debug" }] },
  ]) {
    const invalid = new AIRuntime({ enabled: true, allowManagement: true, adapters: new Map([["gateway", { generate: () => ({ text: "x" }) }]]),
      researchFactory: () => ({ state: "configured", lookup: async () => broken }) });
    const failed = await invalid.handleLine(line(researchRequest()));
    assert.equal(failed.error.code, "PROVIDER_FAILED");
    assert.doesNotMatch(JSON.stringify(failed), /debug/);
  }
});

test("a hung research lookup times out and never returns partial content", async () => {
  const runtime = new AIRuntime({ enabled: true, allowManagement: true, timeoutMs: 20, adapters: new Map([["gateway", { generate: () => ({ text: "x" }) }]]),
    researchFactory: () => ({ state: "configured", lookup: ({ signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("raw provider detail")), { once: true })) }) });
  const response = await runtime.handleLine(line(researchRequest()));
  assert.equal(response.error.code, "TIMEOUT");
  assert.doesNotMatch(JSON.stringify(response), /raw provider detail/);
});

test("research transport enforces scheme, credentials, DNS, redirect and content policy", async () => {
  const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
  let requested;
  const html = "<html><head><title>合成 标题</title></head><body><script>steal()</script><p>合成正文</p></body></html>";
  const ok = await fetchResearchSource("https://example.com/a", {
    lookupImpl: publicLookup,
    fetchImpl: async (url, init) => { requested = { url, init }; return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }); },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.title, "合成 标题");
  assert.match(ok.excerpt, /合成正文/);
  assert.doesNotMatch(ok.excerpt, /steal\(\)/);
  assert.equal(ok.contentType, "text/html");
  assert.equal(requested.init.redirect, "error");
  assert.equal(requested.init.credentials, "omit");

  const reject = async (url, expected, lookupImpl = publicLookup, fetchImpl) => {
    const result = await fetchResearchSource(url, { lookupImpl, fetchImpl: fetchImpl ?? (async () => new Response("x", { status: 200, headers: { "content-type": "text/html" } })) });
    assert.equal(result.ok, false);
    assert.equal(result.error, expected);
  };
  await reject("http://example.com/a", "INVALID_URL");
  await reject("https://user:pass@example.com/a", "INVALID_URL");
  await reject("https://example.com/a#f", "INVALID_URL");
  await reject("not-a-url", "INVALID_URL");
  let resolved = false;
  await reject("https://localhost/a", "INVALID_URL", async () => { resolved = true; return []; });
  assert.equal(resolved, false);
  await reject("https://example.com/a", "INVALID_URL", async () => [{ address: "127.0.0.1", family: 4 }]);
  await reject("https://example.com/a", "INVALID_URL", async () => [{ address: "10.0.0.1", family: 4 }, { address: "93.184.216.34", family: 4 }]);
  await reject("https://example.com/a", "FETCH_FAILED", async () => { throw new Error("dns blocked"); });
  await reject("https://example.com/a", "FETCH_FAILED", publicLookup, async () => new Response("x", { status: 404, headers: { "content-type": "text/html" } }));
  await reject("https://example.com/a", "FETCH_FAILED", publicLookup, async () => new Response("x", { status: 200, headers: { "content-type": "text/event-stream" } }));
});

test("research transport truncates oversized bodies and honours cancellation", async () => {
  const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];
  const chunk = new Uint8Array(64 * 1024).fill(97);
  const stream = new ReadableStream({ start(controller) { for (let index = 0; index < 12; index++) controller.enqueue(chunk); controller.close(); } });
  const truncated = await fetchResearchSource("https://example.com/big", {
    lookupImpl: publicLookup, fetchImpl: async () => new Response(stream, { status: 200, headers: { "content-type": "text/plain" } }),
  });
  assert.equal(truncated.ok, true);
  assert.equal(truncated.truncated, true);
  assert.ok(truncated.bytes > 512 * 1024);

  const controller = new AbortController();
  const cancelled = await fetchResearchSource("https://example.com/slow", {
    lookupImpl: publicLookup, signal: controller.signal,
    fetchImpl: () => new Promise((_, reject) => {
      controller.abort();
      setTimeout(() => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), 0);
    }),
  });
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.error, "CANCELLED");
});

test("research provider looks up sources sequentially and reports per-source failures", async () => {
  const calls = [];
  const provider = createResearchProvider({
    lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async (url) => {
      calls.push(url);
      return url.endsWith("/b")
        ? new Response("gone", { status: 410, headers: { "content-type": "text/html" } })
        : new Response("<html><body>合成</body></html>", { status: 200, headers: { "content-type": "text/html" } });
    },
  });
  const { results } = await provider.lookup({ urls: ["https://example.com/a", "https://example.com/b"] });
  assert.deepEqual(calls, ["https://example.com/a", "https://example.com/b"]);
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
  assert.equal(results[1].error, "FETCH_FAILED");
});

test("stripHtml removes scripts and tags without inventing content", () => {
  assert.equal(stripHtml("<p>a<b>b</b></p><script>x</script>"), "a b");
  assert.equal(stripHtml("&amp;&lt;&gt;&nbsp;"), "&<>");
  assert.equal(stripHtml(""), "");
});

test("native adapters keep the image contract aligned with the declared capability", async () => {
  const profile = { profileId: "connection-1", providerId: "gateway", authKind: "api-key", modelId: "synthetic-model", credential: "synthetic-private-credential", endpoint: "https://gateway.example.com/v1" };
  const plain = createProviderAdapter(profile, { pi: { fetchImpl: async () => new Response("{}", { status: 200 }) } });
  assert.equal(plain.supportsVision(), false);
  await assert.rejects(plain.generate({ task: "document-extraction", input: { images: [IMAGE] }, signal: new AbortController().signal }), { code: "VISION_UNSUPPORTED" });

  const capable = createProviderAdapter({ ...profile, supportsVision: true }, { pi: { fetchImpl: async () => new Response("{}", { status: 200 }) } });
  assert.equal(capable.supportsVision(), true);
  const copilotProfile = { profileId: "connection-2", providerId: "copilot", authKind: "copilot-subscription", modelId: "synthetic-model", credential: "synthetic-private-credential" };
  // Copilot 会话是纯文本：声明读图会在登记阶段就被拒绝，而不是等到发送时才失败。
  assert.throws(() => createProviderAdapter({ ...copilotProfile, supportsVision: true }), { code: "INVALID_PROFILE" });
  const copilot = createProviderAdapter(copilotProfile);
  await assert.rejects(copilot.generate({ task: "document-extraction", input: { images: [IMAGE] }, signal: new AbortController().signal }), { code: "VISION_UNSUPPORTED" });
  // 未完成官方资格验证时，纯文本请求同样被拒绝，不会静默降级成其他通道。
  await assert.rejects(copilot.generate({ task: "document-extraction", input: { text: "x" }, signal: new AbortController().signal }), { code: "QUALIFICATION_REQUIRED" });
});
