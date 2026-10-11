# Recovery and maintainability improvements

The recovery screen now exposes approximate browser storage usage and quota, warns at 80% usage, and offers an explicit persistent-storage request. Unsupported APIs, permission refusal, and failed requests leave encrypted backup actions available. Persistence reduces automatic eviction risk; clearing site data or losing the device still requires recovery from a separate encrypted backup.

Nextcloud uploads compress JSON locally using gzip before AES-GCM encryption. The 10 MiB transfer budget remains unchanged because the separately distributed Proxy extension owns its own transport limits. Compression effectiveness depends on the content: already compressed images, audio, and documents may still require a local backup.

Compressed envelopes use version 2 and authenticate the version/compression contract as AES-GCM additional data. Version 1 remains readable and is still used for local exports and safety copies. Older application releases cannot read version 2 envelopes. Decompression checks gzip integrity and rejects expansion beyond 75 MiB; the decoded database still passes the existing schema and relationship validator before restoration. The size preview uses the same compression settings as upload, without deriving an encryption key or storing a password.

PDF generation now runs in a same-origin module worker. Success, failure, cancellation, message errors, and timeout all terminate the worker. Leaving the report workspace cancels an ongoing export. The worker and font are precached with the built application, so exports can work offline without widening the content security policy. Report validation and document formatting have separate owners.

Presentation logic has been extracted from Gradebook, Reports, and Today; Gradebook icons also have their own component module. Existing Reports exports remain compatible with callers. Gradebook weight parsing now rejects non-finite values.

Built-browser testing also exposed existing 36 px behavior controls in Today, below the test's 44 px touch target requirement. Their grid columns and button dimensions now use 44 px while retaining wrapping in narrow student panels.

The first-install offline test reproduced a Chromium cache miss when a static host sends `Vary: Origin`: precache and module requests have different Origin headers. The service worker now ignores Vary only when matching allowlisted public build assets, which have one representation per build. URL, origin, method, query, and authorization guards remain unchanged. The Node regression and all three built browsers verify the fix. See [Cache.match options](https://developer.mozilla.org/en-US/docs/Web/API/Cache/match).

Regression tests cover storage API support and refusal, compressed and legacy envelope round trips, authenticated metadata, corrupt/truncated gzip streams, decompression limits, restoration rollback and cancellation, invalid references, legacy database migration, and worker lifecycle. Built-browser checks cover storage permission feedback and offline multipage PDF exports under the production CSP, using isolated synthetic data.

The locked `source-map-js` dependency was updated from 1.2.1 to 1.2.2 to resolve [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q). No other locked dependency changed.

## Validation

Validation passed lint, TypeScript, 429 unit tests in 62 files, the build, and the dependency audit with no known vulnerabilities through `npm run verify`. After the offline cache fix, the complete Node security/service-worker suite passed all 9 tests. Global coverage is 26.13% statements, 23.84% branches, 20.08% functions, and 27.26% lines. Global minimums were raised to 25%, 23%, 19%, and 26%, respectively.

| Critical module | Lines | Branches |
| --- | ---: | ---: |
| Backup compression | 100% | 94.73% |
| Backup encryption | 97.87% | 88.46% |
| PDF worker client | 93.75% | 100% |
| Device storage service | 100% | 93.33% |

These modules now have individual coverage thresholds in addition to the existing database, resource quota, and app-lock thresholds.

The 35 affected development-browser flows were verified: 33 passed the initial two-worker run, and two exceeded the original 30-second test budget. Both passed an isolated one-worker rerun within that unchanged budget (24.3 and 10.8 seconds). No test timeout was increased. The final built-application suite passed all 27 tests across Chromium, Firefox, and WebKit, including first-install offline PDF generation, no external report uploads, production CSP, storage feedback, touch target dimensions, and persisted behavior-mark removal. Mobile screenshots were inspected for readable layout and overflow.

The full CI browser suite exposed two outdated Moodle quick-update assertions: a saved scope goes directly to the "Changes and grades" review, so those assertions now check that screen. It also exposed an attendance reload triggered by a changed session object after saving. Attendance loading now depends on the stable class/date/slot identity, retaining the success notice and avoiding an unnecessary draft reset; the recovery test also checks the persisted absence.

Browser validation uses synthetic records in isolated profiles; it does not qualify a live Nextcloud account. Production deployment is recorded separately after successful CI. The Proxy extension is unchanged.
