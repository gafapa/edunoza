# Project review fixes

Date: 2026-09-30. This report records the remediation of the [initial project review](project-review-2026-09-30.md). Changes were implemented and verified locally; no deployment was performed.

## Data integrity and recovery

- Import, reset, and demo loading use the exact snapshot encrypted in the safety backup as their concurrency baseline. A write transaction rejects replacement if another writer changed the database during encryption, preserving the newer records.
- Backup validation, snapshots, and replacement now live in a shared database service. The management page and Nextcloud use that service directly.
- Attachment insertion checks current usage, the 20 MiB quota, and owner references in the same transaction. A compound metadata index calculates total usage without loading attachment contents. IndexedDB upgrades add this index without replacing existing records.
- Schema 6 and 7 backups remain supported, including older payloads without additive AI-report or behavior-mark tables. The README distinguishes backup schema versions from IndexedDB versions.
- Nextcloud displays the estimated encrypted upload size and the 10 MiB limit before encryption. An oversized upload is disabled, with local export still available; the final upload independently checks its actual size.

## Reliability, accessibility, and performance

- Unavailable preference storage uses defaults and displays a persistence notice. Writes, draft storage, session retry metadata, and AI credential storage handle unavailable browser storage.
- Unavailable lock storage blocks access to the private workspace and offers a retry. It cannot silently turn an unavailable configuration into a disabled lock.
- Modal focus stays inside the active dialog, including reverse tabbing from its initial panel focus. Background content becomes inert, stacked dialogs are handled, and previous focus and inert state are restored when closing.
- PDF line wrapping measures words and caches measurements. Character measurements are reserved for oversized tokens; native Word, ODT, and multipage PDF exports are covered by browser tests.
- First service-worker activation avoids an unnecessary page reload. Accepted updates still reload the application, and the production browser suite checks offline navigation and retained local storage.
- Public, recovery, and workspace styles are split into ordered files, preserving their existing cascade.

## Security and maintenance

- A shared CSP definition generates the HTML policy. Regression tests check policy agreement with hosting and Nginx headers and the intended development/production differences.
- Compatible compiler and test-tool updates are locked: TypeScript 6.0.3 and Vitest 5.0.2. TypeScript 7 is deferred because the installed typescript-eslint peer range requires TypeScript below 6.1. Node types remain aligned with the Node 24 runtime.
- CI now checks coverage thresholds, security scripts, and the built application in Chromium, Firefox, and WebKit. Dependabot can propose major upgrades except the compiler and Node-type lines with known compatibility constraints.

## Verification

- `npm run verify`: lint, TypeScript, 391 tests across 55 files, enforced coverage, 8 Node security tests, production build, and dependency audit passed. The audit reported zero known vulnerabilities.
- `npm run test:e2e`: all 90 Chromium workflow tests passed, including concurrent database replacement, storage failures, modal focus, and document exports.
- `npm run test:e2e:production`: all 12 built-application tests passed across Chromium, Firefox, and WebKit. Checks cover lazy routes, strict CSP, offline deep links after real network failure, encrypted backup downloads, accessible dialogs, document exports, and accepted worker updates with retained local storage.
- Lint and TypeScript checks were repeated after adding the production fixtures; both passed.
- `git diff --check`: passed.

The fontkit PDF dependency remains a large, lazily loaded production chunk (approximately 711 kB before gzip). The build reports this size warning; PDF exports load it on demand. Overall unit coverage is 24.8% for statements, with higher enforced thresholds for database recovery, attachment storage, and app-lock code. Browser regressions supplement those unit checks.

These checks cover repository behavior and known dependency advisories. Deployed HTTP headers and authenticated Moodle/Nextcloud installations were not tested against live external services.
