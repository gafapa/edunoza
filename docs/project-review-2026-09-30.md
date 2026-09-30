# Edunoza project review

Review date: 2026-09-30. The highest priority is preventing loss of concurrent edits during local database replacement. Three browser probes reproduced data loss during import, a blank application when preference storage throws, and keyboard focus escaping a modal. Dependency auditing reported no known vulnerabilities, but the complete verification command did not pass.

This document records the initial review before implementation. Remediation and final verification are recorded in [Project review fixes](project-review-fixes-2026-09-30.md).

This review covers the local React application, database and backup operations, provider transports, security configuration, dependency versions, build, and automated checks. It does not certify deployed HTTP headers or the separately distributed Proxy extension. Application code and dependency versions were not changed.

## Findings ordered by priority

### High priority concurrent edits can be lost during local replacement

Location: `src/modules/management/ManagementDatabasePage.tsx:1996`, `:2080`, `:2117`, and `:2133`.

`downloadSafetyBackup` reads the database and encrypts that snapshot. Local import then reads another snapshot and passes this later snapshot to `restoreDatabasePayload` as its concurrency baseline. Changes made during encryption are therefore included in the baseline but excluded from the safety backup. The transaction accepts the baseline and overwrites the changes. Reset and demo loading do not compare a baseline before clearing tables.

An isolated browser probe updated a synthetic course during `crypto.subtle.encrypt`. Import completed successfully. The downloaded safety backup contained the course name `Before safety backup`; the restored database contained `Restore target`. The intervening name `Concurrent edit during encryption` survived in neither place. The probe simulated another writer without touching a real teacher browser profile.

Recommendation: capture one snapshot before encryption, use it to create the safety backup, and compare that same snapshot against the database inside the replacement transaction. Apply the same guard to reset and demo loading. The Nextcloud restoration flow already captures and compares the same snapshot and provides a useful implementation reference. Regression checks should mutate data during encryption and assert that all three local destructive operations abort without clearing data.

### Medium priority storage errors prevent application startup

Location: `src/app/store.ts:36` and `:67`; related reads in `src/shared/security/appLock.ts:110` and `src/shared/ui/AppLockGate.tsx:14`.

Preference reads call `window.localStorage.getItem` at module initialization without error handling. If storage access throws, the store import fails before React or `AppErrorBoundary` mounts. A browser probe that raised `SecurityError` for `student_sort_by` produced an empty root and an uncaught page error. Preference writes and some lock storage operations are also unguarded.

Recommendation: protect both storage acquisition and operations, use default preferences when storage is unavailable, and report persistence failures without crashing. Lock configuration needs an explicit recovery policy so unavailable storage is not silently treated as an intentionally disabled lock.

### Medium priority attachment writes can exceed the recoverable quota

Location: `src/shared/resources/ResourceManager.tsx:53`, `:95`, and `:97`; `src/shared/resources/resources.ts:114`; `src/modules/management/ManagementDatabasePage.tsx:1732`.

The file quota is checked using React state populated by an earlier database read. The eventual `add` is a separate database operation. Multiple components or tabs can use the same remaining quota and both save files, exceeding the 20 MiB total. The import validator subsequently rejects an over-quota resource table, so a backup of that state cannot be restored through the normal validated workflow. This finding follows from code inspection; a concurrent upload was not exercised in the browser.

Recommendation: finish file reading before entering a read/write transaction, then recompute the total from current rows and add only if the total remains valid. Validate the owner within the transaction as well. Avoid reading every attachment's base64 content merely to display the aggregate size.

### Medium priority modal keyboard focus escapes the dialog

Location: `src/shared/ui/Modal.tsx:35` and `:43`.

Opening a modal focuses its panel. The keyboard handler wraps only when focus is already on the first or last child control. Shift+Tab from the panel therefore moves into the background page. The browser probe reproduced focus moving to the footer link `Legal` while the import dialog remained open. The background is not made inert, and the focusable selector also includes inputs or descendants that may be hidden by ancestors or CSS.

Recommendation: handle focus on the panel and outside the dialog, exclude controls that cannot receive visible focus, and make the background inert. Consider native dialog behavior or a maintained focus-management primitive, including stacked-dialog behavior. Verify forward and reverse tabbing from the initial focus position.

### Medium priority PDF export exceeds its test budget

Location: `src/shared/reports/reportDocuments.ts:46` and `:65`; `src/shared/reports/reportDocuments.test.ts:48`.

The PDF test failed in the complete run and again in an isolated one-worker run, exceeding its 20-second timeout. In the isolated run the PDF test was reported at approximately 26.4 seconds. This establishes a local performance or timing problem; it does not establish failure to produce a valid PDF in all environments.

`wrapReportLine` repeatedly measures growing strings for individual characters, invoking font measurement even for ordinary words. PDF creation runs on the calling JavaScript thread. This is a candidate bottleneck to profile, rather than a proven sole cause of the timeout.

Recommendation: measure ordinary words as units, use character fallback only for oversized words, cache suitable measurements, and benchmark the existing synthetic report before increasing timeouts. Consider moving large PDF exports to a worker to preserve UI responsiveness; align every CSP definition if a blob worker is introduced.

### Medium priority browser CI does not exercise the built application

Location: `playwright.config.ts:10`; `.github/workflows/ci.yml:41`.

CI builds the test profile, but Playwright starts `npm run dev`. The browser suite therefore does not consume the generated `dist` application. It cannot verify production-only service-worker registration or the stricter production style policy. Several tests import `/src/...` directly, so switching the entire suite to preview would require fixture changes.

Recommendation: retain the development fixture suite and add a separate preview suite for built application startup, offline loading, update behavior, lazy route loading, document downloads, and CSP errors. Add Firefox and WebKit smoke coverage for IndexedDB and downloads where practical. This is a coverage gap, not evidence that production startup currently fails.

