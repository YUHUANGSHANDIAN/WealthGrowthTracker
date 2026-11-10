import test from "node:test";
import assert from "node:assert/strict";
import { AIRuntime } from "../runtime.mjs";
import { parseRequest, MAX_INPUT_TEXT_LENGTH, MAX_CONVERSATION_MESSAGES } from "../protocol.mjs";

const inferRequest = (overrides = {}) => JSON.stringify({
  protocolVersion: 1,
  requestId: "request-1",
  operation: "infer",
  profileId: "profile-1",
  providerId: "openai",
  task: "analysis-question",
  input: { text: "Explain this synthetic change", facts: [{ factId: "fact-1", label: "Change", value: "-120.00", unit: "CNY", asOf: "2026-10-13" }] },
  ...overrides,
});

test("accepts bounded typed inference and rejects unknown fields", () => {
  assert.equal(parseRequest(inferRequest()).operation, "infer");
  assert.throws(() => parseRequest(inferRequest({ apiKey: "secret" })), { code: "INVALID_REQUEST" });
  assert.throws(() => parseRequest(inferRequest({ endpoint: "https://example.invalid" })), { code: "INVALID_REQUEST" });
  assert.throws(() => parseRequest(inferRequest({ toolDefinitions: [] })), { code: "INVALID_REQUEST" });
});

test("rejects invalid facts, repeated IDs and oversized input", () => {
  assert.throws(() => parseRequest(inferRequest({
    input: { text: "x", facts: [{ factId: "f", label: "x", value: Number.NaN, unit: "CNY" }] },
  })), { code: "INVALID_REQUEST" });
  const duplicate = { factId: "same", label: "x", value: "1", unit: "CNY" };
  assert.throws(() => parseRequest(inferRequest({ input: { text: "x", facts: [duplicate, duplicate] } })), { code: "INVALID_REQUEST" });
  assert.throws(() => parseRequest(inferRequest({ input: { text: "x".repeat(MAX_INPUT_TEXT_LENGTH + 1), facts: [] } })), { code: "INVALID_REQUEST" });
});

test("accepts a bounded health-assistant conversation and rejects extra fields", () => {
  const input = {
    text: "Why is this issue present?",
    facts: [],
    conversation: Array.from({ length: MAX_CONVERSATION_MESSAGES }, (_, index) => ({
      role: index % 2 ? "assistant" : "user",
      text: `Synthetic turn ${index}`,
    })),
  };
  const parsed = parseRequest(inferRequest({ task: "data-health-assistant", input }));
  assert.equal(parsed.input.conversation.length, MAX_CONVERSATION_MESSAGES);
  assert.throws(() => parseRequest(inferRequest({
    task: "data-health-assistant",
    input: { ...input, conversation: [...input.conversation, { role: "user", text: "overflow" }] },
  })), { code: "INVALID_REQUEST" });
  assert.throws(() => parseRequest(inferRequest({
    task: "data-health-assistant",
    input: { ...input, tool: "forbidden" },
  })), { code: "INVALID_REQUEST" });
});

test("default runtime is disabled, reports no tools and never calls providers", async () => {
  let called = false;
  const runtime = new AIRuntime({ adapters: new Map([["openai", { generate: () => { called = true; } }]]) });
  const status = await runtime.handleLine(JSON.stringify({ protocolVersion: 1, requestId: "status-1", operation: "status" }));
  assert.equal(status.result.runtime, "disabled");
  assert.deepEqual(status.result.tools, []);
  assert.ok(status.result.providers.every((provider) => provider.state === "unsupported"));
  const response = await runtime.handleLine(inferRequest());
  assert.equal(response.error.code, "AI_DISABLED");
  assert.equal(called, false);
});

test("enabled runtime still reports unimplemented providers instead of pretending to connect", async () => {
  const runtime = new AIRuntime({ enabled: true });
  const response = await runtime.handleLine(inferRequest());
  assert.equal(response.error.code, "PROVIDER_UNAVAILABLE");
});

test("synthetic adapter sees only typed facts and returns bounded text", async () => {
  let received;
  const runtime = new AIRuntime({ enabled: true, adapters: new Map([["openai", {
    async generate(input) { received = input; return { text: "Synthetic explanation with fact-1." }; },
  }]]) });
  const response = await runtime.handleLine(inferRequest());
  assert.equal(response.ok, true);
  assert.equal(response.result.text, "Synthetic explanation with fact-1.");
  assert.deepEqual(Object.keys(received).sort(), ["input", "profileId", "providerId", "signal", "task"]);
  assert.equal(received.input.facts[0].factId, "fact-1");
});

test("cancellation aborts in-flight work and errors never expose provider details", async () => {
  const runtime = new AIRuntime({ enabled: true, timeoutMs: 500, adapters: new Map([["openai", {
    generate({ signal }) {
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("token=private-provider-detail")), { once: true });
      });
    },
  }]]) });
  const pending = runtime.handleLine(inferRequest());
  await new Promise((resolve) => setImmediate(resolve));
  const cancel = await runtime.handleLine(JSON.stringify({ protocolVersion: 1, requestId: "cancel-1", operation: "cancel", targetRequestId: "request-1" }));
  assert.deepEqual(cancel.result, { cancelled: true });
  const response = await pending;
  assert.equal(response.error.code, "CANCELLED");
  assert.doesNotMatch(JSON.stringify(response), /private-provider-detail|token=/);
});

test("deadline aborts a provider adapter", async () => {
  const runtime = new AIRuntime({ enabled: true, timeoutMs: 10, adapters: new Map([["openai", {
    generate({ signal }) {
      return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new Error("raw error")), { once: true }));
    },
  }]]) });
  const response = await runtime.handleLine(inferRequest());
  assert.equal(response.error.code, "TIMEOUT");
});

test("adapter output must be a strict bounded object", async () => {
  const runtime = new AIRuntime({ enabled: true, adapters: new Map([["openai", { generate: () => ({ text: "ok", debug: "secret" }) }]]) });
  const response = await runtime.handleLine(inferRequest());
  assert.equal(response.error.code, "PROVIDER_FAILED");
  assert.doesNotMatch(JSON.stringify(response), /secret/);
});
