import { decryptBackupPayload, encryptBackupPayload, isEncryptedBackupEnvelope } from "./encryption";

const PROTOCOL = "proxy-extension-bridge";
export const MAX_NEXTCLOUD_BACKUP_BYTES = 10 * 1024 * 1024;
const MAX_BYTES = MAX_NEXTCLOUD_BACKUP_BYTES;
const FILE_PATTERN = /^edunoza-backup-[\dTZ.-]+-[a-f\d-]{36}\.json$/;
const DAV = "DAV:";
export type NextcloudCredentials = { server: string; username: string; password: string };
export type ProxyRequest = { url: string; method: string; headers: Record<string, string>; body?: string; responseType: "text"; allowPrivateNetwork?: boolean };
export type ProxyResponse = { status: number; bodyText: string; finalUrl: string };
export type ProxyTransport = (request: ProxyRequest, signal?: AbortSignal) => Promise<ProxyResponse>;
export type RemoteBackup = { name: string; url: string };

/** Secrets are carried only by this request and are never persisted or logged. */
export function proxyMessage(type: "bridge-ping" | "bridge-request", payload?: ProxyRequest, signal?: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const cleanup = () => {
      window.removeEventListener("message", receive);
      signal?.removeEventListener("abort", abort);
      clearTimeout(timer);
    };
    const fail = (message: string) => { cleanup(); reject(new Error(message)); };
    const abort = () => fail("Operación interrumpida. Una subida ya enviada podría continuar en Nextcloud.");
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (event.source !== window || event.origin !== window.location.origin || !data ||
        data.source !== "proxy-extension" || data.protocol !== PROTOCOL || data.version !== 1) return;
      if (type === "bridge-ping" && data.type === "bridge-available") {
        cleanup(); resolve(data.extensionVersion); return;
      }
      if (type !== "bridge-request" || data.type !== "bridge-response" || data.requestId !== requestId) return;
      if (data.ok !== true) {
        fail("La extensión Proxy no pudo completar la petición. Revisa sus permisos, métodos WebDAV, límites de tamaño y tiempo de espera.");
        return;
      }
      cleanup(); resolve(data.result);
    };
    const timer = window.setTimeout(() => fail(type === "bridge-ping"
      ? "No se detecta Proxy. Instala o actualiza la extensión, permite edunoza.com y recarga esta página."
      : "La petición agotó el tiempo de espera. Si estabas subiendo una copia, actualiza la lista antes de repetir: podría haberse guardado."), type === "bridge-ping" ? 3000 : 125000);
    if (signal?.aborted) { abort(); return; }
    window.addEventListener("message", receive);
    signal?.addEventListener("abort", abort, { once: true });
    window.postMessage({ source: "edunoza-web", protocol: PROTOCOL, version: 1, type, requestId, ...(payload ? { payload } : {}) }, window.location.origin);
  });
}

export const proxyFetch: ProxyTransport = async (request, signal) => {
  const result = await proxyMessage("bridge-request", request, signal) as Partial<ProxyResponse> | null;
  if (!result || !Number.isInteger(result.status) || typeof result.bodyText !== "string" || typeof result.finalUrl !== "string") {
    throw new Error("Proxy devolvió una respuesta no válida. Actualiza la extensión.");
  }
  if (new URL(result.finalUrl).href !== new URL(request.url).href) {
    throw new Error("Nextcloud redirigió la petición. Comprueba la dirección del servidor; no se aceptan redirecciones.");
  }
  if (new TextEncoder().encode(result.bodyText).length > MAX_BYTES) throw new Error("La respuesta supera el límite de 10 MiB.");
  return result as ProxyResponse;
};

