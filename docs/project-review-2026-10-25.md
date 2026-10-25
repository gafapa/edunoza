# Project review — 2026-10-25

## Scope

Reviewed the local checkout, dependency advisories, app-lock handling, offline cache lifecycle, backup encryption and validation, resource storage, manual-grade persistence, grouped-student import, and AI-report data preparation. Existing uncommitted Moodle, tutor, gradebook, import, and documentation changes were preserved. Validation exercises the complete working tree, including those existing changes.

## Repairs

- **Corrupt lock configuration allowed access.** A stored lock that failed JSON parsing or policy validation previously became a disabled lock. Only an absent key now means disabled. Malformed or unsupported settings block academic access and remain stored for diagnosis; the application does not delete or reset them.
- **Lock changes did not reach existing tabs.** Open workspaces now observe storage changes, relock when the configuration changes, and reject an unlock result computed against a superseded configuration. A lock-now event also invalidates an in-flight unlock attempt.
- **Offline cleanup affected unrelated installations.** Service-worker caches now include the registration scope, and activation deletes only obsolete caches with that exact scope prefix. Legacy caches remain untouched because their names do not establish ownership. This can retain an extra legacy cache after an upgrade, but prevents deletion of another installation's offline assets.
- **Gradebook feedback was hidden while entering grades.** Save confirmations and rejection messages were rendered only in the Structure tab. Their shared live-status region now appears above all three tabs, so teachers entering grades can see a closed-period rejection, a conflict, or a successful save immediately.
- **Known dependency vulnerabilities.** The initial npm audit reported five affected packages: Vite, Vitest, `@vitest/mocker`, `@vitest/coverage-v8`, and Zod. Compatible dependency updates removed all reported advisories. Updated minimum versions in the manifest match the selected direct dependency updates; the lockfile records transitive updates.

Key selected versions: Vite 8.3.5, Vitest and coverage 5.0.5, React and React DOM 19.3.1, Dexie 4.4.7, and docx 9.14.0. TypeScript remains on major version 6 and Node types remain on major version 24, matching the existing toolchain rather than introducing unrelated major migrations.

Playwright is pinned to 1.63.0. The initial update to 1.64.1 passed all 103 development scenarios and 25 of 27 built-application scenarios, but its bundled WebKit falsely reported `style-src-attr` violations when constructing native select controls. A minimal reproduction outside React reproduced the violation with just `document.createElement("select")` under a strict CSP. This matches [upstream regression #43497](https://github.com/microsoft/playwright/issues/43497), reported for both 1.64.0 and 1.64.1. The exact pin keeps CI on the compatible engine; application CSP and violation assertions remain unchanged.

Upstream advisory references: [Vite security advisories](https://github.com/vitejs/vite/security/advisories), [Vitest security advisories](https://github.com/vitest-dev/vitest/security/advisories).

## Regression coverage

Added tests for malformed lock values, preservation of the stored configuration, access blocking in the browser, cross-tab lock activation and unlocking, scope-specific cache cleanup, and preservation of another installation's cached content during a built-application update.

The multi-stage academic-period browser scenario exceeded its default 30-second whole-test budget during simultaneous browser-suite execution. It now has a 90-second scenario budget and waits for the save/rejection notice plus the persisted grade value instead of relying on a fixed 200 ms sleep. Its grade-locking and snapshot-version assertions remain intact.

## Validation and limits

- `npm run verify`: passed, including lint, TypeScript checks, 451 unit tests across 64 files, 10 Node script tests, the production build, and the advisory-policy audit.
- `npm audit`: zero known vulnerabilities after updating the dependency tree.
- Development browser suite with the final Playwright pin: 102 scenarios passed and the academic-period scenario exceeded its old 30-second budget. After correcting its wait strategy and exposing gradebook notices, the corrected scenario passed separately, including save confirmation, closed-period rejection, reopening, and both immutable snapshot versions. The earlier complete run with Playwright 1.64.1 passed all 103 scenarios before the final gradebook feedback repair.
- Built application with Playwright 1.63.0: all 27 scenarios passed across Chromium, Firefox, and WebKit after the final gradebook feedback repair was rebuilt, including strict CSP, offline routes, PDF workers, encrypted downloads, and worker updates.
- Dependency updates retain TypeScript 6 and Node types 24; Playwright 1.64 is deferred because of the reproduced WebKit regression above.
- Unit coverage: 26.40% statements, 24.17% branches, 20.35% functions, and 27.54% lines. The configured global and sensitive-module thresholds pass. These figures do not include Playwright coverage and do not imply exhaustive coverage of the application UI.

Browser fixtures use synthetic records and simulated Moodle/Nextcloud transports. These runs do not establish authenticated production behavior, live account access, or hosted CI status. No deployment or publication is part of this review.
