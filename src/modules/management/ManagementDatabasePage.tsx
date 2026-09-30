import { useRef, useState } from "react";
import { useAppDispatch } from "../../app/hooks";
import { hydrateAppPreferences } from "../../app/store";
import {
  decryptBackupPayload,
  encryptBackupPayload,
  isEncryptedBackupEnvelope,
  type EncryptedBackupEnvelope
} from "../../shared/backup/encryption";
import { recordBackupCreated, recordBackupVerified } from "../../shared/backup/status";
import { clearLocalDrafts } from "../../shared/drafts/localDrafts";
import { trackAnalyticsEvent } from "../../shared/analytics/analytics";
import { PRODUCT_NAME } from "../../shared/brand";
import { db } from "../../shared/db/database";
import { Modal } from "../../shared/ui/Modal";
import { BackupTrustPanel } from "../../shared/ui/BackupStatus";
import { useManagement } from "./ManagementContext";
import {
  buildCurrentPayload, buildBackupFileName, clearDatabase, seedDatabase,
  restoreDatabasePayload, validateDatabasePayload, DATABASE_SCHEMA_VERSION,
  MAX_IMPORT_FILE_BYTES, type DatabaseExportPayload
} from "../../shared/backup/database";

// Retain existing test and browser fixture imports while callers migrate to the shared service.
export { buildCurrentPayload, restoreDatabasePayload, validateDatabasePayload, DATABASE_SCHEMA_VERSION } from "../../shared/backup/database";

