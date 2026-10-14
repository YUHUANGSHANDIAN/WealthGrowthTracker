import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const mainPath = resolve(fileURLToPath(new URL("../main.mjs", import.meta.url)));

test("executable refuses to start stdio without explicit AI authorization flag", () => {
  const result = spawnSync(process.execPath, [mainPath, "--stdio"], { input: "", encoding: "utf8", timeout: 2_000 });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /AI runtime is disabled/);
});

test("importing the runtime entrypoint has no stdio or process side effects", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(mainPath).href)})`], { encoding: "utf8", timeout: 2_000 });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});
