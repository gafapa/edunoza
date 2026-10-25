# Edunoza application review

Date: 2026-10-16. Scope: local source, academic persistence, CSV imports, backup and restore, browser storage, Moodle integration, security policy, dependencies, offline behavior and automated browser workflows. Existing uncommitted Moodle numeric-result import changes are retained. No live school account, real student records, production deployment or external application configuration was used or changed.

## Findings and changes

| Priority | Finding | Resolution |
| --- | --- | --- |
| High | Manual grade cells, bulk edits and pasted grades checked period closure before their writes, and saved records from an older screen snapshot. Another writer could close a period or modify a grade before the save. | A shared persistence service checks the current assessment, period, student and expected grade in the write transaction. Conflicts reject the entire batch, including earlier writes in that batch. Deletion uses the same checks. |
| High | Assessment metadata saves could overwrite a newer assessment, and the check for existing grades before assessment deletion was separate from deletion. | Metadata updates and deletion now compare the reviewed assessment and verify period status inside the write transaction. Deletion checks for grades in that same transaction. |
| Medium | Grouped CSV import prepared additions from React state before opening the write transaction. Two simultaneous imports could create duplicate groups or students. | The import recomputes a deterministic plan from current records inside the transaction, compares it with the reviewed plan, and rejects changes before writing. Course and student insertion remains atomic. |
| Medium | Onboarding acquired `window.localStorage` outside the exception handler used for storage operations. A browser policy denying the storage getter could throw while mounting the guide. | Onboarding now uses the shared guarded storage accessor. The independent app-lock behavior still blocks private access when its configuration cannot be checked. |
| Test maintenance | Submenu geometry tests included quick-action links that intentionally have no tab icon. | Geometry checks target the section-tab list. The test retains its icon, alignment, target-size, viewport and active-tab assertions. |

The concurrency findings originated in code inspection. New isolated IndexedDB tests exercise simultaneous imports, stale reviews, failed student insertion, concurrent grade changes, batch rollback, period closure, assessment scope changes, and protected deletion. They do not establish that a teacher previously experienced data loss.

## Verification

The initial complete verification passed 433 unit tests, coverage thresholds, nine Node security tests, production build and dependency audit. The audit reported no known vulnerabilities. The initial Chromium run passed 91 of 98 tests: three failures occurred during page/section loading, and four were the submenu test-selector issue described above. Final verification and focused browser results are recorded after remediation below.

After correcting the selector, the focused Chromium run passed all four submenu widths, both Moodle login flows, the backup reminder and both first-lesson/CSV workflows (nine tests). Its first academic-closure test still exceeded the default 30-second budget while loading the initial page. Running that test alone with `--timeout=90000` passed the full save/close/reopen/versioned-snapshot workflow in 59.7 seconds. The permanent test timeout was not changed. The default-budget development suite is therefore not reported as an uninterrupted green run.

Final `npm run verify`: passed, including lint, TypeScript, 443 tests across 64 files, enforced coverage thresholds, nine Node security tests, production build and dependency audit with no known vulnerabilities. Whole-source statement coverage is 26.43%; the ten additional persistence tests cover the new concurrency guards and rollback behavior. The corrected submenu test also passed its separate ESLint check.

Final built-application check: `npm run build:test` and all 27 production-profile browser tests passed across Chromium, Firefox and WebKit. This includes responsive behavior controls, durable deletion, storage quota/persistence outcomes, native Word/ODT/PDF downloads, multipage PDF generation offline without external requests or CSP errors, lazy routes, offline navigation, encrypted backup downloads, modal accessibility and accepted service-worker updates retaining local storage. `git diff --check` passed. No hosted CI, merge or deployment was performed.

Reproduction commands:

```sh
npm run verify
npm run test:e2e
npx playwright test e2e/academic-period-closure.spec.ts e2e/backup-reminder.spec.ts e2e/moodle-auth.spec.ts e2e/subnav-layout.spec.ts e2e/first-lesson-review.spec.ts --workers=1
npx playwright test e2e/academic-period-closure.spec.ts --workers=1 --timeout=90000
npm run build:test
npm run test:e2e:production
```

## Limits

This is a bounded source and automated workflow review, not a certification of every screen or every concurrent writer. It does not verify deployed headers, current hosted CI, authenticated Moodle/Nextcloud behavior, the separately distributed Proxy extension, or real assistive-technology use. The initial whole-source statement coverage was 26.13%; browser tests supplement that limited unit coverage. PDF font dependencies remain large but load on demand. No dependencies were changed solely to obtain a newer version number.

The existing numeric Moodle import requires individual confirmation for unknown or advanced methods and copies only assignment scores. It does not reproduce rubric criteria, gradebook weighting or gradebook overrides.
