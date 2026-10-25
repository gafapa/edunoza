# Read-only Moodle connection

Edunoza can associate existing local work with a Moodle course and bring selected information into its local database. The connector is strictly read-only in Moodle. It does not publish grades, upload files, create courses or activities, change enrolments, or delete remote data.

## Requirements

- A reachable HTTPS Moodle base URL, including its installation path.
- An account with access to the selected courses and a web-service token for an enabled service.
- The Proxy browser extension, with Edunoza authorized and HTTPS POST requests to the Moodle host permitted. POST carries read-only REST queries; it does not imply a write to Moodle.

The school administrator controls which web-service functions and course permissions are available. A normal browser login alone does not establish that REST access is enabled. Edunoza discovers the token's permitted functions and shows unavailable information explicitly. It cannot grant permissions or enable a service on the school's behalf.

The user-designated test URL is `https://centros.edu.xunta.gal/iesmontevila/aulavirtual/`. Its public page was reachable during implementation; authenticated access still requires a token supplied through Edunoza.

## Workflow

The Moodle screen (`/config/moodle`) is a single linear flow with three steps. Leaving the page disconnects the live client, but in-progress selections, mapping drafts and previews survive navigating between steps.

1. **Conectar**: enter the base HTTPS URL, then choose manual token or username/password authentication — the auth fields appear inline once the URL is valid, and the web-service shortname defaults to `moodle_mobile_app` behind an "Opciones avanzadas" disclosure. There is no preselected school. The base URL, service shortname and access mode are remembered. Previously saved connections are reachable behind a "¿Ya conectaste antes?" toggle to reconnect or forget an account.
2. **Elegir clase**: select a Moodle course — its snapshot loads automatically — and, if relevant, a Moodle subgroup. Choose an existing Edunoza group and subject, or create either inline; a new subject can be added to an *existing* group without also creating a new group. A course that already has exactly one saved destination restores it and continues straight to review; multiple saved destinations still require an explicit choice.
3. **Revisar y aplicar**: associate Moodle participants and activities with existing local students and tasks. Each row is compact — a student or activity with nothing decided yet shows only its name, plus a one-line "Coincidencia: Nombre · Usar" when its remote name exactly matches one local candidate (accents/case/whitespace-insensitive); clicking "Usar" links that single row. A "Vincular N coincidencias exactas" primary button (count included, hidden when there is nothing to suggest) applies every pending exact match at once. Both still require an explicit click; nothing is ever linked without it, a "similar but not exact" name never suggests a match, and neither shortcut overrides a row the teacher already decided explicitly (create/unlink/link-to-someone-else) — only rows still at their default "Ignorar" state are offered. Bulk "Crear todo lo pendiente", "Ignorar todo lo pendiente" and "Quitar todas las asociaciones" actions are also available. Comprobar and guardar the associations, then review basic information changes and available grades together — each proposed field or grade can retain Edunoza's value or accept Moodle's, with bulk "Mantener todo Edunoza" / "Usar todo Moodle" shortcuts — and apply them in one action. Linking records preserves their local IDs and academic content; importing a compatible grade applies an explicit 0–10 conversion, and unsupported representations are never silently converted. A read-only submission summary (status, activity links, deadlines) stays visible throughout. Refresh from "Elegir clase" when new Moodle information is needed; there is no background synchronization.

## Reassignment and preservation

Associations are stored separately from students, tasks and grades. Changing or removing a link leaves the old academic record intact. Names are labels, not identities; matching two similar names never constitutes authorization to merge pupils. A remote deletion or loss of permission does not delete a local student or task.

The connector only updates reviewed basic names/titles and supported direct task grades. It does not overwrite tutorial notes, family contacts, attendance, private comments, attachments or other evaluation methods. Moodle deadlines are displayed as deadlines and are not automatically converted into scheduled lesson sessions.

## Disconnect, reconnect and forget

**Disconnect** cancels local processing of outstanding requests and discards the live client. The saved token, academic records and associations remain. Leaving the Moodle settings screen also ends the live connection. Use **Borrar token guardado** to delete the device token and disconnect without removing academic data or associations.

**Reconnect** loads the last saved token for the normalized server when its account ID matches the selected connection. Otherwise enter another token or request one with username/password. Associations are recovered only for the same normalized server and authenticated account. A newer login to the same server replaces its saved token, but does not delete other accounts' associations.

**Forget** removes the selected connection's saved metadata, associations, operation summaries and its saved token if present. It does not remove students, tasks, grades, or any other academic data. Future connections require making the associations again.

## Storage and transport

The Proxy extension can read the Moodle access token and the data returned by Moodle. Requests go through the extension to the selected Moodle, not through an Edunoza application server. The token is carried in the POST body rather than URLs. At the user's explicit request, a successfully validated token is kept in localStorage for reuse, outside academic backups, operation summaries and analytics. This is not encrypted credential storage: another person or script with access to this browser profile can use it. Deleting it locally does not revoke it in Moodle. Storage failures are reported and leave the connection session-only. Login usernames and passwords are not persisted; Moodle's display name and numeric account ID remain connection metadata.

