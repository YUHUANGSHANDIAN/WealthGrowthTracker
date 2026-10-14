import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";

const ERRORS = {
  AUTH_DISABLED: "The official authorization contract has not been verified for this application.",
  AUTH_BUSY: "An authorization attempt is already in progress for this profile.",
  INVALID_CALLBACK: "The authorization callback did not pass validation.",
  ACCESS_DENIED: "Authorization was denied.",
  TOKEN_REJECTED: "The provider token did not pass validation.",
  VAULT_UNAVAILABLE: "Secure credential storage is unavailable.",
  NETWORK_FAILED: "The authorization request failed.",
  CANCELLED: "Authorization was cancelled.",
  REFRESH_REQUIRED: "Sign in is required for this profile.",
};

export class AuthorizationError extends Error {
  constructor(code) {
    super(ERRORS[code] ?? ERRORS.NETWORK_FAILED);
    this.name = "AuthorizationError";
    this.code = Object.hasOwn(ERRORS, code) ? code : "NETWORK_FAILED";
  }
}

export function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createAuthorizationChallenge() {
  const verifier = randomBytes(48).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier, "ascii").digest("base64url"),
    state: randomBytes(32).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
  };
}

function decodePart(part) {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new AuthorizationError("TOKEN_REJECTED");
  const bytes = Buffer.from(part, "base64url");
  if (bytes.toString("base64url") !== part) throw new AuthorizationError("TOKEN_REJECTED");
  return bytes;
}

export function verifyIdToken(token, { jwks, issuer, audience, nonce, nowMs, algorithms = ["RS256"], maxAgeSeconds = 600 }) {
  try {
    if (typeof token !== "string" || token.length > 16_384) throw new Error();
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error();
    const header = JSON.parse(decodePart(parts[0]).toString("utf8"));
    const claims = JSON.parse(decodePart(parts[1]).toString("utf8"));
    if (!header || typeof header !== "object" || header.crit !== undefined ||
        !algorithms.includes(header.alg) || !["RS256", "ES256"].includes(header.alg) ||
        typeof header.kid !== "string" || header.kid.length > 256 ||
        (header.typ !== undefined && header.typ !== "JWT")) throw new Error();
    if (!jwks || !Array.isArray(jwks.keys) || jwks.keys.length > 32 || JSON.stringify(jwks).length > 65_536) throw new Error();
    const keys = jwks.keys.filter((key) => key.kid === header.kid &&
      (key.alg === undefined || key.alg === header.alg) && (key.use === undefined || key.use === "sig") &&
      (key.key_ops === undefined || (Array.isArray(key.key_ops) && key.key_ops.includes("verify"))));
    if (keys.length !== 1) throw new Error();
    const jwk = keys[0];
    if (["d", "p", "q", "dp", "dq", "qi"].some((part) => Object.hasOwn(jwk, part)) ||
        (jwk.n !== undefined && (typeof jwk.n !== "string" || jwk.n.length > 1_400)) ||
        (jwk.e !== undefined && (typeof jwk.e !== "string" || jwk.e.length > 16))) throw new Error();
    if ((header.alg === "RS256" && jwk.kty !== "RSA") ||
        (header.alg === "ES256" && (jwk.kty !== "EC" || jwk.crv !== "P-256"))) throw new Error();
    const publicKey = createPublicKey({ key: jwk, format: "jwk" });
    if (header.alg === "RS256" && publicKey.asymmetricKeyDetails?.modulusLength < 2048) throw new Error();
    const keyOptions = header.alg === "ES256" ? { key: publicKey, dsaEncoding: "ieee-p1363" } : publicKey;
    if (!verify("sha256", Buffer.from(`${parts[0]}.${parts[1]}`, "ascii"), keyOptions, decodePart(parts[2]))) throw new Error();
    const now = Math.floor(nowMs / 1000);
    const audiences = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
    if (!Array.isArray(audiences) || !audiences.every((item) => typeof item === "string") ||
        !audiences.includes(audience) || (audiences.length > 1 && claims.azp !== audience) ||
        (claims.azp !== undefined && claims.azp !== audience) || claims.iss !== issuer ||
        typeof claims.sub !== "string" || claims.sub.length === 0 || claims.sub.length > 256 ||
        !Number.isSafeInteger(claims.exp) || claims.exp <= now - 30 ||
        !Number.isSafeInteger(claims.iat) || claims.iat > now + 30 || claims.iat < now - maxAgeSeconds ||
        claims.exp <= claims.iat || (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > now + 30)) ||
        (nonce !== undefined && !constantTimeEqual(claims.nonce, nonce))) throw new Error();
    return { subject: claims.sub };
  } catch {
    throw new AuthorizationError("TOKEN_REJECTED");
  }
}

export function parseCallback(callbackUrl, { redirectUri, state, registeredClientId, acceptsIssuedClient }) {
  try {
    const callback = new URL(callbackUrl);
    const expected = new URL(redirectUri);
    const allowed = new Set(["code", "state", "client_id", "error", "error_description", "error_uri"]);
    if (callback.origin !== expected.origin || callback.pathname !== expected.pathname || callback.hash ||
        callback.username || callback.password || callback.href.length > 8_192 ||
        [...callback.searchParams.keys()].some((key) => !allowed.has(key) || callback.searchParams.getAll(key).length !== 1) ||
        !constantTimeEqual(callback.searchParams.get("state"), state)) throw new Error();
    if (callback.searchParams.has("error")) {
      if (callback.searchParams.has("code")) throw new Error();
      throw new AuthorizationError("ACCESS_DENIED");
    }
    const code = callback.searchParams.get("code");
    const issuedClientId = callback.searchParams.get("client_id") ?? registeredClientId;
    if (typeof code !== "string" || code.length === 0 || code.length > 4_096 ||
        typeof issuedClientId !== "string" || issuedClientId.length === 0 || issuedClientId.length > 256 ||
        (registeredClientId && issuedClientId !== registeredClientId) || !acceptsIssuedClient(issuedClientId)) throw new Error();
    return { code, clientId: issuedClientId };
  } catch (error) {
    if (error instanceof AuthorizationError && error.code === "ACCESS_DENIED") throw error;
    throw new AuthorizationError("INVALID_CALLBACK");
  }
}
