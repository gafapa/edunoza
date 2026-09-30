import { getBrowserStorage } from "../storage/browserStorage";

const PREFIX = "edunoza-draft:";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function readLocalDraft(key: string, storage?: Storage, now = Date.now()): unknown | null {
  try {
    storage ??= getBrowserStorage("local");
    if (!storage) return null;
    const raw = storage.getItem(PREFIX + key);
    if (!raw || raw.length > 500_000) return null;
    const saved = JSON.parse(raw) as { version?: number; savedAt?: number; value?: unknown };
    if (saved.version !== 1 || typeof saved.savedAt !== "number" || saved.savedAt > now || now - saved.savedAt > MAX_AGE_MS) {
      storage.removeItem(PREFIX + key);
      return null;
    }
    return saved.value ?? null;
  } catch {
    return null;
  }
}

export function writeLocalDraft(key: string, value: unknown, storage?: Storage): boolean {
  try {
    storage ??= getBrowserStorage("local");
    if (!storage) return false;
    const serialized = JSON.stringify({ version: 1, savedAt: Date.now(), value });
    if (serialized.length > 500_000) return false;
    storage.setItem(PREFIX + key, serialized);
    return true;
  } catch {
    return false;
  }
}

export function removeLocalDraft(key: string, storage?: Storage): void {
  try { (storage ?? getBrowserStorage("local"))?.removeItem(PREFIX + key); } catch { /* The in-memory form remains usable. */ }
}

export function clearLocalDrafts(storage?: Storage): void {
  try {
    storage ??= getBrowserStorage("local");
    if (!storage) return;
    const target = storage;
    const keys = Array.from({ length: target.length }, (_, index) => target.key(index));
    for (const key of keys) if (key?.startsWith(PREFIX)) storage.removeItem(key);
  } catch { /* Storage may be unavailable. */ }
}
