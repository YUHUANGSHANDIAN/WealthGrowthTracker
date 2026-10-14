import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { request } from "node:http";
import { OpenAISiwcAuthorizationService } from "../openai-siwc/service.mjs";
import { createAuthorizationChallenge, parseCallback, verifyIdToken } from "../openai-siwc/security.mjs";
import { createLoopbackListener } from "../openai-siwc/loopback.mjs";
import { createOpenAISiwcContract } from "../openai-siwc/contract.mjs";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "synthetic-key", alg: "RS256", use: "sig" };
const NOW = Date.parse("2026-10-13T00:00:00Z");
const ISSUER = "https://identity.example.invalid";

function withQuery(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function withPairs(base, pairs) {
  const url = new URL(base);
  for (const [key, value] of pairs) url.searchParams.append(key, value);
  return url.toString();
}

function jwt(claims, header = { alg: "RS256", kid: "synthetic-key", typ: "JWT" }) {
  const prefix = [header, claims].map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".");
  return `${prefix}.${sign("sha256", Buffer.from(prefix), privateKey).toString("base64url")}`;
}

function claims(overrides = {}) {
  return { iss: ISSUER, aud: "issued-app-client", sub: "synthetic-subject", nonce: "synthetic-nonce", iat: NOW / 1_000, exp: NOW / 1_000 + 300, ...overrides };
}

function makeFixture(overrides = {}) {
  const records = new Map();
  let authorization;
  let listenerClosed = false;
  let refreshCount = 0;
  let nowMs = NOW;
  const contract = {
    // Synthetic DI configuration is not an assertion that the production protocol is verified.
    verified: true,
    evidence: { sourceUrl: "https://developers.openai.com/synthetic-contract-test", checkedOn: "2026-10-13" },
    issuer: ISSUER,
    authorizationEndpoint: `${ISSUER}/authorize`,
    tokenEndpoint: `${ISSUER}/token`,
    jwksEndpoint: `${ISSUER}/jwks`,
    revocationEndpoint: `${ISSUER}/revoke`,
    resource: "https://api.example.invalid/v1",
    authorizationClientId: "synthetic-registration-client",
    scopes: ["openid", "profile", "offline_access"],
    authorizationParameters: { application_name: "Wealth Growth Tracker synthetic test" },
    acceptsIssuedClient: (clientId) => clientId === "issued-app-client",
    ...overrides.contract,
  };
  const vault = {
    async load(profileId) { return structuredClone(records.get(profileId) ?? null); },
    async write(profileId, record) { records.set(profileId, structuredClone(record)); },
    async remove(profileId) { records.delete(profileId); },
    ...overrides.vault,
  };
  const transport = {
    async exchangeCode(input) {
      assert.equal(input.clientId, "issued-app-client");
      assert.equal(input.code, "synthetic-code");
      assert.equal(input.redirectUri, "http://127.0.0.1:12345/auth/callback");
      assert.equal(createHash("sha256").update(input.codeVerifier, "ascii").digest("base64url"), authorization.searchParams.get("code_challenge"));
      assert.equal(Object.hasOwn(input, "clientSecret"), false);
      return {
        access_token: "synthetic-access-secret",
        refresh_token: "synthetic-refresh-secret",
        token_type: "Bearer",
        expires_in: 3600,
        scope: contract.scopes.join(" "),
        id_token: jwt(claims({ nonce: authorization.searchParams.get("nonce") })),
      };
    },
    async getJwks() { return { keys: [jwk] }; },
    async refreshTokens(input) {
      refreshCount++;
      assert.equal(Object.hasOwn(input, "scope"), false);
      assert.equal(input.refreshToken, "synthetic-refresh-secret");
      await new Promise((resolve) => setImmediate(resolve));
      return { access_token: "synthetic-refreshed-secret", refresh_token: "synthetic-rotated-secret", expires_in: 3600, token_type: "Bearer" };
    },
    async revoke() { return { status: 200 }; },
    ...overrides.transport,
  };
  const listenerFactory = overrides.listenerFactory ?? (async ({ expectedState }) => ({
    redirectUri: "http://127.0.0.1:12345/auth/callback",
    async waitForCallback() {
      return withQuery("http://127.0.0.1:12345/auth/callback", {
        state: expectedState, code: "synthetic-code", client_id: "issued-app-client",
      });
    },
    async close() { listenerClosed = true; },
  }));
  const service = new OpenAISiwcAuthorizationService({
    contract, vault, transport, listenerFactory,
    openBrowser: overrides.openBrowser ?? (async (url) => { authorization = new URL(url); }),
    clock: () => nowMs,
  });
  return { service, records, contract, get authorization() { return authorization; }, get listenerClosed() { return listenerClosed; }, get refreshCount() { return refreshCount; }, setNow(value) { nowMs = value; } };
}

