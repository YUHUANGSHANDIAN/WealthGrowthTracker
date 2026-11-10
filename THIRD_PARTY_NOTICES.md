# Third-Party Notices

WealthGrowthTracker is distributed under the MIT License in this repository.
The application and installers also contain or are built with third-party
software. This notice records the redistributed components that require
attribution. Exact package versions are fixed by `package-lock.json`,
`ai-runtime/package-lock.json`, and `src-tauri/Cargo.lock`.

## Desktop and Web Runtime

- React and React DOM — MIT — <https://github.com/facebook/react>
- Zustand — MIT — <https://github.com/pmndrs/zustand>
- date-fns and date-fns-tz — MIT — <https://github.com/date-fns/date-fns>
- decimal.js — MIT — <https://github.com/MikeMcl/decimal.js>
- SheetJS Community Edition — Apache-2.0 — <https://github.com/SheetJS/sheetjs>
- Tauri — MIT or Apache-2.0 — <https://github.com/tauri-apps/tauri>
- caniuse-lite — CC-BY-4.0 — <https://github.com/browserslist/caniuse-lite>

## AI Runtime

- `@earendil-works/pi-ai` and its transitive packages — license metadata is
  recorded in `ai-runtime/package-lock.json`
- `@github/copilot-sdk` and its transitive packages — license metadata is
  recorded in `ai-runtime/package-lock.json`
- Anthropic SDK and related transport dependencies — MIT or their declared
  lockfile licenses

## Bundled Node Runtime

The official Node.js 24.21.0 runtime is redistributed as the desktop sidecar.
Node.js is licensed under the Node.js license, including the licenses of its
bundled components:

<https://github.com/nodejs/node/blob/main/LICENSE>

The release builder verifies the Node archive against the official
`SHASUMS256.txt` before bundling it.

## Build and Test Tools

Playwright, Axe, Vitest, TypeScript, ESLint, Vite, Tailwind CSS, Rust,
cargo-nextest-compatible test runners, and GitHub Actions support tools may be
used during development or CI. They are not presented as application features.
Their versions and license metadata are recorded in the lockfiles or runner
toolchains.

## Release Rule

Before a Release is published, the release owner must confirm that every
redistributed package has a compatible license and that this notice remains in
the repository and installed application resources. If a dependency's license
cannot be established, publication remains blocked.
