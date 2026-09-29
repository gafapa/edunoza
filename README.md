# Edunoza

Edunoza is an offline-first teacher notebook packaged as a PWA. It is built for day-to-day classroom management: class groups, students, subjects, schedules, attendance, work logs, task planning, gradebook, follow-up records, reports, and local backups.

All academic data is stored locally in the browser with IndexedDB. AI features connect to the selected provider from the browser (through the Proxy extension for Ollama); Edunoza does not operate an AI proxy server or receive those requests.

The optional [read-only Moodle connection](docs/moodle-integration.md) associates existing local groups, students and tasks with Moodle information through the Proxy extension. Reviewed updates and supported assignment grades are applied locally; Edunoza does not modify Moodle. Tokens remain in memory unless the user explicitly saves a validated token on this device. Saved tokens use unencrypted localStorage, are excluded from academic backups, and can be deleted separately. Disconnecting preserves academic work and saved associations.

## Current Scope

- A public landing page explains the local-first value proposition before opening the private teacher workspace. It uses a clearly labeled simulated day view and does not require account creation.
- Top-level teacher workspace organized around Today, an actionable Agenda, the weekly Planificador, advanced task evaluation, attendance history, gradebook, academic management, reports, and configuration.
- A local-first action agenda combines overdue and upcoming tutor follow-ups, family next steps, planned task sessions, dated assessments, and open academic-period endings. It supports course, type, status, and time-horizon filters plus standards-based ICS calendar export.
- A persistent classroom layout supports accessible seat reassignment and swapping, random seating, non-repeating student selection, balanced group generation, and optional exclusion of students marked absent today.
- Course and student management, including student photos, email contacts, educational measures, tutorial follow-up records, grouped XADE CSV import, and pasted spreadsheet import.
- Local resource attachments for student evidence and reusable task materials, supporting validated web links and common document, image, audio, and video formats.
- A guided, resumable onboarding flow that derives progress from saved course, student, schedule, and subject data without creating sample content.
- Mobile-first tutor coordination with due dates, ownership, priorities, structured family contacts, and cross-class support groups backed by stable person identities.
- Subject, unit, task, and schedule management, with exactly one course per subject, one-action course enrollment, optional task units, validated weekly time blocks, guarded autosave, and task evaluation setup.
- Monthly attendance history with course, subject, status, and student filters, incident summaries, detailed records, and contextual links back to the matching Today session.
- Ad-hoc and one-occurrence rescheduled classes, with justified absences, late minutes, early departures, and backup-safe exceptional occurrence identifiers.
- Advanced evaluation workspace for task sessions, rubrics, checklists, and direct grades, with free-form daily records handled in Today.
- Weekly planner with contextual links from Today, quick two-step task assignment, immediate undo, touch- and keyboard-friendly session rescheduling, multi-session progress, and advanced session fields for status, objectives, competencies, materials, homework, and teacher notes.
- Gradebook with persisted academic periods, manual assessments, weights, folders, competencies, per-student grades, observations, task scores, and immutable versioned closure snapshots.
- Bulk grade entry with visible-student filtering, shared status/value actions, spreadsheet matrix paste, and keyboard cell navigation. Missing, exempt, and not-submitted work remain semantically distinct.
- A categorized feedback bank inserts teacher-authored reusable comments into Today observations and manual gradebook evidence without applying or saving them automatically.
- Accent-insensitive global search finds students, tasks, assessments, follow-ups, family contacts, and local resources, then opens the owning workspace with its academic context restored.
- Reusable units, tasks, rubrics, and checklists, plus accessible `Move to…` controls wherever drag and drop is offered.
- Reports module with prerequisite-aware empty states, date-range filtering, printable HTML reports, CSV exports, AI-ready datasets, and an explicit local-versus-AI output choice.
- Local database operations for seeded test data, encrypted JSON backup export/import, integrity checks, and data reset. Destructive replacements create an encrypted safety backup and require explicit confirmation.
- Selective encrypted handoff packages for chosen students and support groups, with conflict preview and non-destructive merge semantics.
- Privacy-preserving product analytics record only fixed event names through same-origin, bodyless requests. No academic content, search text, record IDs, cookies, or persistent user identifiers are collected.
- An in-app feedback composer lets teachers review and share a suggestion, problem, or question through the browser share sheet or clipboard without sending academic data automatically.
- Backup freshness reminders, a visible recovery status, and non-destructive backup-file verification make the local-only storage model explicit and easier to recover.

