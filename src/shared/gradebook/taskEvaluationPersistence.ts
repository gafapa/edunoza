import { db } from "../db/database";
import type { TaskGradebookConfig } from "../db/types";

type TaskEvaluationScope = Pick<TaskGradebookConfig, "taskId" | "subjectId" | "classId">;

/** Call within the write transaction, including task configurations and periods. */
export async function requireEditableTaskGradebookConfig(
  scope: TaskEvaluationScope,
  expectedConfig: TaskGradebookConfig | undefined
): Promise<void> {
  const configs = await db.taskGradebookConfigs.where("[taskId+subjectId+classId]")
    .equals([scope.taskId, scope.subjectId, scope.classId]).toArray();
  const encode = (config: TaskGradebookConfig | undefined) => config &&
    JSON.stringify(config, Object.keys(config).sort());
  if (configs.length > 1 || encode(configs[0]) !== encode(expectedConfig)) {
    throw new Error("La configuración de evaluación ha cambiado. Actualiza la tarea antes de guardar.");
  }
  const config = configs[0];
  if (config?.academicPeriodId) {
    const period = await db.academicPeriods.get(config.academicPeriodId);
    if (!period || period.classId !== scope.classId || period.status === "closed") {
      throw new Error("Reabre el periodo académico y comprueba su grupo para modificar esta evaluación.");
    }
  }
}

/** Keep configuration, closure checks and evidence writes in the same transaction. */
export async function saveTaskEvaluationChanges(
  scope: TaskEvaluationScope,
  expectedConfig: TaskGradebookConfig | undefined,
  writeChanges: () => Promise<void>
): Promise<void> {
  await db.transaction("rw", [
    db.academicPeriods, db.taskGradebookConfigs, db.taskStudentComments,
    db.taskDailyEvaluationSettings, db.taskRubricAssessments,
    db.taskChecklistAssessments, db.taskDirectGrades
  ], async () => {
    await requireEditableTaskGradebookConfig(scope, expectedConfig);
    await writeChanges();
  });
}