export function nextcloudFolder(server: string, username: string): URL {
  username = username.trim();
  let base: URL;
  try { base = new URL(server.trim()); } catch { throw new Error("Introduce una dirección HTTPS válida para Nextcloud."); }
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash ||
    /\/remote\.php(?:\/|$)/i.test(base.pathname)) {
    throw new Error("Usa la dirección HTTPS de inicio de Nextcloud, sin credenciales, parámetros ni ruta WebDAV.");
  }
  if (!username.trim() || /[:/\\\u0000-\u001f]/.test(username) || username === "." || username === "..") {
    throw new Error("Introduce tu identificador de usuario de Nextcloud, sin barras ni dos puntos.");
  }
  return new URL(`${base.href.replace(/\/$/, "")}/remote.php/dav/files/${encodeURIComponent(username.trim())}/Edunoza/`);
}

function authorization(credentials: NextcloudCredentials): string {
  if (!credentials.password) throw new Error("Introduce la contraseña de aplicación de Nextcloud.");
  const bytes = new TextEncoder().encode(`${credentials.username.trim()}:${credentials.password}`);
  return `Basic ${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))}`;
}

function httpError(status: number): Error {
  const messages: Record<number, string> = {
    401: "Nextcloud no acepta el usuario o la contraseña de aplicación.",
    403: "No tienes permiso para acceder a esta carpeta de Nextcloud.",
    404: "No se encuentra la ruta en Nextcloud. Comprueba el servidor y el identificador de usuario.",
    412: "Ya existe un archivo con ese nombre. No se ha sobrescrito.",
    413: "La copia supera el tamaño permitido por Nextcloud o Proxy.",
    507: "No queda espacio suficiente en Nextcloud."
  };
  return new Error(messages[status] ?? `Nextcloud devolvió un error HTTP ${status}. No se ha confirmado la operación.`);
}

export function parseBackupListing(xml: string, folder: URL): RemoteBackup[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Nextcloud devolvió un listado XML no seguro.");
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror") || document.documentElement.localName !== "multistatus" || document.documentElement.namespaceURI !== DAV) {
    throw new Error("Nextcloud no devolvió un listado WebDAV válido.");
  }
  const backups = new Map<string, RemoteBackup>();
  let collectionFound = false;
  for (const response of document.getElementsByTagNameNS(DAV, "response")) {
    const href = response.getElementsByTagNameNS(DAV, "href")[0]?.textContent;
    if (!href) continue;
    let url: URL;
    try { url = new URL(href, folder); } catch { continue; }
    if (url.origin !== folder.origin || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(folder.pathname)) continue;
    const name = url.pathname.slice(folder.pathname.length);
    if (!name) {
      collectionFound = Array.from(response.getElementsByTagNameNS(DAV, "propstat")).some((propstat) =>
        /\s200\s/.test(propstat.getElementsByTagNameNS(DAV, "status")[0]?.textContent ?? "") &&
        propstat.getElementsByTagNameNS(DAV, "collection").length > 0);
    }
    if (!FILE_PATTERN.test(name)) continue;
    const valid = Array.from(response.getElementsByTagNameNS(DAV, "propstat")).some((propstat) =>
      /\s200\s/.test(propstat.getElementsByTagNameNS(DAV, "status")[0]?.textContent ?? "") &&
      !propstat.getElementsByTagNameNS(DAV, "collection").length);
    if (valid) backups.set(name, { name, url: url.href });
  }
  if (!collectionFound) throw new Error("Nextcloud no confirmó el acceso a la carpeta. Comprueba el usuario y los permisos WebDAV.");
  return [...backups.values()].sort((a, b) => b.name.localeCompare(a.name));
}