test("official SIWC factory locks documented dynamic registration, resource and scopes", () => {
  const contract = createOpenAISiwcContract({ installationId: "12345678-1234-4123-8123-123456789abc" });
  assert.equal(contract.authorizationClientId, "dynamic_agent_client");
  assert.equal(contract.authorizationEndpoint, "https://auth.openai.com/api/accounts/authorize");
  assert.equal(contract.tokenEndpoint, "https://auth.openai.com/api/accounts/oauth/token");
  assert.equal(contract.resource, "https://api.openai.com/v1");
  assert.deepEqual(contract.scopes, ["openid", "profile", "email", "offline_access", "resource.invoke", "chatgpt.tokens.use.direct"]);
  assert.equal(contract.authorizationParameters.ext_agent_host_id, "urn:uuid:12345678-1234-4123-8123-123456789abc");
  assert.equal(contract.registrationParameters.agent_name_hint, "Wealth Growth Tracker");
  assert.equal(contract.acceptsIssuedClient("oaiapp_synthetic-owned-id"), true);
  assert.equal(contract.acceptsIssuedClient("another-application-client"), false);
  assert.throws(() => createOpenAISiwcContract({ installationId: "copied-client-identity" }), { code: "AUTH_DISABLED" });
  assert.throws(() => createOpenAISiwcContract({ installationId: "12345678-1234-4123-8123-123456789abc", applicationName: "name\nsecret" }), { code: "AUTH_DISABLED" });
});

test("returning authorization reuses issued client and vault ID token without registration hints", async () => {
  const fixture = makeFixture({ contract: { authorizationParameters: { ext_agent_host_id: "urn:uuid:synthetic-installation" }, registrationParameters: { agent_name_hint: "Synthetic app" } } });
  await fixture.service.signIn("profile-1");
  assert.equal(fixture.authorization.searchParams.get("agent_name_hint"), "Synthetic app");
  assert.equal(fixture.authorization.searchParams.get("id_token_hint"), null);
  const idToken = fixture.records.get("profile-1").idToken;
  await fixture.service.signIn("profile-1");
  assert.equal(fixture.authorization.searchParams.get("client_id"), "issued-app-client");
  assert.equal(fixture.authorization.searchParams.get("agent_name_hint"), null);
  assert.equal(fixture.authorization.searchParams.get("id_token_hint"), idToken);
  assert.equal(fixture.authorization.searchParams.get("ext_agent_host_id"), "urn:uuid:synthetic-installation");
});

test("authorization is disabled without a verified contract and secure vault", async () => {
  const disabled = new OpenAISiwcAuthorizationService();
  assert.equal(disabled.status.authorization, "disabled");
  await assert.rejects(disabled.signIn("profile-1"), { code: "AUTH_DISABLED" });
  const unverified = makeFixture({ contract: { verified: false } });
  await assert.rejects(unverified.service.signIn("profile-1"), { code: "AUTH_DISABLED" });
});

test("PKCE challenges, state and nonce are independent random values", () => {
  const first = createAuthorizationChallenge();
  const second = createAuthorizationChallenge();
  assert.notEqual(first.state, first.nonce);
  assert.notEqual(first.state, second.state);
  assert.equal(first.challenge, createHash("sha256").update(first.verifier, "ascii").digest("base64url"));
  assert.ok(first.verifier.length >= 43 && first.verifier.length <= 128);
});

