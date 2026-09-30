export function getBrowserStorage(kind: "local" | "session"): Storage | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function readSessionValue(key: string): string | null {
  try { return getBrowserStorage("session")?.getItem(key) ?? null; } catch { return null; }
}

export function writeSessionValue(key: string, value: string | null): void {
  try {
    const storage = getBrowserStorage("session");
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch { /* Retry protection also remains active in memory. */ }
}