export function createNextcloudClient(credentials: NextcloudCredentials, transport: ProxyTransport = proxyFetch, signal?: AbortSignal) {
  const folder = nextcloudFolder(credentials.server, credentials.username);
  const headers = { Authorization: authorization(credentials) };
  const request = (url: URL, method: string, extra: Record<string, string> = {}, body?: string) => {
    signal?.throwIfAborted();
    return transport({ url: url.href, method, headers: { ...headers, ...extra }, responseType: "text", ...(body === undefined ? {} : { body }) }, signal);
  };
  const propfind = (url: URL, depth: string) => request(url, "PROPFIND", { Depth: depth, "Content-Type": "application/xml; charset=utf-8" },
    '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>');
  const list = async (): Promise<RemoteBackup[]> => {
    const root = await propfind(new URL("../", folder), "0");
    if (root.status !== 207) throw httpError(root.status);
    parseBackupListing(root.bodyText, new URL("../", folder));
    const result = await propfind(folder, "1");
    if (result.status === 404) return [];
    if (result.status !== 207) throw httpError(result.status);
    return parseBackupListing(result.bodyText, folder);
  };
  const read = async (backup: RemoteBackup) => {
    if (!FILE_PATTERN.test(backup.name) || new URL(backup.name, folder).href !== backup.url) throw new Error("La copia no pertenece a la carpeta Edunoza de esta cuenta.");
    const result = await request(new URL(backup.url), "GET");
    if (result.status !== 200) throw httpError(result.status);
    let envelope: unknown;
    try { envelope = JSON.parse(result.bodyText); } catch { throw new Error("El archivo no contiene una copia cifrada válida."); }
    if (!isEncryptedBackupEnvelope(envelope)) throw new Error("El archivo no es una copia cifrada compatible con Edunoza.");
    return { text: result.bodyText, envelope };
  };
  return {
    list,
    retrieve: async (backup: RemoteBackup, password: string, validate: (value: unknown) => unknown) => {
      const result = await read(backup);
      const payload = await decryptBackupPayload(result.envelope, password);
      validate(payload);
      return payload;
    },
    download: async (backup: RemoteBackup, password: string, validate: (value: unknown) => unknown) => {
      const result = await read(backup);
      validate(await decryptBackupPayload(result.envelope, password));
      return result.text;
    },
    upload: async (payload: unknown, password: string, validate: (value: unknown) => unknown, progress: (message: string) => void) => {
      if (password === credentials.password) throw new Error("Utiliza una contraseña de cifrado distinta de la contraseña de Nextcloud.");
      validate(payload);
      progress("Cifrando la copia en este dispositivo…");
      const text = JSON.stringify(await encryptBackupPayload(payload, password));
      if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error("La copia cifrada supera 10 MiB. Descarga una copia local desde Base de datos.");
      const name = `edunoza-backup-${new Date().toISOString().replace(/:/g, "-")}-${crypto.randomUUID()}.json`;
      const backup = { name, url: new URL(name, folder).href };
      progress("Preparando la carpeta Edunoza…");
      const directory = await request(folder, "MKCOL");
      if (directory.status !== 201 && directory.status !== 405) throw httpError(directory.status);
      if (directory.status === 405) {
        const existing = await propfind(folder, "0");
        if (existing.status !== 207) throw httpError(existing.status);
        parseBackupListing(existing.bodyText, folder);
      }
      progress(`Subiendo ${name}… No cierres esta pantalla.`);
      let result: ProxyResponse;
      try {
        result = await request(new URL(backup.url), "PUT", { "Content-Type": "application/json", "If-None-Match": "*" }, text);
      } catch {
        throw new Error(`No se pudo confirmar la subida de ${name}. Podría haberse guardado: actualiza la lista antes de repetir. Revisa también los permisos, límites y tiempo de espera de Proxy.`);
      }
      if (result.status !== 201 && result.status !== 204) throw httpError(result.status);
      progress("Descargando de nuevo la copia para verificarla…");
      try {
        const saved = await read(backup);
        if (saved.text !== text) throw new Error("El contenido descargado no coincide con el enviado.");
        validate(await decryptBackupPayload(saved.envelope, password));
      } catch {
        throw new Error(`La subida respondió correctamente, pero no se pudo verificar ${name}. No des por segura esta copia: actualiza la lista y prueba a descargarla. No se ha eliminado ningún archivo.`);
      }
      return backup;
    }
  };
}
