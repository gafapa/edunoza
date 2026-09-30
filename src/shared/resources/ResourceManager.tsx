import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { db } from "../db/database";
import type { ResourceAttachment, ResourceKind, ResourceOwnerType } from "../db/types";
import {
  MAX_TOTAL_RESOURCE_BYTES,
  MAX_RESOURCE_URL_LENGTH,
  base64ToBytes,
  createFileResource,
  createLinkResource,
  formatFileSize
} from "./resources";
import { getTotalResourceBytes, saveResourceAttachment } from "./storage";

const ACCEPTED_FILE_TYPES = [
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".odt", ".ods", ".odp", ".txt", ".md", ".csv",
  ".jpg", ".jpeg", ".png", ".webp", ".gif",
  ".mp3", ".wav", ".ogg", ".mp4", ".webm"
].join(",");

type ResourceManagerProps = {
  ownerType: ResourceOwnerType;
  ownerId: string;
  heading?: string;
};

function sortResources(rows: ResourceAttachment[]): ResourceAttachment[] {
  return rows.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.title.localeCompare(right.title));
}

function downloadFile(resource: ResourceAttachment): void {
  if (!resource.dataBase64 || !resource.mimeType || !resource.fileName) return;
  const blob = new Blob([base64ToBytes(resource.dataBase64)], { type: resource.mimeType });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = resource.fileName;
  anchor.click();
  URL.revokeObjectURL(downloadUrl);
}

export function ResourceManager({ ownerType, ownerId, heading = "Recursos y evidencias" }: ResourceManagerProps) {
  const fieldId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [resources, setResources] = useState<ResourceAttachment[]>([]);
  const [totalFileBytes, setTotalFileBytes] = useState(0);
  const [kind, setKind] = useState<ResourceKind>("link");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [notice, setNotice] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const loadResources = useCallback(async (): Promise<void> => {
    const [ownerResources, totalBytes] = await Promise.all([
      db.resourceAttachments.where("[ownerType+ownerId]").equals([ownerType, ownerId]).toArray(),
      getTotalResourceBytes()
    ]);
    setResources(sortResources(ownerResources));
    setTotalFileBytes(totalBytes);
  }, [ownerId, ownerType]);

  useEffect(() => {
    let active = true;
    void loadResources().catch(() => {
      if (active) setNotice("No se pudieron cargar los recursos.");
    });
    return () => {
      active = false;
    };
  }, [loadResources]);

  useEffect(() => {
    setTitle("");
    setUrl("");
    setFile(null);
    setNotice("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [ownerId, ownerType]);

  const resetForm = (): void => {
    setTitle("");
    setUrl("");
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const saveResource = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setIsSaving(true);
    setNotice("");
    try {
      const resource = kind === "link"
        ? createLinkResource(ownerType, ownerId, title, url)
        : file
          ? await createFileResource(ownerType, ownerId, title, file, 0)
          : (() => { throw new Error("Selecciona un archivo."); })();
      await saveResourceAttachment(resource);
      resetForm();
      await loadResources();
      setNotice(kind === "link" ? "Enlace guardado." : "Archivo guardado localmente.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo guardar el recurso.");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteResource = async (resource: ResourceAttachment): Promise<void> => {
    if (!window.confirm(`¿Eliminar “${resource.title}”? Esta acción no se puede deshacer.`)) return;
    try {
      await db.resourceAttachments.delete(resource.id);
      await loadResources();
      setNotice("Recurso eliminado.");
    } catch {
      setNotice("No se pudo eliminar el recurso.");
    }
  };

  return (
    <section className="detail-section resource-manager" aria-labelledby={`${fieldId}-heading`}>
      <div className="course-detail-header">
        <div>
          <h3 id={`${fieldId}-heading`}>{heading}</h3>
          <p className="hint">
            Enlaces y archivos guardados solo en este dispositivo. Los archivos se incluyen en las copias de seguridad.
          </p>
        </div>
        <span className="pill" title="Espacio usado por archivos en toda la aplicación">
          {formatFileSize(totalFileBytes)} / {formatFileSize(MAX_TOTAL_RESOURCE_BYTES)}
        </span>
      </div>

      <form className="resource-form" onSubmit={(event) => void saveResource(event)}>
        <label className="detail-field compact-field">
          <span>Tipo</span>
          <select className="input" value={kind} onChange={(event) => setKind(event.target.value as ResourceKind)}>
            <option value="link">Enlace web</option>
            <option value="file">Archivo local</option>
          </select>
        </label>
        <label className="detail-field compact-field">
          <span>Título</span>
          <input
            className="input"
            required
            minLength={2}
            maxLength={120}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={kind === "link" ? "Ej. Material de consulta" : "Ej. Evidencia del proyecto"}
          />
        </label>
        {kind === "link" ? (
          <label key="link-resource-location" className="detail-field resource-location-field compact-field">
            <span>URL</span>
            <input
              className="input"
              type="url"
              required
              maxLength={MAX_RESOURCE_URL_LENGTH}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://…"
            />
          </label>
        ) : (
          <label key="file-resource-location" className="detail-field resource-location-field">
            <span>Archivo (máximo 5 MB)</span>
            <input
              ref={fileInputRef}
              className="input resource-file-input"
              type="file"
              required
              accept={ACCEPTED_FILE_TYPES}
              onChange={(event) => {
                const selectedFile = event.target.files?.[0] ?? null;
                setFile(selectedFile);
                if (selectedFile && !title.trim()) {
                  setTitle(selectedFile.name.replace(/\.[^.]+$/, "").slice(0, 120));
                }
              }}
            />
          </label>
        )}
        <button type="submit" className="btn secondary resource-add-button" disabled={isSaving}>
          {isSaving ? "Guardando…" : "Añadir recurso"}
        </button>
      </form>

      <p className="resource-notice" role="status" aria-live="polite">{notice}</p>

      {resources.length > 0 ? (
        <ul className="resource-list">
          {resources.map((resource) => (
            <li key={resource.id} className="resource-card">
              <div className="resource-card-content">
                <strong>{resource.title}</strong>
                <small>
                  {resource.kind === "file"
                    ? `${resource.fileName} · ${formatFileSize(resource.sizeBytes ?? 0)}`
                    : resource.url}
                </small>
              </div>
              <div className="resource-actions">
                {resource.kind === "link" && resource.url ? (
                  <a className="btn secondary" href={resource.url} target="_blank" rel="noopener noreferrer">
                    Abrir
                  </a>
                ) : (
                  <button type="button" className="btn secondary" onClick={() => downloadFile(resource)}>
                    Descargar
                  </button>
                )}
                <button type="button" className="btn secondary management-danger-btn" onClick={() => void deleteResource(resource)}>
                  Eliminar
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-state">Todavía no hay recursos asociados.</p>
      )}
    </section>
  );
}
