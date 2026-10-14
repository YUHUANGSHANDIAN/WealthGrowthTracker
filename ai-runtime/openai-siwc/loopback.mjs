import { createServer } from "node:http";
import { AuthorizationError, constantTimeEqual } from "./security.mjs";

const HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
};

export async function createLoopbackListener({ callbackPath = "/auth/callback", expectedState }) {
  if (!/^\/[A-Za-z0-9/_-]{1,100}$/.test(callbackPath) || typeof expectedState !== "string" || expectedState.length < 32) {
    throw new AuthorizationError("INVALID_CALLBACK");
  }
  let resolveCallback;
  let rejectCallback;
  let completed = false;
  const callback = new Promise((resolve, reject) => { resolveCallback = resolve; rejectCallback = reject; });
  // A cancellation may happen before the browser has opened and before a waiter attaches.
  void callback.catch(() => {});
  let redirectUri;
  const server = createServer((request, response) => {
    const respond = (status, text) => { response.writeHead(status, HEADERS); response.end(text); };
    try {
      if (!redirectUri || request.method !== "GET" || request.socket.remoteAddress !== "127.0.0.1" ||
          typeof request.url !== "string" || request.url.length > 8_192 || !request.url.startsWith("/") ||
          request.headers.host !== new URL(redirectUri).host || completed) {
        respond(400, "Authorization callback rejected.");
        return;
      }
      const url = new URL(request.url, redirectUri);
      if (url.origin !== new URL(redirectUri).origin || url.pathname !== callbackPath || url.searchParams.getAll("state").length !== 1 ||
          !constantTimeEqual(url.searchParams.get("state"), expectedState)) {
        respond(400, "Authorization callback rejected.");
        return;
      }
      completed = true;
      respond(200, "Authorization response received. Return to the application.");
      resolveCallback(url.href);
    } catch {
      respond(400, "Authorization callback rejected.");
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.maxHeadersCount = 20;
  server.on("clientError", (_, socket) => socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"));
  await new Promise((resolve, reject) => {
    server.once("error", () => reject(new AuthorizationError("NETWORK_FAILED")));
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve);
  });
  const address = server.address();
  redirectUri = `http://127.0.0.1:${address.port}${callbackPath}`;
  return {
    redirectUri,
    async waitForCallback(signal) {
      if (signal.aborted) throw new AuthorizationError("CANCELLED");
      let onAbort;
      const aborted = new Promise((_, reject) => {
        onAbort = () => reject(new AuthorizationError("CANCELLED"));
        signal.addEventListener("abort", onAbort, { once: true });
      });
      try { return await Promise.race([callback, aborted]); }
      finally { signal.removeEventListener("abort", onAbort); }
    },
    async close() {
      if (!completed) { completed = true; rejectCallback(new AuthorizationError("CANCELLED")); }
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
