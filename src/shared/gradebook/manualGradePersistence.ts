import { db } from "../db/database";
import type { Assessment, GradeEntry } from "../db/types";

export type ManualGradeChange = {
  assessment: Assessment;
  studentId: string;
  expectedEntry?: GradeEntry;
  entry?: GradeEntry;
};

function sameRecord(left: object | undefined, right: object | undefined): boolean {
  const encode = (value: object | undefined) => value === undefined
    ? undefined : JSON.stringify(value, Object.keys(value).sort());
  return encode(left) === encode(right);
}

async function requireEditableAssessment(expected: Assessment): Promise<Assessment> {
  const assessment = await db.assessments.get(expected.id);
  if (!assessment || !sameRecord(assessment, expected)) {
    throw new Error("La prueba ha cambiado desde la revisión. Actualiza el cuaderno antes de guardar.");
  }
  if (assessment.academicPeriodId) {
    const period = await db.academicPeriods.get(assessment.academicPeriodId);
    if (!period || period.classId !== assessment.classId || period.status === "closed") {
      throw new Error("El periodo académico está cerrado o ya no es compatible. Revisa el cuaderno antes de guardar.");
    }
  }
  return assessment;
}

export async function saveManualAssessmentChange(expected: Assessment, next?: Assessment): Promise<void> {
  await db.transaction("rw", [db.assessments, db.academicPeriods, db.gradeEntries], async () => {
    const assessment = await requireEditableAssessment(expected);
    if (next) {
      if (next.id !== assessment.id || next.classId !== assessment.classId || next.subjectId !== assessment.subjectId ||
          next.academicPeriodId !== assessment.academicPeriodId) {
        throw new Error("El ámbito de la prueba ha cambiado. Actualiza el cuaderno antes de guardar.");
      }
      await db.assessments.put(next);
    } else {
      if (await db.gradeEntries.where("assessmentId").equals(assessment.id).count()) {
        throw new Error("No se puede eliminar una prueba que ya tiene notas.");
      }
      await db.assessments.delete(assessment.id);
    }
  });
}

/** Commit the reviewed grade cells atomically, including period and conflict checks. */
export async function saveManualGradeChanges(changes: ManualGradeChange[]): Promise<void> {
  await db.transaction("rw", [db.gradeEntries, db.assessments, db.academicPeriods, db.students], async () => {
    const seen = new Set<string>();
    for (const change of changes) {
      const key = JSON.stringify([change.assessment.id, change.studentId]);
      if (seen.has(key)) throw new Error("La misma nota aparece más de una vez en el cambio.");
      seen.add(key);
      const assessment = await requireEditableAssessment(change.assessment);
      const student = await db.students.get(change.studentId);
      if (!student || student.classId !== assessment.classId) {
        throw new Error("El alumno ya no pertenece al grupo de esta prueba.");
      }
      const entries = await db.gradeEntries.where("assessmentId").equals(assessment.id)
        .filter(entry => entry.studentId === change.studentId).toArray();
      if (entries.length > 1 || !sameRecord(entries[0], change.expectedEntry)) {
        throw new Error("La nota ha cambiado desde la revisión. Actualiza el cuaderno antes de guardar; no se ha sobrescrito.");
      }
      const entry = change.entry;
      if (entry) {
        if (entry.classId !== assessment.classId || entry.assessmentId !== assessment.id || entry.studentId !== student.id ||
          (change.expectedEntry && entry.id !== change.expectedEntry.id) ||
          (entry.numericValue !== undefined && (!Number.isFinite(entry.numericValue) || entry.numericValue < 0 || entry.numericValue > 10))) {
          throw new Error("La nota no es válida para esta prueba y alumno.");
        }
        const existingId = await db.gradeEntries.get(entry.id);
        if (existingId && existingId.id !== change.expectedEntry?.id) {
          throw new Error("El identificador de la nota ya está ocupado. Actualiza el cuaderno antes de guardar.");
        }
        await db.gradeEntries.put(entry);
      } else if (change.expectedEntry) {
        await db.gradeEntries.delete(change.expectedEntry.id);
      }
    }
  });
}