test("JWT validation verifies signatures, issuer, audience, nonce, time and key identity", () => {
  const options = { jwks: { keys: [jwk] }, issuer: ISSUER, audience: "issued-app-client", nonce: "synthetic-nonce", nowMs: NOW };
  assert.deepEqual(verifyIdToken(jwt(claims()), options), { subject: "synthetic-subject" });
  for (const changed of [
    { iss: "https://evil.invalid" }, { aud: "another-client" }, { nonce: "wrong" },
    { exp: NOW / 1000 - 100 }, { iat: NOW / 1000 + 100 }, { sub: "" },
    { aud: ["issued-app-client", "other"], azp: "other" },
  ]) assert.throws(() => verifyIdToken(jwt(claims(changed)), options), { code: "TOKEN_REJECTED" });
  const signed = jwt(claims());
  const tampered = `${signed.slice(0, -5)}xxxxx`;
  assert.throws(() => verifyIdToken(tampered, options), { code: "TOKEN_REJECTED" });
  assert.throws(() => verifyIdToken(jwt(claims(), { alg: "none", kid: "synthetic-key" }), options), { code: "TOKEN_REJECTED" });
  assert.throws(() => verifyIdToken(jwt(claims(), { alg: "RS256", kid: "unrecognized" }), options), { code: "TOKEN_REJECTED" });
});

test("callback rejects wrong state, duplicate fields, changed issued client and foreign origin", () => {
  const redirectUri = "http://127.0.0.1:12345/auth/callback";
  const options = { redirectUri, state: "expected", registeredClientId: "issued-app-client", acceptsIssuedClient: (id) => id === "issued-app-client" };
  for (const callback of [
    withQuery(redirectUri, { state: "wrong", code: "x" }),
    withPairs(redirectUri, [["state", "expected"], ["state", "expected"], ["code", "x"]]),
    withQuery(redirectUri, { state: "expected", code: "x", client_id: "other" }),
    withQuery("http://localhost:12345/auth/callback", { state: "expected", code: "x" }),
    withQuery(redirectUri, { state: "expected", code: "x", token: "secret" }),
    `${withQuery(redirectUri, { state: "expected", code: "x" })}#fragment`,
  ]) assert.throws(() => parseCallback(callback, options), { code: "INVALID_CALLBACK" });
  assert.throws(() => parseCallback(withQuery(redirectUri, { state: "expected", error: "access_denied", error_description: "secret" }), options), { code: "ACCESS_DENIED" });
});

test("successful synthetic sign-in writes only to vault and returns token-free session metadata", async () => {
  const fixture = makeFixture();
  const result = await fixture.service.signIn("profile-1");
  assert.equal(result.status, "signed-in");
  assert.equal(result.subject, "synthetic-subject");
  assert.equal(fixture.records.get("profile-1").clientId, "issued-app-client");
  assert.equal(fixture.records.get("profile-1").refreshToken, "synthetic-refresh-secret");
  assert.doesNotMatch(JSON.stringify(result), /synthetic-access-secret|synthetic-refresh-secret|id_token/);
  assert.equal(fixture.listenerClosed, true);
});

test("denial, cancellation and provider exceptions never save credentials or expose raw details", async () => {
  const fixture = makeFixture({ transport: { exchangeCode: async () => { throw new Error("token=synthetic-sensitive-value"); } } });
  await assert.rejects(fixture.service.signIn("profile-1"), (error) => error.code === "NETWORK_FAILED" && !error.message.includes("sensitive"));
  assert.equal(fixture.records.size, 0);
  assert.equal(fixture.listenerClosed, true);
  let closed = false;
  const cancelled = makeFixture({ listenerFactory: async () => ({
    redirectUri: "http://127.0.0.1:12345/auth/callback",
    waitForCallback: async () => new Promise(() => {}),
    close: async () => { closed = true; },
  }) });
  const pending = cancelled.service.signIn("profile-2");
  await new Promise((resolve) => setImmediate(resolve));
  cancelled.service.cancel("profile-2");
  await assert.rejects(pending, { code: "CANCELLED" });
  assert.equal(closed, true);
  assert.equal(cancelled.records.size, 0);
});

