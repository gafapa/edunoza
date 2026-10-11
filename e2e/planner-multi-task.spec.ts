import { expect, test, type Page } from "@playwright/test";

async function seedBase(page: Page) {
  await page.goto("/");
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    await db.classGroups.put({ id: "class-a", name: "1º ESO A · Simulado", level: "1º ESO", schoolYear: "2026/2027" });
    await db.subjects.put({ id: "subject-math", name: "Matemáticas", scheduleSlotIds: ["slot-1", "slot-2"] });
    await db.subjects.put({ id: "subject-lang", name: "Lengua", scheduleSlotIds: ["slot-1"] });
    await db.subjectCourseLinks.put({ id: "link-math", classId: "class-a", subjectId: "subject-math" });
    await db.subjectCourseLinks.put({ id: "link-lang", classId: "class-a", subjectId: "subject-lang" });
    await db.scheduleDays.put({ id: "day-tue", dayOfWeek: 2, dayName: "Martes", enabled: true, blocks: [{ id: "slot-1", startTime: "09:00", endTime: "09:50" }] });
    await db.scheduleDays.put({ id: "day-wed", dayOfWeek: 3, dayName: "Miércoles", enabled: true, blocks: [{ id: "slot-2", startTime: "09:00", endTime: "09:50" }] });
    await db.tasks.put({ id: "task-1", title: "Calentamiento", description: "", sessionCount: 1, sendToGradebook: false });
    await db.tasks.put({ id: "task-2", title: "Tarea principal", description: "", sessionCount: 1, sendToGradebook: false });
    await db.tasks.put({ id: "task-lang", title: "Lectura", description: "", sessionCount: 1, sendToGradebook: false });
    await db.taskSubjectLinks.put({ id: "tsl-1", taskId: "task-1", subjectId: "subject-math" });
    await db.taskSubjectLinks.put({ id: "tsl-2", taskId: "task-2", subjectId: "subject-math" });
    await db.taskSubjectLinks.put({ id: "tsl-lang", taskId: "task-lang", subjectId: "subject-lang" });
    await db.students.put({ id: "student-1", classId: "class-a", firstName: "Alba", lastName: "Ejemplo", fullName: "Alba Ejemplo" });
    await db.subjectStudentLinks.put({ id: "ssl-1", studentId: "student-1", subjectId: "subject-math" });
  });
}

