import { getBrowserStorage } from "../storage/browserStorage";

export const APP_LOCK_STORAGE_KEY = "profeplus_app_lock";
export const APP_LOCK_CHANGED_EVENT = "profeplus:app-lock-changed";
export const APP_LOCK_NOW_EVENT = "profeplus:lock-now";

const APP_LOCK_ITERATIONS = 210_000;
const APP_LOCK_SALT_BYTES = 16;
const APP_LOCK_VERIFIER_BYTES = 32;
const MIN_AUTO_LOCK_MINUTES = 1;
const MAX_AUTO_LOCK_MINUTES = 120;

export type AppLockConfig = {
  version: 1;
  salt: string;
  verifier: string;
  iterations: number;
  autoLockMinutes: number;
};

function hasEncodedByteLength(value: string, expectedLength: number): boolean {
  try {
    return base64ToBytes(value).length === expectedLength;
  } catch {
    return false;
  }
}

function isValidAppLockConfig(value: Partial<AppLockConfig>): value is AppLockConfig {
  return (
    value.version === 1 &&
    typeof value.salt === "string" &&
    hasEncodedByteLength(value.salt, APP_LOCK_SALT_BYTES) &&
    typeof value.verifier === "string" &&
    hasEncodedByteLength(value.verifier, APP_LOCK_VERIFIER_BYTES) &&
    value.iterations === APP_LOCK_ITERATIONS &&
    Number.isInteger(value.autoLockMinutes) &&
    (value.autoLockMinutes ?? 0) >= MIN_AUTO_LOCK_MINUTES &&
    (value.autoLockMinutes ?? 0) <= MAX_AUTO_LOCK_MINUTES
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function deriveVerifier(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number
): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    keyMaterial,
    256
  );
  return bytesToBase64(new Uint8Array(bits));
}

export async function createAppLockConfig(
  passphrase: string,
  autoLockMinutes: number
): Promise<AppLockConfig> {
  if (passphrase.length < 8) throw new Error("La clave debe tener al menos 8 caracteres.");
  if (
    !Number.isInteger(autoLockMinutes) ||
    autoLockMinutes < MIN_AUTO_LOCK_MINUTES ||
    autoLockMinutes > MAX_AUTO_LOCK_MINUTES
  ) {
    throw new Error("El bloqueo automático debe estar entre 1 y 120 minutos.");
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    version: 1,
    salt: bytesToBase64(salt),
    verifier: await deriveVerifier(passphrase, salt, APP_LOCK_ITERATIONS),
    iterations: APP_LOCK_ITERATIONS,
    autoLockMinutes
  };
}

export async function verifyAppLockPassphrase(
  config: AppLockConfig,
  passphrase: string
): Promise<boolean> {
  if (!isValidAppLockConfig(config)) return false;
  const candidate = await deriveVerifier(passphrase, base64ToBytes(config.salt), config.iterations);
  if (candidate.length !== config.verifier.length) return false;
  let difference = 0;
  for (let index = 0; index < candidate.length; index += 1) {
    difference |= candidate.charCodeAt(index) ^ config.verifier.charCodeAt(index);
  }
  return difference === 0;
}

export function readAppLockConfig(storage?: Storage): AppLockConfig | null {
  let rawValue: string | null;
  try {
    const target = storage ?? getBrowserStorage("local");
    if (!target) throw new Error("Storage unavailable");
    rawValue = target.getItem(APP_LOCK_STORAGE_KEY);
  } catch {
    throw new Error("No se puede comprobar el bloqueo local. Permite el almacenamiento de este sitio y vuelve a intentarlo.");
  }
  if (!rawValue) return null;
  try {
    const value = JSON.parse(rawValue) as Partial<AppLockConfig>;
    return isValidAppLockConfig(value) ? value : null;
  } catch {
    return null;
  }
}

export function persistAppLockConfig(config: AppLockConfig | null): void {
  try {
    const storage = getBrowserStorage("local");
    if (!storage) throw new Error("Storage unavailable");
    if (config) storage.setItem(APP_LOCK_STORAGE_KEY, JSON.stringify(config));
    else storage.removeItem(APP_LOCK_STORAGE_KEY);
  } catch {
    throw new Error("No se pudo guardar el bloqueo local. Revisa los permisos de almacenamiento del navegador.");
  }
  window.dispatchEvent(new Event(APP_LOCK_CHANGED_EVENT));
}
