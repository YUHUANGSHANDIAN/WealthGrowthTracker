import { MAX_MANAGEMENT_FRAME_BYTES } from "./protocol.mjs";
import { AIRuntime } from "./runtime.mjs";
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function writeResponse(output, response) {
  output.write(`${JSON.stringify(response)}\n`);
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
    if (pending.length > 0 && !discardingOversizeFrame) processFrame(pending);
  });
}

export function startStdioRuntime({ enabled }) {
  // stdin is owned by the Rust Broker, which never forwards renderer management frames.
  const runtime = new AIRuntime({ enabled, allowManagement: true });
  serveStdio({ input: process.stdin, output: process.stdout, runtime });
}
