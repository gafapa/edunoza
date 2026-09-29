import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readMoodleToken, removeMoodleToken, saveMoodleToken } from "./credentials";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; }
  });
});
afterEach(() => vi.unstubAllGlobals());

it("isolates tokens by normalized installation and account", () => {
  expect(saveMoodleToken("https://school.example/aula/", "token123", 9)).toBe(true);
  expect(readMoodleToken("https://school.example/aula", 9)?.token).toBe("token123");
  expect(readMoodleToken("https://school.example/other/")).toBeNull();
  expect(readMoodleToken("https://school.example/aula", 10)).toBeNull();
  removeMoodleToken("https://school.example/aula", 10);
  expect(readMoodleToken("https://school.example/aula", 9)).not.toBeNull();
  removeMoodleToken("https://school.example/aula", 9);
  expect(readMoodleToken("https://school.example/aula")).toBeNull();
});

it("migrates a token saved under the pre-account-scoped key and then removes it", () => {
  localStorage.setItem("edunoza.moodle.token:https://school.example/aula/", JSON.stringify({ token: "legacyToken1", userId: 9 }));
  expect(readMoodleToken("https://school.example/aula", 9)?.token).toBe("legacyToken1");
  // Migrated into the new per-account key; the legacy entry is gone.
  expect(localStorage.getItem("edunoza.moodle.token:https://school.example/aula/")).toBeNull();
  expect(readMoodleToken("https://school.example/aula", 9)?.token).toBe("legacyToken1");
});

it("migrates a legacy token when looked up without an account id, then leaves it removed", () => {
  localStorage.setItem("edunoza.moodle.token:https://school.example/aula/", JSON.stringify({ token: "legacyToken2", userId: 7 }));
  expect(readMoodleToken("https://school.example/aula")?.token).toBe("legacyToken2");
  expect(localStorage.getItem("edunoza.moodle.token:https://school.example/aula/")).toBeNull();
  expect(readMoodleToken("https://school.example/aula", 8)).toBeNull();
});

it("rejects unsafe URLs and invalid tokens", () => {
  expect(saveMoodleToken("https://user:secret@school.example/", "token123", 9)).toBe(false);
  expect(saveMoodleToken("https://school.example/", "<token>", 9)).toBe(false);
  expect(saveMoodleToken("https://school.example/", "token123", 0)).toBe(false);
  expect(readMoodleToken("invalid")).toBeNull();
});

it("reports blocked storage without claiming credentials were saved", () => {
  vi.stubGlobal("localStorage", {
    setItem: () => { throw new Error("blocked"); },
    getItem: () => { throw new Error("blocked"); },
    removeItem: () => { throw new Error("blocked"); },
    key: () => { throw new Error("blocked"); },
    get length(): number { throw new Error("blocked"); }
  });
  expect(saveMoodleToken("https://school.example/", "token123", 9)).toBe(false);
  expect(readMoodleToken("https://school.example/")).toBeNull();
  expect(removeMoodleToken("https://school.example/")).toBe(false);
});

it("skips damaged or mismatched account entries while recovering a valid token", () => {
  const prefix = "edunoza.moodle.token:https://school.example/aula/";
  localStorage.setItem(`${prefix}::8`, "{broken");
  localStorage.setItem(`${prefix}::10`, JSON.stringify({ token: "wrongAccount", userId: 11 }));
  expect(saveMoodleToken("https://school.example/aula/", "validToken", 9)).toBe(true);
  expect(readMoodleToken("https://school.example/aula/")).toEqual({ token: "validToken", userId: 9 });
  expect(readMoodleToken("https://school.example/aula/", 10)).toBeNull();
});

it("removes an account token even when its legacy entry is damaged", () => {
  const server = "https://school.example/aula/";
  expect(saveMoodleToken(server, "token123", 9)).toBe(true);
  localStorage.setItem(`edunoza.moodle.token:${server}`, "{broken");
  expect(removeMoodleToken(server, 9)).toBe(true);
  expect(readMoodleToken(server, 9)).toBeNull();
});
