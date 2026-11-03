# Maintained documentation

This directory describes the current implementation. Update these contracts when behavior changes instead of adding dated implementation plans or review reports.

| Document | Purpose |
| --- | --- |
| [Project README](../README.md) | Features, setup, commands, schema compatibility, privacy, and deployment |
| [Product](../PRODUCT.md) | Users, positioning, architectural boundaries, and evidence limits |
| [Design](../DESIGN.md) | Visual language, responsive behavior, accessibility, and interaction rules |
| [Changelog](../CHANGELOG.md) | Concise history of product changes; historical URLs are not current deployment targets |
| [CI and security](ci-and-security.md) | Verification, dependency policy, service workers, and credential handling |
| [Data integrity and recovery](data-integrity.md) | Transactional writes, restore safeguards, migrations, and compatibility |
| [Moodle](moodle-integration.md) | Current three-step read-only connection, explicit associations, and numerical grade review |
| [Nextcloud](nextcloud-backups.md) | Manual encrypted uploads, verified restore, transport limits, and compression |
| [AI reports](ai-report-workflow.md) | Explicit data approval, editable local versions, native downloads, and limitations |
| [Family contacts](family-contact-status.md) | Status transitions, historical records, and agenda behavior |

## Repository maintenance

Keep source, tests and fixtures, public assets and font licenses, dependency manifests and lockfile, build and deployment configuration, CI, and the maintained documentation above. Preserve additive database migrations, legacy ProfePlus identifiers, old backup readers, and historical academic evidence: these still support existing installations.

`npm run clean` removes only explicitly identified generated output at the repository root: builds, coverage, browser results, QA scratch directories, log files, and TypeScript build caches. Recreate builds with `npm run build`, coverage with `npm run test:coverage`, and browser diagnostics with the relevant Playwright command. Build before previewing or running built-application tests.

Do not remove `.git`, `.gitdata`, `.agents`, `.claude`, `.codex`, `.metagallego`, environment configuration, or `node_modules` during routine cleanup. Git metadata can live in `.gitdata`; `.agents` can link outside the project. These entries are not disposable build output. The cleaner does not traverse root directory symlinks.

The 2026-10-31 cleanup consolidates completed Moodle plans, dated reviews, competitive research, and implementation reports into maintained contracts. Tracked historical documents remain retrievable through Git history. Local screenshots, logs, traces, temporary deployment scripts, and dated release manifests are disposable review output, not application dependencies or a current deployment procedure.

## Validation evidence

Run the commands in the project README to establish current results. Old test counts, dependency audit results, screenshots, and release hashes describe earlier snapshots; they are not current verification. Automated integrations use fictional data and simulated transports. Authenticated Moodle/Nextcloud access, hosted CI, production deployment, physical devices, and native office application compatibility require separate direct verification.

The 2026-11-03 review passed `npm run verify`: lint, TypeScript, 469 Vitest tests in 65 files with enforced coverage thresholds, 10 Node security/offline regressions, the production build, and the dependency audit with zero known vulnerabilities and no advisory exceptions. Ten direct dependencies were updated in the lockfile; the development-tool `minimatch` correction uses the documented override. Lint also passed separately for all changed source and regression files with zero warnings. Local documentation links and `git diff --check` passed.

The development browser run passed 104 of 105 tests; the first `/today` navigation in the backup-reminder test exceeded its 30-second limit during initial loading. That unchanged test passed in an isolated `--last-failed` run. Both new browser regressions passed: a remotely closed task period preserves saved evidence and the unsaved draft, and a stale task-weight autosave preserves a newer period assignment. The test-mode compiled application then passed all 27 checks across Chromium, Firefox, and WebKit, including strict CSP, offline navigation/PDF generation, encrypted downloads, and worker updates. These are local synthetic checks; no deployment, hosted CI run, or authenticated external-service validation was performed.

For the 2026-10-31 cleanup, lint, TypeScript checks, 451 unit tests with coverage thresholds, 10 Node script regressions, and the production build passed. Local Markdown links, cleaner syntax, generated-output removal, preservation of workspace entries, and preservation of an external directory junction also passed dedicated checks. Generated build and coverage files were removed again afterward. The dependency audit returned no valid JSON report on either of two attempts; dependency security could not be verified. No browser suite or deployment was performed for this repository cleanup.
