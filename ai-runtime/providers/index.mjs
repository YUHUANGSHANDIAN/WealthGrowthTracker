import { validateProfile } from "./policy.mjs";
import { createPiAdapter } from "./pi.mjs";
import { createCopilotAdapter } from "./copilot.mjs";

// Subscription policy and sandbox paths are trusted host options, never management-frame fields.
export function createProviderAdapter(input, options = {}) {
  const profile = validateProfile(input);
  return profile.providerId === "copilot" ? createCopilotAdapter(profile, options.copilot) :
    createPiAdapter(profile, { ...options.pi, subscriptionEnabled: options.openaiSubscriptionEnabled === true });
}
