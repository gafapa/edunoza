import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/database";
import type { Assessment, GradeEntry } from "../db/types";
import { saveManualAssessmentChange, saveManualGradeChanges } from "./manualGradePersistence";

const assessment: Assessment = { id: "exam", classId: "course", subjectId: "subject", title: "Synthetic exam", weight: 1, period: "", academicPeriodId: "term" };
const grade: GradeEntry = { id: "grade", classId: "course", assessmentId: assessment.id, studentId: "student", numericValue: 6, comment: "Original" };
const change = { assessment, studentId: grade.studentId, expectedEntry: grade, entry: { ...grade, numericValue: 8 } };

beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await db.assessments.put(assessment);
  await db.students.put({ id: grade.studentId, classId: "course", firstName: "Synthetic", lastName: "Student", fullName: "Synthetic Student" });
  await db.academicPeriods.put({ id: "term", classId: "course", name: "Term", startDate: "2026-09-01", endDate: "2026-12-31", status: "open", position: 0, closureVersion: 0, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" });
  await db.gradeEntries.put(grade);
});

describe("manual grade transactional persistence", () => {
  it("updates and deletes a reviewed grade without changing its identity", async () => {
    await saveManualGradeChanges([change]);
    expect(await db.gradeEntries.get(grade.id)).toEqual(change.entry);
    await saveManualGradeChanges([{ ...change, expectedEntry: change.entry, entry: undefined }]);
    expect(await db.gradeEntries.count()).toBe(0);
  });

  it("rejects a closure that happened after the grade was reviewed", async () => {
    await db.academicPeriods.update("term", { status: "closed" });
    await expect(saveManualGradeChanges([change])).rejects.toThrow("cerrado");
    expect(await db.gradeEntries.get(grade.id)).toEqual(grade);
  });

  it("rolls back a batch when another writer changed a later grade", async () => {
    const other = { ...grade, id: "other-grade", studentId: "other-student" };
    await db.students.put({ id: other.studentId, classId: "course", firstName: "Other", lastName: "Student", fullName: "Other Student" });
    await db.gradeEntries.put({ ...other, comment: "Concurrent note" });
    await expect(saveManualGradeChanges([change, { ...change, studentId: other.studentId, expectedEntry: other, entry: { ...other, numericValue: 9 } }])).rejects.toThrow("ha cambiado");
    expect(await db.gradeEntries.get(grade.id)).toEqual(grade);
    expect((await db.gradeEntries.get(other.id))?.comment).toBe("Concurrent note");
  });

  it("rejects stale deletion and changed assessment scope", async () => {
    await db.gradeEntries.update(grade.id, { numericValue: 9 });
    await expect(saveManualGradeChanges([{ ...change, entry: undefined }])).rejects.toThrow("ha cambiado");
    await db.assessments.update(assessment.id, { classId: "another-course" });
    await expect(saveManualGradeChanges([change])).rejects.toThrow("prueba ha cambiado");
    expect((await db.gradeEntries.get(grade.id))?.numericValue).toBe(9);
  });

  it("does not recreate a grade inserted by another writer since review", async () => {
    await expect(saveManualGradeChanges([{ ...change, expectedEntry: undefined }])).rejects.toThrow("ha cambiado");
    expect(await db.gradeEntries.count()).toBe(1);
  });

  it("protects assessment edits from closure and deletion from existing grades", async () => {
    await expect(saveManualAssessmentChange(assessment)).rejects.toThrow("ya tiene notas");
    await db.academicPeriods.update("term", { status: "closed" });
    await expect(saveManualAssessmentChange(assessment, { ...assessment, title: "Updated" })).rejects.toThrow("cerrado");
    expect(await db.assessments.get(assessment.id)).toEqual(assessment);
  });

  it("updates an open assessment and can delete it once it has no grades", async () => {
    const next = { ...assessment, title: "Updated" };
    await saveManualAssessmentChange(assessment, next);
    await expect(saveManualAssessmentChange(assessment, { ...assessment, title: "Stale" })).rejects.toThrow("ha cambiado");
    await db.gradeEntries.clear();
    await saveManualAssessmentChange(next);
    expect(await db.assessments.count()).toBe(0);
  });
});
