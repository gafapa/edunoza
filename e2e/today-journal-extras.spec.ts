import { expect, test } from "@playwright/test";

test("attaches a link to a journal entry in Hoy and it survives a reload", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    await db.classGroups.put({ id: "class-a", name: "1º ESO A · Simulado", level: "1º ESO", schoolYear: "2026/2027" });
    await db.subjects.put({ id: "subject-math", name: "Matemáticas", scheduleSlotIds: ["slot-1"] });
    await db.subjectCourseLinks.put({ id: "link-math", classId: "class-a", subjectId: "subject-math" });
    await db.scheduleDays.put({ id: "day-tue", dayOfWeek: 2, dayName: "Martes", enabled: true, blocks: [{ id: "slot-1", startTime: "09:00", endTime: "09:50" }] });
    await db.tasks.put({ id: "task-1", title: "Calentamiento", description: "", sessionCount: 1, sendToGradebook: false });
    await db.taskSubjectLinks.put({ id: "tsl-1", taskId: "task-1", subjectId: "subject-math" });
    await db.taskSessions.put({ id: "session-1", taskId: "task-1", subjectId: "subject-math", classId: "class-a", date: "2026-09-08", scheduleSlotId: "slot-1", status: "planned" });
    await db.students.put({ id: "student-1", classId: "class-a", firstName: "Alba", lastName: "Ejemplo", fullName: "Alba Ejemplo" });
    await db.subjectStudentLinks.put({ id: "ssl-1", studentId: "student-1", subjectId: "subject-math" });
  });

  await page.goto("/today?date=2026-09-08&classId=class-a");
  await page.locator(".today-slot-list").getByText("Calentamiento", { exact: true }).click();

  const resourceSection = page.locator(".resource-manager");
  await expect(resourceSection).toBeVisible();
  await expect(resourceSection.getByText("Todavía no hay recursos asociados.", { exact: true })).toBeVisible();

  await resourceSection.getByLabel("Título", { exact: true }).fill("Foto del mural");
  await resourceSection.getByLabel("URL", { exact: true }).fill("https://example.org/mural.jpg");
  await resourceSection.getByRole("button", { name: "Añadir recurso", exact: true }).click();

  await expect(resourceSection.getByText("Foto del mural", { exact: true })).toBeVisible();
  await expect(resourceSection.getByText("Enlace guardado.", { exact: true })).toBeVisible();

  const stored = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return db.resourceAttachments.toArray();
  });
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({
    ownerType: "journalEntry",
    ownerId: "class-a:subject-math:2026-09-08:slot-1:task-1",
    kind: "link",
    title: "Foto del mural",
    url: "https://example.org/mural.jpg"
  });

  await page.reload();
  await page.locator(".today-slot-list").getByText("Calentamiento", { exact: true }).click();
  await expect(page.locator(".resource-manager").getByText("Foto del mural", { exact: true })).toBeVisible();
});

test("logs a quick positive/negative behavior tap without requiring a save step", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    await db.classGroups.put({ id: "class-a", name: "1º ESO A · Simulado", level: "1º ESO", schoolYear: "2026/2027" });
    await db.subjects.put({ id: "subject-math", name: "Matemáticas", scheduleSlotIds: ["slot-1"] });
    await db.subjectCourseLinks.put({ id: "link-math", classId: "class-a", subjectId: "subject-math" });
    await db.scheduleDays.put({ id: "day-tue", dayOfWeek: 2, dayName: "Martes", enabled: true, blocks: [{ id: "slot-1", startTime: "09:00", endTime: "09:50" }] });
    await db.students.put({ id: "student-1", classId: "class-a", firstName: "Alba", lastName: "Ejemplo", fullName: "Alba Ejemplo" });
    await db.subjectStudentLinks.put({ id: "ssl-1", studentId: "student-1", subjectId: "subject-math" });
  });

  await page.goto("/today?date=2026-09-08&classId=class-a");
  await page.locator(".today-slot-list").getByText("Matemáticas", { exact: true }).click();

  const positiveButton = page.getByRole("button", { name: "Conducta positiva para Alba Ejemplo", exact: true });
  const negativeButton = page.getByRole("button", { name: "Conducta negativa para Alba Ejemplo", exact: true });
  await positiveButton.click();
  await positiveButton.click();
  await negativeButton.click();
  await expect(page.locator(".today-behavior-count")).toHaveText("+2 −1");

  const marks = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return db.behaviorMarks.toArray();
  });
  expect(marks).toHaveLength(3);
  expect(marks.filter((mark) => mark.kind === "positive")).toHaveLength(2);
  expect(marks.every((mark) => mark.studentId === "student-1" && mark.classId === "class-a" && mark.date === "2026-09-08")).toBe(true);

  await page.reload();
  await page.locator(".today-slot-list").getByText("Matemáticas", { exact: true }).click();
  await expect(page.locator(".today-behavior-count")).toHaveText("+2 −1");
});
