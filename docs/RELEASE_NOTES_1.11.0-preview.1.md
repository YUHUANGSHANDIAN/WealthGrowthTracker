# WealthGrowthTracker 1.11.0-preview.1

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