## Teacher Workflow

Each academic record has one primary workspace. Cross-links preserve context and accelerate navigation without creating a second editor for the same data.

- **Today** owns class delivery: attendance, attendance observations, the actual class record, and quick per-student work comments.
- **Agenda** derives a read-only action list from existing academic records and links each item back to its owning workspace.
- **Classroom** owns the persistent seating plan and temporary participation/grouping tools for the selected course.
- **Search** provides cross-workflow discovery and deep links without duplicating record editors.
- **Planificador** owns future preparation: assigning tasks to schedule slots, rescheduling sessions, and editing planned objectives, materials, homework, and notes.
- **Evaluate** owns task evidence: rubric results, checklist results, and direct task grades.
- **Attendance** owns review: monthly history, incident summaries, filtering, and contextual links to correct the original class in Today.
- **Gradebook** owns grade consolidation: manual assessments, folders, weights, task-score inclusion, and final-grade calculations.
- **Management** owns reusable task resources and student evidence files. Attachments remain local and travel only inside full database backups.

## Academic Periods And School-Year Rollover

Academic periods are managed from `Management > Periods`. Each period belongs to one course, has an explicit date range, and cannot overlap another period in that course. Manual assessments store a local ISO `assessmentDate`; manual assessments and task gradebook configurations can be assigned to a period. A closed period rejects grade and task-evaluation changes until it is explicitly reopened.

Closing a period creates a new immutable, versioned snapshot of the course structure and the period-scoped gradebook evidence. Reopening does not delete or rewrite earlier snapshots; a later closure appends another version. These snapshots are included in encrypted database backups and are validated during import.

The school-year rollover action can create a new course or populate a selected empty course. It copies structural data such as student enrolments, subjects, units, tasks, instruments, gradebook definitions, and shifted academic periods. It deliberately does not copy grades, attendance, session evidence, evaluations, follow-up records, or closure snapshots. New enrolment rows retain the student's stable `personId`, which keeps longitudinal identity separate from the year-specific enrolment ID.

The v1-to-v2 migration preserves existing manual assessments. Legacy text period labels become non-overlapping academic periods distributed across the September-to-June school year, and their deterministic default `assessmentDate` is the end of the generated period. Teachers should review these generated dates before closing migrated periods.

## Stack

- React 19 + TypeScript 5.9
- Vite 8 with a native service worker and web app manifest
- Redux Toolkit 2
- Dexie 4 with IndexedDB
- React Router 7
- Vitest 4

## Requirements

- Node.js 22.13+ (`.node-version` currently selects Node.js 24.18)
- npm 10+
- A current browser with Fetch, Web Crypto, IndexedDB, and service-worker support
- A provider API key, or a local Ollama or LM Studio server, when AI workflows are needed

## Local Development

```bash
npm install
npm run dev
```

The Vite dev server prints the local URL. By default it uses the configured base path from the environment.

## Scripts

```bash
npm run dev        # Start Vite in development mode
npm run build      # Type-check and build production assets into dist/
npm run build:test # Build the local/CI verification profile with analytics disabled
npm run build:production # Build the production deployment profile
npm run preview    # Preview the production build
npm run clean      # Remove generated builds, coverage, logs, and TypeScript caches
npm run test       # Run Vitest
npm run test:coverage # Run Vitest and write the full source coverage report
npm run lint       # Run ESLint, including React hook checks
npm run typecheck  # Run TypeScript project checks
npm run audit      # Audit dependencies against the reviewed advisory policy
npm run verify     # Run lint, typecheck, tests, build, and dependency audit
```

Use `npm run verify` before publishing or handing off a larger change.

## Data Model And Backups

Edunoza has no backend. Data persists in IndexedDB through Dexie.

Database tools are available under `Configuración > Base de datos`:

- Load seeded demo data for local testing.
- Export an AES-256-GCM encrypted JSON backup with app metadata, schema version, export timestamp, and table data. Keys are derived from a password of at least 12 characters using PBKDF2-SHA-256 with 210,000 iterations.
- Import an encrypted backup, or a legacy plaintext JSON backup, after validating the exact current schema, export timestamp, complete table set, row IDs, references, duplicates, dates, schedule-day alignment, schedule overlaps, task scopes, and assessment shapes.
- Verify the current database integrity or validate an existing backup file without replacing local data.
- Delete all local app data.