test("stacks a second same-subject task onto an occupied slot and Hoy lists both separately", async ({ page }) => {
  await seedBase(page);
  await page.goto("/planner?date=2026-09-08&classId=class-a&subjectId=subject-math");

  await page.getByRole("button", { name: "Programar tarea el 8 de septiembre de 2026, 09:00 - 09:50", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Tarea")).toHaveValue("task-1");
  await dialog.getByRole("button", { name: "Programar sesión", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Sesión guardada.", { exact: true })).toBeVisible();
  await expect(page.getByText("Calentamiento", { exact: true })).toBeVisible();

  const addTaskButton = page.getByRole("button", { name: "Añadir otra tarea el 8 de septiembre de 2026, 09:00 - 09:50", exact: true });
  await expect(addTaskButton).toBeVisible();
  await addTaskButton.click();
  await expect(dialog.getByLabel("Tarea")).toHaveValue("task-2");
  await dialog.getByRole("button", { name: "Programar sesión", exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByText("Calentamiento", { exact: true })).toBeVisible();
  await expect(page.getByText("Tarea principal", { exact: true })).toBeVisible();

  const sessions = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return db.taskSessions.toArray();
  });
  expect(sessions).toHaveLength(2);
  expect(sessions.map((session) => session.taskId).sort()).toEqual(["task-1", "task-2"]);

  await page.goto("/today?date=2026-09-08&classId=class-a");
  const slotList = page.locator(".today-slot-list");
  await expect(slotList.getByText("Calentamiento", { exact: true })).toBeVisible();
  await expect(slotList.getByText("Tarea principal", { exact: true })).toBeVisible();

  await slotList.getByText("Calentamiento", { exact: true }).click();
  await expect(page.locator(".today-session-card p")).toHaveText("Calentamiento");
  await slotList.getByText("Tarea principal", { exact: true }).click();
  await expect(page.locator(".today-session-card p")).toHaveText("Tarea principal");
});

test("still rejects a different subject sharing the same class period", async ({ page }) => {
  await seedBase(page);
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    await db.taskSessions.put({ id: "session-math", taskId: "task-1", subjectId: "subject-math", classId: "class-a", date: "2026-09-08", scheduleSlotId: "slot-1", status: "planned" });
  });

  await page.goto("/planner?date=2026-09-08&classId=class-a&subjectId=subject-lang");
  await expect(page.getByText("Bloqueado por otra asignatura en esta franja.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Programar tarea el 8 de septiembre de 2026/ })).toHaveCount(0);
});

test("reassigning a task on a session with recorded data warns before replacing it", async ({ page }) => {
  await seedBase(page);
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    await db.taskSessions.put({ id: "session-1", taskId: "task-1", subjectId: "subject-math", classId: "class-a", date: "2026-09-08", scheduleSlotId: "slot-1", status: "planned" });
    await db.taskDailyEvaluationSettings.put({ id: "setting-1", taskId: "task-1", subjectId: "subject-math", classId: "class-a", date: "2026-09-08", scheduleSlotId: "slot-1", generalComment: "Buen trabajo" });
  });

  await page.goto("/planner?date=2026-09-08&classId=class-a&subjectId=subject-math");
  await page.getByText("Calentamiento", { exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Editar sesión" });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Tarea").selectOption("task-2");
  await expect(dialog.getByText(/comentarios o evaluación guardados/)).toBeVisible();
  await dialog.getByRole("button", { name: "Guardar sesión", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Sesión guardada.", { exact: true })).toBeVisible();

  const records = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return { sessions: await db.taskSessions.toArray(), settings: await db.taskDailyEvaluationSettings.toArray() };
  });
  expect(records.sessions).toHaveLength(1);
  expect(records.sessions[0]).toMatchObject({ taskId: "task-2" });
  expect(records.settings).toHaveLength(1);
});

test("removing a session with recorded data shows a warning and proceeds without a second prompt", async ({ page }) => {
  await seedBase(page);
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    await db.taskSessions.put({ id: "session-1", taskId: "task-1", subjectId: "subject-math", classId: "class-a", date: "2026-09-08", scheduleSlotId: "slot-1", status: "planned" });
    await db.taskDailyEvaluationSettings.put({ id: "setting-1", taskId: "task-1", subjectId: "subject-math", classId: "class-a", date: "2026-09-08", scheduleSlotId: "slot-1", generalComment: "Buen trabajo" });
  });

  await page.goto("/planner?date=2026-09-08&classId=class-a&subjectId=subject-math");
  await page.getByText("Calentamiento", { exact: true }).click();
  await page.getByRole("dialog", { name: "Editar sesión" }).getByRole("button", { name: "Quitar", exact: true }).click();

  const removeDialog = page.getByRole("dialog", { name: "Quitar sesión del Planificador" });
  await expect(removeDialog).toBeVisible();
  await expect(removeDialog.getByText(/comentarios o evaluación guardados/)).toBeVisible();
  await removeDialog.getByRole("button", { name: "Quitar sesión", exact: true }).click();
  await expect(removeDialog).toBeHidden();
  await expect(page.getByText("Sesión eliminada.", { exact: true })).toBeVisible();

  const records = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return { sessions: await db.taskSessions.toArray(), settings: await db.taskDailyEvaluationSettings.toArray() };
  });
  expect(records.sessions).toHaveLength(0);
  expect(records.settings).toHaveLength(1);

  await page.goto("/config/database");
  await page.locator("summary").filter({ hasText: "Comprobaciones" }).click();
  await page.getByRole("button", { name: "Verificar datos actuales", exact: true }).click();
  await expect(page.getByText("Integridad verificada: no se han encontrado referencias rotas.", { exact: true })).toBeVisible();
});

