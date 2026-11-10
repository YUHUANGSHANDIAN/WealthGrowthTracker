# WealthGrowthTracker 1.11.0-preview.1

## Release status

This release remains blocked from publication until the private full-history
audit is explicitly accepted or resolved and GitHub Actions billing is restored.
The release workflow creates a verified Draft only; publication requires a
separate manual confirmation.

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
- Added a brand contract, npm/Cargo license checks and high-severity dependency
  audits.
- Pinned GitHub Actions to complete commit SHAs and enabled Secret Scanning,
  Push Protection and Dependabot.
- Upgraded Vite, Vitest and GitHub Copilot SDK to versions that remove the
  identified high-severity advisories.
- Draft release verification now requires a complete platform asset matrix and
  SHA-256 checksums. Missing assets block publication.

## Experience

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

## Verification boundaries

Real paid AI authentication, inference, vision and research were not exercised without user credentials. macOS, Linux and Android remain CI build evidence rather than local runtime verification.
