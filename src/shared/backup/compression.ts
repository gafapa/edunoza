import { gzipSync, Gunzip } from "fflate";

export const MAX_BACKUP_PLAINTEXT_BYTES = 75 * 1024 * 1024;
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

export function compressBackup(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.length > MAX_BACKUP_PLAINTEXT_BYTES) throw new Error("La copia supera el tamaño admitido.");
  return new Uint8Array(gzipSync(bytes, { level: 6 }));
}

/** Inflate incrementally so a crafted archive cannot allocate unbounded output. */
export function decompressBackup(bytes: Uint8Array, limit = MAX_BACKUP_PLAINTEXT_BYTES): Uint8Array<ArrayBuffer> {
  if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 8) throw new Error("Formato gzip no válido.");
  const trailer = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 8, 8);
  if (trailer.getUint32(4, true) > limit) throw new Error("La copia descomprimida supera el tamaño admitido.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  let crc = 0xffffffff;
  const stream = new Gunzip(chunk => {
    total += chunk.length;
    if (total > limit) throw new Error("La copia descomprimida supera el tamaño admitido.");
    for (const byte of chunk) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
    chunks.push(chunk);
  });
  for (let offset = 0; offset < bytes.length; offset += 1024) {
    stream.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
  }
  if (total !== trailer.getUint32(4, true) || ((crc ^ 0xffffffff) >>> 0) !== trailer.getUint32(0, true)) throw new Error("La copia comprimida está incompleta o dañada.");
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