Backups include `schemaVersion` and `exportedAt`. Unsupported or malformed backups are rejected before existing local tables are cleared. Imports and destructive demo/reset operations show a confirmation summary and require a separate password before downloading an encrypted safety backup.

The IndexedDB database uses additive Dexie migrations. It retains the legacy internal name `profeplus-db` so existing same-origin installations keep their data after the Edunoza rebrand. Schema v2 added academic periods and closure snapshots without deleting v1 data, schema v3 added stable person identities and tutor-coordination tables, schema v4 added resource attachments, schema v5 added classroom layouts, and schema v6 added reusable feedback comments. Student enrolment rows carry a stable `personId` so year rollover can create a new enrolment without losing longitudinal identity. Cross-class support groups reference those student enrolments without duplicating student profiles. Each subject belongs to exactly one course. Attendance and task evaluation rows always include their course, subject, date, schedule slot, and required scope fields. Attendance also stores creation and update timestamps. Free daily class records allow Today to document unplanned lessons without creating artificial tasks.

Resource files are stored as backup-safe base64 data with a 5 MB per-file limit and a 20 MB application-wide limit. Active web formats such as HTML and SVG are rejected; links must use HTTP or HTTPS. Deleting an otherwise unreferenced student or task also removes its attachments. Full encrypted backups include resources, while school-year rollover and selective student handoff packages deliberately exclude them to avoid silently duplicating or disclosing files.

Classroom layouts are course-scoped and included in full encrypted backups. Deleting an otherwise empty course removes its layout, and deleting an otherwise unreferenced student removes that student's seat assignment. Temporary random-picker rounds and generated groups are intentionally not persisted.

Selective handoff packages contain only the selected students, their course references, tutorial follow-ups, structured family contacts, and relevant support-group memberships. They never include attendance, gradebook data, or resource attachments. Import first validates references and IDs, then shows creates, unchanged rows, and conflicts. Any conflicting ID blocks the complete merge; accepted merges use insert-only operations and never overwrite local rows.

Database payloads are intentionally not backward compatible. Only payloads produced by the current schema are accepted, and every current table must be present. This keeps import behavior deterministic and prevents inferred or partially scoped academic records.

## Security Model

- Academic records remain local to the browser profile in IndexedDB; Edunoza has no application backend.
- Downloaded backups and automatic pre-operation safety backups are encrypted. Edunoza never stores their passwords.
- An optional local app lock uses a salted PBKDF2-SHA-256 verifier, validates its stored work factor, pauses retries after repeated failures, and automatically locks after the configured inactivity period. It protects the visible application from casual access but is not a substitute for operating-system disk and profile encryption.
- CSV exports neutralize spreadsheet formula prefixes before escaping cell values.
- Backup imports enforce a size limit and validate metadata, structure, types, relationships, scopes, uniqueness, dates, and numeric ranges before changing the database.
- Resource imports additionally validate ownership, web protocols, MIME allowlists, exact base64 byte lengths, and per-file and total storage limits.
- The application includes a restrictive Content Security Policy, referrer policy, permission policy, cross-origin isolation headers, clickjacking protection, and MIME-sniffing protection. `public/_headers` applies the full header set on compatible static hosts. Nginx deployments can include `deploy/nginx-security-headers.conf` from the HTTPS server or location block.
- Anyone with access to an unlocked browser profile can still inspect its IndexedDB data. Use an encrypted operating-system account and do not share the browser profile when handling real student data.

## Anonymous Product Analytics

Production builds can emit a deliberately small set of anonymous product events to the same origin. Events are encoded only in an allowlisted URL path and sent as `POST` requests with no request body, query string, cookies, referrer, student data, free text, record IDs, or generated user ID. Browser Do Not Track and Global Privacy Control are respected. Test and local builds leave analytics disabled by default.

Event deduplication is held only in JavaScript memory for the current page runtime. Analytics does not write identifiers or deduplication flags to `localStorage`, `sessionStorage`, IndexedDB, or cookies.

