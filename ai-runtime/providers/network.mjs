import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns";
import { isPublicAddress, ProviderError, responseError } from "./policy.mjs";

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function publicLookup(hostname, options, callback) {
  lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error || !addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
      callback(new ProviderError());
    } else if (options?.all) {
      callback(null, addresses);
    } else {
      callback(null, addresses[0].address, addresses[0].family);
    }
  });
}

// Direct HTTP transport deliberately never reads proxy variables, cookies or credential files.
// DNS is validated and pinned by the same lookup used by the connection.
async function directFetch(request, local) {
  const body = request.method === "GET" ? undefined : Buffer.from(await request.arrayBuffer());
  if (body && body.length > MAX_REQUEST_BYTES) throw new ProviderError();
  return new Promise((resolve, reject) => {
    if (request.signal.aborted) { reject(new ProviderError("CANCELLED")); return; }
    const url = new URL(request.url);
    const transport = url.protocol === "https:" ? https : http;
    const outbound = transport.request(url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      ...(local ? {} : { lookup: publicLookup }),
      agent: false,
    });
    const onAbort = () => outbound.destroy(new ProviderError("CANCELLED"));
    request.signal.addEventListener("abort", onAbort, { once: true });
    outbound.setTimeout(120_000, () => outbound.destroy(new ProviderError("TIMEOUT")));
    outbound.once("error", () => {
      request.signal.removeEventListener("abort", onAbort);
      reject(new ProviderError(request.signal.aborted ? "CANCELLED" : "PROVIDER_FAILED"));
    });
    outbound.once("response", (incoming) => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const declared = Number(headers.get("content-length"));
      if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
        request.signal.removeEventListener("abort", onAbort); incoming.destroy(); reject(new ProviderError()); return;
      }
      if ([204, 205, 304].includes(incoming.statusCode)) {
        request.signal.removeEventListener("abort", onAbort); incoming.resume();
        resolve(new Response(null, { status: incoming.statusCode, headers })); return;
      }
      let received = 0;
      const iterator = incoming[Symbol.asyncIterator]();
      const stream = new ReadableStream({
        async pull(controller) {
          try {
            const next = await iterator.next();
            if (next.done) { request.signal.removeEventListener("abort", onAbort); controller.close(); return; }
            received += next.value.length;
            if (received > MAX_RESPONSE_BYTES) { incoming.destroy(); throw new ProviderError(); }
            controller.enqueue(new Uint8Array(next.value));
          } catch { request.signal.removeEventListener("abort", onAbort); controller.error(new ProviderError()); }
        },
        cancel() { request.signal.removeEventListener("abort", onAbort); incoming.destroy(); },
      });
      resolve(new Response(stream, { status: incoming.statusCode, headers }));
    });
    outbound.end(body);
  });
}

export function createRestrictedFetch({ profile, fetchImpl } = {}) {
  const base = new URL(`${profile.endpoint}/`);
  const local = profile.authKind === "local";
  const inferencePath = profile.providerId === "anthropic" ? "messages" :
    profile.providerId === "openai" ? "responses" : "chat/completions";
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const expectedPath = `${base.pathname}${request.method === "GET" ? "models" : inferencePath}`;
    // The pinned Anthropic SDK marks beta-namespace calls with exactly ?beta=true;
    // every other query string stays rejected.
    const betaMarker = profile.providerId === "anthropic" && request.method === "POST" && url.search === "?beta=true";
    if (url.origin !== base.origin || url.pathname !== expectedPath || url.username || url.password || url.hash ||
        (url.search !== "" && !betaMarker) || !["GET", "POST"].includes(request.method) || request.headers.has("cookie")) throw new ProviderError();
    // New Request does not follow redirects itself; the underlying transport also cannot do so.
    const safeRequest = new Request(request, { redirect: "error", credentials: "omit", cache: "no-store" });
    let response;
    try { response = fetchImpl ? await fetchImpl(safeRequest) : await directFetch(safeRequest, local); }
    catch (error) { throw error instanceof ProviderError ? error : new ProviderError(request.signal.aborted ? "CANCELLED" : "PROVIDER_FAILED"); }
    if (!response.ok) { await response.body?.cancel(); throw responseError(response.status); }
    return response;
  };
}

export async function readModelList(response) {
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new ProviderError();
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderError();
  let length = 0;
  const chunks = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 64 * 1024) { await reader.cancel(); throw new ProviderError(); }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { throw new ProviderError(); }
  finally { reader.releaseLock(); }
}
