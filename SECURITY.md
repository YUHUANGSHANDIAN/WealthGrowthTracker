# Security Policy

## Reporting a vulnerability

Do not include financial records, credentials, tokens, personal paths, screenshots
of real accounts or private backups in a public issue.

Use GitHub's private "Report a vulnerability" / Security Advisory flow for this
repository. If private reporting is unavailable, open a public issue that only
states that a private report is needed, without exploit details or personal data.

## Supported release line

Only the newest published pre-release is eligible for security fixes while the
project remains in preview. Historical tags and releases are retained for
reproducibility and are not moved or rewritten.

## Release controls

Release publication requires a trusted `main` commit, an immutable new tag,
successful standard GitHub-hosted CI, a complete Draft asset matrix, verified
SHA-256 checksums and an explicit human safety acknowledgement.
