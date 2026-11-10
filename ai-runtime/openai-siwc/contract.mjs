import { AuthorizationError } from "./security.mjs";

// Verified against the official open-source token-sharing flow on 2026-10-13.
// This contract does not assert app eligibility, account authorization or subscription entitlement.
export function createOpenAISiwcContract({ installationId, applicationName = "WealthGrowthTracker" } = {}) {
  if (typeof installationId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(installationId) ||
      typeof applicationName !== "string" || !applicationName.trim() || applicationName.length > 100 ||
      /[\r\n\0]/.test(applicationName)) throw new AuthorizationError("AUTH_DISABLED");
  return Object.freeze({
    verified: true,
    evidence: Object.freeze({
      sourceUrl: "https://developers.openai.com/siwc/token-sharing-open-source/sign-in",
      checkedOn: "2026-10-13",
    }),
    issuer: "https://auth.openai.com",
    authorizationEndpoint: "https://auth.openai.com/api/accounts/authorize",
    tokenEndpoint: "https://auth.openai.com/api/accounts/oauth/token",
    jwksEndpoint: "https://auth.openai.com/.well-known/jwks.json",
    resource: "https://api.openai.com/v1",
    authorizationClientId: "dynamic_agent_client",
    scopes: Object.freeze(["openid", "profile", "email", "offline_access", "resource.invoke", "chatgpt.tokens.use.direct"]),
    authorizationParameters: Object.freeze({ ext_agent_host_id: `urn:uuid:${installationId.toLowerCase()}` }),
    registrationParameters: Object.freeze({ agent_name_hint: applicationName.trim() }),
    acceptsIssuedClient: (clientId) => typeof clientId === "string" && /^oaiapp_[A-Za-z0-9_-]{1,200}$/.test(clientId),
    algorithms: Object.freeze(["RS256"]),
  });
}