Username/password authentication uses an HTTPS POST to the installation's `login/token.php`, carrying `username`, `password` and the service shortname in the encoded body. Proxy can read these credentials. Edunoza clears the password field on submission and cancellation and does not persist it. The default service is `moodle_mobile_app`; an administrator can supply another enabled shortname. Service availability, token-generation permissions, SSO and MFA policies may prevent this flow; manual tokens remain available. The returned `privatetoken` is discarded. There are no automatic login retries or redirects accepted as successful responses.

Authentication can generate/reuse a server-side token and log the login attempt; disconnecting does not revoke it on Moodle. The read-only guarantee applies to academic operations, not Moodle's own authentication bookkeeping. The token's server-side permissions depend on its service; Edunoza still invokes only its read-only academic allowlist. Prefer a restricted service where available. See the [official token endpoint source](https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/login/token.php).

Non-secret connection metadata and associations are included in encrypted Edunoza backups. Older backups remain importable without Moodle metadata. Restoring a backup does not restore an authenticated Moodle session.

## Troubleshooting unavailable grading methods

The default login service, `moodle_mobile_app`, does not include `core_grading_get_definitions` in Moodle 4.5's standard service registration. A teacher role alone cannot add a function to the token's service. Edunoza checks the functions reported by `core_webservice_get_site_info`; when this function is absent, assignment grading methods remain unverified.

Grading definitions are optional for importing an assignment's numeric result. When `mod_assign_get_grades` provides a numeric task grade and assignment metadata provides a positive maximum, Edunoza shows the original score, its explicit 0–10 conversion and the existing local score. Known advanced grading and unverified methods require choosing **Importar solo resultado numérico** individually for each grade. This copies only the task result, without rubric criteria or guide levels; it does not claim to reproduce a gradebook total, overrides or weighting. **Usar todo Moodle** never selects these rows on the teacher's behalf, and all rows initially retain the local value. A refresh resets the choices. Group submissions, nonnumeric scales, incompatible local evaluation settings, closed periods, stale previews and conflicting local changes remain protected.

To enable method verification as well, an administrator can check **Site administration > Server > Web services > External services**, select an editable custom service, and add `core_grading_get_definitions` alongside the read functions required by the connector. Authorize the teacher for that service where restricted to authorized users, and issue a token for that same service. For username/password login, enter the custom service's shortname in Edunoza's advanced connection options; changing the shortname does not change an already saved token. Reconnect with the appropriate token and refresh the course before reviewing grades again.

If the function is present but one task remains unverified, check the account's access to that activity and any context restriction on the token. Moodle can also return module-specific warnings for draft or hidden advanced grading definitions. `moodle/grade:managegradingforms` controls access to those restricted definitions; it is not a universal prerequisite for reading every grading area. Do not grant it solely because the function is missing from the service. Missing areas and unscoped warnings also remain unverified, so the generic task notice alone does not prove a permission failure.

Sources: [Moodle 4.5 service registration](https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/lib/db/services.php) and [grading API access checks](https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/lib/classes/grading_external.php). These checks describe upstream behavior; the school's installed version and authenticated configuration have not been inspected.

## Function families

The adapter uses an explicit read-only allowlist. Site identity and accessible courses come from `core_webservice_get_site_info` and `core_enrol_get_users_courses`. Course information comes from enrolled-user, group and course-content functions. Assignment metadata, grades and submissions use `mod_assign_get_*` functions where permitted. Optional grading-definition metadata may be used to distinguish representations. No `save`, `update`, `create`, `delete`, or upload operation is exposed by the adapter.

## Single-flow redesign and returning updates

The connector was redesigned from an earlier two-subsection, seven-step wizard into the single three-step flow described above, without dropping any capability: every preview-before-apply step, conflict-detection rule and safety guard documented in this file is unchanged — only its exposure to the teacher is simpler.

For subsequent updates, reselecting the same course from **Elegir clase** (or its "Actualizar curso" refresh) is the only refresh path; it doubles as the old "Buscar cambios" shortcut. Edunoza fetches a fresh snapshot, recovers the valid current or uniquely saved destination and, when found, returns straight to **Revisar y aplicar** with fresh basic-information and grade previews. Multiple saved destinations still require choosing the intended one. New remote records remain pending associations; the refresh never imports automatically.

Refreshing, changing scope or applying associations invalidates older previews. Applying basic-information changes also invalidates the grade preview for the same scope, so Edunoza automatically re-issues it before applying any selected grade. A failed refresh leaves no old snapshot actionable.

See [the guided workflow plan](moodle-guided-workflow-plan.md) for the design history of the original guided flow this redesign replaced.

## Verification scope

Automated tests use synthetic Moodle protocol responses and isolated browser databases. They cover association preservation, stale plans, disconnect/reconnect, account separation, read-only transport and backup validation. A public-page HTTP check is not an authenticated integration test. A live test must use the authorized Moodle token in the app and confirm the capabilities reported by that server.

See [the implementation plan](moodle-integration-plan.md) for ownership and acceptance criteria.

## Deployment verification — 2026-09-13

Published the dedicated Proxy tab, optional username/password token acquisition, device token persistence and institution-neutral connection preferences. Thirty focused unit tests and twenty browser tests passed, including cancellation, token deletion, non-persistence of login credentials and recovery of previously saved Moodle connections. TypeScript, scoped lint and production build passed. Production verification confirmed 68 byte-identical build files, security headers and 14 routes without uncaught JavaScript errors, including initially empty Moodle/Nextcloud server fields in a fresh browser. No live school login was attempted.
