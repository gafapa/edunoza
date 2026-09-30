import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  APP_LOCK_CHANGED_EVENT,
  APP_LOCK_NOW_EVENT,
  readAppLockConfig,
  verifyAppLockPassphrase,
  type AppLockConfig
} from "../security/appLock";
import { readSessionValue, writeSessionValue } from "../storage/browserStorage";

const MAX_FAILED_UNLOCK_ATTEMPTS = 5;
const UNLOCK_COOLDOWN_MS = 30_000;
const UNLOCK_COOLDOWN_STORAGE_KEY = "profeplus_app_lock_retry_after";

function readRetryAfter(): number {
  const stored = Number(readSessionValue(UNLOCK_COOLDOWN_STORAGE_KEY));
  const now = Date.now();
  return Number.isFinite(stored) && stored > now && stored <= now + UNLOCK_COOLDOWN_MS
    ? stored
    : 0;
}

function readLockState(): { config: AppLockConfig | null; error: string } {
  try { return { config: readAppLockConfig(), error: "" }; }
  catch (error) { return { config: null, error: error instanceof Error ? error.message : "No se puede comprobar el bloqueo local." }; }
}

export function AppLockGate({ children }: { children: ReactNode }) {
  const [lockState, setLockState] = useState(readLockState);
  const config = lockState.config;
  const [locked, setLocked] = useState(() => Boolean(lockState.config));
  const [passphrase, setPassphrase] = useState("");
  const [notice, setNotice] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [retryAfter, setRetryAfter] = useState(readRetryAfter);
  const activityTimer = useRef<number | null>(null);
  const lastActivityAt = useRef(Date.now());
  const failedAttempts = useRef(0);

  useEffect(() => {
    const handleConfigChange = () => {
      const next = readLockState();
      setLockState(next);
      if (!next.config && !next.error) setLocked(false);
    };
    const handleLockNow = () => {
      const next = readLockState();
      setLockState(next);
      if (next.config) setLocked(true);
    };
    window.addEventListener(APP_LOCK_CHANGED_EVENT, handleConfigChange);
    window.addEventListener(APP_LOCK_NOW_EVENT, handleLockNow);
    return () => {
      window.removeEventListener(APP_LOCK_CHANGED_EVENT, handleConfigChange);
      window.removeEventListener(APP_LOCK_NOW_EVENT, handleLockNow);
    };
  }, []);

  useEffect(() => {
    if (!config || locked) return;
    const resetTimer = () => {
      lastActivityAt.current = Date.now();
      if (activityTimer.current !== null) window.clearTimeout(activityTimer.current);
      activityTimer.current = window.setTimeout(
        () => setLocked(true),
        config.autoLockMinutes * 60_000
      );
    };
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastActivityAt.current >= config.autoLockMinutes * 60_000
      ) {
        setLocked(true);
      }
    };
    const events = ["pointerdown", "keydown", "touchstart"] as const;
    for (const eventName of events) window.addEventListener(eventName, resetTimer, { passive: true });
    document.addEventListener("visibilitychange", handleVisibilityChange);
    resetTimer();
    return () => {
      for (const eventName of events) window.removeEventListener(eventName, resetTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (activityTimer.current !== null) window.clearTimeout(activityTimer.current);
    };
  }, [config, locked]);

  useEffect(() => {
    if (retryAfter <= Date.now()) return;
    const timeoutId = window.setTimeout(() => {
      writeSessionValue(UNLOCK_COOLDOWN_STORAGE_KEY, null);
      setRetryAfter(0);
      setNotice("");
    }, retryAfter - Date.now());
    return () => window.clearTimeout(timeoutId);
  }, [retryAfter]);

  const unlock = async (): Promise<void> => {
    if (!config) return;
    if (retryAfter > Date.now()) {
      setNotice("Demasiados intentos fallidos. Espera 30 segundos antes de volver a intentarlo.");
      return;
    }
    setIsVerifying(true);
    try {
      if (!(await verifyAppLockPassphrase(config, passphrase))) {
        failedAttempts.current += 1;
        if (failedAttempts.current >= MAX_FAILED_UNLOCK_ATTEMPTS) {
          const nextRetryAfter = Date.now() + UNLOCK_COOLDOWN_MS;
          failedAttempts.current = 0;
          writeSessionValue(UNLOCK_COOLDOWN_STORAGE_KEY, String(nextRetryAfter));
          setRetryAfter(nextRetryAfter);
          setNotice("Demasiados intentos fallidos. Espera 30 segundos antes de volver a intentarlo.");
        } else {
          setNotice("La clave no es correcta.");
        }
        return;
      }
      failedAttempts.current = 0;
      writeSessionValue(UNLOCK_COOLDOWN_STORAGE_KEY, null);
      setRetryAfter(0);
      setPassphrase("");
      setNotice("");
      setLocked(false);
    } catch {
      setNotice("No se pudo comprobar la clave. Vuelve a intentarlo.");
    } finally {
      setIsVerifying(false);
    }
  };

  if (lockState.error) return <main className="app-lock-screen" id="main-content"><section className="app-lock-card"><h1>No se puede comprobar el bloqueo local</h1><p role="alert">{lockState.error}</p><button type="button" className="btn primary" onClick={() => { const next = readLockState(); setLockState(next); setLocked(Boolean(next.config)); }}>Volver a comprobar</button></section></main>;
  if (!config || !locked) return children;

  return (
    <main className="app-lock-screen" id="main-content">
      <form
        className="app-lock-card"
        onSubmit={(event) => {
          event.preventDefault();
          void unlock();
        }}
      >
        <span className="app-lock-mark" aria-hidden="true">PP</span>
        <h1>Edunoza está bloqueado</h1>
        <p>Introduce la clave local de este dispositivo para continuar.</p>
        <label className="detail-field compact-field">
          <span>Clave del dispositivo</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
          />
        </label>
        {notice ? <p className="form-error" role="alert">{notice}</p> : null}
        <button
          className="btn primary"
          type="submit"
          disabled={isVerifying || !passphrase || retryAfter > Date.now()}
        >
          {isVerifying ? "Comprobando…" : retryAfter > Date.now() ? "Espera para reintentar" : "Desbloquear"}
        </button>
      </form>
    </main>
  );
}

export function AppLockButton() {
  const [enabled, setEnabled] = useState(() => Boolean(readLockState().config));
  useEffect(() => {
    const handleChange = () => setEnabled(Boolean(readLockState().config));
    window.addEventListener(APP_LOCK_CHANGED_EVENT, handleChange);
    return () => window.removeEventListener(APP_LOCK_CHANGED_EVENT, handleChange);
  }, []);
  if (!enabled) return null;
  return (
    <button
      type="button"
      className="status-bar-button"
      onClick={() => window.dispatchEvent(new Event(APP_LOCK_NOW_EVENT))}
    >
      Bloquear ahora
    </button>
  );
}
