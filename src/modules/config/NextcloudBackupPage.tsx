import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { createNextcloudClient, proxyMessage, MAX_NEXTCLOUD_BACKUP_BYTES, type RemoteBackup } from "../../shared/backup/nextcloud";
import { liveQuery } from "dexie";
import { buildCurrentPayload } from "../../shared/backup/database";
import { estimateEncryptedBackupBytes } from "../../shared/backup/encryption";
import { formatFileSize } from "../../shared/resources/resources";
import { useUnsavedChangesGuard } from "../../shared/hooks/useUnsavedChangesGuard";
import { Modal } from "../../shared/ui/Modal";
import { useManagement } from "../management/ManagementContext";
import { useAppDispatch } from "../../app/hooks";
import { DEFAULT_APP_PREFERENCES, hydrateAppPreferences } from "../../app/store";
import { db } from "../../shared/db/database";
import { useConnectionPreference } from "../../shared/hooks/useConnectionPreference";

// Extend the existing configuration surface: connection, encrypted upload, verified retrieval.
// Inherit the restrained navy palette, native fields and responsive stacked forms.
// Keep connection controls first; make uploading and restoring distinct, explicit actions.
export function NextcloudBackupPage() {
  const { refreshAll } = useManagement();
  const dispatch = useAppDispatch();
  const [server, setServer] = useConnectionPreference("nextcloud.server");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [encryptionPassword, setEncryptionPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [restorePassword, setRestorePassword] = useState("");
  const [backups, setBackups] = useState<RemoteBackup[]>([]);
  const [selected, setSelected] = useState("");
  const [listed, setListed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [pendingRestore, setPendingRestore] = useState<{ payload: unknown; name: string; exportedAt: string; rows: number; groups: number; students: number } | null>(null);
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const [preventiveName, setPreventiveName] = useState("");
  const [backupBytes, setBackupBytes] = useState<number | null>(null);
  const [sizeError, setSizeError] = useState("");
  useEffect(() => {
    const subscription = liveQuery(async () => estimateEncryptedBackupBytes(await buildCurrentPayload())).subscribe({
      next: value => { setBackupBytes(value); setSizeError(""); },
      error: () => { setBackupBytes(null); setSizeError("No se pudo calcular el tamaño de la copia. Puedes descargar una copia local desde Base de datos."); }
    });
    return () => subscription.unsubscribe();
  }, []);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useUnsavedChangesGuard(busy || pendingRestore !== null, "Hay una operación con Nextcloud pendiente. Si sales, se descartará la revisión y una subida podría continuar sin que podamos verificarla. ¿Quieres salir?");

  const resetConnection = () => { setBackups([]); setSelected(""); setListed(false); setStatus(""); setError(""); };
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    if (controller.current) return;
    const operation = new AbortController();
    controller.current = operation;
    setBusy(true); setError(""); setStatus("Conectando con la extensión Proxy…");
    try {
      await proxyMessage("bridge-ping", undefined, operation.signal);
      await action(operation.signal);
    } catch (cause) {
      if (!operation.signal.aborted) {
        setStatus("");
        setError(cause instanceof Error ? cause.message : "No se ha podido completar la operación.");
      }
    } finally {
      controller.current = null;
      if (!operation.signal.aborted) setBusy(false);
    }
  };
  const client = (signal: AbortSignal) => createNextcloudClient({ server, username, password }, undefined, signal);
  const refresh = () => run(async (signal) => {
    setStatus("Comprobando la conexión y buscando copias…");
    const result = await client(signal).list();
    setBackups(result); setSelected(result[0]?.name ?? ""); setListed(true);
    setStatus(result.length ? `Conexión comprobada. ${result.length} copias disponibles.` : "Conexión comprobada. Todavía no hay copias de Edunoza en esta cuenta.");
  });
  const upload = () => run(async (signal) => {
    if (encryptionPassword !== confirmation) throw new Error("Las contraseñas de cifrado no coinciden.");
    const { buildCurrentPayload, validateDatabasePayload } = await import("../../shared/backup/database");
    const backup = await client(signal).upload(await buildCurrentPayload(), encryptionPassword, validateDatabasePayload, setStatus);
    setBackups((previous) => [backup, ...previous.filter((item) => item.name !== backup.name)]);
    setSelected(backup.name); setListed(true); setEncryptionPassword(""); setConfirmation("");
    setStatus(`Copia subida y verificada: ${backup.name}. Las copias anteriores se han conservado.`);
  });
  const prepareRestore = () => run(async (signal) => {
    const backup = backups.find((item) => item.name === selected);
    if (!backup) throw new Error("Selecciona una copia de la lista.");
    const { validateDatabasePayload } = await import("../../shared/backup/database");
    setStatus("Descargando y validando la copia antes de restaurar…");
    const payload = await client(signal).retrieve(backup, restorePassword, validateDatabasePayload);
    signal.throwIfAborted();
    const tables = validateDatabasePayload(payload);
    setPendingRestore({ payload, name: backup.name, exportedAt: (payload as { exportedAt: string }).exportedAt,
      rows: Object.values(tables).reduce((sum, rows) => sum + rows.length, 0), groups: tables.classGroups.length, students: tables.students.length });
    setRestoreConfirmed(false); setPreventiveName("");
    setStatus("Copia validada. Revisa el contenido y confirma si quieres sustituir los datos de este dispositivo.");
  });
  const confirmRestore = () => run(async (signal) => {
    if (!pendingRestore || !restoreConfirmed) throw new Error("Confirma que deseas sustituir los datos actuales.");
    const { buildCurrentPayload, validateDatabasePayload, restoreDatabasePayload } = await import("../../shared/backup/database");
    const current = await buildCurrentPayload();
    setStatus("Creando una copia preventiva de los datos actuales en Nextcloud…");
    const preventive = await client(signal).upload(current, restorePassword, validateDatabasePayload,
      (message) => setStatus(`Copia preventiva: ${message}`));
    setPreventiveName(preventive.name);
    setBackups((previous) => [preventive, ...previous]);
    signal.throwIfAborted();
    setStatus("Copia preventiva verificada. Restaurando los datos en este dispositivo…");
    await restoreDatabasePayload(pendingRestore.payload, current.tables, signal);
    setPendingRestore(null); setRestoreConfirmed(false); setRestorePassword("");
    setStatus(`Restauración completada. Los borradores anteriores se han descartado. Tus datos anteriores están en la copia preventiva ${preventive.name}.`);
    try {
      await refreshAll();
      const preferences = await db.appPreferences.get("default");
      dispatch(hydrateAppPreferences(preferences ?? DEFAULT_APP_PREFERENCES));
    } catch {
      setError("Los datos se han restaurado, pero la interfaz no pudo actualizarse. Recarga Edunoza; no repitas la restauración.");
    }
  });
  const closeRestore = () => {
    if (busy) return;
    setPendingRestore(null); setRestoreConfirmed(false); setRestorePassword(""); setError("");
    setStatus("Restauración cancelada. Los datos locales no se han sustituido.");
  };

  return <article className="management-card nextcloud-backup-page">
    <header className="ai-settings-heading">
      <h2>Copia en Nextcloud</h2>
      <p>Guarda una copia cifrada de tu base de datos en tu cuenta. Es una copia manual, no una sincronización entre dispositivos.</p>
    </header>
    <p className="hint">Requiere Proxy. <Link to="/config/proxy">Comprobar e instalar la extensión</Link>.</p>
    {!pendingRestore && <div role="status" aria-live="polite" className="nextcloud-message">{status}</div>}
    {error && !pendingRestore && <p role="alert" className="notice">{error}</p>}
    <form onSubmit={(event) => event.preventDefault()}>
    <fieldset disabled={busy} className="nextcloud-fields">
      <legend>Conexión</legend>
      <label className="compact-field"><span>Servidor Nextcloud</span><input className="input" type="url" value={server} onChange={(event) => { setServer(event.target.value); resetConnection(); }} autoComplete="off" spellCheck={false} /></label>
      <label className="compact-field"><span>Usuario de Nextcloud</span><input className="input" value={username} onChange={(event) => { setUsername(event.target.value); resetConnection(); }} autoComplete="off" spellCheck={false} autoCapitalize="none" /></label>
      <label className="compact-field"><span>Contraseña de aplicación de Nextcloud</span><input className="input" type="password" value={password} onChange={(event) => { setPassword(event.target.value); resetConnection(); }} autoComplete="off" aria-describedby="nextcloud-auth-help" /></label>
      <p id="nextcloud-auth-help">Usa el identificador de tu cuenta, que puede ser distinto del correo. Si tu servidor lo permite, crea una contraseña de aplicación en sus ajustes de seguridad.</p>
      <button className="btn secondary" type="button" onClick={() => void refresh()} disabled={!username.trim() || !password}>Comprobar conexión y listar copias</button>
    </fieldset>
    <fieldset disabled={busy} className="nextcloud-fields">
      <legend>Crear una copia</legend>
      <p>Se cifra en este dispositivo antes de enviarla a la carpeta Edunoza. Guarda la contraseña en un lugar seguro: no podemos recuperarla.</p>
      <p role="status">{backupBytes === null ? sizeError || "Calculando el tamaño de la copia…" : `Tamaño cifrado: ${formatFileSize(backupBytes)}. Límite de Nextcloud y Proxy: ${formatFileSize(MAX_NEXTCLOUD_BACKUP_BYTES)}.`}</p>
      {backupBytes !== null && backupBytes > MAX_NEXTCLOUD_BACKUP_BYTES && <p className="notice">Esta copia supera el límite de transferencia. <Link to="/config/database">Descarga una copia local</Link> para conservar todos los archivos.</p>}
      <label className="compact-field"><span>Contraseña para cifrar la nueva copia</span><input className="input" type="password" value={encryptionPassword} onChange={(event) => setEncryptionPassword(event.target.value)} autoComplete="new-password" minLength={12} aria-describedby="nextcloud-encryption-help" /></label>
      <p id="nextcloud-encryption-help">Al menos 12 caracteres. Utiliza una contraseña distinta de la de Nextcloud.</p>
      <label className="compact-field"><span>Repite la contraseña de cifrado</span><input className="input" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" /></label>
      <button className="btn" type="button" onClick={() => void upload()} disabled={!username.trim() || !password || encryptionPassword.length < 12 || confirmation !== encryptionPassword || backupBytes === null || backupBytes > MAX_NEXTCLOUD_BACKUP_BYTES}>Cifrar y subir copia</button>
    </fieldset>
    <fieldset disabled={busy} className="nextcloud-fields">
      <legend>Restaurar datos</legend>
      <p>Elige una copia para sustituir los datos de este dispositivo. Antes de restaurar, se guardará y verificará una copia preventiva en Nextcloud. No se combinan datos entre dispositivos.</p>
      {!backups.length ? <p>{listed ? "No hay copias disponibles. Puedes crear la primera arriba." : "Comprueba la conexión para ver las copias de esta cuenta."}</p> : <>
        <label className="compact-field"><span>Copia guardada</span><select className="input" value={selected} onChange={(event) => setSelected(event.target.value)}>{backups.map((backup) => <option key={backup.name} value={backup.name}>{backup.name}</option>)}</select></label>
        <label className="compact-field"><span>Contraseña que usaste para cifrar esta copia</span><input className="input" type="password" value={restorePassword} onChange={(event) => setRestorePassword(event.target.value)} autoComplete="off" /></label>
        <button className="btn" type="button" onClick={() => void prepareRestore()} disabled={!selected || !restorePassword || !password}>Restaurar desde Nextcloud</button>
      </>}
    </fieldset>
    </form>
    <Modal open={pendingRestore !== null} title="Restaurar desde Nextcloud" onClose={closeRestore}>
      <p>Esta copia <strong>sustituirá todos los datos actuales de este dispositivo</strong> y descartará sus borradores. No modifica la copia original de Nextcloud. Cierra otras pestañas de Edunoza antes de continuar.</p>
      {pendingRestore && <dl className="database-import-summary">
        <div><dt>Archivo</dt><dd style={{ overflowWrap: "anywhere" }}>{pendingRestore.name}</dd></div>
        <div><dt>Fecha de la copia</dt><dd>{new Date(pendingRestore.exportedAt).toLocaleString("es-ES")}</dd></div>
        <div><dt>Grupos / alumnado</dt><dd>{pendingRestore.groups} / {pendingRestore.students}</dd></div>
        <div><dt>Registros totales</dt><dd>{pendingRestore.rows}</dd></div>
      </dl>}
      <p>Primero se creará una copia preventiva cifrada en Nextcloud con <strong>la misma contraseña de cifrado que acabas de introducir</strong>. Debe tener al menos 12 caracteres y ser distinta de la de Nextcloud. Si falla la copia preventiva, no se restaurará nada. Necesitas permiso de escritura y espacio disponible.</p>
      <p>Si solo tienes acceso de lectura, descarga el archivo desde Nextcloud e impórtalo en <Link to="/config/database">Base de datos</Link>, con una copia preventiva local.</p>
      {preventiveName && <p style={{ overflowWrap: "anywhere" }}>Copia preventiva verificada: {preventiveName}</p>}
      <div role="status" aria-live="polite">{status}</div>
      {error && <p role="alert">{error}</p>}
      <label className="nextcloud-restore-confirm"><input type="checkbox" checked={restoreConfirmed} disabled={busy} onChange={(event) => setRestoreConfirmed(event.target.checked)} />Entiendo que se sustituirán los datos actuales de este dispositivo.</label>
      <div className="inline-form">
        <button className="btn secondary" type="button" disabled={busy} onClick={closeRestore}>Cancelar</button>
        <button className="btn danger" type="button" disabled={busy || !restoreConfirmed} onClick={() => void confirmRestore()}>{busy ? "Procesando restauración…" : "Crear copia preventiva y restaurar"}</button>
      </div>
    </Modal>
    <details>
      <summary>Ayuda con BoxAbalar y privacidad</summary>
      <p>En BoxAbalar utiliza https://boxabalar.edu.xunta.gal como servidor. La disponibilidad de contraseñas de aplicación y de WebDAV depende de tu cuenta y de las políticas del centro.</p>
      <p>La extensión recibe las credenciales de Nextcloud para realizar las peticiones y solo el archivo ya cifrado, nunca la contraseña de cifrado. Nextcloud conserva el archivo y sus metadatos. Instala únicamente una extensión de confianza y usa una cuenta autorizada para estos datos.</p>
      <p>Las copias incluyen la base de datos (alumnado, planificación, seguimiento e informes guardados), no las preferencias ni las claves de IA del navegador. No se eliminan copias antiguas automáticamente: gestiona el espacio desde Nextcloud. Conserva también una copia local.</p>
    </details>
  </article>;
}
