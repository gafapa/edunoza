# CI and security maintenance

## Automated verification

The CI workflow runs lint, TypeScript checks, Vitest with enforced coverage thresholds, Node security regressions, the production build, the dependency audit, the local/CI verification build, and every Playwright test. Browser tests use synthetic records and isolated browser contexts on localhost; they require no production credentials. The only public deployment is `https://edunoza.com`; `.env.test` does not configure a separate public site.

Playwright keeps the development Chromium workflow suite and a separate built-application suite using Chromium, Firefox, and WebKit. Install them with `npx playwright install --with-deps chromium firefox webkit` on Linux or `npx playwright install chromium firefox webkit` locally. Run `npm run test:e2e` for development fixtures, then `npm run test:e2e:production` after a build to exercise `dist/` through Vite preview. The production suite includes offline deep links, strict CSP execution, encrypted backup downloads, modal focus, worker updates, and Word, ODT, and PDF exports. Its preview fixture destroys network connections for an isolated context's offline cookie. Each worker-update test uses a separate server on an ephemeral port, which changes the same worker URL without depending on worker-request cookies or affecting parallel contexts. This avoids the [WebKit offline-emulation defect](https://github.com/microsoft/playwright/issues/42775) without skipping offline verification or changing the shipped worker.

The workflow uses one standard Ubuntu runner, two browser workers, a 20-minute job timeout, and cancellation of superseded runs. Dependencies are cached by lockfile. Failed jobs upload available browser diagnostics; runs also retain synthetic behavior-layout previews when those tests produce them. Both artifact types are retained for three days. Trace files and screenshots contain synthetic test data.

Manual workflow dispatch accepts an optional `production_test_grep` filter for focused compiled-application regressions. Filtered runs keep lint, TypeScript, unit tests, coverage, build, and audit, and run the selected production tests in all three browsers. Pull requests always run both complete browser suites.

This repository is public. Standard GitHub-hosted runner execution is free for public repositories under [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions). The workflow uses no larger runners or paid services. If the repository becomes private, check the owner's included monthly allowance and configure a spending budget with usage blocking in GitHub billing; workflow YAML cannot enforce an account-level financial cap.

## Supply-chain controls

Workflow permissions are limited to `contents: read`. Checkout does not persist repository credentials. External actions are pinned to full commit SHAs. Pull-request tests use `pull_request`, so untrusted changes do not execute through a privileged `pull_request_target` workflow.

Dependabot proposes grouped compatible npm updates weekly and action updates monthly. Major npm upgrades are proposed separately, with Vitest packages grouped together, and need a compatibility review. Node types stay on the selected Node 24 line. TypeScript 7 remains deferred because the installed typescript-eslint supports TypeScript below 6.1; the compiler is upgraded to 6.0.3. Updates are not automatically merged. The locked dependencies currently require no npm advisory exceptions; a recurrence of the formerly exempt React Router advisory fails CI.

## Offline caching and credentials

Internal navigation first completes a form's supported autosave before leaving. Successful saves bypass the discard dialog. Invalid or failed saves still require an explicit discard decision, and forms without autosave retain their unsaved-change confirmation.

The service worker caches only assets listed by the production build. Same-origin API responses, authenticated requests, query-bearing asset URLs, and requests outside the app scope bypass its cache. Online navigation never overwrites the installed build's offline HTML, keeping its shell paired with the installed assets until the next worker activates. Offline deep links return that shell; a missing shell returns HTTP 503.

Moodle credential recovery skips malformed saved entries and verifies account-scoped keys. Damaged legacy entries do not prevent removal of an account's token. Optional saved tokens remain unencrypted device-local credentials; use the app's deletion control to remove them, and Moodle to revoke them.

These automated checks cover known dependency advisories and the tested application behavior. They do not establish a complete security audit of the deployed host or an authenticated integration test against a school Moodle server.

## Local recovery and storage failures

Shared database validation and replacement live in `src/shared/backup/database.ts`. Every local destructive operation compares its pre-encryption safety snapshot inside the write transaction. Attachment quota and owner checks run in the same transaction as insertion. Indexed size metadata avoids loading file contents to calculate usage.

Unavailable preference storage uses session defaults and a visible notice. Unavailable lock storage blocks the private workspace until storage can be checked again; it never silently disables a configured lock. Retry timing remains active in memory if session storage cannot persist it.

The HTML build uses `scripts/security-policy.mjs`. Node security tests require the hosting and Nginx headers to match that policy, including worker sources.
