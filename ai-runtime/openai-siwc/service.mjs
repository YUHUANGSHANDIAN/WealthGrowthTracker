import { AuthorizationError, createAuthorizationChallenge, parseCallback, verifyIdToken } from "./security.mjs";
import { createLoopbackListener } from "./loopback.mjs";

const PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RESERVED_PARAMETERS = new Set(["client_id", "redirect_uri", "response_type", "scope", "resource", "state", "nonce", "code_challenge", "code_challenge_method", "id_token_hint"]);

function requireProfileId(profileId) {
  if (typeof profileId !== "string" || !PROFILE_ID.test(profileId)) throw new AuthorizationError("AUTH_DISABLED");
}

function httpsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) throw new Error();
  return url;
}

function copyVerifiedContract(contract) {
  try {
    if (contract?.verified !== true || !contract.evidence ||
        new URL(contract.evidence.sourceUrl).hostname !== "developers.openai.com" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(contract.evidence.checkedOn) ||
        typeof contract.authorizationClientId !== "string" || !contract.authorizationClientId ||
        contract.authorizationClientId.length > 256 || !Array.isArray(contract.scopes) ||
        contract.scopes.length > 20 || !contract.scopes.includes("openid") ||
        contract.scopes.some((scope) => typeof scope !== "string" || !/^[A-Za-z0-9._:-]{1,100}$/.test(scope)) ||
        new Set(contract.scopes).size !== contract.scopes.length ||
        typeof contract.acceptsIssuedClient !== "function") return null;
    httpsUrl(contract.issuer);
    const issuer = contract.issuer;
    const authorizationEndpoint = httpsUrl(contract.authorizationEndpoint).href;
    const tokenEndpoint = httpsUrl(contract.tokenEndpoint).href;
    const jwksEndpoint = httpsUrl(contract.jwksEndpoint).href;
    const revocationEndpoint = contract.revocationEndpoint ? httpsUrl(contract.revocationEndpoint).href : null;
    const resource = contract.resource ? httpsUrl(contract.resource).href.replace(/\/$/, "") : null;
    const authorizationParameters = { ...contract.authorizationParameters };
    const registrationParameters = { ...contract.registrationParameters };
    if (contract.algorithms !== undefined && (!Array.isArray(contract.algorithms) || !contract.algorithms.length ||
        contract.algorithms.some((algorithm) => !["RS256", "ES256"].includes(algorithm)))) return null;
    if (Object.entries({ ...authorizationParameters, ...registrationParameters }).some(([key, value]) =>
      RESERVED_PARAMETERS.has(key) || !/^[A-Za-z0-9_]{1,100}$/.test(key) || typeof value !== "string" || value.length > 256)) return null;
    return Object.freeze({
      issuer, authorizationEndpoint, tokenEndpoint, jwksEndpoint, revocationEndpoint, resource,
      authorizationClientId: contract.authorizationClientId,
      scopes: Object.freeze([...contract.scopes]),
      authorizationParameters: Object.freeze(authorizationParameters),
      registrationParameters: Object.freeze(registrationParameters),
      acceptsIssuedClient: contract.acceptsIssuedClient,
      algorithms: Object.freeze([...(contract.algorithms ?? ["RS256"])]),
    });
  } catch { return null; }
}

