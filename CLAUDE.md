# CLAUDE.md - Edunoza

Context guide for coding agents working on Edunoza.

## Description

Edunoza is an offline-first PWA for teachers. It includes a gradebook, journal, task planning, attendance tracking, rubrics, checklists, reports, and local database tools.

AI features use the built-in browser runtime in `src/shared/ai/runtime.ts`. It connects directly to user-selected cloud providers or loopback services and keeps credentials session-only unless the user explicitly opts into device persistence.

## Stack

- React 19 + TypeScript 6
- Vite 8 with a native service worker
- Redux Toolkit 2
- Dexie 4 with IndexedDB
- React Router DOM 7
- Vitest 5

## Commands

```bash
npm run dev
npm run build
npm run preview
npm run test
npm run typecheck
npm run audit
npm run verify
```

## Source Layout

```txt
src/
  app/                  # Redux store and typed hooks
  modules/
    attendance/         # Journal and attendance workflows
    gradebook/          # Weighted gradebook
    planner/            # Weekly task-session planning
    reports/            # Reporting views
    management/         # Courses, students, subjects, units, tasks, schedules, backups
  shared/
    ai/                 # Direct browser AI runtime
    attendance/         # Attendance normalization helpers
    db/                 # Dexie schema and shared types
    gradebook/          # Scoring and manual assessment helpers
    import/             # CSV and pasted-table import helpers
    planner/            # Planner/session helpers and printable planner exports
    reports/            # Printable report builders
    students/           # Student follow-up helpers
    ui/                 # Shared components
    hooks/              # Shared React hooks
    utils/              # Shared utilities
```

## Data

- There is no backend. Data persists in the user's browser through IndexedDB.
- Backup imports must validate app name, schema version, export timestamp, allowed table names, row IDs, references, date/time values, duplicate logical rows, schedule overlaps, and supported legacy tables before clearing data.
- Do not add automatic seed data on normal app startup.

## Documentation and maintenance

- Start with `README.md` for current scope, commands, source layout, and deployment at `https://edunoza.com/`.
- Use `docs/README.md` to find maintained integration, recovery, and security contracts.
- Run `npm run clean` to remove reproducible local output. Keep Git metadata, workspace configuration, dependencies, and academic compatibility code.
- Keep legacy database names, backup identifiers, additive migrations, and regression fixtures. Their age does not make them obsolete.

## Conventions

- Documentation, variable names, function names, and comments are written in English.
- User-facing UI text can remain Spanish.
- Keep modules scoped under `src/modules/<module-name>/`.
- Keep AI calls behind `src/shared/ai/runtime.ts`; never expose credentials outside that module or broaden provider network origins without reviewing security and legal documentation.
