# 1.11 Experience Acceptance

This matrix is intentionally based on synthetic data. Real account names, amounts, paths, prompts, attachments and diagnostics belong only in a private acceptance record.

## Page coverage

| Area | Primary interaction | Required states | Evidence |
| --- | --- | --- | --- |
| Overview | identify current position and next work item | empty, dense, long task names, stale draft | component test + Playwright light/dark |
| Assets | balances, holdings and risk views | no channel, many children, long names, privacy mode | domain tests + Playwright |
| Finance | continue one of seven task types | no task, blocked, ready, draft recovered, no AI | finance domain tests + Playwright |
| History | locate a real observation and inspect evidence | empty, one point, long gap, invalid range | history tests + Playwright |
| Reports | read, edit and compare revisions | no report, missing baseline, two revisions | report tests + Playwright |
| Trends | compare two exact observations | sparse, one point, differing channel coverage | asset trend tests + Playwright |
| Planning | save and compare goal assumptions | no goal, incompatible baseline, no solution | goal calculation tests + Playwright |
| Lottery | separate current pool from historical summary | no pool, summary-only, negative pool | lottery tests + Playwright |
| Settings | find status and safe next action | AI disabled, unverified capability, storage error | settings tests + Playwright |

## Key acceptance IDs

| ID | Automated or manual evidence |
| --- | --- |
| BASE-01 | `git diff --check`, version tests, install identity check |
| UX-01 | Playwright route screenshot matrix |
| UX-02 | Playwright light/dark, desktop/narrow and reduced-motion runs |
| UX-03 | component tests for modal focus, tables and empty/error states |
| UX-04 | keyboard and non-drag alternatives in component tests/manual checklist |
| NAV-01 | `dataHealthCenter.test.ts` deep-link roundtrip + browser route tests |
| NAV-02 | command palette test and privacy scan |
| DASH-01 | overview source links and work-queue tests |
| ASSET-01 | existing amount-batch and channel invariant tests |
| ASSET-02 | classification and holding observation tests |
| FIN-01 | finance task flow tests |
| FIN-02 | no-action completion test |
| FIN-03 | task revision/reopen tests |
| FIN-04 | import, evidence and low-confidence tests |
| DRAFT-01 | workspace state tests + draft hook test |
| DRAFT-02 | fingerprint and revision conflict tests |
| REVIEW-01 | history/report transaction tests |
| REVIEW-02 | report revision and presentation tests |
| TREND-01 | asset trend regression suite |
| TREND-02 | `compareHistoryObservations` tests and chart formatter tests |
| PLAN-01 | goal scenario baseline tests |
| LOT-01 | lottery math and isolation tests |
| HEALTH-01 | work-queue tests and health review action tests |
| HEALTH-02 | duplicate fund code evidence test |
| HASH-01 | classification content hash tests |
| HASH-02 | create/save/read/backup/restore hash tests |
| AI-01 | AI runtime and connection store tests |
| AI-02 | AI Settings tests |
| AI-03 | AI runtime cancellation and authorization tests |
| BAK-01 | full-backup workspace metadata roundtrip test |
| BAK-02 | bad hash/future schema restore tests |
| PRIV-01 | privacy check plus synthetic-only visual fixtures |
| PERF-01 | production build size report and route timing |
| RELEASE-01 | local gates, PR CI, tag CI and install verification |
| RELEASE-02 | digest and Authenticode are recorded as separate facts |
| PATH-01 | build/cache path tests |

## Desktop visual matrix

- Playwright Chromium light and dark snapshots for every primary route and Settings subpage.
- 1440×900 is the desktop baseline. A 390px run checks reflow and whole-document horizontal overflow.
- Windows WebView2 remains a separate manual layer after installing the official NSIS package.
- Snapshot changes require page-by-page review; accepting the whole suite without inspection is not valid evidence.

## Non-substitutable evidence

Browser mocks, Tauri IPC tests, the installed Windows GUI and real paid AI requests are separate evidence layers. Passing one layer does not imply another. Real AI authentication, inference, vision and research remain unverified until a user-authorized account is exercised with a minimum-cost request.

## 1.11 verification run

- Synthetic frontend suite: 99 files, 688 tests passed.
- AI Runtime: 55 tests passed with no real account request.
- Rust: 23 tests passed; format and Clippy gates passed.
- Playwright on Windows: six light/dark desktop, accessibility and 390px tests passed; representative pages have zero serious/critical axe findings.
- Production web build completed with 537 modules.
- Local NSIS package built, SHA-256 verified, upgraded over 1.10, launched, and showed version `1.11.0-preview.2`.
- A complete backup was created from the migrated formal ledger and restored into a brand-new isolated root. Record counts, task revisions, classification events, attachment files and new workspace metadata matched; storage configuration was then switched back to the original root.
- The Windows installer and executable remain unsigned. Real AI credentials and requests were not used.
