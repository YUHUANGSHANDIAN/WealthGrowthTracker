import test from "node:test";
import assert from "node:assert/strict";
import { createOAuthTransport } from "../openai-siwc/transport.mjs";

test("OAuth transport encodes PKCE form, omits secrets and refuses redirects/cookies", async () => {
  let received;
  const transport = createOAuthTransport({ fetchImpl: async (url, options) => {
    received = { url, options };
    return Response.json({ access_token: "synthetic", token_type: "Bearer", expires_in: 300 });
  } });
  await transport.exchangeCode({
    tokenEndpoint: "https://identity.example.invalid/token", clientId: "issued-client", code: "synthetic-code",
    codeVerifier: "synthetic-verifier", redirectUri: "http://127.0.0.1:1234/auth/callback",
    resource: "https://api.example.invalid/v1", signal: new AbortController().signal,
  });
  assert.equal(received.options.redirect, "error");
  assert.equal(received.options.credentials, "omit");
  assert.equal(received.options.cache, "no-store");
  const form = new URLSearchParams(received.options.body);
  assert.equal(form.get("code_verifier"), "synthetic-verifier");
  assert.equal(form.get("client_id"), "issued-client");
  assert.equal(form.has("client_secret"), false);
  assert.equal(form.get("redirect_uri"), "http://127.0.0.1:1234/auth/callback");
});

test("refresh form cannot add scope and revocation accepts an empty 200", async () => {
  const forms = [];
  const transport = createOAuthTransport({ fetchImpl: async (url, options) => {
    forms.push(new URLSearchParams(options.body));
    return url.endsWith("/revoke") ? new Response(null, { status: 200 }) : Response.json({ access_token: "synthetic" });
  } });
  await transport.refreshTokens({ tokenEndpoint: "https://identity.example.invalid/token", clientId: "issued-client", refreshToken: "synthetic-refresh", scope: "forbidden-extra" });
  assert.equal(forms[0].has("scope"), false);
  const revoke = await transport.revoke({ revocationEndpoint: "https://identity.example.invalid/revoke", clientId: "issued-client", refreshToken: "synthetic-refresh" });
  assert.deepEqual(revoke, { status: 200 });
  assert.equal(forms[1].get("token_type_hint"), "refresh_token");
});

test("HTTP transport rejects non-HTTPS endpoints, non-JSON and oversized responses", async () => {
  const unused = createOAuthTransport({ fetchImpl: () => { throw new Error("must not call"); } });
  await assert.rejects(unused.getJwks({ jwksEndpoint: "http://identity.example.invalid/jwks" }), { code: "AUTH_DISABLED" });
  const html = createOAuthTransport({ fetchImpl: async () => new Response("secret-error-page", { headers: { "content-type": "text/html" } }) });
  await assert.rejects(html.getJwks({ jwksEndpoint: "https://identity.example.invalid/jwks" }), (error) => error.code === "TOKEN_REJECTED" && !error.message.includes("secret"));
  const huge = createOAuthTransport({ fetchImpl: async () => new Response("x".repeat(65_537), { headers: { "content-type": "application/json" } }) });
  await assert.rejects(huge.getJwks({ jwksEndpoint: "https://identity.example.invalid/jwks" }), { code: "TOKEN_REJECTED" });
});

test("HTTP provider errors are redacted and do not expose response bodies", async () => {
  const transport = createOAuthTransport({ fetchImpl: async () => new Response("token=sensitive-response", { status: 500 }) });
  await assert.rejects(transport.getJwks({ jwksEndpoint: "https://identity.example.invalid/jwks" }), (error) => error.code === "NETWORK_FAILED" && !error.message.includes("sensitive"));
});
