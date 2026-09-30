import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it("starts with defaults when obtaining local storage throws", async () => {
  vi.stubGlobal("window", { get localStorage() { throw new Error("Storage blocked"); }, dispatchEvent: vi.fn() });
  const { store, DEFAULT_APP_PREFERENCES, hasPreferenceStorageError } = await import("./store");
  expect(store.getState().app).toMatchObject(DEFAULT_APP_PREFERENCES);
  expect(hasPreferenceStorageError()).toBe(true);
});

it("keeps updated preferences usable when persistent writes fail", async () => {
  vi.stubGlobal("window", {
    localStorage: { getItem: () => null, setItem: () => { throw new Error("Quota exceeded"); } },
    dispatchEvent: vi.fn()
  });
  const { store, setStudentSortBy, hasPreferenceStorageError } = await import("./store");
  store.dispatch(setStudentSortBy("firstName"));
  expect(store.getState().app.studentSortBy).toBe("firstName");
  expect(hasPreferenceStorageError()).toBe(true);
});
