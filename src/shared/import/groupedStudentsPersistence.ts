import { db } from "../db/database";
import { prepareGroupedStudentsImport } from "./groupedStudentsImport";

type GroupedStudentsImportInput = Parameters<typeof prepareGroupedStudentsImport>[0];

/** Revalidate the reviewed additions inside the same transaction that saves them. */
export async function importGroupedStudents(input: Omit<GroupedStudentsImportInput, "createId">) {
  const reviewedPlan = () => {
    let nextId = 0;
    return prepareGroupedStudentsImport({ ...input, createId: () => `review-${nextId++}` });
  };
  const expectedPlan = JSON.stringify(reviewedPlan());
  return db.transaction("rw", db.classGroups, db.students, async () => {
    const [existingCourses, existingStudents] = await Promise.all([
      db.classGroups.toArray(), db.students.toArray()
    ]);
    let nextId = 0;
    const currentInput = { ...input, existingCourses, existingStudents };
    const currentPlan = prepareGroupedStudentsImport({ ...currentInput, createId: () => `review-${nextId++}` });
    if (JSON.stringify(currentPlan) !== expectedPlan) {
      throw new Error("Los grupos o el alumnado han cambiado desde la revisión. Actualiza la pantalla y revisa el CSV antes de importar.");
    }
    const plan = prepareGroupedStudentsImport(currentInput);
    if (plan.coursesToAdd.length) await db.classGroups.bulkAdd(plan.coursesToAdd);
    if (plan.studentsToAdd.length) await db.students.bulkAdd(plan.studentsToAdd);
    return plan;
  });
}
