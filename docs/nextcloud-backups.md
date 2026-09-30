# Nextcloud backups

Configuration → Nextcloud creates manual, encrypted, immutable backups through the Proxy browser extension (bridge protocol v1, tested against source version 0.2.7). It is not multi-device synchronization.

Settings has a single **Data and backups** entry (`/config/database`), with internal navigation for local files and Nextcloud (`/config/database/nextcloud`). The old `/config/nextcloud` URL redirects to the latter. Extension detection, installation and permissions are centralized in **Proxy extension** (`/config/proxy`), linked from Nextcloud, AI and Moodle. Detection only sends a local bridge ping, not service requests or academic data; each service retains its own connection test. Local backups do not require the extension.

## User workflow

1. Install/update Proxy and allow `edunoza.com`. Enable GET, PROPFIND, MKCOL and PUT.
2. Enter the HTTPS Nextcloud installation URL, account username and preferably an app password. No institution is preselected. The server URL is remembered on this device, but the login username and passwords are not. Actual account authentication remains subject to the institution's policies.
3. Test the connection and list backups. This step does not create a directory or write remote data.
4. Choose and confirm a separate encryption password of at least 12 characters. Create the backup explicitly.
5. To restore on this device, list backups, enter the original encryption password and choose Restore from Nextcloud. Review the filename, timestamp and record counts, then explicitly acknowledge replacement. Edunoza first uploads and verifies an encrypted preventive snapshot using the entered encryption password, then replaces the local database in one transaction. No manual file transfer is required. To download files independently, use Nextcloud itself.

Credentials, encryption passwords and the reviewed payload are React state only. They are discarded on leaving this screen. There is no automatic synchronization, remote deletion or credential persistence. Local data replacement requires explicit confirmation after review.

## Interface guidance

This route inherits the configuration workspace's navy palette, labeled native fields and button treatments from `DESIGN.md`. Keep connection, encrypted backup creation and recovery in separate fieldsets, in that reading order, with a stacked layout on mobile. Use distinct labels for the Nextcloud app password, the new backup encryption password and the original recovery password.

Announce progress and verification results and disable competing operations while a request is running. The restoration dialog must state that all current local data is replaced, not merged, and that old drafts are cleared only after a successful transaction. Keep extension setup in its dedicated settings tab and account-specific troubleshooting in Nextcloud's expandable help. Users with read-only Nextcloud access can download a file in Nextcloud and use Database import with a local preventive backup.

## Integrity and security

- Reuses the local database snapshot builder, schema validator and AES-256-GCM/PBKDF2-SHA256 envelope (210,000 iterations).
- Upload filenames contain only timestamp and random UUID, never pupil names. The `Edunoza` directory is created during explicit upload only.
- `PUT` uses `If-None-Match: *`. Existing snapshots are never intentionally replaced.
- A successful PUT is not sufficient: GET must return identical ciphertext and authenticated decryption plus schema validation must succeed before the UI reports verification.
- Restoration validates decryption and database schema before showing the review dialog. Cancellation leaves local data unchanged. Confirmation creates a new, verified preventive backup in Nextcloud; failure blocks replacement. The source backup is never modified.
- The replacement uses the same transactional restore helper as local imports. A write failure rolls back all tables. A snapshot comparison inside the write transaction rejects local changes made while the preventive backup was being uploaded. Users should close other Edunoza tabs to avoid stale editors writing after restoration.
- The preventive snapshot uses the entered restore encryption password (at least 12 characters, distinct from the Nextcloud app password), disclosed before confirmation. Write permission, remote space and the existing transfer limits are required.
- DAV responses must contain an accessible collection. XML entities/DTDs, cross-origin hrefs, nested paths, query strings and non-backup filenames are rejected or excluded.
- Edunoza accepts only HTTPS installation URLs. The bridge transport rejects redirected responses. Proxy independently controls destinations, redirects, methods and body limits.
- Proxy necessarily receives the Nextcloud authorization header and encrypted file. It does not receive the encryption password. Nextcloud sees file metadata and ciphertext. Only trusted extensions and institution-approved accounts should be used.
- A local abort or timeout cannot cancel a request already sent by the extension. The UI warns about uncertain uploads; refresh the remote listing before retrying.

## Limits and verification

Edunoza limits encrypted files and responses to 10 MiB. Proxy defaults to 1 MiB requests and 10 MiB responses; users may need to increase the request limit to the required size. Its timeout can be raised to 120 seconds. No public-network CORS change is needed on Edunoza because Proxy performs the HTTP request.

The creation panel computes the compact encrypted envelope size before upload, including UTF-8 encoding, the AES-GCM authentication tag, and base64 expansion. It disables remote upload when the current snapshot exceeds 10 MiB and links to local export, which preserves all attachments. The 20 MiB raw attachment quota is independent of the remote transfer limit. Upload still checks the final payload because another tab may change data after the estimate.

Automated tests use synthetic database records and a simulated bridge/WebDAV server. They do not establish that a real BoxAbalar account permits this workflow. Live authentication requires the account owner's credentials entered locally in the application.
