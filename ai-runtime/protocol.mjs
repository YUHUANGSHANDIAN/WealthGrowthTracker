export const PROTOCOL_VERSION = 1;
export const MAX_FRAME_BYTES = 64 * 1024;
export const MAX_INPUT_TEXT_LENGTH = 8_000;
export const MAX_FACTS = 48;
export const MAX_FACT_VALUE_LENGTH = 512;

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TASKS = new Set([
  "report-interpretation",
  "analysis-question",
  "entry-draft",
  "data-health-explanation",
  "goal-scenario",
]);
const PROVIDERS = new Set([
  "openai",
  "copilot",
  "anthropic",
  "deepseek",
  "ollama",
  "lmstudio",
  "gateway",
]);
const FACT_UNITS = new Set(["CNY", "percent", "count", "text"]);
const AUTH_KINDS = new Set(["api-key", "local", "copilot-subscription", "openai-subscription"]);

export class ProtocolError extends Error {
  constructor(code, requestId = null) {
    super(code);
    this.name = "ProtocolError";
    this.code = code;
    this.requestId = requestId;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, required, optional = []) {
  if (!isRecord(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
}

function isIdentifier(value) {
  return typeof value === "string" && REQUEST_ID.test(value);
}

function validateFact(fact) {
  if (!exactKeys(fact, ["factId", "label", "value", "unit"], ["asOf"])) return false;
  if (!isIdentifier(fact.factId) || typeof fact.label !== "string" || fact.label.length > 120) return false;
  if (typeof fact.value !== "string" || fact.value.length > MAX_FACT_VALUE_LENGTH) return false;
  if (!FACT_UNITS.has(fact.unit)) return false;
  if (fact.asOf === undefined) return true;
  if (typeof fact.asOf !== "string" || !ISO_DATE.test(fact.asOf)) return false;
  const parsed = new Date(`${fact.asOf}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === fact.asOf;
}

export function parseRequest(rawLine, { allowManagement = false } = {}) {
  if (typeof rawLine !== "string" || Buffer.byteLength(rawLine, "utf8") > MAX_FRAME_BYTES) {
    throw new ProtocolError("FRAME_TOO_LARGE");
  }

  let value;
  try {
    value = JSON.parse(rawLine);
  } catch {
    throw new ProtocolError("INVALID_JSON");
  }

  const requestId = isRecord(value) && isIdentifier(value.requestId) ? value.requestId : null;
  if (!isRecord(value) || value.protocolVersion !== PROTOCOL_VERSION || !requestId || typeof value.operation !== "string") {
    throw new ProtocolError("INVALID_REQUEST", requestId);
  }

  if (value.operation === "status") {
    if (!exactKeys(value, ["protocolVersion", "requestId", "operation"])) {
      throw new ProtocolError("INVALID_REQUEST", requestId);
    }
    return value;
  }

  if (value.operation === "cancel") {
    if (!exactKeys(value, ["protocolVersion", "requestId", "operation", "targetRequestId"]) ||
        !isIdentifier(value.targetRequestId)) {
      throw new ProtocolError("INVALID_REQUEST", requestId);
    }
    return value;
  }

  // Management frames are private Broker IPC, never renderer inference input.
  if (allowManagement && value.operation === "configure") {
    if (!exactKeys(value, ["protocolVersion", "requestId", "operation", "profile"]) ||
        !exactKeys(value.profile, ["profileId", "providerId", "authKind", "modelId"], ["endpoint", "credential"]) ||
        !isIdentifier(value.profile.profileId) || !PROVIDERS.has(value.profile.providerId) ||
        !AUTH_KINDS.has(value.profile.authKind) || typeof value.profile.modelId !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,159}$/.test(value.profile.modelId) ||
        (value.profile.endpoint !== undefined && (typeof value.profile.endpoint !== "string" || value.profile.endpoint.length > 2_048)) ||
        (value.profile.credential !== undefined && (typeof value.profile.credential !== "string" ||
          !value.profile.credential || value.profile.credential.length > 16_384 || /[\r\n\0]/.test(value.profile.credential)))) {
      throw new ProtocolError("INVALID_REQUEST", requestId);
    }
    return value;
  }

  if (value.operation === "models" || (allowManagement && value.operation === "removeProfile")) {
    const required = ["protocolVersion", "requestId", "operation", "profileId"];
    if (value.operation === "models") required.push("providerId");
    if (!exactKeys(value, required) || !isIdentifier(value.profileId) ||
        (value.operation === "models" && !PROVIDERS.has(value.providerId))) {
      throw new ProtocolError("INVALID_REQUEST", requestId);
    }
    return value;
  }

  if (value.operation !== "infer" || !exactKeys(value, [
    "protocolVersion", "requestId", "operation", "profileId", "providerId", "task", "input",
  ])) {
    throw new ProtocolError("INVALID_REQUEST", requestId);
  }
  if (!isIdentifier(value.profileId) || !PROVIDERS.has(value.providerId) || !TASKS.has(value.task)) {
    throw new ProtocolError("INVALID_REQUEST", requestId);
  }
  if (!exactKeys(value.input, ["text", "facts"]) || typeof value.input.text !== "string" ||
      value.input.text.length > MAX_INPUT_TEXT_LENGTH || !Array.isArray(value.input.facts) ||
      value.input.facts.length > MAX_FACTS || !value.input.facts.every(validateFact)) {
    throw new ProtocolError("INVALID_REQUEST", requestId);
  }
  const factIds = value.input.facts.map((fact) => fact.factId);
  if (new Set(factIds).size !== factIds.length) throw new ProtocolError("INVALID_REQUEST", requestId);
  return value;
}

export function errorResponse(requestId, code) {
  const messages = {
    INVALID_REQUEST: "The request does not match the supported protocol.",
    INVALID_JSON: "The request is not valid JSON.",
    FRAME_TOO_LARGE: "The request exceeds the protocol size limit.",
    AI_DISABLED: "AI is disabled for this runtime.",
    PROVIDER_UNAVAILABLE: "This provider is not implemented in this build.",
    REQUEST_IN_PROGRESS: "A request with this identifier is already in progress.",
    CANCELLED: "The request was cancelled.",
    TIMEOUT: "The provider request timed out.",
    PROVIDER_FAILED: "The provider request failed.",
    PROFILE_UNAVAILABLE: "The connection profile is not configured.",
    INVALID_PROFILE: "The connection profile does not match the supported policy.",
    QUALIFICATION_REQUIRED: "The subscription connection requires separate qualification and authorization.",
    AUTH_REQUIRED: "The provider rejected this connection's credentials.",
    ACCESS_DENIED: "The provider denied access to this connection.",
    RATE_LIMITED: "The provider rate limit was reached.",
  };
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: isIdentifier(requestId) ? requestId : null,
    ok: false,
    error: { code, message: messages[code] ?? messages.PROVIDER_FAILED },
  };
}
