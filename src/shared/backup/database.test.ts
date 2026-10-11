import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/database";
import { buildCurrentPayload, clearDatabase, restoreDatabasePayload, seedDatabase } from "./database";

beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await db.classGroups.put({ id: "course", name: "Original", level: "ESO", schoolYear: "2026-2027" });
});
afterEach(() => vi.restoreAllMocks());

describe("database replacement concurrency", () => {
  it("rolls back every cleared table when a replacement write fails", async () => {
    const current = await buildCurrentPayload();
    vi.spyOn(Object.getPrototypeOf(db.classGroups), "bulkPut").mockRejectedValueOnce(new Error("Simulated quota failure"));
    await expect(restoreDatabasePayload(current, current.tables)).rejects.toThrow(/quota/);
    expect((await buildCurrentPayload()).tables).toEqual(current.tables);
  });
  it("rejects invalid relationships without touching current records", async () => {
    const current = await buildCurrentPayload();
    const invalid = { ...current, tables: { ...current.tables, students: [{ id: "orphan", classId: "missing", firstName: "Synthetic", lastName: "Student", fullName: "Synthetic Student" }] } };
    await expect(restoreDatabasePayload(invalid, current.tables)).rejects.toThrow();
    expect((await buildCurrentPayload()).tables).toEqual(current.tables);
  });
  it("does not clear the database when restoration is already cancelled", async () => {
    const current = await buildCurrentPayload();
    const controller = new AbortController();
    controller.abort();
    await expect(restoreDatabasePayload(current, current.tables, controller.signal)).rejects.toThrow();
    expect((await buildCurrentPayload()).tables).toEqual(current.tables);
  });
  it.each(["restore", "reset", "demo"])("preserves a concurrent edit before %s", async operation => {
    const current = await buildCurrentPayload();
    await db.classGroups.update("course", { name: "Concurrent edit" });
    const replacement = { ...current, tables: { ...current.tables, classGroups: [] } };
    const action = operation === "restore" ? restoreDatabasePayload(replacement, current.tables)
      : operation === "reset" ? clearDatabase(current.tables) : seedDatabase(current.tables);
    await expect(action).rejects.toThrow(/datos locales cambiaron/);
    expect((await db.classGroups.get("course"))?.name).toBe("Concurrent edit");
  });

  it("restores an unchanged database from the protected snapshot", async () => {
    const current = await buildCurrentPayload();
    await restoreDatabasePayload({ ...current, tables: { ...current.tables, classGroups: [] } }, current.tables);
    expect(await db.classGroups.count()).toBe(0);
  });
});
