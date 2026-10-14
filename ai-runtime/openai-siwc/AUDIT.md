# OpenAI SIWC authorization boundary audit

Date: 2026-10-13. Status: **production disabled; provider protocol unverified**.

The intended official source pages are:

- <https://developers.openai.com/siwc/token-sharing-open-source/sign-in>
- <https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions>

In this implementation run, the web tool returned no usable page text. Direct read-only HTTPS requests to both the Markdown form and the `sign-in` HTML page returned HTTP 403. Previous summaries described inconsistent registration and token-exchange flows. Those summaries are not treated as official evidence. No production endpoint, client identity, registration parameters, required scopes, resource, or approved model entitlement is therefore hardcoded or enabled here.

The module implements independently testable OAuth/OIDC security mechanisms. A future broker must supply a reviewed `VerifiedAuthorizationContract` with the official issuer, discovery/JWKS/token/revocation endpoints, current scopes/resource, this application's own client registration behavior, and an `acceptsIssuedClient` policy. `verified: true` is a broker configuration assertion, not an entitlement check; it must never be set from a renderer, model output, imported user data, or an unreviewed document. No production contract is supplied in this repository.

The service requires an injected secure vault. It never serializes credentials, uses localStorage, reads other applications' credentials, or embeds a client secret. The private broker/provider adapter may consume an access token through `withAccessToken`; that callback must not be exposed to renderer IPC. The runtime executable does not import or instantiate this authorization service.

Security mechanisms implemented and tested:

- Independent random state, nonce and PKCE verifier, using S256.
- Literal `127.0.0.1` loopback listener on an OS-selected port with an exact callback path; forged state, Host mismatches and other origins are rejected.
- Exact redirect binding and issued client validation; an existing profile rejects a changed client or subject.
- JWT signature verification against bounded JWKS; only explicitly allowed RS256/ES256, with issuer, audience/authorized party, nonce, issued-at/expiry and subject validation.
- Bounded HTTPS-only transport, redirect refusal, no cookies, no client secret, response size limits and fixed redacted error messages.
- Cancel/deadline cleanup, profile isolation, per-profile serialized refresh, refresh-token rotation and no scope expansion.
- Local sign-out clears the vault and distinguishes confirmed remote revocation from an unconfirmed result.

Synthetic tests use generated local RSA keys, `.invalid` provider addresses, an in-memory vault and mocked HTTP responses. The loopback integration test talks only to its own local test server. These tests do not establish official app registration, OAuth eligibility, a subscription, real authentication, real inference, cancellation at a real provider, or successful real revocation.

Remaining release blockers: obtain and re-review the actual official page text; implement the reviewed production contract/discovery cache; integrate Rust keyring and private broker lifecycle; isolate per-app host/client identities; verify account switching behavior; complete real authorization/inference/revocation with the user's account and explicit consent; independently satisfy the second subscription release gate. The current service does not implement device flow and does not claim browser/Android support.