async function abortable(work, signal) {
  if (signal.aborted) throw new AuthorizationError("CANCELLED");
  let onAbort;
  const cancelled = new Promise((_, reject) => {
    onAbort = () => reject(new AuthorizationError("CANCELLED"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([Promise.resolve().then(work), cancelled]); }
  finally { signal.removeEventListener("abort", onAbort); }
}

function readTokenResponse(value, { scopes, previous, nowMs }) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      typeof value.access_token !== "string" || !value.access_token || value.access_token.length > 16_384 ||
      typeof value.token_type !== "string" || value.token_type.toLowerCase() !== "bearer" ||
      !Number.isSafeInteger(value.expires_in) || value.expires_in <= 0 || value.expires_in > 86_400 ||
      (value.refresh_token !== undefined && (typeof value.refresh_token !== "string" || !value.refresh_token || value.refresh_token.length > 16_384)) ||
      (value.id_token !== undefined && (typeof value.id_token !== "string" || value.id_token.length > 16_384)) ||
      (value.scope !== undefined && typeof value.scope !== "string")) throw new AuthorizationError("TOKEN_REJECTED");
  const granted = value.scope === undefined ? (previous?.scopes ?? scopes) : value.scope.split(" ");
  if (!granted.length || new Set(granted).size !== granted.length ||
      granted.some((scope) => !scopes.includes(scope)) || !scopes.every((scope) => granted.includes(scope))) {
    throw new AuthorizationError("TOKEN_REJECTED");
  }
  return {
    accessToken: value.access_token,
    refreshToken: value.refresh_token ?? previous?.refreshToken ?? null,
    expiresAt: nowMs + value.expires_in * 1_000,
    scopes: [...granted],
  };
}

export class OpenAISiwcAuthorizationService {
  #contract;
  #vault;
  #transport;
  #openBrowser;
  #listenerFactory;
  #clock;
  #active = new Map();
  #locks = new Map();
  #generation = new Map();

  constructor({ contract, vault, transport, openBrowser, listenerFactory = createLoopbackListener, clock = Date.now } = {}) {
    this.#contract = copyVerifiedContract(contract);
    this.#vault = vault;
    this.#transport = transport;
    this.#openBrowser = openBrowser;
    this.#listenerFactory = listenerFactory;
    this.#clock = clock;
  }

  get status() {
    return { providerId: "openai", authorization: this.#isReady() ? "contract-configured" : "disabled", realAccountVerified: false };
  }

  #isReady() {
    return Boolean(this.#contract && this.#vault && typeof this.#vault.load === "function" &&
      typeof this.#vault.write === "function" && typeof this.#vault.remove === "function" &&
      this.#transport && typeof this.#transport.exchangeCode === "function" &&
      typeof this.#transport.refreshTokens === "function" && typeof this.#transport.getJwks === "function" &&
      typeof this.#openBrowser === "function");
  }

  #assertReady(profileId) {
    requireProfileId(profileId);
    if (!this.#isReady()) throw new AuthorizationError("AUTH_DISABLED");
  }

  async #vaultCall(method, ...args) {
    try { return await this.#vault[method](...args); }
    catch { throw new AuthorizationError("VAULT_UNAVAILABLE"); }
  }

  async #lock(profileId, operation) {
    const previous = this.#locks.get(profileId) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    const queue = previous.catch(() => {}).then(() => current);
    this.#locks.set(profileId, queue);
    await previous.catch(() => {});
    try { return await operation(); }
    finally { release(); if (this.#locks.get(profileId) === queue) this.#locks.delete(profileId); }
  }

  #publicSession(profileId, record) {
    return { profileId, status: "signed-in", subject: record.subject, expiresAt: record.expiresAt, scopes: [...record.scopes] };
  }

  async signIn(profileId, { signal, timeoutMs = 120_000 } = {}) {
    this.#assertReady(profileId);
    if (this.#active.has(profileId)) throw new AuthorizationError("AUTH_BUSY");
    const controller = new AbortController();
    const generation = this.#generation.get(profileId) ?? 0;
    this.#active.set(profileId, controller);
    const onAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), Math.max(1, Math.min(timeoutMs, 300_000)));
    let listener;
    try {
      if (controller.signal.aborted) throw new AuthorizationError("CANCELLED");
      const existing = await this.#vaultCall("load", profileId);
      if (existing && (!this.#contract.acceptsIssuedClient(existing.clientId) ||
          typeof existing.subject !== "string" || !existing.subject ||
          (existing.idToken !== undefined && (typeof existing.idToken !== "string" || existing.idToken.length > 16_384)))) {
        throw new AuthorizationError("TOKEN_REJECTED");
      }
      const challenge = createAuthorizationChallenge();
      listener = await this.#listenerFactory({ callbackPath: "/auth/callback", expectedState: challenge.state });
      const redirect = new URL(listener.redirectUri);
      if (redirect.protocol !== "http:" || redirect.hostname !== "127.0.0.1" || redirect.pathname !== "/auth/callback" ||
          !redirect.port || redirect.search || redirect.hash || redirect.username || redirect.password) {
        throw new AuthorizationError("INVALID_CALLBACK");
      }
      const authorization = new URL(this.#contract.authorizationEndpoint);
      const fields = {
        ...this.#contract.authorizationParameters,
        ...(!existing ? this.#contract.registrationParameters : {}),
        client_id: existing?.clientId ?? this.#contract.authorizationClientId,
        redirect_uri: listener.redirectUri,
        response_type: "code",
        scope: this.#contract.scopes.join(" "),
        state: challenge.state,
        nonce: challenge.nonce,
        code_challenge: challenge.challenge,
        code_challenge_method: "S256",
      };
      if (this.#contract.resource) fields.resource = this.#contract.resource;
      if (existing?.idToken) fields.id_token_hint = existing.idToken;
      for (const [key, value] of Object.entries(fields)) authorization.searchParams.set(key, value);
      await abortable(() => this.#openBrowser(authorization.href), controller.signal);
      const callbackUrl = await abortable(() => listener.waitForCallback(controller.signal), controller.signal);
      const callback = parseCallback(callbackUrl, {
        redirectUri: listener.redirectUri,
        state: challenge.state,
        registeredClientId: existing?.clientId,
        acceptsIssuedClient: this.#contract.acceptsIssuedClient,
      });
      const rawTokens = await abortable(() => this.#transport.exchangeCode({
        tokenEndpoint: this.#contract.tokenEndpoint,
        clientId: callback.clientId,
        code: callback.code,
        codeVerifier: challenge.verifier,
        redirectUri: listener.redirectUri,
        resource: this.#contract.resource,
        signal: controller.signal,
      }), controller.signal);
      const tokens = readTokenResponse(rawTokens, { scopes: this.#contract.scopes, nowMs: this.#clock() });
      const jwks = await abortable(() => this.#transport.getJwks({ jwksEndpoint: this.#contract.jwksEndpoint, signal: controller.signal }), controller.signal);
      const identity = verifyIdToken(rawTokens.id_token, {
        jwks, issuer: this.#contract.issuer, audience: callback.clientId, nonce: challenge.nonce,
        nowMs: this.#clock(), algorithms: this.#contract.algorithms,
      });
      if (existing && identity.subject !== existing.subject) throw new AuthorizationError("TOKEN_REJECTED");
      const record = { ...tokens, idToken: rawTokens.id_token, clientId: callback.clientId, subject: identity.subject };
      await this.#lock(profileId, async () => {
        if (controller.signal.aborted || generation !== (this.#generation.get(profileId) ?? 0)) throw new AuthorizationError("CANCELLED");
        await this.#vaultCall("write", profileId, record);
      });
      return this.#publicSession(profileId, record);
    } catch (error) {
      if (controller.signal.aborted) throw new AuthorizationError("CANCELLED");
      throw error instanceof AuthorizationError ? error : new AuthorizationError("NETWORK_FAILED");
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      try { await listener?.close(); } catch { /* Credentials and callback details are never logged. */ }
      this.#active.delete(profileId);
    }
  }

  cancel(profileId) {
    requireProfileId(profileId);
    this.#active.get(profileId)?.abort();
  }

  async withAccessToken(profileId, consumer) {
    this.#assertReady(profileId);
    if (typeof consumer !== "function") throw new AuthorizationError("AUTH_DISABLED");
    const record = await this.#lock(profileId, async () => {
      const stored = await this.#vaultCall("load", profileId);
      if (!stored || !this.#contract.acceptsIssuedClient(stored.clientId)) throw new AuthorizationError("REFRESH_REQUIRED");
      if (stored.expiresAt > this.#clock() + 60_000) return stored;
      if (!stored.refreshToken) throw new AuthorizationError("REFRESH_REQUIRED");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        const raw = await abortable(() => this.#transport.refreshTokens({
          tokenEndpoint: this.#contract.tokenEndpoint,
          clientId: stored.clientId,
          refreshToken: stored.refreshToken,
          resource: this.#contract.resource,
          signal: controller.signal,
        }), controller.signal);
        const tokens = readTokenResponse(raw, { scopes: this.#contract.scopes, previous: stored, nowMs: this.#clock() });
        if (raw.id_token) {
          const jwks = await abortable(() => this.#transport.getJwks({ jwksEndpoint: this.#contract.jwksEndpoint, signal: controller.signal }), controller.signal);
          const identity = verifyIdToken(raw.id_token, {
            jwks, issuer: this.#contract.issuer, audience: stored.clientId, nowMs: this.#clock(), algorithms: this.#contract.algorithms,
          });
          if (identity.subject !== stored.subject) throw new AuthorizationError("TOKEN_REJECTED");
        }
        const refreshed = { ...stored, ...tokens, idToken: raw.id_token ?? stored.idToken };
        await this.#vaultCall("write", profileId, refreshed);
        return refreshed;
      } catch (error) {
        throw error instanceof AuthorizationError ? error : new AuthorizationError("NETWORK_FAILED");
      } finally { clearTimeout(timer); }
    });
    // This method is for the private broker/provider adapter. Never forward its consumer to the renderer.
    return consumer(record.accessToken);
  }

  async signOut(profileId) {
    this.#assertReady(profileId);
    this.cancel(profileId);
    this.#generation.set(profileId, (this.#generation.get(profileId) ?? 0) + 1);
    return this.#lock(profileId, async () => {
      const stored = await this.#vaultCall("load", profileId);
      await this.#vaultCall("remove", profileId);
      if (!stored?.refreshToken) return { profileId, signedOut: true, remoteRevocation: "not-needed" };
      if (!this.#contract.revocationEndpoint || typeof this.#transport.revoke !== "function") {
        return { profileId, signedOut: true, remoteRevocation: "unconfirmed" };
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const result = await abortable(() => this.#transport.revoke({
          revocationEndpoint: this.#contract.revocationEndpoint,
          clientId: stored.clientId,
          refreshToken: stored.refreshToken,
          tokenTypeHint: "refresh_token",
          signal: controller.signal,
        }), controller.signal);
        return { profileId, signedOut: true, remoteRevocation: result?.status === 200 ? "confirmed" : "unconfirmed" };
      } catch {
        return { profileId, signedOut: true, remoteRevocation: "unconfirmed" };
      } finally { clearTimeout(timeout); }
    });
  }
}
