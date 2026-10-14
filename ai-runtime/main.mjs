import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { startStdioRuntime } from "./stdio.mjs";

export function runCli(args = process.argv.slice(2)) {
  if (args.length !== 2 || !args.includes("--stdio") || !args.includes("--enable-ai-runtime")) {
    process.stderr.write("AI runtime is disabled. Start only after explicit user authorization.\n");
    process.exitCode = 2;
    return;
  }
  startStdioRuntime({ enabled: true });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
