import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { db } from "../db/database";
import { createLinkResource, journalEntryOwnerId, MAX_RESOURCE_FILE_BYTES, MAX_TOTAL_RESOURCE_BYTES } from "./resources";
import { getTotalResourceBytes, saveResourceAttachment } from "./storage";
import type { ResourceAttachment } from "../db/types";

beforeEach(async () => {
  await db.transaction("rw", db.tables, async () => { for (const table of db.tables) await table.clear(); });
  await db.students.put({ id: "student", classId: "course", personId: "person", firstName: "Synthetic", lastName: "Student", fullName: "Synthetic Student" });
});

function file(id: string, sizeBytes: number): ResourceAttachment {
  return { id, ownerType: "student", ownerId: "student", kind: "file", title: "Synthetic file", fileName: "file.txt", mimeType: "text/plain", sizeBytes, dataBase64: "", createdAt: "2026-09-30T00:00:00Z", updatedAt: "2026-09-30T00:00:00Z" };
}

it("serializes competing writes so only the remaining quota can be committed", async () => {
  // Quota checks use indexed metadata, independent of the fixture's file content.
  await db.resourceAttachments.bulkAdd(Array.from({ length: 4 }, (_, index) => file(`existing-${index}`, MAX_RESOURCE_FILE_BYTES - 1)));
  const results = await Promise.allSettled([saveResourceAttachment(file("first", 3)), saveResourceAttachment(file("second", 3))]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(await getTotalResourceBytes()).toBe(MAX_TOTAL_RESOURCE_BYTES - 1);
  expect(await db.resourceAttachments.count()).toBe(5);
});

it("rejects an attachment if its owner was deleted before commit", async () => {
  await db.students.delete("student");
  await expect(saveResourceAttachment(createLinkResource("student", "student", "Resource", "https://example.org"))).rejects.toThrow(/ya no existe/);
  expect(await db.resourceAttachments.count()).toBe(0);
});

it("checks the course, subject and task associations before attaching journal evidence", async () => {
  const ownerId = journalEntryOwnerId("course", "subject", "2026-09-30", "slot", "task");
  const resource = createLinkResource("journalEntry", ownerId, "Evidence", "https://example.org");
  await expect(saveResourceAttachment(resource)).rejects.toThrow(/ya no existe/);
  await db.classGroups.put({ id: "course", name: "Course", level: "ESO", schoolYear: "2026-2027" });
  await db.subjects.put({ id: "subject", name: "Subject", scheduleSlotIds: [] });
  await db.subjectCourseLinks.put({ id: "course-link", subjectId: "subject", classId: "course" });
  await db.tasks.put({ id: "task", title: "Task", description: "", sessionCount: 1, sendToGradebook: false });
  await db.taskSubjectLinks.put({ id: "task-link", taskId: "task", subjectId: "subject" });
  await saveResourceAttachment(resource);
  expect(await db.resourceAttachments.count()).toBe(1);
  await db.tasks.delete("task");
  await expect(saveResourceAttachment({ ...resource, id: "second" })).rejects.toThrow(/ya no existe/);
});
