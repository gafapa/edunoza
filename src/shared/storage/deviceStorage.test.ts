import { describe, expect, it, vi } from "vitest";
import { readDeviceStorage, requestPersistentStorage } from "./deviceStorage";

describe("device storage protection", () => {
  it("supports browsers without the storage manager", async () => {
    await expect(readDeviceStorage(null as unknown as StorageManager)).resolves.toEqual({ supported: false, persistent: null, usage: null, quota: null });
    await expect(requestPersistentStorage(null as unknown as StorageManager)).resolves.toBe(false);
  });
  it("reads estimates without requesting permission", async () => {
    const storage = { estimate: vi.fn(async () => ({ usage: 100, quota: 200 })), persisted: vi.fn(async () => true), persist: vi.fn() };
    await expect(readDeviceStorage(storage as unknown as StorageManager)).resolves.toEqual({ supported: true, persistent: true, usage: 100, quota: 200 });
    expect(storage.persist).not.toHaveBeenCalled();
  });
  it("does not invent space measurements when values are unavailable or invalid", async () => {
    await expect(readDeviceStorage({ estimate: async () => ({ usage: NaN, quota: -1 }) } as StorageManager)).resolves.toEqual({ supported: false, persistent: null, usage: null, quota: null });
  });
  it.each([true, false])("reports the browser permission decision (%s)", async granted => {
    await expect(requestPersistentStorage({ persist: async () => granted } as StorageManager)).resolves.toBe(granted);
  });
  it("propagates denied API access for the UI to explain", async () => {
    const storage = { estimate: async () => { throw new Error("Blocked"); } } as unknown as StorageManager;
    await expect(readDeviceStorage(storage)).rejects.toThrow("Blocked");
    await expect(requestPersistentStorage({ persist: async () => { throw new Error("Blocked"); } } as unknown as StorageManager)).rejects.toThrow("Blocked");
  });
});
