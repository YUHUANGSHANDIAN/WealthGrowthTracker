export type ProviderId = "openai" | "copilot" | "anthropic" | "deepseek" | "ollama" | "lmstudio" | "gateway";
export type TaskId = "report-interpretation" | "analysis-question" | "entry-draft" | "data-health-explanation" | "goal-scenario";
export type FactUnit = "CNY" | "percent" | "count" | "text";
export type FactValue = string;

export interface Fact {
  factId: string;
  label: string;
  value: FactValue;
  unit: FactUnit;
  asOf?: string;
}

export interface StatusRequest {
  protocolVersion: 1;
  requestId: string;
  operation: "status";
}

export interface CancelRequest {
  protocolVersion: 1;
  requestId: string;
  operation: "cancel";
  targetRequestId: string;
}

export interface InferRequest {
  protocolVersion: 1;
  requestId: string;
  operation: "infer";
  profileId: string;
  providerId: ProviderId;
  task: TaskId;
  input: { text: string; facts: Fact[] };
}

export interface ModelsRequest {
  protocolVersion: 1;
  requestId: string;
  operation: "models";
  profileId: string;
  providerId: ProviderId;
}

export interface BrokerProfile {
  profileId: string;
  providerId: ProviderId;
  authKind: "api-key" | "local" | "copilot-subscription" | "openai-subscription";
  modelId: string;
  endpoint?: string;
  /** Only on private Broker stdio. Never accepted from renderer inference. */
  credential?: string;
}

export interface ConfigureRequest {
  protocolVersion: 1;
  requestId: string;
  operation: "configure";
  profile: BrokerProfile;
}

export interface RemoveProfileRequest {
  protocolVersion: 1;
  requestId: string;
  operation: "removeProfile";
  profileId: string;
}

export type RuntimeRequest = StatusRequest | CancelRequest | InferRequest | ModelsRequest;
export type BrokerRequest = RuntimeRequest | ConfigureRequest | RemoveProfileRequest;

export type ErrorCode = "INVALID_REQUEST" | "INVALID_JSON" | "FRAME_TOO_LARGE" | "AI_DISABLED" | "PROVIDER_UNAVAILABLE" | "REQUEST_IN_PROGRESS" | "CANCELLED" | "TIMEOUT" | "PROVIDER_FAILED" | "PROFILE_UNAVAILABLE" | "INVALID_PROFILE" | "QUALIFICATION_REQUIRED" | "AUTH_REQUIRED" | "ACCESS_DENIED" | "RATE_LIMITED";

export interface ProtocolErrorResponse {
  protocolVersion: 1;
  requestId: string | null;
  ok: false;
  error: { code: ErrorCode; message: string };
}

export function parseRequest(rawLine: string, options: { allowManagement: true }): BrokerRequest;
export function parseRequest(rawLine: string, options?: { allowManagement?: false }): RuntimeRequest;
export function errorResponse(requestId: string | null, code: ErrorCode): ProtocolErrorResponse;
export class ProtocolError extends Error {
  readonly code: ErrorCode;
  readonly requestId: string | null;
}
