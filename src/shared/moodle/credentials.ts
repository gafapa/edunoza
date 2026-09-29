import { normalizeMoodleUrl } from "./client";

const PREFIX = "edunoza.moodle.token:";
type SavedToken = { token: string; userId: number };

function buildKey(server: string, userId: number): string {
  return `${PREFIX}${normalizeMoodleUrl(server)}::${userId}`;
}

/** Pre-migration key format (one token per server, no account suffix). */
function legacyKey(server: string): string {
  return `${PREFIX}${normalizeMoodleUrl(server)}`;
}

function parseStoredToken(raw: string | null): SavedToken | null {
  try {
    const value = JSON.parse(raw ?? "null") as SavedToken | null;
    if (!value || typeof value.token !== "string" || !/^[a-zA-Z0-9]{1,256}$/.test(value.token) ||
        !Number.isSafeInteger(value.userId) || value.userId <= 0) return null;
    return { token: value.token, userId: value.userId };
  } catch {
    // A damaged entry must not block other accounts or removal of saved credentials.
    return null;
  }
}

/** Migrate a token saved under the pre-account-scoped key, if present, and remove the old entry. */
function migrateLegacyToken(server: string, matchingUserId?: number): SavedToken | null {
  const legacy = parseStoredToken(localStorage.getItem(legacyKey(server)));
  if (!legacy || (matchingUserId !== undefined && legacy.userId !== matchingUserId)) return null;
  localStorage.setItem(buildKey(server, legacy.userId), JSON.stringify(legacy));
  localStorage.removeItem(legacyKey(server));
  return legacy;
}

/** Device-only credential storage, deliberately excluded from academic backups. Keyed by server+account so distinct accounts on the same server never collide. */
export function readMoodleToken(server: string, userId?: number): SavedToken | null {
  try {
    if (userId !== undefined) {
      const value = parseStoredToken(localStorage.getItem(buildKey(server, userId)));
      if (value && value.userId === userId) return value;
      return migrateLegacyToken(server, userId);
    }
    const prefix = `${PREFIX}${normalizeMoodleUrl(server)}::`;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith(prefix)) continue;
      const value = parseStoredToken(localStorage.getItem(key));
      if (value && key === buildKey(server, value.userId)) return value;
    }
    return migrateLegacyToken(server);
  } catch { return null; }
}

export function saveMoodleToken(server: string, token: string, userId: number): boolean {
  try {
    if (!/^[a-zA-Z0-9]{1,256}$/.test(token) || !Number.isSafeInteger(userId) || userId <= 0) return false;
    localStorage.setItem(buildKey(server, userId), JSON.stringify({ token, userId }));
    localStorage.removeItem(legacyKey(server));
    return true;
  } catch { return false; }
}

export function removeMoodleToken(server: string, userId?: number): boolean {
  try {
    if (userId !== undefined) {
      localStorage.removeItem(buildKey(server, userId));
      const legacy = parseStoredToken(localStorage.getItem(legacyKey(server)));
      if (legacy && legacy.userId === userId) localStorage.removeItem(legacyKey(server));
      return true;
    }
    const prefix = `${PREFIX}${normalizeMoodleUrl(server)}::`;
    const keysToRemove: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && key.startsWith(prefix)) keysToRemove.push(key);
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
    localStorage.removeItem(legacyKey(server));
    return true;
  } catch { return false; }
}