## Security assessment

The repository already uses authenticated AES-GCM backup encryption, random salts and IVs, an explicit PBKDF2 work factor, strict import validation, transactional replacement, spreadsheet formula neutralization, restricted provider endpoints, and a restrictive CSP. CI restricts permissions, disables persisted checkout credentials, and pins actions to commit hashes. The service worker avoids caching API responses and authorization-bearing requests.

`npm audit --json` returned zero vulnerabilities at every severity and no advisory exceptions. This is an advisory result for the current dependency tree, not a guarantee that application logic or external services are secure.

Saved Moodle tokens and optional device AI credentials use browser storage without application encryption, as documented. Keep explicit device-saving consent and session defaults. The local lock protects visible UI access and does not encrypt IndexedDB. Credentials traversing the Proxy message bridge rely on the extension and the trusted page execution environment; extension permissions and redirect handling were outside this repository review.

The CSP definitions in `index.html`, `public/_headers`, and `deploy/nginx-security-headers.conf` should share one maintained policy. In particular, Nginx allows blob workers while the HTML meta policy and static header file do not. There is no current worker-export implementation in the reviewed report code, so this difference is a maintenance concern rather than a reproduced failure.

## Dependency updates

`npm outdated --json` reported the following installed versions and registry latest versions. All packages are already at the wanted version allowed by their current constraints. No compatible update was pending in that output.

| Package | Installed | Registry latest | Recommendation |
| --- | --- | --- | --- |
| TypeScript | 5.9.3 | 7.0.2 | Plan a separate compiler migration after resolving the current failures. Review compatibility changes and typecheck all configurations. |
| Vitest | 4.1.11 | 5.0.2 | Upgrade together with its coverage package and rerun unit and coverage checks. |
| @vitest/coverage-v8 | 4.1.11 | 5.0.2 | Keep aligned with Vitest. |
| @types/node | 24.19.0 | 26.6.3 | Keep the Node 24 type line while the project selects Node 24.18.0. A newer major is not automatically a suitable update. |

Versions were obtained from npm's configured public registry during this review. Registry metadata changes over time: [TypeScript](https://registry.npmjs.org/typescript/latest), [Vitest](https://registry.npmjs.org/vitest/latest), [Vitest coverage](https://registry.npmjs.org/@vitest%2fcoverage-v8/latest), and [Node types](https://registry.npmjs.org/@types%2fnode/latest). The intermediate [TypeScript 6 migration notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html) document compatibility changes relevant to leaving 5.9, but are not evidence of the latest package version.

Dependabot currently ignores all major npm updates. Continue automatic compatible updates and schedule deliberate major-version reviews. No dependency installation, forced audit fix, or lockfile rewrite was performed.

## Maintainability and recovery improvements

Separate database payload serialization, validation, and restoration from `ManagementDatabasePage.tsx`. At roughly 119 KB of source, the component also acts as a shared database service imported by Nextcloud. Moving those operations into `shared/backup` or `shared/db` would give recovery rules one owner and make concurrency tests easier.

The largest UI modules and the approximately 181 KB global stylesheet warrant gradual extraction around existing workflows. Current coverage thresholds are 17 percent statements, 15 percent branches, 13 percent functions, and 18 percent lines, and coverage is not part of `verify`. Raise coverage specifically for replacement, quota enforcement, lock behavior, and migration paths rather than targeting superficial UI counts.

The application accepts 20 MiB of raw attachments, but Nextcloud limits the complete encrypted JSON file to 10 MiB. Base64 encoding of files and ciphertext further expands the payload. This documented limit means a valid database can require local recovery even before reaching the attachment quota. Expose the estimated remote-backup size earlier and consider coordinated transport limits or compression before encryption while retaining legacy envelope support.

Update the README's backup compatibility description. It says only current-schema payloads are accepted, whereas the validator and tests explicitly support schema 6 backups without Moodle metadata and selected absent optional tables. Document schema 7 and the actual compatibility rules.

## Verification results and limits

| Check | Result |
| --- | --- |
| ESLint through `npm run verify` | Passed. |
| TypeScript through `npm run verify` | Passed. |
| Complete Vitest run | 376 passed and 3 timed out across 52 files. |
| Isolated Nextcloud and report document run with one worker | 33 passed and 1 PDF timeout across 2 files. Nextcloud and DOCX timeouts did not recur. |
| Production build | Passed; reported a chunk-size warning for the approximately 711 KB minified fontkit chunk. |
| Direct npm dependency audit | Passed with zero known vulnerabilities. |
| Separate Node audit and service worker tests | All 7 passed. |
| Playwright suite with two workers | Stopped after six reported timeouts; the 84-test suite was not completed. Early failures included page-load timeouts, so they are not attributed to a specific product regression. |
| Isolated browser probes | Reproduced the import race, storage startup failure, and reverse-tab modal escape. |

The complete `verify` command stopped at the unit-test failures, so it did not reach its build, audit, or Node-script test stages. Build and the dependency audit were checked separately. Initial unit and browser suites ran concurrently; resource contention may have contributed to their timing failures. An isolated rerun narrowed the persistent failure to PDF export.

Local diagnostic code and exact probe output are in `artifacts/review/review-probes.mjs` and `artifacts/review/probe-results.json`, under the repository's existing ignored artifacts directory. The probes require a development server on `http://127.0.0.1:5276` and use fresh browser contexts with synthetic records. No production service or existing teacher profile was changed.

Recommended implementation order: fix local replacement concurrency, handle unavailable storage, enforce attachment quotas transactionally, repair modal focus, profile PDF export, and then add built-application smoke tests before undertaking major dependency migrations.
