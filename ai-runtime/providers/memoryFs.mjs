import { posix } from "node:path";
import { ProviderError } from "./policy.mjs";

// Virtual session files stay in this closure; no host filesystem methods are called.
export function createMemorySessionFs() {
  const files = new Map();
  const directories = new Set(["/wgt", "/wgt/session"]);
  let totalBytes = 0;
  function path(value) {
    if (typeof value !== "string" || value.includes("\0") || value.includes("\\") || value.length > 1_024) throw new ProviderError();
    const result = posix.resolve("/wgt", value);
    if (result !== "/wgt" && !result.startsWith("/wgt/")) throw new ProviderError();
    return result;
  }
  function missing() { return Object.assign(new Error("Virtual file is unavailable."), { code: "ENOENT" }); }
  function write(value, content) {
    const target = path(value);
    if (directories.has(target)) throw new ProviderError();
    const bytes = Buffer.byteLength(content, "utf8");
    const next = totalBytes - Buffer.byteLength(files.get(target) ?? "", "utf8") + bytes;
    if (bytes > 1_048_576 || next > 4_194_304 || (!files.has(target) && files.size >= 128)) throw new ProviderError();
    const parents = [];
    let parent = posix.dirname(target);
    while (parent.startsWith("/wgt")) {
      if (files.has(parent)) throw new ProviderError();
      if (!directories.has(parent)) parents.push(parent);
      if (parent === "/wgt") break; parent = posix.dirname(parent);
    }
    if (directories.size + parents.length > 128) throw new ProviderError();
    files.set(target, content); totalBytes = next;
    for (const entry of parents) directories.add(entry);
  }
  return {
    async readFile(value) { const target = path(value); if (!files.has(target)) throw missing(); return files.get(target); },
    async writeFile(value, content) { if (typeof content !== "string") throw new ProviderError(); write(value, content); },
    async appendFile(value, content) { if (typeof content !== "string") throw new ProviderError(); write(value, (files.get(path(value)) ?? "") + content); },
    async exists(value) { const target = path(value); return files.has(target) || directories.has(target); },
    async stat(value) {
      const target = path(value);
      if (!files.has(target) && !directories.has(target)) throw missing();
      return { isFile: files.has(target), isDirectory: directories.has(target), size: Buffer.byteLength(files.get(target) ?? "", "utf8"), mtime: "1970-01-01T00:00:00.000Z", birthtime: "1970-01-01T00:00:00.000Z" };
    },
    async mkdir(value, recursive = false) {
      const target = path(value); const entries = [target];
      if (directories.has(target)) return;
      let parent = posix.dirname(target);
      while (!directories.has(parent)) {
        if (!recursive || files.has(parent)) throw new ProviderError();
        entries.push(parent); parent = posix.dirname(parent);
      }
      if (files.has(target) || directories.size + entries.filter((entry) => !directories.has(entry)).length > 128) throw new ProviderError();
      for (const entry of entries) directories.add(entry);
    },
    async readdir(value) {
      const target = path(value);
      if (!directories.has(target)) throw missing();
      return [...new Set([...files.keys(), ...directories].filter((entry) => posix.dirname(entry) === target && entry !== target).map((entry) => posix.basename(entry)))];
    },
    async readdirWithTypes(value) {
      const target = path(value);
      const names = await this.readdir(target);
      return names.map((name) => ({ name, type: files.has(`${target}/${name}`) ? "file" : "directory" }));
    },
    async rm(value, recursive, force) {
      const target = path(value);
      if (recursive || directories.has(target)) throw new ProviderError();
      if (!files.has(target)) { if (!force) throw missing(); return; }
      totalBytes -= Buffer.byteLength(files.get(target), "utf8"); files.delete(target);
    },
    async rename(source, destination) {
      const original = path(source); const target = path(destination);
      if (!files.has(original) || files.has(target) || directories.has(target)) throw new ProviderError();
      const content = files.get(original);
      // Validate parents and all bounds before mutating either virtual entry.
      if (!directories.has(posix.dirname(target))) throw new ProviderError();
      files.set(target, content); files.delete(original);
    },
  };
}
