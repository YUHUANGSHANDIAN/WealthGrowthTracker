# Workspace State Contracts

The workspace layer adds recoverable interaction state without creating a second financial ledger.

## Scopes

- `ledger_identity` identifies one canonical local ledger.
- `data_revision` is a monotonically increasing revision for protected domain state and survives restarts.
- `workspace_drafts`, `health_review_state`, `report_revision_state`, `goal_scenario_state` and `workspace_ui_state` are local additive metadata.
- `asset_classification_state` remains an append-only classification projection and never becomes a second asset balance.

## Draft safety

Each draft stores its ledger ID, global base revision, entity revision, source fingerprint and payload version. A source fingerprint is authoritative across restarts; a numeric revision alone is not sufficient. A mismatched fingerprint never auto-overwrites the editor. The user must inspect and explicitly restore the old draft.

Drafts reject credential-like fields, binary attachment copies and payloads above the bounded size. Submission of a formal task or report always rechecks its own revision and fingerprint before writing.

## Health decisions

`acknowledged` and `deferred` remain unresolved. Only a matching fingerprint can be hidden as `resolved`. Error-severity integrity failures cannot be resolved while the underlying scan still reports them. Review records carry the ledger ID, rule version, operation ID, source classification event IDs and revalidation time.

## Comparison boundaries

- Report revisions compare immutable content-hash snapshots.
- Trend comparison accepts two exact historical observation dates and never substitutes nearest points.
- Goal scenarios persist the amount, date, basis and fingerprint of their baseline. Different baselines cannot enter one comparison.
- Finance comparisons stay inside a recoverable draft until the user explicitly adopts an adjusted candidate; comparison itself never approves or trades.

## Backup

The full backup captures all registered storage keys, including workspace metadata and the persisted data revision. `manifest.workspaceSchemaVersion` lets a future restore reject unsupported workspace semantics. Credentials and raw attachments embedded inside draft payloads remain prohibited.
