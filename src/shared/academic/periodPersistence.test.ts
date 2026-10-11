import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/database";
import { assignAssessmentToAcademicPeriod, closeAcademicPeriod, createAcademicPeriod, reopenAcademicPeriod, updateManualAssessmentDate } from "./periods";

beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await db.classGroups.put({ id: "course", name: "Synthetic course", level: "ESO", schoolYear: "2026-2027" });
  await db.students.put({ id: "student", classId: "course", firstName: "Synthetic", lastName: "Student", fullName: "Synthetic Student" });
});
afterEach(() => vi.restoreAllMocks());

describe("persisted academic closure integrity", () => {
  it("preserves immutable evidence across closure, reopening and another closure", async () => {
    const period = await createAcademicPeriod("course", { name: "Term 1", startDate: "2026-09-01", endDate: "2026-12-20" });
    await db.assessments.put({ id: "assessment", classId: "course", subjectId: "subject", title: "Synthetic exam", weight: 1, period: "Term 1", academicPeriodId: period.id, assessmentDate: "2026-10-01" });
    await db.gradeEntries.put({ id: "grade", classId: "course", assessmentId: "assessment", studentId: "student", numericValue: 8 });
    const first = await closeAcademicPeriod(period.id);
    await expect(closeAcademicPeriod(period.id)).rejects.toThrow(/already closed/);
    await expect(assignAssessmentToAcademicPeriod("assessment")).rejects.toThrow(/Reopen/);
    await expect(updateManualAssessmentDate("assessment", "2026-10-02")).rejects.toThrow(/Reopen/);
    await reopenAcademicPeriod(period.id);
    await db.gradeEntries.update("grade", { numericValue: 3 });
    const second = await closeAcademicPeriod(period.id);
    expect(second.version).toBe(2);
    expect(second.data.gradeEntries[0].numericValue).toBe(3);
    expect((await db.gradebookPeriodSnapshots.get(first.id))?.data.gradeEntries[0].numericValue).toBe(8);
    expect(await db.gradebookPeriodSnapshots.count()).toBe(2);
  });
  it("rolls back the snapshot when saving the closed period fails", async () => {
    const period = await createAcademicPeriod("course", { name: "Term 1", startDate: "2026-09-01", endDate: "2026-12-20" });
    vi.spyOn(Object.getPrototypeOf(db.academicPeriods), "put").mockRejectedValueOnce(new Error("Simulated storage failure"));
    await expect(closeAcademicPeriod(period.id)).rejects.toThrow(/storage failure/);
    expect((await db.academicPeriods.get(period.id))?.status).toBe("open");
    expect(await db.gradebookPeriodSnapshots.count()).toBe(0);
  });
});
