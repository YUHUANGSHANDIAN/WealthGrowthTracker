import { AuthorizationError } from "./security.mjs";

const MAX_RESPONSE_BYTES = 65_536;

function requireEndpoint(value) {
  try {
    const endpoint = new URL(value);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash || endpoint.search) throw new Error();
    return endpoint.href;
  } catch { throw new AuthorizationError("AUTH_DISABLED"); }
}

function formField(value) {
  if (typeof value !== "string" || !value || value.length > 16_384) throw new AuthorizationError("TOKEN_REJECTED");
  return value;
}

async function readBoundedJson(response) {
  try {
    if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new Error();
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_RESPONSE_BYTES)) throw new Error();
    if (!response.body) throw new Error();
    const reader = response.body.getReader();
    let length = 0;
    const chunks = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error(); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch { throw new AuthorizationError("TOKEN_REJECTED"); }
}

// This transport is called by the authorization service only. It is not exposed as a model tool.
// Endpoints must come from the broker's independently verified provider contract.
export function createOAuthTransport({ fetchImpl = globalThis.fetch } = {}) {
  async function perform(endpoint, { form, signal, emptyResponse = false } = {}) {
    const url = requireEndpoint(endpoint);
    let response;
    try {
      response = await fetchImpl(url, {
        method: form ? "POST" : "GET",
        headers: { Accept: "application/json", ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
        body: form ? new URLSearchParams(form).toString() : undefined,
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        signal,
      });
    } catch { throw new AuthorizationError(signal?.aborted ? "CANCELLED" : "NETWORK_FAILED"); }
    if (response.status !== 200) throw new AuthorizationError("NETWORK_FAILED");
    if (emptyResponse) { await response.body?.cancel(); return { status: 200 }; }
    return readBoundedJson(response);
  }
  return Object.freeze({
    async exchangeCode({ tokenEndpoint, clientId, code, codeVerifier, redirectUri, resource, signal }) {
      const form = {
        grant_type: "authorization_code",
        client_id: formField(clientId),
        code: formField(code),
        code_verifier: formField(codeVerifier),
        redirect_uri: formField(redirectUri),
      };
      if (resource) form.resource = formField(resource);
      return perform(tokenEndpoint, { form, signal });
    },
    async refreshTokens({ tokenEndpoint, clientId, refreshToken, resource, signal }) {
      const form = { grant_type: "refresh_token", client_id: formField(clientId), refresh_token: formField(refreshToken) };
      if (resource) form.resource = formField(resource);
      return perform(tokenEndpoint, { form, signal });
    },
    async getJwks({ jwksEndpoint, signal }) { return perform(jwksEndpoint, { signal }); },
    async revoke({ revocationEndpoint, clientId, refreshToken, signal }) {
      return perform(revocationEndpoint, {
        form: { token: formField(refreshToken), token_type_hint: "refresh_token", client_id: formField(clientId) },
        signal,
        emptyResponse: true,
      });
    },
  });
}
