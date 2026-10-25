import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { db } from "../db/database";
import { importGroupedStudents } from "./groupedStudentsPersistence";
import type { ParsedStudentCsvGroup } from "./studentsCsv";

const group: ParsedStudentCsvGroup = {
  key: "synthetic-a", course: "ESO", group: "A", name: "Synthetic A",
  students: [{ sourceId: "synthetic-1", sourceRow: 2, firstName: "Synthetic", lastName: "Student", hasAcs: false, hasReinforcement: false }]
};
const input = { selectedGroups: [group], schoolYear: "2026-2027", existingCourses: [], existingStudents: [] };

beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); });
});
afterEach(() => vi.restoreAllMocks());

describe("grouped CSV transactional persistence", () => {
  it("serializes concurrent imports and rejects the stale review without duplicating records", async () => {
    const results = await Promise.allSettled([importGroupedStudents(input), importGroupedStudents(input)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason.message).toContain("han cambiado");
    expect(await db.classGroups.count()).toBe(1);
    expect(await db.students.count()).toBe(1);
  });

  it("does not recreate a deleted reviewed course", async () => {
    const course = { id: "course", name: group.name, level: "ESO", schoolYear: input.schoolYear };
    await expect(importGroupedStudents({ ...input, existingCourses: [course] })).rejects.toThrow("han cambiado");
    expect(await db.classGroups.count()).toBe(0);
    expect(await db.students.count()).toBe(0);
  });

  it("rolls back a newly created course when inserting its students fails", async () => {
    vi.spyOn(db.students, "bulkAdd").mockRejectedValueOnce(new Error("Simulated storage failure"));
    await expect(importGroupedStudents(input)).rejects.toThrow("storage failure");
    expect(await db.classGroups.count()).toBe(0);
    expect(await db.students.count()).toBe(0);
  });
});
