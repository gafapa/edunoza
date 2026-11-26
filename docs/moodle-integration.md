# Read-only Moodle connection

Edunoza can associate existing local work with a Moodle course and bring selected information into its local database. The connector is strictly read-only in Moodle. It does not publish grades, upload files, create courses or activities, change enrolments, or delete remote data.

## Requirements

- A reachable HTTPS Moodle base URL, including its installation path.
- An account with access to the selected courses and a web-service token for an enabled service.
- The Proxy browser extension, with Edunoza authorized and HTTPS POST requests to the Moodle host permitted. POST carries read-only REST queries; it does not imply a write to Moodle.

The school administrator controls which web-service functions and course permissions are available. A normal browser login alone does not establish that REST access is enabled. Edunoza discovers the token's permitted functions and shows unavailable information explicitly. It cannot grant permissions or enable a service on the school's behalf.

The user-designated test URL is `https://centros.edu.xunta.gal/iesmontevila/aulavirtual/`. Its public page was reachable during implementation; authenticated access still requires a token supplied through Edunoza.

## Workflow

The Moodle screen (`/config/moodle`, titled "Importar de Moodle") connects once and then runs three steps. Leaving the page disconnects the live client, but selections and unsaved matching choices survive moving between steps. The UI avoids connector jargon: it speaks of *emparejar* (matching), *tu nota* / *nota de Moodle* and *traer novedades*.

- **Connect** (shown only while disconnected): enter the base HTTPS URL, then choose manual token or username/password authentication — the auth fields appear inline once the URL is valid, and the web-service shortname defaults to `moodle_mobile_app` behind "Opciones avanzadas". The base URL, service shortname and access mode are remembered. Saved connections are behind "¿Ya conectaste antes?" to reconnect or forget an account. Once connected, the header shows "Conectado a <site>" and **Desconectar**.

1. **Origen y destino**: a "Desde Moodle → A Edunoza" form. Pick the Moodle course (its snapshot loads automatically) and optional Moodle group, then the Edunoza class and subject; "+ Crear…" options create either inline, prefilled from the course names. A new subject can be added to an existing class. Every course already imported to exactly one destination is offered as **Traer novedades**, which loads it and goes straight to the grades step; a course with several saved destinations still requires an explicit choice.
2. **Emparejar**: only exceptions are listed. A Moodle participant or graded activity whose name matches exactly one unlinked local record (accents/case/whitespace-insensitive) is *preselected* as matched and folded under "Ver N emparejados"; similar but not exact names never match. A participant with no match becomes a new student, unless unlinked students remain in the class: then the row is **Por decidir** and saving is blocked until the teacher chooses (link to someone, create, or skip). Graded activities default to a new task (or their exact match) with an **Incluir** checkbox; resources without grades are not offered. One **Guardar y ver notas** button validates and saves every choice in one go; if any row is invalid nothing is saved and the problems are listed. Nothing is linked before that click.
3. **Notas**: a summary of new, unchanged, differing and non-importable grades, all converted to 0–10. New grades import without further questions. Only grades that differ from an existing local grade need a choice ("Mantener 6" / "Usar 7", with "Para todas" shortcuts; default keeps the local grade). Activities graded with advanced grading or an unverified method need one explicit confirmation per activity ("importar solo la nota final"); bulk shortcuts never give it. Name changes in Moodle are offered field by field. Non-importable grades are grouped by task with their reason and, where possible, a link to the fix (switch the task to a direct grade in the gradebook, or review closed periods). If new Moodle records appeared since the last matching, a callout links back to **Emparejar**. A read-only submission summary sits in a collapsed section.

After importing, a confirmation lists the tasks and grade counts, warns when imported tasks have weight 0 while other tasks are weighted (they do not count in the average), and opens the gradebook already filtered to that class and subject.

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

Grading definitions are optional for importing an assignment's numeric result. When `mod_assign_get_grades` provides a numeric task grade and assignment metadata provides a positive maximum, Edunoza shows the original score, its explicit 0–10 conversion and the existing local score. Known advanced grading and unverified methods require confirming **importar solo la nota final** once per activity. This copies only the task result, without rubric criteria or guide levels; it does not claim to reproduce a gradebook total, overrides or weighting. **Usar Moodle** never gives that confirmation on the teacher's behalf, and differing grades initially retain the local value. A refresh resets the choices. Group submissions, nonnumeric scales, incompatible local evaluation settings, closed periods, stale previews and conflicting local changes remain protected.