test("rescheduling a session with recorded data warns inline and proceeds without a second prompt", async ({ page }) => {
  await seedBase(page);
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    await db.taskSessions.put({ id: "session-1", taskId: "task-1", subjectId: "subject-math", classId: "class-a", date: "2026-09-08", scheduleSlotId: "slot-1", status: "planned" });
    await db.taskDailyEvaluationSettings.put({ id: "setting-1", taskId: "task-1", subjectId: "subject-math", classId: "class-a", date: "2026-09-08", scheduleSlotId: "slot-1", generalComment: "Buen trabajo" });
  });

  await page.goto("/planner?date=2026-09-08&classId=class-a&subjectId=subject-math");
  await page.getByText("Calentamiento", { exact: true }).click();
  await page.getByRole("dialog", { name: "Editar sesión" }).getByRole("button", { name: "Reprogramar", exact: true }).click();

  const rescheduleDialog = page.getByRole("dialog", { name: "Reprogramar sesión" });
  await expect(rescheduleDialog).toBeVisible();
  await expect(rescheduleDialog.getByText(/comentarios o evaluación guardados/)).toBeVisible();
  await rescheduleDialog.locator('input[type="date"]').fill("2026-09-09");
  await expect(rescheduleDialog.getByLabel("Franja")).toHaveValue("slot-2");
  await rescheduleDialog.getByRole("button", { name: "Reprogramar sesión", exact: true }).click();
  await expect(rescheduleDialog).toBeHidden();
  await expect(page.getByText("Sesión reprogramada.", { exact: true })).toBeVisible();

  const sessions = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return db.taskSessions.toArray();
  });
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({ date: "2026-09-09", scheduleSlotId: "slot-2", status: "moved" });
});

test("rescheduling a session onto a slot that already has the same task is blocked", async ({ page }) => {
  await seedBase(page);
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    await db.taskSessions.put({ id: "session-1", taskId: "task-1", subjectId: "subject-math", classId: "class-a", date: "2026-09-08", scheduleSlotId: "slot-1", status: "planned" });
    await db.taskSessions.put({ id: "session-2", taskId: "task-1", subjectId: "subject-math", classId: "class-a", date: "2026-09-09", scheduleSlotId: "slot-2", status: "planned" });
  });

  await page.goto("/planner?date=2026-09-08&classId=class-a&subjectId=subject-math");
  await page.getByText("Calentamiento", { exact: true }).first().click();
  await page.getByRole("dialog", { name: "Editar sesión" }).getByRole("button", { name: "Reprogramar", exact: true }).click();

  const rescheduleDialog = page.getByRole("dialog", { name: "Reprogramar sesión" });
  await expect(rescheduleDialog).toBeVisible();
  await rescheduleDialog.locator('input[type="date"]').fill("2026-09-09");
  await expect(rescheduleDialog.getByLabel("Franja")).toHaveValue("slot-2");
  await rescheduleDialog.getByRole("button", { name: "Reprogramar sesión", exact: true }).click();
  await expect(rescheduleDialog.getByText("Esa tarea ya está programada en el bloque destino.", { exact: true })).toBeVisible();
  await expect(rescheduleDialog).toBeVisible();

  const sessions = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return db.taskSessions.toArray();
  });
  expect(sessions.find((item) => item.id === "session-1")).toMatchObject({ date: "2026-09-08", scheduleSlotId: "slot-1" });
  expect(sessions.find((item) => item.id === "session-2")).toMatchObject({ date: "2026-09-09", scheduleSlotId: "slot-2" });
});

