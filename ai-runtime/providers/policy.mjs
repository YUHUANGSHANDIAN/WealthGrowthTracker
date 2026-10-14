import { BlockList, isIP } from "node:net";

const excludedV6 = new BlockList();
for (const [address, prefix] of [["2001::", 32], ["2001:db8::", 32], ["2002::", 16]]) excludedV6.addSubnet(address, prefix, "ipv6");

export class ProviderError extends Error {
  constructor(code = "PROVIDER_FAILED") { super(code); this.name = "ProviderError"; this.code = code; }
}

const FIXED_ENDPOINTS = Object.freeze({
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  deepseek: "https://api.deepseek.com/v1",
});
const LOOPBACK = new Set(["127.0.0.1", "[::1]"]);

export function validateProfile(value) {
  const profile = { ...value };
  const local = profile.providerId === "ollama" || profile.providerId === "lmstudio";
  if (profile.providerId === "copilot") {
    if (profile.authKind !== "copilot-subscription" || !profile.credential || profile.endpoint !== undefined) throw new ProviderError("INVALID_PROFILE");
    return Object.freeze(profile);
  }
  if (profile.authKind === "openai-subscription") {
    if (profile.providerId !== "openai" || !profile.credential || profile.endpoint !== undefined) throw new ProviderError("INVALID_PROFILE");
    return Object.freeze({ ...profile, endpoint: FIXED_ENDPOINTS.openai });
  }
  if (local ? profile.authKind !== "local" : profile.authKind !== "api-key") throw new ProviderError("INVALID_PROFILE");
  if (!local && !profile.credential) throw new ProviderError("INVALID_PROFILE");
  // Pi recognizes Claude Code OAuth tokens automatically; this app permits Anthropic API credentials only.
  if (profile.providerId === "anthropic" && profile.credential.includes("sk-ant-oat")) throw new ProviderError("INVALID_PROFILE");
  if (local && profile.credential !== undefined) throw new ProviderError("INVALID_PROFILE");
  if (FIXED_ENDPOINTS[profile.providerId]) {
    if (profile.endpoint !== undefined && profile.endpoint.replace(/\/$/, "") !== FIXED_ENDPOINTS[profile.providerId]) throw new ProviderError("INVALID_PROFILE");
    profile.endpoint = FIXED_ENDPOINTS[profile.providerId];
  } else {
    let endpoint;
    try { endpoint = new URL(profile.endpoint); } catch { throw new ProviderError("INVALID_PROFILE"); }
    if (endpoint.username || endpoint.password || endpoint.hash || endpoint.search || endpoint.pathname.replace(/\/$/, "") !== "/v1") throw new ProviderError("INVALID_PROFILE");
    if (local) {
      // Literal addresses avoid localhost DNS/proxy ambiguity and LAN metadata access.
      if (!LOOPBACK.has(endpoint.hostname) || !["http:", "https:"].includes(endpoint.protocol) || !endpoint.port || Number(endpoint.port) < 1024) throw new ProviderError("INVALID_PROFILE");
      if (profile.providerId === "ollama" && /(?:^|[:/])cloud(?:$|[:/])/i.test(profile.modelId)) throw new ProviderError("INVALID_PROFILE");
    } else if (profile.providerId !== "gateway" || endpoint.protocol !== "https:" || isPrivateHost(endpoint.hostname)) {
      throw new ProviderError("INVALID_PROFILE");
    }
    profile.endpoint = endpoint.href.replace(/\/$/, "");
  }
  return Object.freeze(profile);
}

export function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || !host.includes(".")) return true;
  if (isIP(host) === 4) {
    const octets = host.split(".").map(Number);
    return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 || octets[0] >= 224 ||
      (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127);
  }
  if (isIP(host) === 6) return true; // v1 gateway policy rejects all literal IPv6, including mapped addresses.
  return false;
}

// Gateway literals remain stricter than DNS. Public DNS may legitimately return IPv6.
export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    if (isPrivateHost(address)) return false;
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 192 && b === 0 && (c === 0 || c === 2)) && !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) && !(a === 203 && b === 0 && c === 113);
  }
  return family === 6 && /^[23]/.test(address) && !excludedV6.check(address, "ipv6");
}

export function responseError(status) {
  return new ProviderError(status === 401 ? "AUTH_REQUIRED" : status === 403 ? "ACCESS_DENIED" : status === 429 ? "RATE_LIMITED" : "PROVIDER_FAILED");
}

export function tokenCount(value) { return Number.isSafeInteger(value) && value >= 0 ? value : null; }

export function toModelInfo(value) {
  const id = typeof value?.id === "string" ? value.id : typeof value?.slug === "string" ? value.slug : null;
  if (!id || id.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/.test(id)) return null;
  const name = typeof value.display_name === "string" ? value.display_name : typeof value.name === "string" ? value.name : id;
  return {
    id, name: name.slice(0, 160), input: ["text"],
    contextWindow: tokenCount(value.context_window ?? value.contextWindow),
    maxOutputTokens: tokenCount(value.max_output_tokens ?? value.maxOutputTokens),
  };
}
