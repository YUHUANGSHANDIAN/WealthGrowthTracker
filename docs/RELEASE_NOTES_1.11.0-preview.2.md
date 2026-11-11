# WealthGrowthTracker 1.11.0-preview.2

## Release status

This patch preview supersedes the protected `v1.11.0-preview.1` tag, which did
not produce a Release because Playwright 1.56.1 could not install Chromium on
the Ubuntu 26.04 image selected by `ubuntu-latest`. The release quality gate is
now pinned to the standard `ubuntu-24.04` runner. The preview.1 tag remains
unchanged; no tag was moved or reused.

The full-history audit is now governed by an exact public baseline of 291
fingerprints and 8 content groups. The repository owner explicitly accepted
those three families of already-public legacy residue while keeping new
matches, credentials and account-identity data fail-closed.

GitHub Actions uses only standard GitHub-hosted runners. The zero-dollar
Actions budget does not replace required release checks: publication still
requires a green PR, a verified Draft asset matrix, SHA-256 verification,
isolated Windows upgrade validation and a separate manual publish workflow.

## Brand and packaging

- The visible product name is `WealthGrowthTracker` across the application,
  PWA, exports and release workflow.
- npm, AI Runtime and Rust package names no longer use the retired hyphenated
  brand.
- The Windows main binary is generated as `WealthGrowthTracker.exe`; the
  published Tauri identifier and existing local data schema are unchanged.
- New installs use `Documents/WealthGrowthTracker`; the previous default folder
  is detected in place for compatibility.
- The local build-cache root is `DevCache/WealthGrowthTracker`.

## Security and supply chain

- Added current-tree, full-history and build-artifact privacy checks.
- The historical gate accepts only the exact audited 291 fingerprints; reused
  content in a new commit, changed rules, shallow clones and credential matches
  still block.
- PR and release checks audit the ancestors of the exact commit being built.
  Unrelated open branches are audited separately so they cannot mask or block
  the release commit; each branch must still pass the same gate when updated.
- Added a brand contract, npm/Cargo license checks and high-severity dependency
  audits.
- Pinned GitHub Actions to complete commit SHAs and enabled Secret Scanning,
  Push Protection and Dependabot.
- Upgraded Vite, Vitest and GitHub Copilot SDK to versions that remove the
  identified high-severity advisories.
- Draft release verification now requires a complete platform asset matrix and
  SHA-256 checksums. Missing assets block publication.

## Experience

- User-facing leaf-channel wording is unified as subchannels, with direct parent
  balances explicitly labelled as unsubdivided. CSV exports add readable
  channel paths and a subchannel/direct-parent kind without changing machine
  identity columns.

- The data-health center now supports bounded multi-turn AI conversations from
  a detected issue or a free-form question. Exact evidence requires separate
  authorization, replies are validated against authorized facts, and every
  repair remains preview-only until local confirmation.

- Unified page hierarchy, semantic status tokens, light/dark surfaces, compact density, responsive tables and accessible dialogs across all main pages.
- Added synthetic-data visual, accessibility and narrow-layout regression coverage.
- Added saved page views and deep-link context for reports, history, holdings, scenarios, evidence and two-point trend comparisons.

## Workflows

- Recoverable drafts are scoped by ledger and source fingerprint. Stale drafts require explicit review and never overwrite changed facts.
- Added a unified issue workbench with structured evidence, impact preview, acknowledged/deferred states and revalidation.
- Added report revision comparison, exact historical observation comparison, same-baseline goal scenarios and bounded finance proposal comparison.
- Added applicable task steps, evidence deep links and an explicit adjusted-candidate path for finance tasks.

## Data and safety

- Added persisted protected-data revision metadata without changing the existing asset ledger schema.
- Full backups now declare workspace schema support and validate workspace metadata before restore.
- Classification event ordering, evidence IDs, task revisions, historical snapshots and attachment references remain protected invariants.
- Windows packages remain unsigned until a signing identity is supplied.
- Health-assistant conversations are local-only by default, expire after 30
  days, do not increment the financial revision and are excluded from full
  backups unless explicitly enabled.

## Known residual exposure

- The accepted historical residue remains public in Git history; this release
  does not claim that it was deleted or that history was rewritten.
- No credential, account-identity, complete ledger or newly introduced match is
  covered by the acceptance baseline.

## Verification boundaries

Real paid AI authentication, inference, vision and research were not exercised without user credentials. macOS, Linux and Android remain CI build evidence rather than local runtime verification.
