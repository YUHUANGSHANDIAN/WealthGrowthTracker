import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { serveStdio } from "../stdio.mjs";
import { AIRuntime } from "../runtime.mjs";

test("stdio serves bounded JSONL status requests and writes only protocol output to stdout", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const runtime = new AIRuntime();
  const chunks = [];
  output.on("data", (chunk) => chunks.push(chunk));
  serveStdio({ input, output, runtime });
  input.end('{"protocolVersion":1,"requestId":"status-stdio","operation":"status"}\n');
  await new Promise((resolve) => setImmediate(resolve));
  const frames = Buffer.concat(chunks).toString("utf8").trim().split("\n");
  assert.equal(frames.length, 1);
  const response = JSON.parse(frames[0]);
  assert.equal(response.requestId, "status-stdio");
  assert.equal(response.result.runtime, "disabled");
});
