# Family contact follow-up

Family contacts support open, in-progress and completed states through **Empezar**, **Completar** and **Reabrir**. Older records without a status remain readable and appear as open; no database migration or deletion is required.

State changes update only the status and modification timestamp in an IndexedDB transaction. A stale status or missing contact blocks the write. The interface reports storage failures and keeps all contact notes and agreements intact.

Completed contacts remain in the history and encrypted backups, but their next steps no longer appear as pending agenda items or overdue actions. Database imports and student handoff packages validate the optional status and preserve it.

Local browser regression covers legacy contacts, starting, completion, reopening, persistence after reload, backup validation, agenda exclusion and mobile/desktop overflow. Moodle regression uses synthetic protocol responses; it does not verify an authenticated school account.