export function ManagementDatabasePage() {
  const dispatch = useAppDispatch();
  const { setNotice, refreshAll } = useManagement();
  const [isBusy, setIsBusy] = useState(false);
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [showSeedModal, setShowSeedModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportPassword, setExportPassword] = useState("");
  const [exportPasswordConfirmation, setExportPasswordConfirmation] = useState("");
  const [encryptedImport, setEncryptedImport] = useState<{
    fileName: string;
    envelope: EncryptedBackupEnvelope;
    mode: "import" | "verify";
  } | null>(null);
  const [importPassword, setImportPassword] = useState("");
  const [safetyPassword, setSafetyPassword] = useState("");
  const [pendingImport, setPendingImport] = useState<{
    fileName: string;
    exportedAt: string;
    schemaVersion: number;
    totalRows: number;
    tablesData: Record<string, unknown[]>;
  } | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const verificationInputRef = useRef<HTMLInputElement | null>(null);

  const runDatabaseAction = async (action: () => Promise<void>): Promise<void> => {
    setIsBusy(true);
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido";
      setNotice(`Operación de base de datos fallida: ${message}`);
    } finally {
      setIsBusy(false);
    }
  };

  const downloadPayload = (payload: unknown, label = "backup"): void => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const downloadUrl = URL.createObjectURL(blob);
    try {
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = buildBackupFileName(label);
      document.body.appendChild(link);
      link.click();
      link.remove();
      recordBackupCreated();
      trackAnalyticsEvent("backup_exported");
    } finally {
      URL.revokeObjectURL(downloadUrl);
    }
  };

  const downloadSafetyBackup = async (label: string): Promise<DatabaseExportPayload> => {
    const current = await buildCurrentPayload();
    const encrypted = await encryptBackupPayload(current, safetyPassword);
    downloadPayload(encrypted, `${label}-encrypted`);
    return current;
  };

  const exportEncryptedDatabase = async (): Promise<void> => {
    if (exportPassword !== exportPasswordConfirmation) {
      setNotice("Las contraseñas de la copia no coinciden.");
      return;
    }
    await runDatabaseAction(async () => {
      const encrypted = await encryptBackupPayload(await buildCurrentPayload(), exportPassword);
      downloadPayload(encrypted, "backup-encrypted");
      setExportPassword("");
      setExportPasswordConfirmation("");
      setShowExportModal(false);
      setNotice("Copia cifrada descargada. Comprueba el archivo en «Comprobar una copia» y guarda la contraseña en un lugar seguro.");
    });
  };

  const prepareValidatedImport = (parsed: unknown, fileName: string): void => {
    const tablesData = validateDatabasePayload(parsed);
    const metadata = parsed as DatabaseExportPayload;
    setPendingImport({
      fileName,
      exportedAt: metadata.exportedAt,
      schemaVersion: metadata.schemaVersion,
      totalRows: Object.values(tablesData).reduce((sum, rows) => sum + rows.length, 0),
      tablesData
    });
    setSafetyPassword("");
  };

  const prepareDatabaseFile = async (file: File, mode: "import" | "verify"): Promise<void> => {
    await runDatabaseAction(async () => {
      if (file.size > MAX_IMPORT_FILE_BYTES) {
        throw new Error("El archivo es demasiado grande para importarlo de forma segura.");
      }
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("El archivo no es JSON válido.");
      }

      if (isEncryptedBackupEnvelope(parsed)) {
        setEncryptedImport({ fileName: file.name, envelope: parsed, mode });
        setImportPassword("");
        return;
      }
      if (mode === "verify") {
        const tablesData = validateDatabasePayload(parsed);
        const totalRows = Object.values(tablesData).reduce((sum, rows) => sum + rows.length, 0);
        setNotice(`Copia válida: ${totalRows} registros comprobados sin modificar tus datos.`);
        recordBackupVerified();
        trackAnalyticsEvent("backup_verified");
      } else {
        prepareValidatedImport(parsed, file.name);
      }
    });
  };

  const decryptPendingImport = async (): Promise<void> => {
    if (!encryptedImport) return;
    await runDatabaseAction(async () => {
      const parsed = await decryptBackupPayload(encryptedImport.envelope, importPassword);
      if (encryptedImport.mode === "verify") {
        const tablesData = validateDatabasePayload(parsed);
        const totalRows = Object.values(tablesData).reduce((sum, rows) => sum + rows.length, 0);
        setNotice(`Copia cifrada válida: ${totalRows} registros comprobados sin modificar tus datos.`);
        recordBackupVerified();
        trackAnalyticsEvent("backup_verified");
      } else {
        prepareValidatedImport(parsed, encryptedImport.fileName);
      }
      setEncryptedImport(null);
      setImportPassword("");
    });
  };

  const confirmDatabaseImport = async (): Promise<void> => {
    if (!pendingImport) return;
    await runDatabaseAction(async () => {
      const current = await downloadSafetyBackup("before-import");
      await restoreDatabasePayload({
        app: PRODUCT_NAME,
        schemaVersion: pendingImport.schemaVersion,
        exportedAt: pendingImport.exportedAt,
        tables: pendingImport.tablesData
      }, current.tables);

      await refreshAll();
      const preferences = await db.appPreferences.get("default");
      if (preferences) {
        dispatch(hydrateAppPreferences(preferences));
      }
      setNotice("Base de datos importada. Los borradores anteriores se han descartado.");
      trackAnalyticsEvent("backup_imported");
      setPendingImport(null);
      setSafetyPassword("");
    });
  };

  const verifyDatabaseIntegrity = async (): Promise<void> => {
    await runDatabaseAction(async () => {
      const tables: Record<string, unknown[]> = {};
      for (const table of db.tables) {
        tables[table.name] = await table.toArray();
      }
      validateDatabasePayload({
        app: PRODUCT_NAME,
        schemaVersion: DATABASE_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        tables
      });
      setNotice("Integridad verificada: no se han encontrado referencias rotas.");
    });
  };

  const deleteAllDatabase = async (): Promise<void> => {
    await runDatabaseAction(async () => {
      const current = await downloadSafetyBackup("before-delete");
      await clearDatabase(current.tables);
      await refreshAll();
      clearLocalDrafts();
      setNotice("Todos los datos de la base y sus borradores han sido eliminados.");
      setShowDeleteAllModal(false);
      setSafetyPassword("");
    });
  };

  const confirmSeedDatabase = async (): Promise<void> => {
    await runDatabaseAction(async () => {
      const current = await downloadSafetyBackup("before-demo-data");
      await seedDatabase(current.tables);
      await refreshAll();
      clearLocalDrafts();
      setNotice("Datos de prueba cargados.");
      setShowSeedModal(false);
      setSafetyPassword("");
    });
  };

  return (
    <>
      <article className="management-card database-actions database-actions-simple">
        <BackupTrustPanel />
        <section className="database-primary-action" aria-labelledby="database-backup-title">
          <div>
            <h3 id="database-backup-title">Crear una copia segura</h3>
            <p>Descarga un archivo cifrado que podrás guardar fuera de este navegador.</p>
          </div>
          <button
            type="button"
            className="btn primary"
            disabled={isBusy}
            onClick={() => setShowExportModal(true)}
          >
            Crear copia cifrada
          </button>
        </section>

          <section aria-labelledby="database-restore-title">
            <h3 id="database-restore-title">Restaurar una copia</h3>
            <p>Revisa primero el archivo. Antes de sustituir los datos se descargará una copia de seguridad.</p>
            <button
              type="button"
              className="btn secondary"
              disabled={isBusy}
              onClick={() => importInputRef.current?.click()}
            >
              Seleccionar copia para restaurar
            </button>
          </section>

        <details className="database-disclosure">
          <summary>Comprobaciones</summary>
          <section aria-labelledby="database-checks-title">
            <h3 id="database-checks-title">Comprobaciones</h3>
            <p>Comprueba una copia o revisa la integridad de los datos de este navegador.</p>
            <div className="database-action-buttons">
              <button
                type="button"
                className="btn secondary"
                disabled={isBusy}
                onClick={() => verificationInputRef.current?.click()}
              >
                Comprobar una copia
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={isBusy}
                onClick={() => void verifyDatabaseIntegrity()}
              >
                Verificar datos actuales
              </button>
            </div>
          </section>

        </details>
        <details className="database-disclosure">
          <summary>Opciones avanzadas</summary>
        <section className="database-danger-zone" aria-labelledby="database-danger-title">
          <div>
            <h3 id="database-danger-title">Zona de peligro</h3>
            <p>Elimina toda la información local después de descargar una copia preventiva.</p>
          </div>
          <button
            type="button"
            className="btn secondary management-danger-btn"
            disabled={isBusy}
            onClick={() => {
              setSafetyPassword("");
              setShowDeleteAllModal(true);
            }}
          >
            Borrar todo
          </button>
        </section>

        {import.meta.env.DEV && (
          <div className="database-developer-action">
            <span>Solo desarrollo</span>
            <button
              type="button"
              className="btn secondary"
              disabled={isBusy}
              onClick={() => {
                setSafetyPassword("");
                setShowSeedModal(true);
              }}
            >
              Cargar datos de prueba
            </button>
          </div>
        )}

        </details>

        <input
          ref={importInputRef}
          className="student-photo-input-hidden"
          type="file"
          aria-label="Seleccionar copia de seguridad JSON"
          accept="application/json,.json"
          disabled={isBusy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (!file) {
              return;
            }
            void prepareDatabaseFile(file, "import");
          }}
        />

        <input
          ref={verificationInputRef}
          className="student-photo-input-hidden"
          type="file"
          aria-label="Seleccionar copia JSON para comprobar"
          accept="application/json,.json"
          disabled={isBusy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (!file) {
              return;
            }
            void prepareDatabaseFile(file, "verify");
          }}
        />

        {isBusy ? (
          <div className="management-progress" role="status" aria-label="Procesando base de datos">
            <div className="management-progress-bar" />
          </div>
        ) : null}
      </article>

      <Modal
        open={showExportModal}
        form
        title="Exportar copia cifrada"
        subtitle="La contraseña no se puede recuperar. Guárdala fuera de Edunoza."
        onClose={() => {
          if (isBusy) return;
          setShowExportModal(false);
          setExportPassword("");
          setExportPasswordConfirmation("");
        }}
      >
        <div className="detail-grid">
          <label className="detail-field full compact-field">
            <span>Contraseña de la copia</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={exportPassword}
              onChange={(event) => setExportPassword(event.target.value)}
            />
          </label>
          <label className="detail-field full compact-field">
            <span>Repetir contraseña</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={exportPasswordConfirmation}
              onChange={(event) => setExportPasswordConfirmation(event.target.value)}
            />
          </label>
        </div>
        <div className="inline-form">
          <button type="button" className="btn secondary" disabled={isBusy} onClick={() => setShowExportModal(false)}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={
              isBusy ||
              exportPassword.length < 12 ||
              exportPassword !== exportPasswordConfirmation
            }
            onClick={() => void exportEncryptedDatabase()}
          >
            Descargar copia cifrada
          </button>
        </div>
      </Modal>

      <Modal
        open={encryptedImport !== null}
        form
        title={encryptedImport?.mode === "verify" ? "Comprobar copia cifrada" : "Descifrar copia de seguridad"}
        subtitle={
          encryptedImport?.mode === "verify"
            ? `${encryptedImport.fileName} · La comprobación no modificará tus datos.`
            : encryptedImport?.fileName
        }
        onClose={() => {
          if (isBusy) return;
          setEncryptedImport(null);
          setImportPassword("");
        }}
      >
        <label className="detail-field compact-field">
          <span>Contraseña de la copia</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={importPassword}
            onChange={(event) => setImportPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && importPassword.length > 0 && !isBusy) {
                void decryptPendingImport();
              }
            }}
          />
        </label>
        <div className="inline-form">
          <button type="button" className="btn secondary" disabled={isBusy} onClick={() => setEncryptedImport(null)}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={isBusy || importPassword.length === 0}
            onClick={() => void decryptPendingImport()}
          >
            {encryptedImport?.mode === "verify" ? "Descifrar y comprobar" : "Descifrar y revisar"}
          </button>
        </div>
      </Modal>

      <Modal
        open={pendingImport !== null}
        form
        title="Confirmar importación"
        subtitle={pendingImport?.fileName}
        onClose={() => {
          if (!isBusy) {
            setPendingImport(null);
            setSafetyPassword("");
          }
        }}
      >
        <p>La copia sustituirá todos los datos actuales. Antes de continuar se descargará automáticamente una copia cifrada.</p>
        {pendingImport ? (
          <dl className="database-import-summary">
            <div><dt>Fecha de la copia</dt><dd>{new Date(pendingImport.exportedAt).toLocaleString("es-ES")}</dd></div>
            <div><dt>Versión del esquema</dt><dd>{pendingImport.schemaVersion}</dd></div>
            <div><dt>Registros</dt><dd>{pendingImport.totalRows}</dd></div>
          </dl>
        ) : null}
        <label className="detail-field compact-field">
          <span>Contraseña para la copia de seguridad</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={safetyPassword}
            onChange={(event) => setSafetyPassword(event.target.value)}
          />
        </label>
        <div className="inline-form">
          <button
            type="button"
            className="btn secondary"
            disabled={isBusy}
            onClick={() => {
              setPendingImport(null);
              setSafetyPassword("");
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={isBusy || safetyPassword.length < 12}
            onClick={() => void confirmDatabaseImport()}
          >
            Crear copia cifrada e importar
          </button>
        </div>
      </Modal>

      <Modal
        open={showSeedModal}
        form
        title="Cargar datos de prueba"
        onClose={() => {
          if (!isBusy) {
            setShowSeedModal(false);
            setSafetyPassword("");
          }
        }}
      >
        <p>Los datos actuales se sustituirán por el conjunto de demostración. Se descargará una copia cifrada antes de continuar.</p>
        <label className="detail-field compact-field">
          <span>Contraseña para la copia de seguridad</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={safetyPassword}
            onChange={(event) => setSafetyPassword(event.target.value)}
          />
        </label>
        <div className="inline-form">
          <button
            type="button"
            className="btn secondary"
            disabled={isBusy}
            onClick={() => {
              setShowSeedModal(false);
              setSafetyPassword("");
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={isBusy || safetyPassword.length < 12}
            onClick={() => void confirmSeedDatabase()}
          >
            Crear copia cifrada y continuar
          </button>
        </div>
      </Modal>

      <Modal
        open={showDeleteAllModal}
        form
        title="Borrar toda la base de datos"
        onClose={() => {
          if (!isBusy) {
            setShowDeleteAllModal(false);
            setSafetyPassword("");
          }
        }}
      >
        <p>Se eliminarán todos los datos de la app. Antes de continuar se descargará automáticamente una copia cifrada.</p>
        <label className="detail-field compact-field">
          <span>Contraseña para la copia de seguridad</span>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={safetyPassword}
            onChange={(event) => setSafetyPassword(event.target.value)}
          />
        </label>
        <div className="inline-form">
          <button
            type="button"
            className="btn secondary"
            disabled={isBusy}
            onClick={() => {
              setShowDeleteAllModal(false);
              setSafetyPassword("");
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn secondary management-danger-btn"
            disabled={isBusy || safetyPassword.length < 12}
            onClick={() => void deleteAllDatabase()}
          >
            Crear copia cifrada y borrar
          </button>
        </div>
      </Modal>
    </>
  );
}
