import {
  PRODUCT_NAME,
  isCompatibleProductName,
  type CompatibleProductName
} from "../brand";
import { compressBackup, decompressBackup, MAX_BACKUP_PLAINTEXT_BYTES } from "./compression";

const ALGORITHM = "AES-GCM";
const KDF = "PBKDF2";
const HASH = "SHA-256";
const ITERATIONS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export type EncryptedBackupEnvelope = {
  app: CompatibleProductName;
  format: "encrypted-backup";
  version: 1 | 2;
  compression?: "gzip";
  encryption: {
    algorithm: typeof ALGORITHM;
    kdf: typeof KDF;
    hash: typeof HASH;
    iterations: number;
    salt: string;
    iv: string;
  };
  ciphertext: string;
};

/** Exact UTF-8 transfer size of the compact encrypted envelope, without deriving a key. */
export function estimateEncryptedBackupBytes(payload: unknown, compressed = false): number {
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const plaintextBytes = compressed ? compressBackup(plaintext).length : plaintext.length;
  const envelope: EncryptedBackupEnvelope = {
    app: PRODUCT_NAME, format: "encrypted-backup", version: compressed ? 2 : 1,
    ...(compressed ? { compression: "gzip" as const } : {}),
    encryption: { algorithm: ALGORITHM, kdf: KDF, hash: HASH, iterations: ITERATIONS, salt: "A".repeat(24), iv: "A".repeat(16) },
    ciphertext: ""
  };
  return new TextEncoder().encode(JSON.stringify(envelope)).length + 4 * Math.ceil((plaintextBytes + 16) / 3);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    KDF,
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: KDF, hash: HASH, salt, iterations },
    passwordKey,
    { name: ALGORITHM, length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export function isEncryptedBackupEnvelope(value: unknown): value is EncryptedBackupEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<EncryptedBackupEnvelope>;
  return (
    isCompatibleProductName(candidate.app) &&
    candidate.format === "encrypted-backup" &&
    ((candidate.version === 1 && candidate.compression === undefined) ||
      (candidate.version === 2 && candidate.compression === "gzip")) &&
    candidate.encryption?.algorithm === ALGORITHM &&
    candidate.encryption.kdf === KDF &&
    candidate.encryption.hash === HASH &&
    candidate.encryption.iterations === ITERATIONS &&
    typeof candidate.encryption.salt === "string" &&
    typeof candidate.encryption.iv === "string" &&
    typeof candidate.ciphertext === "string"
  );
}

export async function encryptBackupPayload(payload: unknown, password: string, compressed = false): Promise<EncryptedBackupEnvelope> {
  if (password.length < 12) {
    throw new Error("La contraseña debe tener al menos 12 caracteres.");
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt, ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  if (plaintext.length > MAX_BACKUP_PLAINTEXT_BYTES) throw new Error("La copia supera el tamaño admitido.");
  const ciphertext = await crypto.subtle.encrypt({ name: ALGORITHM, iv,
    ...(compressed ? { additionalData: new TextEncoder().encode("Edunoza:encrypted-backup:2:gzip") } : {})
  }, key, compressed ? compressBackup(plaintext) : plaintext);

  return {
    app: PRODUCT_NAME,
    format: "encrypted-backup",
    version: compressed ? 2 : 1,
    ...(compressed ? { compression: "gzip" as const } : {}),
    encryption: {
      algorithm: ALGORITHM,
      kdf: KDF,
      hash: HASH,
      iterations: ITERATIONS,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv)
    },
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
}

export async function decryptBackupPayload(envelope: EncryptedBackupEnvelope, password: string): Promise<unknown> {
  if (!isEncryptedBackupEnvelope(envelope)) {
    throw new Error("La copia cifrada no tiene un formato compatible.");
  }
  try {
    if (envelope.ciphertext.length > 4 * Math.ceil((MAX_BACKUP_PLAINTEXT_BYTES + 16) / 3)) throw new Error("Oversized ciphertext");
    const salt = base64ToBytes(envelope.encryption.salt);
    const iv = base64ToBytes(envelope.encryption.iv);
    if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES) throw new Error("Invalid salt or IV");
    const ciphertext = base64ToBytes(envelope.ciphertext);
    const key = await deriveKey(password, salt, envelope.encryption.iterations);
    const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: ALGORITHM, iv,
      ...(envelope.version === 2 ? { additionalData: new TextEncoder().encode("Edunoza:encrypted-backup:2:gzip") } : {})
    }, key, ciphertext));
    const decoded = envelope.version === 2 ? decompressBackup(plaintext) : plaintext;
    if (decoded.length > MAX_BACKUP_PLAINTEXT_BYTES) throw new Error("Oversized plaintext");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded)) as unknown;
  } catch {
    throw new Error("No se pudo descifrar la copia. Comprueba la contraseña y el archivo.");
  }
}
