export type DeviceStorageState = {
  supported: boolean;
  persistent: boolean | null;
  usage: number | null;
  quota: number | null;
};

export async function readDeviceStorage(storage: StorageManager | undefined = navigator.storage): Promise<DeviceStorageState> {
  if (!storage) return { supported: false, persistent: null, usage: null, quota: null };
  const [estimate, persistent] = await Promise.all([
    storage.estimate?.() ?? Promise.resolve({}),
    storage.persisted?.() ?? Promise.resolve(null)
  ]);
  const validBytes = (value: number | undefined) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  return { supported: typeof storage.persist === "function", persistent, usage: validBytes(estimate.usage), quota: validBytes(estimate.quota) };
}

export async function requestPersistentStorage(storage: StorageManager | undefined = navigator.storage): Promise<boolean> {
  return storage?.persist ? storage.persist() : false;
}