test("vault failure never falls back to plaintext or returns a successful session", async () => {
  const fixture = makeFixture({ vault: { write: async () => { throw new Error("private path credential"); } } });
  await assert.rejects(fixture.service.signIn("profile-1"), (error) => error.code === "VAULT_UNAVAILABLE" && !error.message.includes("private path"));
  assert.equal(fixture.records.size, 0);
  assert.equal(fixture.listenerClosed, true);
});

test("refresh is serialized per profile, omits scope and saves rotated refresh token", async () => {
  const fixture = makeFixture();
  await fixture.service.signIn("profile-1");
  fixture.setNow(NOW + 3_600_000);
  const results = await Promise.all(Array.from({ length: 5 }, () => fixture.service.withAccessToken("profile-1", (token) => token === "synthetic-refreshed-secret")));
  assert.deepEqual(results, [true, true, true, true, true]);
  assert.equal(fixture.refreshCount, 1);
  assert.equal(fixture.records.get("profile-1").refreshToken, "synthetic-rotated-secret");
});

test("profiles cannot access each other's stored tokens", async () => {
  const fixture = makeFixture();
  await fixture.service.signIn("profile-1");
  await assert.rejects(fixture.service.withAccessToken("profile-2", () => true), { code: "REFRESH_REQUIRED" });
  assert.equal(fixture.records.has("profile-2"), false);
});

test("scope expansion and invalid identity fail before vault commit", async () => {
  const fixture = makeFixture({ transport: { exchangeCode: async () => ({
    access_token: "synthetic-secret", token_type: "Bearer", expires_in: 3600,
    scope: "openid profile offline_access unexpected.admin", id_token: "invalid",
  }) } });
  await assert.rejects(fixture.service.signIn("profile-1"), { code: "TOKEN_REJECTED" });
  assert.equal(fixture.records.size, 0);
});

test("sign out clears vault and distinguishes confirmed from failed remote revocation", async () => {
  const fixture = makeFixture();
  await fixture.service.signIn("profile-1");
  assert.deepEqual(await fixture.service.signOut("profile-1"), { profileId: "profile-1", signedOut: true, remoteRevocation: "confirmed" });
  assert.equal(fixture.records.size, 0);
  const offline = makeFixture({ transport: { revoke: async () => { throw new Error("refresh-token-sensitive-value"); } } });
  await offline.service.signIn("profile-1");
  const result = await offline.service.signOut("profile-1");
  assert.equal(result.remoteRevocation, "unconfirmed");
  assert.equal(offline.records.size, 0);
  assert.doesNotMatch(JSON.stringify(result), /sensitive/);
});

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const outgoing = request(url, { method: "GET", agent: false }, (response) => {
      response.resume();
      response.once("end", () => resolve({ status: response.statusCode, headers: response.headers }));
    });
    outgoing.once("error", reject);
    outgoing.end();
  });
}

test("loopback listener binds literal 127.0.0.1 and ignores forged state before valid callback", async () => {
  const expectedState = "synthetic-state-with-more-than-thirty-two-characters";
  const listener = await createLoopbackListener({ expectedState });
  try {
    assert.equal(new URL(listener.redirectUri).hostname, "127.0.0.1");
    const forged = await httpGet(withQuery(listener.redirectUri, { state: "forged", code: "x" }));
    assert.equal(forged.status, 400);
    const valid = await httpGet(withQuery(listener.redirectUri, { state: expectedState, code: "synthetic-code" }));
    assert.equal(valid.status, 200);
    assert.equal(valid.headers["cache-control"], "no-store");
    assert.match(await listener.waitForCallback(new AbortController().signal), /synthetic-code/);
  } finally { await listener.close(); }
});