test("dragging a session with recorded data onto another slot warns and proceeds only on confirm", async ({ page }) => {
  await seedBase(page);
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    await db.taskSessions.put({ id: "session-1", taskId: "task-1", subjectId: "subject-math", classId: "class-a", date: "2026-09-08", scheduleSlotId: "slot-1", status: "planned" });
    await db.taskDailyEvaluationSettings.put({ id: "setting-1", taskId: "task-1", subjectId: "subject-math", classId: "class-a", date: "2026-09-08", scheduleSlotId: "slot-1", generalComment: "Buen trabajo" });
  });

  await page.goto("/planner?date=2026-09-08&classId=class-a&subjectId=subject-math");
  const sourceCard = page.getByText("Calentamiento", { exact: true });
  const targetCell = page.getByRole("button", { name: "Programar tarea el 9 de septiembre de 2026, 09:00 - 09:50", exact: true });
  await sourceCard.dragTo(targetCell);

  const dragDialog = page.getByRole("dialog", { name: "Mover sesión" });
  await expect(dragDialog).toBeVisible();
  await expect(dragDialog.getByText(/comentarios o evaluación guardados/)).toBeVisible();

  await dragDialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(dragDialog).toBeHidden();

  let sessions = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return db.taskSessions.toArray();
  });
  expect(sessions[0]).toMatchObject({ date: "2026-09-08", scheduleSlotId: "slot-1" });

  await sourceCard.dragTo(targetCell);
  await expect(dragDialog).toBeVisible();
  await dragDialog.getByRole("button", { name: "Mover sesión", exact: true }).click();
  await expect(dragDialog).toBeHidden();
  await expect(page.getByText("Sesión reprogramada.", { exact: true })).toBeVisible();

  sessions = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return db.taskSessions.toArray();
  });
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({ date: "2026-09-09", scheduleSlotId: "slot-2", status: "moved" });
});

test("closing one stacked task's class does not ask to retake attendance for the other", async ({ page }) => {
  await seedBase(page);
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    await db.taskSessions.put({ id: "session-1", taskId: "task-1", subjectId: "subject-math", classId: "class-a", date: "2026-09-08", scheduleSlotId: "slot-1", status: "planned" });
    await db.taskSessions.put({ id: "session-2", taskId: "task-2", subjectId: "subject-math", classId: "class-a", date: "2026-09-08", scheduleSlotId: "slot-1", status: "planned" });
  });

  await page.goto("/today?date=2026-09-08&classId=class-a");
  const slotList = page.locator(".today-slot-list");
  await expect(slotList.getByText("Calentamiento", { exact: true })).toBeVisible();
  await expect(slotList.getByText("Tarea principal", { exact: true })).toBeVisible();

  await slotList.getByText("Calentamiento", { exact: true }).click();
  await page.getByRole("button", { name: "Ausente para Alba Ejemplo", exact: true }).click();
  const closeButton = page.locator(".today-close-session");
  await expect(closeButton).toHaveText("Confirmar y cerrar clase");
  await closeButton.click();
  await expect(closeButton).toHaveText("Clase guardada");
  await expect(closeButton).toBeDisabled();

  await slotList.getByText("Tarea principal", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Ausente para Alba Ejemplo", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(closeButton).toHaveText("Guardar registro de esta tarea");
  await expect(closeButton).toBeEnabled();
  await expect(page.getByText("La asistencia de esta hora ya está guardada.", { exact: false })).toBeVisible();

  await closeButton.click();
  await expect(closeButton).toHaveText("Clase guardada");

  const records = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return { sessions: await db.taskSessions.toArray(), attendance: await db.attendanceEntries.toArray() };
  });
  expect(records.sessions.map((session) => session.status).sort()).toEqual(["done", "done"]);
  expect(records.attendance).toHaveLength(1);
  expect(records.attendance[0]).toMatchObject({ studentId: "student-1", status: "absent" });

  await slotList.getByText("Calentamiento", { exact: true }).click();
  await expect(closeButton).toHaveText("Clase guardada");
});
