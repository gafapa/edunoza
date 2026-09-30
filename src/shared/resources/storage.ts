import { db } from "../db/database";
import type { ResourceAttachment } from "../db/types";
import { MAX_TOTAL_RESOURCE_BYTES, formatFileSize, parseJournalEntryOwnerId } from "./resources";

export async function getTotalResourceBytes(): Promise<number> {
  const keys = await db.resourceAttachments.orderBy("[kind+sizeBytes]").keys();
  return keys.reduce<number>((total, key) => {
    const metadata = key as unknown;
    if (!Array.isArray(metadata) || metadata[0] !== "file" || typeof metadata[1] !== "number") return total;
    return total + metadata[1];
  }, 0);
}

export async function saveResourceAttachment(resource: ResourceAttachment): Promise<void> {
  await db.transaction("rw", [db.resourceAttachments, db.students, db.tasks, db.classGroups, db.subjects, db.subjectCourseLinks, db.taskSubjectLinks], async () => {
    if (resource.ownerType === "student" && !(await db.students.get(resource.ownerId))) throw new Error("El alumno ya no existe.");
    if (resource.ownerType === "task" && !(await db.tasks.get(resource.ownerId))) throw new Error("La tarea ya no existe.");
    if (resource.ownerType === "journalEntry") {
      const owner = parseJournalEntryOwnerId(resource.ownerId);
      if (!owner || !(await db.classGroups.get(owner.classId)) || !(await db.subjects.get(owner.subjectId)) ||
        !(await db.subjectCourseLinks.where("subjectId").equals(owner.subjectId).filter(row => row.classId === owner.classId).count()) ||
        (owner.taskId && (!(await db.tasks.get(owner.taskId)) || !(await db.taskSubjectLinks.where("taskId").equals(owner.taskId).filter(row => row.subjectId === owner.subjectId).count())))) {
        throw new Error("La clase o la tarea del registro ya no existe.");
      }
    }
    if (resource.kind === "file" && await getTotalResourceBytes() + (resource.sizeBytes ?? 0) > MAX_TOTAL_RESOURCE_BYTES) {
      throw new Error(`Los archivos guardados no pueden superar ${formatFileSize(MAX_TOTAL_RESOURCE_BYTES)} en total.`);
    }
    await db.resourceAttachments.add(resource);
  });
}
