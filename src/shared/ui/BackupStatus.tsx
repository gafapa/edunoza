import { useCallback, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { db } from "../db/database";
import { IconButton } from "./IconButton";
import {
  BACKUP_STATUS_CHANGED_EVENT,
  backupFreshness,
  backupStatusLabel,
  readLastBackupAt,
  readLastVerifiedBackupAt,
  type BackupFreshness
} from "../backup/status";

const REMINDER_TEXT: Record<BackupFreshness, { title: string; body: (statusLabel: string) => string }> = {
  missing: {
    title: "Protege tu trabajo",
    body: () => "Los datos están solo en este navegador hasta que descargues una copia cifrada."
  },
  current: { title: "", body: () => "" },
  due: {
    title: "Actualiza tu copia de seguridad",
    body: (statusLabel) => `${statusLabel}. Conviene renovarla pronto.`
  },
  overdue: {
    title: "Tu copia de seguridad lleva mucho retraso",
    body: (statusLabel) => `${statusLabel}. Si el navegador borrase sus datos ahora, perderías todo lo hecho desde entonces.`
  }
};

function useBackupState(): { lastBackupAt: string | null; lastVerifiedAt: string | null; freshness: BackupFreshness } {
  const [lastBackupAt, setLastBackupAt] = useState(() => readLastBackupAt());
  const [lastVerifiedAt, setLastVerifiedAt] = useState(() => readLastVerifiedBackupAt());

  useEffect(() => {
    const refresh = (): void => {
      setLastBackupAt(readLastBackupAt());
      setLastVerifiedAt(readLastVerifiedBackupAt());
    };
    window.addEventListener(BACKUP_STATUS_CHANGED_EVENT, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(BACKUP_STATUS_CHANGED_EVENT, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return { lastBackupAt, lastVerifiedAt, freshness: backupFreshness(lastBackupAt) };
}

function useHasLocalData(): boolean {
  const [hasLocalData, setHasLocalData] = useState(false);

  const refreshDataState = useCallback((): void => {
    void Promise.all([
      db.classGroups.count(),
      db.students.count(),
      db.attendanceEntries.count(),
      db.assessments.count()
    ])
      .then((counts) => setHasLocalData(counts.some((count) => count > 0)))
      .catch(() => setHasLocalData(false));
  }, []);

  useEffect(() => {
    refreshDataState();
    const interval = window.setInterval(refreshDataState, 10_000);
    window.addEventListener("focus", refreshDataState);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshDataState);
    };
  }, [refreshDataState]);

  return hasLocalData;
}

export function BackupStatusLink() {
  const { lastBackupAt, lastVerifiedAt, freshness } = useBackupState();
  const hasLocalData = useHasLocalData();
  if (!hasLocalData) return null;
  const formatDate = (value: string | null) => value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString("es-ES")
    : "sin registro";
  const detail = `Última copia descargada: ${formatDate(lastBackupAt)}. Última comprobación de una copia: ${formatDate(lastVerifiedAt)}. Abrir copias y recuperación.`;
  return (
    <NavLink
      to="/config/database"
      className={`backup-status-link ${freshness}`}
      title={detail}
      aria-label={`${backupStatusLabel(lastBackupAt)}. ${detail}`}
    >
      <span className="backup-status-dot" aria-hidden="true" />
      <span>{backupStatusLabel(lastBackupAt)}</span>
    </NavLink>
  );
}

export function BackupReminder() {
  const { lastBackupAt, freshness } = useBackupState();
  const hasLocalData = useHasLocalData();
  const [dismissedTier, setDismissedTier] = useState<string | null>(() => {
    try {
      return window.sessionStorage.getItem("profeplus_backup_reminder_dismissed");
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const region = document.getElementById("global-notification-region");
    if (!region) return;
    const updateReservedSpace = () => {
      const height = Math.ceil(region.getBoundingClientRect().height);
      document.documentElement.style.setProperty("--notification-stack-height", `${height}px`);
    };
    const observer = new ResizeObserver(updateReservedSpace);
    observer.observe(region);
    updateReservedSpace();
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--notification-stack-height");
    };
  }, []);

  // Dismissing only silences the current urgency tier for this session - if the backup keeps
  // aging and crosses into a more urgent tier (due -> overdue), the reminder comes back.
  // "1" is a legacy value from before per-tier dismissal existed and still silences unconditionally.
  const isDismissed = dismissedTier === freshness || dismissedTier === "1";

  if (!hasLocalData || isDismissed || freshness === "current") return null;

  const statusLabel = backupStatusLabel(lastBackupAt);
  const text = REMINDER_TEXT[freshness];

  return (
    <aside
      className={`backup-reminder ${freshness}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label="Recordatorio de copia de seguridad"
    >
      <div>
        <strong>{text.title}</strong>
        <span>{text.body(statusLabel)}</span>
      </div>
      <NavLink className="btn primary" to="/config/database">Crear copia</NavLink>
      <IconButton
        icon="close"
        className="backup-reminder-dismiss"
        label="Descartar recordatorio durante esta sesión"
        onClick={() => {
          try {
            window.sessionStorage.setItem("profeplus_backup_reminder_dismissed", freshness);
          } catch {
            // The in-memory dismissal still works when session storage is blocked.
          }
          setDismissedTier(freshness);
        }}
      />
    </aside>
  );
}

export function BackupTrustPanel() {
  const { lastBackupAt, freshness } = useBackupState();
  return (
    <section className="backup-local-status" aria-label="Estado de las copias">
      <p>Tus datos están en este navegador. Guarda una copia fuera de él para poder recuperarlos.</p>
        <span className={`backup-trust-state ${freshness}`}>{backupStatusLabel(lastBackupAt)}</span>
      <details className="database-disclosure">
        <summary>Cómo conservar una copia segura</summary>
        <p>Crea una copia tras cambios importantes. Guarda el archivo y su contraseña en lugares distintos; no podemos recuperar la contraseña. En «Comprobaciones» puedes validar el archivo sin sustituir tus datos.</p>
      </details>
    </section>
  );
}
