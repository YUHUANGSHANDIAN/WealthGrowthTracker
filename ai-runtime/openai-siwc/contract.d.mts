import type { VerifiedAuthorizationContract } from "./service.mjs";
export function createOpenAISiwcContract(options: {
  installationId: string;
  applicationName?: string;
}): Readonly<VerifiedAuthorizationContract>;
