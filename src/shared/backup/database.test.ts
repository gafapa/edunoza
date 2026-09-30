import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/database";
import { buildCurrentPayload, clearDatabase, restoreDatabasePayload, seedDatabase } from "./database";

beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await db.classGroups.put({ id: "course", name: "Original", level: "ESO", schoolYear: "2026-2027" });
});

describe("database replacement concurrency", () => {
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
