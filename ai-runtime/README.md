# Wealth Growth Tracker AI Runtime

This private Node process boundary is not a provider integration. It implements a bounded JSONL protocol and reports every provider as unsupported until authentication, secure credential storage, provider rights, and packaging have been implemented and verified.

The process does not start when this module is imported. The executable requires both `--stdio` and `--enable-ai-runtime`; the application broker must launch it only after an explicit user action. AI disabled is the default. The current executable accepts no credentials, makes no network requests, invokes no tools, and never reads provider CLI credentials or ambient provider environment variables.

## Protocol

Each UTF-8 JSONL frame is limited to 64 KiB. Requests have `protocolVersion: 1`, a bounded `requestId`, and one of `status`, `infer`, or `cancel`. Inference accepts a fixed task/provider allowlist and bounded text/facts only. Unknown properties, credential fields, endpoints, arbitrary messages, and tool definitions are rejected. Responses use fixed error codes and do not include adapter exception messages.

The production adapter registry is empty. Tests inject a synthetic adapter to verify the typed boundary, deadline, cancellation, and output validation; that test adapter is not shipped or selectable by the application.

## Provider status

OpenAI subscription authorization, GitHub Copilot subscription authorization, API-key providers, local endpoints, and user gateways are all unsupported in this build. No subscription entitlement is inferred from an OAuth flow or API key. There is no Keychain/Android Keystore integration and no persistent credential support.

`openai-siwc/` contains a separate, dependency-injected authorization security service and constrained OAuth transport. It is not connected to the executable or application. It requires a verified provider contract, secure vault and browser launcher; none are supplied for production. See `openai-siwc/AUDIT.md` for source-access failures, the conflicting summaries rejected as evidence, verified test mechanisms and remaining blockers.

## SDK audit and prerequisites

The pinned plan packages were checked against npm registry metadata on 2026-10-13: `@earendil-works/pi-ai@1.2.0` is MIT and declares Node `>=22.19.0`; `@github/copilot-sdk@1.0.20` is MIT and declares Node `^20.19.0 || >=22.12.0`. The Copilot SDK also declares platform-specific optional runtime packages. These SDKs are deliberately not imported by this slice because its OAuth, credential, session storage, and per-profile isolation integrations are not present.

Official SDK references:

- Pi AI upstream: <https://github.com/earendil-works/pi>
- Copilot SDK upstream: <https://github.com/github/copilot-sdk>
- Copilot SDK isolation guidance: <https://github.com/github/copilot-sdk/blob/main/docs/setup/multi-tenancy.md>
- OpenAI open-source app authorization: <https://developers.openai.com/api/docs/guides/authentication/open-source-ai-apps>

The plan standardizes the application runtime at Node `24.21.0`; this development machine reported Node `24.14.1` during implementation. The current protocol tests run on Node's built-in test runner and do not require network or credentials.
