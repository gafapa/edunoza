import { useState } from "react";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import {
  setStudentNameFormat,
  setStudentSortBy,
  setNotSubmittedGradePolicy,
  setWeekStartsOn,
  type NotSubmittedGradePolicy,
  type StudentNameFormat,
  type StudentSortBy,
  type WeekStartsOn
} from "../../app/store";
import {
  APP_LOCK_NOW_EVENT,
  createAppLockConfig,
  persistAppLockConfig,
  readAppLockConfig
} from "../../shared/security/appLock";

export function ManagementPreferencesPage() {
  const dispatch = useAppDispatch();
  const studentSortBy = useAppSelector((state) => state.app.studentSortBy);
  const studentNameFormat = useAppSelector((state) => state.app.studentNameFormat);
  const weekStartsOn = useAppSelector((state) => state.app.weekStartsOn);
  const notSubmittedGradePolicy = useAppSelector((state) => state.app.notSubmittedGradePolicy);
  const [appLockEnabled, setAppLockEnabled] = useState(() => Boolean(readAppLockConfig()));
  const [appLockPassphrase, setAppLockPassphrase] = useState("");
  const [appLockConfirmation, setAppLockConfirmation] = useState("");
  const [autoLockMinutes, setAutoLockMinutes] = useState(
    () => readAppLockConfig()?.autoLockMinutes ?? 15
  );
  const [securityNotice, setSecurityNotice] = useState("");
  const [isSavingSecurity, setIsSavingSecurity] = useState(false);
  const enableAppLock = async (): Promise<void> => {
    if (appLockPassphrase !== appLockConfirmation) {
      setSecurityNotice("Las claves no coinciden.");
      return;
    }
    setIsSavingSecurity(true);
    try {
      const config = await createAppLockConfig(appLockPassphrase, autoLockMinutes);
      persistAppLockConfig(config);
      setAppLockEnabled(true);
      setAppLockPassphrase("");
      setAppLockConfirmation("");
      setSecurityNotice("Bloqueo local activado.");
    } catch (error) {
      setSecurityNotice(error instanceof Error ? error.message : "No se pudo activar el bloqueo.");
    } finally {
      setIsSavingSecurity(false);
    }
  };

  return (
    <article className="management-card">
      <h1 className="sr-only">Preferencias</h1>
      <p className="hint">
        Estas preferencias se guardan en la copia de seguridad.
      </p>

      <section className="detail-section">
        <h2>Ordenar listados de alumnos por</h2>
        <div className="inline-form">
          {(
            [
              { value: "lastName", label: "Apellidos" },
              { value: "firstName", label: "Nombre" }
            ] as { value: StudentSortBy; label: string }[]
          ).map(({ value, label }) => (
            <label key={value} className="pref-radio-label">
              <input
                type="radio"
                name="studentSortBy"
                value={value}
                checked={studentSortBy === value}
                onChange={() => dispatch(setStudentSortBy(value))}
              />
              {label}
            </label>
          ))}
        </div>
      </section>

      <section className="detail-section">
        <h2>Mostrar nombre del alumno como</h2>
        <div className="inline-form">
          {(
            [
              { value: "firstLast", label: "Nombre Apellidos  (Ana García)" },
              { value: "lastFirst", label: "Apellidos, Nombre  (García, Ana)" }
            ] as { value: StudentNameFormat; label: string }[]
          ).map(({ value, label }) => (
            <label key={value} className="pref-radio-label">
              <input
                type="radio"
                name="studentNameFormat"
                value={value}
                checked={studentNameFormat === value}
                onChange={() => dispatch(setStudentNameFormat(value))}
              />
              {label}
            </label>
          ))}
        </div>
      </section>

      <section className="detail-section">
        <h2>Empezar la semana en</h2>
        <div className="inline-form">
          {(
            [
              { value: "monday", label: "Lunes" },
              { value: "sunday", label: "Domingo" }
            ] as { value: WeekStartsOn; label: string }[]
          ).map(({ value, label }) => (
            <label key={value} className="pref-radio-label">
              <input
                type="radio"
                name="weekStartsOn"
                value={value}
                checked={weekStartsOn === value}
                onChange={() => dispatch(setWeekStartsOn(value))}
              />
              {label}
            </label>
          ))}
        </div>
      </section>

      <section className="detail-section">
        <h2>Alumnado no presentado</h2>
        <p className="hint">
          Esta política solo se aplica a calificaciones marcadas expresamente como no presentado.
        </p>
        <div className="inline-form">
          {(
            [
              { value: "exclude", label: "Excluir de la media" },
              { value: "zero", label: "Contar como cero" }
            ] as { value: NotSubmittedGradePolicy; label: string }[]
          ).map(({ value, label }) => (
            <label key={value} className="pref-radio-label">
              <input
                type="radio"
                name="notSubmittedGradePolicy"
                value={value}
                checked={notSubmittedGradePolicy === value}
                onChange={() => dispatch(setNotSubmittedGradePolicy(value))}
              />
              {label}
            </label>
          ))}
        </div>
      </section>

      <section className="detail-section" aria-labelledby="device-security-title">
        <h2 id="device-security-title">Bloqueo del dispositivo</h2>
        <p className="hint">
          Protege la pantalla ante accesos casuales y se activa por inactividad. Los datos del navegador
          siguen dependiendo del cifrado y control de acceso del sistema operativo; las copias exportadas
          sí se cifran de extremo a extremo.
        </p>
        {appLockEnabled ? (
          <div className="inline-form">
            <span className="pill">Activado · {autoLockMinutes} min</span>
            <button
              className="btn secondary"
              type="button"
              onClick={() => window.dispatchEvent(new Event(APP_LOCK_NOW_EVENT))}
            >
              Bloquear ahora
            </button>
            <button
              className="btn danger"
              type="button"
              onClick={() => {
                try {
                  persistAppLockConfig(null);
                  setAppLockEnabled(false);
                  setSecurityNotice("Bloqueo local desactivado.");
                } catch (error) {
                  setSecurityNotice(error instanceof Error ? error.message : "No se pudo desactivar el bloqueo.");
                }
              }}
            >
              Desactivar
            </button>
          </div>
        ) : (
          <form className="detail-grid" onSubmit={(event) => event.preventDefault()}>
            <label className="detail-field compact-field">
              <span>Clave local (mínimo 8 caracteres)</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={appLockPassphrase}
                onChange={(event) => setAppLockPassphrase(event.target.value)}
              />
            </label>
            <label className="detail-field compact-field">
              <span>Repetir clave</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={appLockConfirmation}
                onChange={(event) => setAppLockConfirmation(event.target.value)}
              />
            </label>
            <label className="detail-field compact-field">
              <span>Bloquear tras</span>
              <select
                className="input"
                value={autoLockMinutes}
                onChange={(event) => setAutoLockMinutes(Number(event.target.value))}
              >
                <option value={5}>5 minutos</option>
                <option value={15}>15 minutos</option>
                <option value={30}>30 minutos</option>
                <option value={60}>60 minutos</option>
              </select>
            </label>
            <button
              className="btn primary"
              type="button"
              disabled={isSavingSecurity || !appLockPassphrase || !appLockConfirmation}
              onClick={() => void enableAppLock()}
            >
              {isSavingSecurity ? "Protegiendo…" : "Activar bloqueo"}
            </button>
          </form>
        )}
        {securityNotice ? <p className="hint" role="status">{securityNotice}</p> : null}
      </section>
    </article>
  );
}