The supported events cover application and coarse workspace opens, initial setup completion, class saves, calendar exports, search use, backup export/verification/import, and feedback opening/sharing. They measure whether major workflows are reached; they do not reconstruct teacher behavior or individual sessions.

For Nginx, include `deploy/nginx-analytics-log-format.conf` once inside the global `http` block and `deploy/nginx-analytics-endpoint.conf` inside the production HTTPS `server` block before publishing. The endpoint returns `204` and writes a dedicated-format line to the container log containing only an ISO timestamp and the fixed event path; IP addresses, user agents, referrers, cookies, request bodies, and query strings are excluded from that line. Set `VITE_ANALYTICS_ENDPOINT` to an empty value to disable collection.

## Public Legal Pages

The public legal area is available without opening or unlocking the academic workspace:

- `/legal`: legal information index.
- `/aviso-legal`: service-provider identification and legal notice.
- `/privacidad`: privacy information for technical logs, product events, email inquiries, local academic data, and optional external actions.
- `/cookies`: cookie and browser-storage information.
- `/condiciones`: terms of use for the free service.
- `/config/ai`: direct AI provider, model, credential lifetime, local endpoint, model discovery, and a non-academic connection test.

The landing footer links directly to every document, and the workspace status bar links to the legal index. The published copy reflects a free, advertising-free service operated by an individual and must be reviewed whenever the owner, hosting, analytics, external integrations, pricing, or data flows change.

## Direct AI Runtime

AI features use the built-in browser runtime in `src/shared/ai/runtime.ts`:

- Supported cloud providers are OpenRouter, OpenAI, and Anthropic.
- Supported local providers are Ollama and LM Studio on `localhost` or `127.0.0.1`.
- `Configuration > Artificial intelligence` stores the provider, model, and loopback endpoint, refreshes the provider model catalog, displays normalized metadata such as context limits, pricing, capabilities, architecture, or local file size when available, and runs a test without academic data.
- API keys are stored in `sessionStorage` by default. The teacher can explicitly opt into persistence in `localStorage` for the current browser profile and can remove the saved key from the same screen.
- Keys are never bundled into the application, sent to Edunoza servers, included in database backups, analytics, or service-worker caches.
- The browser sends AI requests to the selected provider, using the Proxy extension for Ollama. Provider terms, retention, billing, regional processing, and applicable CORS policies still apply.
- Report generation asks for explicit confirmation before academic data is sent to AI, and AI reports anonymize student names by default.
- The content security policy allows only the three supported cloud API origins and loopback HTTP(S) endpoints for AI traffic.

Ollama uses the Proxy browser extension for model discovery and generation, with no direct-fetch fallback. Keep Ollama running locally; authorize `edunoza.com` in Proxy, enable its local-network policy and allow GET/POST. No `OLLAMA_ORIGINS` change is required. Proxy can read AI prompts and responses; use a trusted extension and local models for local processing. Its request timeout is capped at 120 seconds. LM Studio still connects directly and must enable cross-origin access for the site. The connection probe uses a larger output budget and disables Ollama thinking only for the probe (GPT-OSS uses low reasoning); report generation retains the model defaults.

## Project Layout

```txt
src/
  app/                  Redux store and typed hooks
  modules/
    agenda/             Cross-workflow action agenda and calendar export
    classroom/          Persistent seating plan and temporary classroom tools
    attendance/         Attendance journal and work diary
    gradebook/          Weighted gradebook and manual assessment entry
    management/         Courses, students, subjects, units, tasks, schedules, backups
    planner/            Weekly task-session planner
    reports/            Printable, CSV, and AI-assisted reports
    search/             Cross-record search and contextual navigation
    today/              Daily classroom workspace
  shared/
    agenda/             Agenda derivation and ICS serialization
    ai/                 Direct browser AI runtime and provider configuration
    attendance/         Attendance normalization helpers
    backup/             Password-based backup encryption
    classroom/          Seating, random selection, and balanced grouping logic
    db/                 Dexie schema and shared types
    export/             Safe CSV serialization
    feedback/           Reusable teaching feedback and product feedback controls
    gradebook/          Gradebook and scoring calculations
    handoff/            Selective student handoff validation and merge previews
    hooks/              Shared React hooks
    import/             Student import parsing
    planner/            Planner/session helpers and printable exports
    resources/          Secure local resource validation and shared attachment UI
    reports/            Printable report generation
    search/             Accent-insensitive cross-record search logic
    students/           Student follow-up helpers
    ui/                 Shared UI components
    utils/              General utilities
```

