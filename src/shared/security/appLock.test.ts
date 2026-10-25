import { describe, expect, it } from "vitest";
import {
  APP_LOCK_STORAGE_KEY,
  createAppLockConfig,
  readAppLockConfig,
  verifyAppLockPassphrase
} from "./appLock";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("app lock", () => {
  it("treats only an absent key as disabled and preserves corrupt values", () => {
    const storage = new MemoryStorage();
    expect(readAppLockConfig(storage)).toBeNull();
    for (const raw of ["", "null", "false", "[]", "{broken", "{}"]) {
      storage.setItem(APP_LOCK_STORAGE_KEY, raw);
      expect(() => readAppLockConfig(storage)).toThrow(/bloqueo local/);
      expect(storage.getItem(APP_LOCK_STORAGE_KEY)).toBe(raw);
    }
  });
  it("does not treat blocked storage as a disabled lock", () => {
    const storage = new MemoryStorage();
    storage.getItem = () => { throw new Error("Storage blocked"); };
    expect(() => readAppLockConfig(storage)).toThrow(/comprobar el bloqueo local/);
  });
  it("creates a salted verifier and validates the correct passphrase", async () => {
    const config = await createAppLockConfig("teacher passphrase", 15);
    expect(config.verifier).not.toContain("teacher passphrase");
    await expect(verifyAppLockPassphrase(config, "teacher passphrase")).resolves.toBe(true);
    await expect(verifyAppLockPassphrase(config, "wrong passphrase")).resolves.toBe(false);
  });

  it("rejects weak configuration and malformed stored values", async () => {
    await expect(createAppLockConfig("short", 15)).rejects.toThrow();
    const storage = new MemoryStorage();
    storage.setItem(APP_LOCK_STORAGE_KEY, "{}");
    expect(() => readAppLockConfig(storage)).toThrow(/bloqueo local/);
  });

  it("rejects stored work factors and timeouts outside the supported policy", async () => {
    const config = await createAppLockConfig("teacher passphrase", 15);
    const storage = new MemoryStorage();

    storage.setItem(APP_LOCK_STORAGE_KEY, JSON.stringify({ ...config, iterations: 1 }));
    expect(() => readAppLockConfig(storage)).toThrow(/bloqueo local/);
    await expect(
      verifyAppLockPassphrase({ ...config, iterations: Number.MAX_SAFE_INTEGER }, "teacher passphrase")
    ).resolves.toBe(false);

    storage.setItem(APP_LOCK_STORAGE_KEY, JSON.stringify({ ...config, autoLockMinutes: 121 }));
    expect(() => readAppLockConfig(storage)).toThrow(/bloqueo local/);

    storage.setItem(APP_LOCK_STORAGE_KEY, JSON.stringify({ ...config, salt: "invalid" }));
    expect(() => readAppLockConfig(storage)).toThrow(/bloqueo local/);
  });
});
