import { MAX_MANAGEMENT_FRAME_BYTES } from "./protocol.mjs";
import { AIRuntime } from "./runtime.mjs";
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const DIAGNOSTICS =
  process.env.WGT_AI_DIAGNOSTICS === "1";

function diagnose(message) {
  if (DIAGNOSTICS) process.stderr.write(`[runtime] ${message}\n`);
}

function writeResponse(output, response) {
  output.write(`${JSON.stringify(response)}\n`);
  diagnose(`response-written requestId=${response.requestId ?? "null"} ok=${response.ok}`);
}

export function serveStdio({ input, output, runtime }) {
  let pending = Buffer.alloc(0);
  let discardingOversizeFrame = false;

  const processFrame = (frame) => {
    let line;
    try {
      line = UTF8_DECODER.decode(frame).replace(/\r$/, "");
    } catch {
      writeResponse(output, {
        protocolVersion: 1,
        requestId: null,
        ok: false,
        error: { code: "INVALID_JSON", message: "The request is not valid JSON." },
      });
      return;
    }
    void runtime.handleLine(line).then((response) => writeResponse(output, response));
  };

  input.on("data", (chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    diagnose(`stdin-data bytes=${bytes.length}`);
    for (const byte of bytes) {
      if (byte === 0x0a) {
        if (discardingOversizeFrame) {
          writeResponse(output, {
            protocolVersion: 1,
            requestId: null,
            ok: false,
            error: { code: "FRAME_TOO_LARGE", message: "The request exceeds the protocol size limit." },
          });
        } else {
          processFrame(pending);
        }
        pending = Buffer.alloc(0);
        discardingOversizeFrame = false;
      } else if (!discardingOversizeFrame) {
        if (pending.length >= MAX_MANAGEMENT_FRAME_BYTES) {
          pending = Buffer.alloc(0);
          discardingOversizeFrame = true;
        } else {
          pending = Buffer.concat([pending, Buffer.from([byte])]);
        }
      }
    }
  });

  input.on("end", () => {
    diagnose(`stdin-end pending=${pending.length} discarding=${discardingOversizeFrame}`);
    if (pending.length > 0 && !discardingOversizeFrame) processFrame(pending);
  });
}

export function startStdioRuntime({ enabled }) {
  diagnose(
    `runtime-start pid=${process.pid} ppid=${process.ppid} stdinTTY=${Boolean(process.stdin.isTTY)} stdoutWritable=${process.stdout.writable}`,
  );
  process.stdin.on("error", (error) => diagnose(`stdin-error code=${error?.code ?? "unknown"}`));
  process.stdout.on("error", (error) => diagnose(`stdout-error code=${error?.code ?? "unknown"}`));
  process.on("beforeExit", (code) => diagnose(`before-exit code=${code}`));
  process.on("exit", (code) => diagnose(`exit code=${code}`));
  // stdin is owned by the Rust Broker, which never forwards renderer management frames.
  const runtime = new AIRuntime({ enabled, allowManagement: true });
  serveStdio({ input: process.stdin, output: process.stdout, runtime });
}
