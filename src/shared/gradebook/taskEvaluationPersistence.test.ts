import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/database";
import { closeAcademicPeriod, createAcademicPeriod } from "../academic/periods";
import type { TaskGradebookConfig } from "../db/types";
import { saveTaskEvaluationChanges } from "./taskEvaluationPersistence";

const scope = { taskId: "task", subjectId: "subject", classId: "course" };
const config: TaskGradebookConfig = { id: "config", ...scope, gradebookWeight: 1, directGradeEnabled: true };
const grade = { id: "grade", ...scope, studentId: "student", score: 8 };

beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
  await db.classGroups.put({ id: scope.classId, name: "Synthetic course", level: "ESO", schoolYear: "2026-2027" });
  await db.taskGradebookConfigs.put(config);
  await db.taskDirectGrades.put(grade);
});

const saveGrade = (expected = config) => saveTaskEvaluationChanges(scope, expected, async () => {
  await db.taskDirectGrades.put({ ...grade, score: 4 });
});

describe("task evaluation transactional persistence", () => {
  it("saves open task evidence and rolls back every write on a storage failure", async () => {
    await saveGrade();
    expect((await db.taskDirectGrades.get(grade.id))?.score).toBe(4);
    await expect(saveTaskEvaluationChanges(scope, config, async () => {
      await db.taskDirectGrades.delete(grade.id);
      throw new Error("Simulated storage failure");
    })).rejects.toThrow(/storage failure/);
    expect((await db.taskDirectGrades.get(grade.id))?.score).toBe(4);
  });

  it("rejects stale configuration and configuration deletion without erasing evidence", async () => {
    await db.taskGradebookConfigs.update(config.id, { directGradeEnabled: false });
    await expect(saveGrade()).rejects.toThrow(/ha cambiado/);
    await db.taskGradebookConfigs.delete(config.id);
    await expect(saveGrade()).rejects.toThrow(/ha cambiado/);
    expect(await db.taskDirectGrades.get(grade.id)).toEqual(grade);
  });

  it("allows comments on an unconfigured task but rejects a new configuration since review", async () => {
    await db.taskGradebookConfigs.delete(config.id);
    await saveTaskEvaluationChanges(scope, undefined, async () => {
      await db.taskStudentComments.add({ id: "comment", ...scope, studentId: "student", date: "2026-10-01", scheduleSlotId: "slot", comment: "Synthetic comment" });
    });
    await db.taskGradebookConfigs.add(config);
    await expect(saveTaskEvaluationChanges(scope, undefined, async () => {
      await db.taskStudentComments.clear();
    })).rejects.toThrow(/ha cambiado/);
    expect(await db.taskStudentComments.count()).toBe(1);
  });

  it("rejects a concurrent closure without changing the saved grade or snapshot", async () => {
    const period = await createAcademicPeriod(scope.classId, { name: "Term 1", startDate: "2026-09-01", endDate: "2026-12-20" });
    const assigned = { ...config, academicPeriodId: period.id };
    await db.taskGradebookConfigs.put(assigned);
    const [closure, save] = await Promise.allSettled([closeAcademicPeriod(period.id), saveGrade(assigned)]);
    expect(closure.status).toBe("fulfilled");
    expect(save).toMatchObject({ status: "rejected", reason: expect.objectContaining({ message: expect.stringMatching(/Reabre/) }) });
    expect(await db.taskDirectGrades.get(grade.id)).toEqual(grade);
    expect((await db.gradebookPeriodSnapshots.toArray())[0].data.taskDirectGrades[0]).toEqual(grade);
  });

  it("rejects missing and foreign periods without changing evidence", async () => {
    const assigned = { ...config, academicPeriodId: "missing" };
    await db.taskGradebookConfigs.put(assigned);
    await expect(saveGrade(assigned)).rejects.toThrow(/periodo académico/);
    await db.academicPeriods.put({ id: "missing", classId: "other-course", name: "Other term", startDate: "2026-09-01", endDate: "2026-12-20", status: "open", position: 0, closureVersion: 0, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" });
    await expect(saveGrade(assigned)).rejects.toThrow(/periodo académico/);
    expect(await db.taskDirectGrades.get(grade.id)).toEqual(grade);
  });
});
