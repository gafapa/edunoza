import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/database";
import {
  assignAssessmentToAcademicPeriod, assignTaskConfigToAcademicPeriod, closeAcademicPeriod,
  createAcademicPeriod, reopenAcademicPeriod, rolloverSchoolYear, updateAcademicPeriod,
  updateManualAssessmentDate
} from "./periods";

beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await db.classGroups.put({ id: "course", name: "Synthetic course", level: "ESO", schoolYear: "2026-2027" });
  await db.students.put({ id: "student", classId: "course", firstName: "Synthetic", lastName: "Student", fullName: "Synthetic Student" });
});
afterEach(() => vi.restoreAllMocks());

describe("persisted academic closure integrity", () => {
  const draft = { name: "Term 1", startDate: "2026-09-01", endDate: "2026-12-20" };

  it("serializes concurrent period creation so only one overlapping draft is saved", async () => {
    const results = await Promise.allSettled([
      createAcademicPeriod("course", draft),
      createAcademicPeriod("course", { ...draft, name: "Other term" })
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: expect.objectContaining({ message: expect.stringMatching(/overlap/) }) });
    expect(await db.academicPeriods.count()).toBe(1);
  });

  it("does not create a period for a deleted class", async () => {
    await expect(createAcademicPeriod("deleted-course", draft)).rejects.toThrow(/class no longer exists/);
    expect(await db.academicPeriods.count()).toBe(0);
  });

  it("keeps a concurrent closure and its snapshot when period metadata is edited", async () => {
    const period = await createAcademicPeriod("course", draft);
    await Promise.all([
      updateAcademicPeriod(period.id, { ...draft, name: "Reviewed term" }),
      closeAcademicPeriod(period.id)
    ]);
    const saved = await db.academicPeriods.get(period.id);
    expect(saved).toMatchObject({ status: "closed", name: "Reviewed term", closureVersion: 1 });
    expect(await db.gradebookPeriodSnapshots.get(saved!.currentSnapshotId!)).toBeDefined();
  });

  it("rejects period date changes that would invalidate existing assessment dates", async () => {
    const period = await createAcademicPeriod("course", draft);
    await db.assessments.put({ id: "assessment", classId: "course", subjectId: "subject", title: "Synthetic exam", weight: 1, period: draft.name, academicPeriodId: period.id, assessmentDate: "2026-12-10" });
    await expect(updateAcademicPeriod(period.id, { ...draft, endDate: "2026-11-30" })).rejects.toThrow(/include the dates/);
    expect(await db.academicPeriods.get(period.id)).toEqual(period);
    await updateAcademicPeriod(period.id, { ...draft, name: "Renamed term" });
    expect((await db.assessments.get("assessment"))?.assessmentDate).toBe("2026-12-10");
  });

  it("does not silently detach evidence from a missing academic period", async () => {
    await db.assessments.put({ id: "assessment", classId: "course", subjectId: "subject", title: "Synthetic exam", weight: 1, period: draft.name, academicPeriodId: "missing-period", assessmentDate: "2026-10-01" });
    await db.taskGradebookConfigs.put({ id: "config", classId: "course", subjectId: "subject", taskId: "task", gradebookWeight: 1, academicPeriodId: "missing-period" });
    await expect(assignAssessmentToAcademicPeriod("assessment")).rejects.toThrow(/not found/);
    await expect(assignTaskConfigToAcademicPeriod("config")).rejects.toThrow(/not found/);
    await expect(updateManualAssessmentDate("assessment", "2026-10-02")).rejects.toThrow(/no longer exists/);
    expect((await db.assessments.get("assessment"))?.academicPeriodId).toBe("missing-period");
    expect((await db.taskGradebookConfigs.get("config"))?.academicPeriodId).toBe("missing-period");
  });

  it("assigns open evidence and keeps date edits inside the assigned period", async () => {
    const period = await createAcademicPeriod("course", draft);
    await db.assessments.put({ id: "assessment", classId: "course", subjectId: "subject", title: "Synthetic exam", weight: 1, period: "", assessmentDate: "2026-01-01" });
    await db.taskGradebookConfigs.put({ id: "config", classId: "course", subjectId: "subject", taskId: "task", gradebookWeight: 1 });
    await assignAssessmentToAcademicPeriod("assessment", period.id);
    await assignTaskConfigToAcademicPeriod("config", period.id);
    expect((await db.assessments.get("assessment"))?.assessmentDate).toBe(period.endDate);
    await updateManualAssessmentDate("assessment", "2026-10-02");
    await expect(updateManualAssessmentDate("assessment", "2027-01-01")).rejects.toThrow(/inside/);
    await closeAcademicPeriod(period.id);
    await expect(assignTaskConfigToAcademicPeriod("config")).rejects.toThrow(/Reopen/);
    expect((await db.taskGradebookConfigs.get("config"))?.academicPeriodId).toBe(period.id);
  });

  it("checks rollover target emptiness in the transaction and rejects concurrent duplication", async () => {
    await db.classGroups.put({ id: "target", name: "Next course", level: "ESO", schoolYear: "2027-2028" });
    const request = { sourceClassId: "course", targetClassId: "target", targetName: "", targetSchoolYear: "" };
    const results = await Promise.allSettled([rolloverSchoolYear(request), rolloverSchoolYear(request)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: expect.objectContaining({ message: expect.stringMatching(/empty class/) }) });
    expect(await db.students.where("classId").equals("target").count()).toBe(1);
    expect(await db.students.where("classId").equals("course").count()).toBe(1);
  });

  it("rolls back the new rollover class when a structural insert fails", async () => {
    vi.spyOn(db.students, "bulkAdd").mockRejectedValueOnce(new Error("Simulated rollover storage failure"));
    await expect(rolloverSchoolYear({ sourceClassId: "course", targetName: "Next course", targetSchoolYear: "2027-2028" })).rejects.toThrow(/storage failure/);
    expect(await db.classGroups.count()).toBe(1);
    expect(await db.students.count()).toBe(1);
  });

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
