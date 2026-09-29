# CI and security maintenance

## Automated verification

The CI workflow runs lint, TypeScript checks, Vitest, Node security regressions, the production build, the dependency audit, the test-profile build, and every Playwright test. Browser tests use synthetic records and isolated browser contexts; they require no production credentials.

Playwright uses its managed Chromium browser, installed with `npx playwright install --with-deps chromium` on Linux. Run `npx playwright install chromium` before `npm run test:e2e` on a local machine.

The workflow uses one standard Ubuntu runner, two browser workers, a 20-minute job timeout, and cancellation of superseded runs. Dependencies are cached by lockfile. Only failed jobs upload available browser diagnostics, retained for three days. Trace files and screenshots contain synthetic test data.

This repository is public. Standard GitHub-hosted runner execution is free for public repositories under [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions). The workflow uses no larger runners or paid services. If the repository becomes private, check the owner's included monthly allowance and configure a spending budget with usage blocking in GitHub billing; workflow YAML cannot enforce an account-level financial cap.

## Supply-chain controls

Workflow permissions are limited to `contents: read`. Checkout does not persist repository credentials. External actions are pinned to full commit SHAs. Pull-request tests use `pull_request`, so untrusted changes do not execute through a privileged `pull_request_target` workflow.

Dependabot proposes grouped compatible npm updates weekly and action updates monthly. Major npm upgrades need a separate compatibility review. Updates are not automatically merged. The locked dependencies currently require no npm advisory exceptions; a recurrence of the formerly exempt React Router advisory fails CI.

## Offline caching and credentials

Internal navigation first completes a form's supported autosave before leaving. Successful saves bypass the discard dialog. Invalid or failed saves still require an explicit discard decision, and forms without autosave retain their unsaved-change confirmation.

The service worker caches only assets listed by the production build. Same-origin API responses, authenticated requests, query-bearing asset URLs, and requests outside the app scope bypass its cache. Online navigation never overwrites the installed build's offline HTML, keeping its shell paired with the installed assets until the next worker activates. Offline deep links return that shell; a missing shell returns HTTP 503.

Moodle credential recovery skips malformed saved entries and verifies account-scoped keys. Damaged legacy entries do not prevent removal of an account's token. Optional saved tokens remain unencrypted device-local credentials; use the app's deletion control to remove them, and Moodle to revoke them.

These automated checks cover known dependency advisories and the tested application behavior. They do not establish a complete security audit of the deployed host or an authenticated integration test against a school Moodle server.