Rubrics and checklists are managed inside task management.

## Testing And QA

Automated coverage includes focused Vitest suites for:

- Agenda action derivation, filtering boundaries, contextual routes, and ICS calendar serialization.
- Classroom dimensions, assignment cleanup, seat swapping, random layouts, balanced groups, and non-repeating picks.
- Backup payload validation.
- Anonymous analytics event allowlisting and route mapping.
- Backup freshness classification and status copy.
- Resource URL, file-type, size, base64-integrity, and backup-reference validation.
- Feedback normalization, duplicate prevention, explicit insertion, and backup validation.
- Global search matching, accent normalization, result typing, and contextual routes.
- Student import parsing.
- Attendance note normalization.
- Attendance historical subject context and free daily class record validation.
- Gradebook calculations and manual assessment behavior.
- Explicit grade statuses, bulk spreadsheet parsing, report date filtering, and no-data risk behavior.
- Academic-period overlap rules, immutable closure versions, and isolated school-year rollover mapping.
- Planner session planning and printable planner exports.
- Schedule draft validation, disabled-day dependency detection, and Planner rescheduling targets.
- Printable reports.
- Student follow-up helpers.
- AI-generated instrument parsing and validation.
- Direct AI provider configuration, loopback endpoint restrictions, and user-facing failure mapping.
- Student handoff scope, reference, date, and enum validation.

Run `npm run test:coverage` to generate the complete text and HTML coverage report for `src/`.

Run the full verification with:

```bash
npm run verify
```

The expected result is:

- TypeScript project checks pass.
- ESLint passes without errors or warnings.
- Every Vitest suite passes.
- Production build succeeds.
- The dependency audit passes with no known vulnerabilities and no advisory exceptions.

The latest production browser QA covered:

- Production loading from the domain root and route-level lazy loading.
- Accessible navigation landmarks, skip link, page headings, configuration navigation, and modal labeling.
- Encrypted backup password requirements and disabled export behavior until both passwords match.
- A visible, recoverable page for unknown routes.
- Reports at a mobile viewport without horizontal document overflow.
- Console health without relevant errors or warnings.
- Tutor workflows at 390 × 844 without document overflow, with accessible tab/tabpanel semantics.

GitHub Actions runs `npm run verify`, the local/CI verification build, and the complete Chromium browser suite on pushes to `main`, pull requests, and manual dispatch. See [CI and security maintenance](docs/ci-and-security.md) for runner costs, diagnostics, and dependency updates.

## Deployment

The application is published only at `https://edunoza.com`, serving the SPA from the domain root:

| Environment | Public URL | Build command | Environment file |
| --- | --- | --- | --- |
| Production | `https://edunoza.com` | `npm run build:production` | `.env.production` |

The `npm run build:test` command and `.env.test` are reserved for local and CI verification with analytics disabled. They do not represent a separate public deployment.

Each build writes the deployable static application to `dist/`. The hosting
provider must:

- Serve `dist/` over HTTPS.
- Rewrite unknown application routes to `index.html`.
- Apply the security headers in `public/_headers`, or equivalent platform
  configuration. For Nginx, include `deploy/nginx-security-headers.conf` and
  reload Nginx after validating the configuration.
- For production analytics, include `deploy/nginx-analytics-log-format.conf`
  in the global `http` block and `deploy/nginx-analytics-endpoint.conf` in the
  HTTPS server block. Local and CI verification analytics remain disabled unless explicitly enabled.
- Run browser tests on localhost with isolated browser contexts rather than against production academic data.

The deployed content security policy must keep the supported cloud API origins and
loopback endpoints in `connect-src` when AI features are enabled.

## Development Conventions

- Documentation, variable names, function names, and code comments are written in English.
- User-facing UI text can remain Spanish.
- Keep data operations local-first and avoid introducing backend dependencies unless the architecture is intentionally changed.
- Keep AI calls behind `src/shared/ai/runtime.ts`; do not read credentials outside that module or add provider origins without updating the content security policy and legal documentation.
