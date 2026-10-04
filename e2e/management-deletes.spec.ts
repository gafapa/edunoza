import { expect, test, type Page } from "@playwright/test";

async function dismissBackupReminder(page: Page) {
  await page.evaluate(() => sessionStorage.setItem("profeplus_backup_reminder_dismissed", "1"));
}

test("deleting a course asks for confirmation and only deletes when accepted", async ({ page }) => {
  await page.goto("/management/courses");
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    await db.classGroups.put({ id: "class-solo", name: "Grupo sin vínculos", level: "1º ESO", schoolYear: "2026-2027" });
  });
  await dismissBackupReminder(page);
  await page.reload();
  await expect(page.getByText("Grupo sin vínculos", { exact: true })).toBeVisible();

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Eliminar Grupo sin vínculos", exact: true }).click();
  await expect(page.getByText("Grupo sin vínculos", { exact: true })).toBeVisible();

  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("Grupo sin vínculos");
    void dialog.accept();
  });
  await page.getByRole("button", { name: "Eliminar Grupo sin vínculos", exact: true }).click();
  await expect(page.getByText("Grupo sin vínculos", { exact: true })).toHaveCount(0);

  const remaining = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return db.classGroups.get("class-solo");
  });
  expect(remaining).toBeUndefined();
});

test("deleting a course with an academic period is blocked instead of orphaning it", async ({ page }) => {
  await page.goto("/management/courses");
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    const now = new Date().toISOString();
    await db.classGroups.put({ id: "class-period", name: "Grupo con periodo", level: "1º ESO", schoolYear: "2026-2027" });
    await db.academicPeriods.put({
      id: "period-del", classId: "class-period", name: "1ª evaluación", startDate: "2026-09-01", endDate: "2026-12-20",
      position: 0, status: "open", createdAt: now, updatedAt: now, closureVersion: 0
    });
  });
  await dismissBackupReminder(page);
  await page.reload();
  await expect(page.getByText("Grupo con periodo", { exact: true })).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Eliminar Grupo con periodo", exact: true }).click();
  await expect(page.getByText(/No se puede eliminar el curso porque tiene dependencias/)).toBeVisible();
  await expect(page.getByText(/periodos_academicos/)).toBeVisible();

  const stillThere = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return { course: await db.classGroups.get("class-period"), period: await db.academicPeriods.get("period-del") };
  });
  expect(stillThere.course).toBeDefined();
  expect(stillThere.period).toBeDefined();
});

test("deleting a subject asks for confirmation", async ({ page }) => {
  await page.goto("/management/subjects");
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    await db.classGroups.put({ id: "class-subj", name: "Grupo materia", level: "1º ESO", schoolYear: "2026-2027" });
    await db.subjects.put({ id: "subject-del", name: "Materia a borrar", scheduleSlotIds: [] });
    await db.subjectCourseLinks.put({ id: "link-subj", classId: "class-subj", subjectId: "subject-del" });
  });
  await dismissBackupReminder(page);
  await page.reload();
  await expect(page.getByText("Materia a borrar", { exact: true })).toBeVisible();

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Eliminar Materia a borrar", exact: true }).click();
  await expect(page.getByText("Materia a borrar", { exact: true })).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Eliminar Materia a borrar", exact: true }).click();
  await expect(page.getByText("Materia a borrar", { exact: true })).toHaveCount(0);

  const remaining = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return db.subjects.get("subject-del");
  });
  expect(remaining).toBeUndefined();
});

test("deleting a unit asks for confirmation", async ({ page }) => {
  await page.goto("/management/units");
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    await db.classGroups.put({ id: "class-unit", name: "Grupo unidad", level: "1º ESO", schoolYear: "2026-2027" });
    await db.subjects.put({ id: "subject-unit", name: "Materia unidad", scheduleSlotIds: [] });
    await db.subjectCourseLinks.put({ id: "link-unit", classId: "class-unit", subjectId: "subject-unit" });
    await db.unitBlocks.put({ id: "unit-del", subjectId: "subject-unit", name: "Unidad a borrar", description: "", sessionCount: 1, position: 0 });
  });
  await dismissBackupReminder(page);
  await page.reload();
  await expect(page.getByText("Unidad a borrar", { exact: true })).toBeVisible();

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Eliminar Unidad a borrar", exact: true }).click();
  await expect(page.getByText("Unidad a borrar", { exact: true })).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Eliminar Unidad a borrar", exact: true }).click();
  await expect(page.getByText("Unidad a borrar", { exact: true })).toHaveCount(0);

  const remaining = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return db.unitBlocks.get("unit-del");
  });
  expect(remaining).toBeUndefined();
});

test("deleting a task asks for confirmation and atomically removes the task and its subject link", async ({ page }) => {
  await page.goto("/management/tasks");
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    await db.classGroups.put({ id: "class-task", name: "Grupo tarea", level: "1º ESO", schoolYear: "2026-2027" });
    await db.subjects.put({ id: "subject-task", name: "Materia tarea", scheduleSlotIds: [] });
    await db.subjectCourseLinks.put({ id: "link-task", classId: "class-task", subjectId: "subject-task" });
    await db.tasks.put({ id: "task-del", title: "Tarea a borrar", description: "", sessionCount: 1, sendToGradebook: false });
    await db.taskSubjectLinks.put({ id: "tsl-del", taskId: "task-del", subjectId: "subject-task" });
  });
  await dismissBackupReminder(page);
  await page.reload();
  await expect(page.getByText("Tarea a borrar", { exact: true })).toBeVisible();

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Eliminar Tarea a borrar", exact: true }).click();
  await expect(page.getByText("Tarea a borrar", { exact: true })).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Eliminar Tarea a borrar", exact: true }).click();
  await expect(page.getByText("Tarea a borrar", { exact: true })).toHaveCount(0);

  const remaining = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return { task: await db.tasks.get("task-del"), links: await db.taskSubjectLinks.where("taskId").equals("task-del").toArray() };
  });
  expect(remaining.task).toBeUndefined();
  expect(remaining.links).toHaveLength(0);
});