To enable method verification as well, an administrator can check **Site administration > Server > Web services > External services**, select an editable custom service, and add `core_grading_get_definitions` alongside the read functions required by the connector. Authorize the teacher for that service where restricted to authorized users, and issue a token for that same service. For username/password login, enter the custom service's shortname in Edunoza's advanced connection options; changing the shortname does not change an already saved token. Reconnect with the appropriate token and refresh the course before reviewing grades again.

If the function is present but one task remains unverified, check the account's access to that activity and any context restriction on the token. Moodle can also return module-specific warnings for draft or hidden advanced grading definitions. `moodle/grade:managegradingforms` controls access to those restricted definitions; it is not a universal prerequisite for reading every grading area. Do not grant it solely because the function is missing from the service. Missing areas and unscoped warnings also remain unverified, so the generic task notice alone does not prove a permission failure.

Sources: [Moodle 4.5 service registration](https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/lib/db/services.php) and [grading API access checks](https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/lib/classes/grading_external.php). These checks describe upstream behavior; the school's installed version and authenticated configuration have not been inspected.

## Function families

The adapter uses an explicit read-only allowlist. Site identity and accessible courses come from `core_webservice_get_site_info` and `core_enrol_get_users_courses`. Course information comes from enrolled-user and course-content functions. Moodle subgroups and their members are derived from the `groups` field of `core_enrol_get_enrolled_users`, because `core_group_get_group_members` is not in the standard mobile service and both group functions require `moodle/course:managegroups`. Assignment metadata, grades and submissions use `mod_assign_get_*` functions where permitted. Grades of every other graded activity (quizzes, lessons, H5P, forums, workshops) come from the course gradebook through `gradereport_user_get_grade_items`. Optional grading-definition metadata may be used to distinguish representations. No `save`, `update`, `create`, `delete`, or upload operation is exposed by the adapter.

## Grades without extra Moodle plugins

Edunoza needs no Moodle plugin (MoodlIA or otherwise). Every function it calls ships with Moodle core, and all grade sources are in the default `moodle_mobile_app` service used by username/password login:

- `mod_assign_get_grades` for assignments (attempt-aware). When the service lacks it, assignment grades fall back to the gradebook.
- `gradereport_user_get_grade_items`, called once per course with `userid=0` (requires `moodle/grade:viewall`, which teachers hold by default), for every other activity with a gradebook item. Only the activity's main item (`itemnumber` 0) is read; course/category totals and manual items have no course module to link and are ignored.

Gradebook items graded with a scale, with a minimum other than 0, or without a visible range (the user report's *Show range* setting disabled) are not imported, and a warning says so. A gradebook permission error only adds a warning; the course snapshot and assignment grades remain usable. Activities other than assignments and forums cannot use advanced grading, so their numeric grade is offered as a direct grade; forum grades still require the individual numeric-result confirmation.

Imported grades are stored as direct grades of the linked task. Tasks created from Moodle activities are sent to the gradebook, and importing a grade also sends a linked local task there, because the gradebook only lists tasks marked with `sendToGradebook`.

## Single-flow redesign and returning updates

The connector was redesigned from an earlier seven-step wizard, and later from a four-step flow with separate check/save and per-grade decisions, into the three steps described above. Every preview-before-apply rule, conflict check and safety guard documented in this file still runs in the service; the UI only asks the teacher about exceptions.

For subsequent updates, **Traer novedades**, reselecting the same course, or "Actualizar curso" in **Origen y destino** is the refresh path. Edunoza fetches a fresh snapshot, recovers the valid current or uniquely saved destination and, when found, returns straight to **Notas** with fresh basic-information and grade previews. Multiple saved destinations still require choosing the intended one. New remote records remain pending associations; the refresh never imports automatically.

Refreshing, changing scope or applying associations invalidates older previews. Applying basic-information changes also invalidates the grade preview for the same scope, so Edunoza automatically re-issues it before applying any selected grade. A failed refresh leaves no old snapshot actionable.


## Verification scope

Automated tests use synthetic Moodle protocol responses and isolated browser databases. They cover association preservation, stale plans, disconnect/reconnect, account separation, read-only transport and backup validation. A public-page HTTP check is not an authenticated integration test. A live test must use the authorized Moodle token in the app and confirm the capabilities reported by that server.
