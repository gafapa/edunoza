import { describe, expect, it } from "vitest";
import { compressBackup, decompressBackup } from "./compression";

describe("bounded backup compression", () => {
  it("round trips non-ASCII content and rejects expansion beyond the budget", () => {
    const bytes = new TextEncoder().encode("Synthetic áéíóú data\n".repeat(2000));
    const compressed = compressBackup(bytes);
    expect(compressed.length).toBeLessThan(bytes.length / 10);
    expect(decompressBackup(compressed, bytes.length)).toEqual(bytes);
    expect(() => decompressBackup(compressed, bytes.length - 1)).toThrow(/tamaño/);
  });
  it("rejects invalid and truncated compressed streams", () => {
    expect(() => decompressBackup(new Uint8Array([1, 2, 3]))).toThrow();
    const bytes = compressBackup(new TextEncoder().encode("Synthetic".repeat(100)));
    expect(() => decompressBackup(bytes.subarray(0, 12))).toThrow();
  });
  it("enforces the expansion budget even when the archive lies about its size", () => {
    const bytes = compressBackup(new TextEncoder().encode("Synthetic".repeat(20_000)));
    new DataView(bytes.buffer).setUint32(bytes.length - 4, 0, true);
    expect(() => decompressBackup(bytes, 1024)).toThrow(/tamaño/);
  });
  it("rejects a mismatched checksum after decompression", () => {
    const bytes = compressBackup(new TextEncoder().encode("Synthetic backup"));
    bytes[bytes.length - 8] ^= 1;
    expect(() => decompressBackup(bytes)).toThrow(/dañada/);
  });
});
