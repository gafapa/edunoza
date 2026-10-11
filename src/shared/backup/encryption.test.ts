import { describe, expect, it } from "vitest";
import {
  decryptBackupPayload,
  encryptBackupPayload,
  estimateEncryptedBackupBytes,
  isEncryptedBackupEnvelope
} from "./encryption";

describe("encrypted backups", () => {
  it("compresses before encryption and predicts the exact transfer size", async () => {
    const payload = { text: "Synthetic áéíóú content".repeat(10_000) };
    const compressed = await encryptBackupPayload(payload, "correct horse battery staple", true);
    expect(compressed.version).toBe(2);
    expect(compressed.compression).toBe("gzip");
    expect(estimateEncryptedBackupBytes(payload, true)).toBe(new TextEncoder().encode(JSON.stringify(compressed)).length);
    expect(estimateEncryptedBackupBytes(payload, true)).toBeLessThan(estimateEncryptedBackupBytes(payload) / 10);
    await expect(decryptBackupPayload(compressed, "correct horse battery staple")).resolves.toEqual(payload);
    await expect(decryptBackupPayload({ ...compressed, version: 1, compression: undefined }, "correct horse battery staple")).rejects.toThrow(/descifrar/);
    expect(isEncryptedBackupEnvelope({ ...compressed, compression: "zip" })).toBe(false);
    expect(isEncryptedBackupEnvelope({ ...compressed, version: 3 })).toBe(false);
  });
  it("round-trips a payload without exposing its content", async () => {
    const payload = { students: [{ name: "Ana" }], grades: [8.5] };
    const encrypted = await encryptBackupPayload(payload, "correct horse battery staple");

    expect(encrypted.app).toBe("Edunoza");
    expect(isEncryptedBackupEnvelope(encrypted)).toBe(true);
    expect(encrypted.ciphertext).not.toContain("Ana");
    expect(estimateEncryptedBackupBytes(payload)).toBe(new TextEncoder().encode(JSON.stringify(encrypted)).length);
    await expect(decryptBackupPayload(encrypted, "correct horse battery staple")).resolves.toEqual(payload);
  });

  it("keeps legacy ProfePlus envelopes readable", async () => {
    const encrypted = await encryptBackupPayload({ value: "legacy" }, "correct horse battery staple");
    const legacyEnvelope = { ...encrypted, app: "ProfePlus" as const };

    expect(isEncryptedBackupEnvelope(legacyEnvelope)).toBe(true);
    await expect(decryptBackupPayload(legacyEnvelope, "correct horse battery staple")).resolves.toEqual({
      value: "legacy"
    });
  });

  it("rejects an incorrect password", async () => {
    const encrypted = await encryptBackupPayload({ value: "private" }, "correct horse battery staple");

    await expect(decryptBackupPayload(encrypted, "incorrect password value")).rejects.toThrow(
      "No se pudo descifrar"
    );
  });

  it("requires a password with at least twelve characters", async () => {
    await expect(encryptBackupPayload({ value: "private" }, "too-short")).rejects.toThrow(
      "al menos 12 caracteres"
    );
  });

  it("rejects envelopes with weakened key derivation settings", async () => {
    const encrypted = await encryptBackupPayload({ value: "private" }, "correct horse battery staple");
    const weakened = {
      ...encrypted,
      encryption: {
        ...encrypted.encryption,
        iterations: 1
      }
    };

    expect(isEncryptedBackupEnvelope(weakened)).toBe(false);
  });
});
