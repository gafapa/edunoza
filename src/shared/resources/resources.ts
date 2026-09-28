import type { ResourceAttachment, ResourceOwnerType } from "../db/types";

export const MAX_RESOURCE_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_RESOURCE_BYTES = 20 * 1024 * 1024;
export const MAX_RESOURCE_TITLE_LENGTH = 120;
export const MAX_RESOURCE_FILE_NAME_LENGTH = 255;
export const MAX_RESOURCE_URL_LENGTH = 2048;

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "text/markdown",
  "text/plain",
  "video/mp4",
  "video/webm"
]);

export function normalizeResourceTitle(value: string): string {
  const title = value.trim();
  if (title.length < 2 || title.length > MAX_RESOURCE_TITLE_LENGTH) {
    throw new Error(`El título debe tener entre 2 y ${MAX_RESOURCE_TITLE_LENGTH} caracteres.`);
  }
  return title;
}

export function normalizeHttpUrl(value: string): string {
  const trimmedValue = value.trim();
  if (trimmedValue.length > MAX_RESOURCE_URL_LENGTH) {
    throw new Error(`La URL no puede superar ${MAX_RESOURCE_URL_LENGTH} caracteres.`);
  }
  let url: URL;
  try {
    url = new URL(trimmedValue);
  } catch {
    throw new Error("Introduce una URL completa que empiece por https:// o http://.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Solo se permiten enlaces https:// o http://.");
  }
  return url.toString();
}

export function isAllowedResourceMimeType(value: string): boolean {
  return ALLOWED_MIME_TYPES.has(value.toLowerCase());
}

export function validateResourceFile(file: Pick<File, "name" | "size" | "type">): void {
  if (!file.name.trim() || file.name.length > MAX_RESOURCE_FILE_NAME_LENGTH || /[\u0000-\u001f]/.test(file.name)) {
    throw new Error("El nombre del archivo no es válido.");
  }
  if (file.size <= 0) {
    throw new Error("El archivo está vacío.");
  }
  if (file.size > MAX_RESOURCE_FILE_BYTES) {
    throw new Error(`El archivo supera el límite de ${formatFileSize(MAX_RESOURCE_FILE_BYTES)}.`);
  }
  if (!isAllowedResourceMimeType(file.type)) {
    throw new Error("Tipo de archivo no permitido. Usa PDF, Office, OpenDocument, texto, imagen, audio o vídeo web.");
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function base64DecodedByteLength(value: string): number {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return -1;
  }
  if (value.length === 0) return 0;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

export async function createFileResource(
  ownerType: ResourceOwnerType,
  ownerId: string,
  titleValue: string,
  file: File,
  currentTotalBytes: number,
  now = new Date().toISOString()
): Promise<ResourceAttachment> {
  const title = normalizeResourceTitle(titleValue);
  validateResourceFile(file);
  if (currentTotalBytes + file.size > MAX_TOTAL_RESOURCE_BYTES) {
    throw new Error(`Los archivos guardados no pueden superar ${formatFileSize(MAX_TOTAL_RESOURCE_BYTES)} en total.`);
  }
  const dataBase64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
  return {
    id: crypto.randomUUID(),
    ownerType,
    ownerId,
    kind: "file",
    title,
    fileName: file.name,
    mimeType: file.type.toLowerCase(),
    sizeBytes: file.size,
    dataBase64,
    createdAt: now,
    updatedAt: now
  };
}

export function createLinkResource(
  ownerType: ResourceOwnerType,
  ownerId: string,
  titleValue: string,
  urlValue: string,
  now = new Date().toISOString()
): ResourceAttachment {
  return {
    id: crypto.randomUUID(),
    ownerType,
    ownerId,
    kind: "link",
    title: normalizeResourceTitle(titleValue),
    url: normalizeHttpUrl(urlValue),
    createdAt: now,
    updatedAt: now
  };
}

/**
 * Attachments on a journal/diary entry (Hoy) are owned by the exact entry they were added
 * to - the same (class, subject, date, slot) scope as its comments, plus the task when one is
 * selected, so attachments stay put across reschedules and stacked same-slot tasks.
 */
export function journalEntryOwnerId(
  classId: string,
  subjectId: string,
  date: string,
  scheduleSlotId: string,
  taskId?: string
): string {
  return [classId, subjectId, date, scheduleSlotId, taskId ?? ""].join(":");
}

export type JournalEntryOwner = {
  classId: string;
  subjectId: string;
  date: string;
  scheduleSlotId: string;
  taskId: string;
};

export function parseJournalEntryOwnerId(ownerId: string): JournalEntryOwner | null {
  const parts = ownerId.split(":");
  if (parts.length !== 5) return null;
  const [classId, subjectId, date, scheduleSlotId, taskId] = parts;
  if (!classId || !subjectId || !date || !scheduleSlotId) return null;
  return { classId, subjectId, date, scheduleSlotId, taskId };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
