# Data integrity and recovery

## Local writes

Academic records live in IndexedDB. Manual grade writes and deletion compare the expected grade, current assessment, enrolled student, and academic-period status inside the write transaction. Assessment metadata changes compare the reviewed assessment; deletion checks for grades in that same transaction. A stale review or closed period rejects the entire batch, including earlier writes in the transaction.

Academic-period creation, editing, assignment, date changes, and reopening validate current records in their write transactions. Concurrent creation cannot introduce overlapping periods; metadata edits cannot undo a closure or exclude dates of assigned assessments. Missing or foreign periods reject evidence edits rather than silently detaching the evidence. School-year rollover reads its source and checks target emptiness in the same transaction as all structural inserts, preventing duplicate population by concurrent tabs.

Task evaluation writes, task weights, and task folder moves compare the reviewed gradebook configuration and check its current period before writing. A concurrent closure or configuration change rejects the operation and preserves the unsaved form. Group weight batches also reject stale folders. Task evidence writes and all scope deletions roll back together on failure.

Grouped student imports recompute their deterministic plan from current records inside the transaction and compare it with the reviewed plan before inserting courses and students atomically. Attachment insertion checks current ownership and quotas in its write transaction. Indexed attachment sizes avoid reading all file contents to calculate usage.

Keep concurrency and rollback regressions when reorganizing code. Old test dates and historical fixtures do not make these protections obsolete.

## Destructive operations and compatibility

`src/shared/backup/database.ts` owns database serialization, validation, and replacement. Import, reset, and demo loading create an encrypted preventive snapshot and compare that snapshot with current records inside the replacement transaction. Concurrent changes during encryption or remote upload abort replacement. Validation precedes clearing tables; transaction failure rolls back the replacement.

Retain the `profeplus-db` name, supported legacy backup identifiers, additive Dexie migrations, schema 6/7 payload compatibility, and optional historical report/behavior tables described in the project README. Database and backup schema versions are independent.

Historical task comments, daily evaluation settings, rubric/checklist results, and direct grades can remain valid without an active task-subject planning link. Preserve their explicit scope and validate entity references, enrolment, ownership, values, and uniqueness. Active planner sessions and gradebook configuration still require that link. Never discard historical academic evidence solely because its planning link is absent.

Nextcloud restoration requires a decrypted, validated preview and a verified remote preventive backup before local replacement. See [Nextcloud backups](nextcloud-backups.md) for compressed/legacy envelope compatibility and size limits.

## Browser storage and drafts

Recoverable drafts require explicit restoration, expire after seven days, and are excluded from academic backups. Successful database replacement/deletion clears obsolete drafts. Supported autosaves flush before navigation; invalid or failed saves keep the explicit discard decision.

Preference storage failures use session defaults and visible feedback. Unavailable or malformed app-lock storage blocks access; it must not silently disable a configured lock. Lock changes propagate across tabs and invalidate outstanding unlock attempts. The app lock does not encrypt the live academic database.

The recovery screen estimates browser storage usage, warns at 80%, and offers a persistent-storage request. Permission refusal and unsupported APIs leave encrypted backup actions available. Persistence does not protect against explicit site-data deletion or device loss.

## Reports and offline assets

Protected AI datasets omit free-text notes, follow-ups, activity titles, and comments, replace subject names, and use generated student labels. Academic values and support indicators can still be sensitive: this is data minimization, not a guarantee of anonymity. Approval must cover the actual outgoing snapshot; cancellation before approval sends no request.

Reports distinguish ungraded, not-submitted, and exempt work and identify the group, school year, and date scope. Follow-up edits preserve responsibility, due date, priority, status, and audit metadata. Calendar exports preserve timed classes and all-day follow-up dates.

CSV exports quote every cell, escape embedded quotes, and prefix spreadsheet formula markers with an apostrophe even after leading whitespace, byte-order marks, or control characters.

PDF generation runs in a same-origin worker. Completion, cancellation, errors, and timeout terminate it; leaving the workspace cancels export. The font, worker, and build assets are precached; updates copy unchanged content-hashed assets from the previous installation and download the rest. Service-worker cache ownership includes registration scope; activation removes only obsolete caches belonging to that scope. Legacy caches without provable ownership remain intact. Allowlisted public build assets ignore `Vary` during matching while origin, method, query, and authorization guards still apply.

See [CI and security](ci-and-security.md) for executable verification and [AI reports](ai-report-workflow.md) for download contracts. Synthetic browser results are not an authenticated service test or a real-teacher usability study.
