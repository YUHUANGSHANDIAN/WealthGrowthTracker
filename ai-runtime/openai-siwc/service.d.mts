export interface CredentialRecord {
  clientId: string;
  subject: string;
  accessToken: string;
  refreshToken: string | null;
  idToken?: string;
  expiresAt: number;
  scopes: readonly string[];
}

export interface CredentialVault {
  load(profileId: string): Promise<CredentialRecord | null>;
  write(profileId: string, record: CredentialRecord): Promise<void>;
  remove(profileId: string): Promise<void>;
}

export interface VerifiedAuthorizationContract {
  verified: true;
  evidence: { sourceUrl: string; checkedOn: string };
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksEndpoint: string;
  revocationEndpoint?: string;
  resource?: string;
  authorizationClientId: string;
  scopes: readonly string[];
  authorizationParameters?: Record<string, string>;
  registrationParameters?: Record<string, string>;
  acceptsIssuedClient(clientId: string): boolean;
  algorithms?: ReadonlyArray<"RS256" | "ES256">;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export interface OAuthTransport {
  exchangeCode(input: {
    tokenEndpoint: string; clientId: string; code: string; codeVerifier: string;
    redirectUri: string; resource: string | null; signal: AbortSignal;
  }): Promise<TokenResponse>;
  refreshTokens(input: {
    tokenEndpoint: string; clientId: string; refreshToken: string;
    resource: string | null; signal: AbortSignal;
  }): Promise<TokenResponse>;
  getJwks(input: { jwksEndpoint: string; signal: AbortSignal }): Promise<{ keys: JsonWebKey[] }>;
  revoke?(input: {
    revocationEndpoint: string; clientId: string; refreshToken: string;
    tokenTypeHint: "refresh_token"; signal: AbortSignal;
  }): Promise<{ status: number }>;
}

export interface AuthorizationSession {
  profileId: string;
  status: "signed-in";
  subject: string;
  expiresAt: number;
  scopes: string[];
}

export class OpenAISiwcAuthorizationService {
  constructor(options?: {
    contract?: VerifiedAuthorizationContract;
    vault?: CredentialVault;
    transport?: OAuthTransport;
    openBrowser?(url: string): Promise<void>;
    listenerFactory?(input: { callbackPath: string; expectedState: string }): Promise<{
      redirectUri: string; waitForCallback(signal: AbortSignal): Promise<string>; close(): Promise<void>;
    }>;
    clock?: () => number;
  });
  readonly status: { providerId: "openai"; authorization: "contract-configured" | "disabled"; realAccountVerified: false };
  signIn(profileId: string, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<AuthorizationSession>;
  cancel(profileId: string): void;
  withAccessToken<T>(profileId: string, consumer: (token: string) => T | Promise<T>): Promise<T>;
  signOut(profileId: string): Promise<{
    profileId: string; signedOut: true; remoteRevocation: "confirmed" | "unconfirmed" | "not-needed";
  }>;
}
