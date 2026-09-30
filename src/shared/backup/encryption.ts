import {
  PRODUCT_NAME,
  isCompatibleProductName,
  type CompatibleProductName
} from "../brand";

const ALGORITHM = "AES-GCM";
const KDF = "PBKDF2";
const HASH = "SHA-256";
const ITERATIONS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export type EncryptedBackupEnvelope = {
  app: CompatibleProductName;
  format: "encrypted-backup";
  version: 1;
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
export function estimateEncryptedBackupBytes(payload: unknown): number {
  const plaintextBytes = new TextEncoder().encode(JSON.stringify(payload)).length;
  const envelope: EncryptedBackupEnvelope = {
    app: PRODUCT_NAME, format: "encrypted-backup", version: 1,
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
    candidate.version === 1 &&
    candidate.encryption?.algorithm === ALGORITHM &&
    candidate.encryption.kdf === KDF &&
    candidate.encryption.hash === HASH &&
    candidate.encryption.iterations === ITERATIONS &&
    typeof candidate.encryption.salt === "string" &&
    typeof candidate.encryption.iv === "string" &&
    typeof candidate.ciphertext === "string"
  );
}

export async function encryptBackupPayload(payload: unknown, password: string): Promise<EncryptedBackupEnvelope> {
  if (password.length < 12) {
    throw new Error("La contraseña debe tener al menos 12 caracteres.");
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt, ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, plaintext);

  return {
    app: PRODUCT_NAME,
    format: "encrypted-backup",
    version: 1,
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
    const salt = base64ToBytes(envelope.encryption.salt);
    const iv = base64ToBytes(envelope.encryption.iv);
    const ciphertext = base64ToBytes(envelope.ciphertext);
    const key = await deriveKey(password, salt, envelope.encryption.iterations);
    const plaintext = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
  } catch {
    throw new Error("No se pudo descifrar la copia. Comprueba la contraseña y el archivo.");
  }
}
