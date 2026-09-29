import { expect, test, type Download, type Page } from "@playwright/test";

async function seed(page: Page, method = "direct") {
  await page.goto("/management/students");
  await page.locator(".group-context-selector select").waitFor();
  await page.evaluate(async (mode) => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    await db.classGroups.put({ id: "g", name: "Grupo simulado", level: "ESO", schoolYear: "2026-2027" });
    await db.students.put({ id: "s", classId: "g", firstName: "Alumno", lastName: "Simulado", fullName: "Alumno Simulado" });
    await db.aiReports.put({ id: "report-version", reportId: "report", classId: "g", title: "Informe simulado", text: "Revisión docente guardada", context: "Grupo simulado", provider: "ollama", model: "simulated", createdAt: "2026-09-08T12:00:00Z" });
    await db.subjects.put({ id: "subject", name: "Matemáticas", scheduleSlotIds: ["slot"] });
    await db.subjectCourseLinks.put({ id: "sc", classId: "g", subjectId: "subject" });
    await db.subjectStudentLinks.put({ id: "ss", studentId: "s", subjectId: "subject" });
    const day = await db.scheduleDays.where("dayOfWeek").equals(2).first();
    await db.scheduleDays.put({ id: day?.id ?? "tue", dayOfWeek: 2, dayName: "Martes", enabled: true, blocks: [{ id: "slot", startTime: "09:00", endTime: "09:50" }] });
    await db.unitBlocks.put({ id: "u", subjectId: "subject", name: "Unidad", description: "", sessionCount: 1, position: 0 });
    await db.tasks.put({ id: "t", title: "Tarea simulada", description: "", sessionCount: 1, sendToGradebook: true });
    await db.taskSubjectLinks.put({ id: "ts", taskId: "t", subjectId: "subject", unitId: "u" });
    await db.taskSessions.put({ id: "session", taskId: "t", subjectId: "subject", classId: "g", date: "2026-09-08", scheduleSlotId: "slot", status: "planned" });
    const common = { id: "grade", taskId: "t", subjectId: "subject", classId: "g", studentId: "s", date: "2026-09-08", scheduleSlotId: "slot" };
    if (mode === "rubric") {
      await db.rubricTemplates.put({ id: "r", classId: "g", taskId: "t", name: "Rúbrica", criteria: [{ id: "criterion", name: "Criterio", levels: [{ id: "low", name: "Insuficiente", score: 2 }, { id: "level", name: "Bien", score: 8 }] }] });
      await db.taskRubricAssessments.put({ ...common, rubricTemplateId: "r", criterionId: "criterion", levelId: "level", score: 8 });
    } else if (mode === "checklist") {
      await db.checklistTemplates.put({ id: "c", classId: "g", taskId: "t", name: "Lista", items: [{ id: "item", text: "Completado" }] });
      await db.taskChecklistAssessments.put({ ...common, checklistTemplateId: "c", itemId: "item", checked: true });
    } else await db.taskDirectGrades.put({ id: "grade", taskId: "t", subjectId: "subject", classId: "g", studentId: "s", score: 8 });
    await db.taskGradebookConfigs.put({ id: "config", taskId: "t", subjectId: "subject", classId: "g", gradebookWeight: 100,
      ...(mode === "rubric" ? { rubricTemplateId: "r" } : mode === "checklist" ? { checklistTemplateId: "c" } : { directGradeEnabled: true }) });
    sessionStorage.setItem("profeplus_backup_reminder_dismissed", "1");
  }, method);
  await page.reload();
}

async function downloadBytes(download: Download) {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

for (const method of ["direct", "rubric", "checklist"]) {
  test(`encrypted ${method} backup verifies and restores grades without stale drafts`, async ({ page }) => {
    await seed(page, method);
    await page.goto("/config/database");
    await page.getByRole("button", { name: "Crear copia cifrada", exact: true }).click();
    await page.getByLabel("Contraseña de la copia", { exact: true }).fill("Simulated-Backup-2026!");
    await page.getByLabel("Repetir contraseña", { exact: true }).fill("Simulated-Backup-2026!");
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Descargar copia cifrada", exact: true }).click();
    const bytes = await downloadBytes(await downloading);
    expect(bytes.toString()).not.toContain("Alumno Simulado");
    const file = { name: "simulated-backup.json", mimeType: "application/json", buffer: bytes };
    await page.getByLabel("Seleccionar copia JSON para comprobar", { exact: true }).setInputFiles(file);
    if (method === "direct") {
      await page.getByLabel("Contraseña de la copia", { exact: true }).fill("Incorrect-Password!");
      await page.getByRole("button", { name: "Descifrar y comprobar", exact: true }).click();
      await expect(page.getByText(/Operación de base de datos fallida/)).toBeVisible();
      await expect(page.getByRole("dialog")).toBeVisible();
    }
    await page.getByLabel("Contraseña de la copia", { exact: true }).fill("Simulated-Backup-2026!");
    await page.getByRole("button", { name: "Descifrar y comprobar", exact: true }).click();
    await expect(page.getByText(/Copia cifrada válida:/)).toBeVisible();
    await page.evaluate(async () => {
      const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
      await db.students.update("s", { comments: "Modified after export" });
      localStorage.setItem("edunoza-draft:old", "discard on restore");
    });
    await page.getByLabel("Seleccionar copia de seguridad JSON", { exact: true }).setInputFiles(file);
    await page.getByLabel("Contraseña de la copia", { exact: true }).fill("Simulated-Backup-2026!");
    await page.getByRole("button", { name: "Descifrar y revisar", exact: true }).click();
    await page.getByLabel("Contraseña para la copia de seguridad", { exact: true }).fill("Simulated-Safety-2026!");
    const safety = page.waitForEvent("download");
    await page.getByRole("button", { name: "Crear copia cifrada e importar", exact: true }).click();
    expect((await downloadBytes(await safety)).length).toBeGreaterThan(100);
    await expect(page.getByText(/Base de datos importada/)).toBeVisible();
    const restored = await page.evaluate(async (mode) => {
      const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
      const table = mode === "rubric" ? db.taskRubricAssessments : mode === "checklist" ? db.taskChecklistAssessments : db.taskDirectGrades;
      return { student: await db.students.get("s"), grade: await table.get("grade"), report: await db.aiReports.get("report-version"), draft: localStorage.getItem("edunoza-draft:old") };
    }, method);
    expect(restored.student?.comments).toBeUndefined();
    expect(restored.grade).toMatchObject(method === "checklist" ? { checked: true } : { score: 8 });
    expect(restored.draft).toBeNull();
    expect(restored.report?.text).toBe("Revisión docente guardada");
  });
}

test("follow-up editing preserves coordination and unsaved notes are recoverable", async ({ page }) => {
  await seed(page);
  await page.goto("/management/tutor");
  await page.locator("#tutor-panel-followUps select").first().selectOption("s");
  await page.getByLabel("Título", { exact: true }).fill("Seguimiento simulado");
  await page.getByLabel("Notas", { exact: true }).fill("Notas simuladas");
  await page.getByLabel("Responsable", { exact: true }).fill("Tutor simulado");
  await page.getByLabel("Fecha límite", { exact: true }).fill("2026-09-15");
  await page.getByRole("button", { name: "Añadir seguimiento", exact: true }).click();
  await expect(page.getByText("Seguimiento añadido.", { exact: true })).toBeVisible();
  await page.locator('a[href="/management/courses"]').first().click();
  await page.locator('a[href="/management/students"]').first().click();
  await page.getByRole("tab", { name: "Seguimiento tutorial", exact: true }).click();
  await page.locator(".follow-up-card").getByRole("button", { name: "Editar", exact: true }).click();
  const notes = page.getByPlaceholder("Evidencias, acuerdos, incidencias o medidas observadas");
  await notes.fill("Notas actualizadas");
  await page.getByRole("button", { name: "Actualizar seguimiento", exact: true }).click();
  await expect(page.getByText("Seguimiento actualizado.", { exact: true })).toBeVisible();
  const row = await page.evaluate(async () => (await import(/* @vite-ignore */ "/src/shared/db/database.ts")).db.studentFollowUps.toCollection().first());
  expect(row).toMatchObject({ responsiblePerson: "Tutor simulado", dueDate: "2026-09-15", notes: "Notas actualizadas", status: "open" });
  await page.getByPlaceholder("Ej. Entrevista con familia").fill("Borrador importante");
  await notes.fill("Acuerdos pendientes");
  await page.locator('a[href="/today"]').first().click();
  await expect(page.getByRole("dialog", { name: "Cambios sin guardar" })).toBeVisible();
  await page.getByRole("button", { name: "Salir sin guardar", exact: true }).click();
  await expect(page).toHaveURL(/\/today/);
  await page.locator('a[href="/management/courses"]').first().click();
  await page.locator('a[href="/management/students"]').first().click();
  await page.getByRole("button", { name: "Recuperar borrador", exact: true }).click();
  await expect(notes).toHaveValue("Acuerdos pendientes");
});

test("valid student autosave completes before navigation without discard dialog", async ({ page }) => {
  await seed(page);
  await page.getByPlaceholder("Comentarios del alumno").fill("Saved while navigating");
  await page.locator('a[href="/management/schedule"]').first().click();
  await expect(page).toHaveURL(/\/management\/schedule/);
  await expect(page.getByRole("dialog", { name: "Cambios sin guardar" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => (await (await import(/* @vite-ignore */ "/src/shared/db/database.ts")).db.students.get("s"))?.comments)).toBe("Saved while navigating");
});

test("invalid student drafts stay protected when navigation cannot autosave", async ({ page }) => {
  await seed(page);
  await page.getByPlaceholder("Nombre", { exact: true }).fill("");
  await page.locator('a[href="/management/schedule"]').first().click();
  const dialog = page.getByRole("dialog", { name: "Cambios sin guardar" });
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "Quedarme", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/management\/students/);
  await expect(page.getByPlaceholder("Nombre", { exact: true })).toHaveValue("");
  await expect.poll(() => page.evaluate(async () => (await (await import(/* @vite-ignore */ "/src/shared/db/database.ts")).db.students.get("s"))?.firstName)).toBe("Alumno");
  await page.locator('a[href="/management/schedule"]').first().click();
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "Salir sin guardar", exact: true }).click();
  await expect(page).toHaveURL(/\/management\/schedule/);
});

test("interrupted class work can be restored and explicitly saved", async ({ page }) => {
  await seed(page);
  await page.goto("/today?classId=g&date=2026-09-08");
  await page.getByRole("button", { name: "Ausente para Alumno Simulado", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("edunoza-draft:class:")).length)).toBe(1);
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await page.getByRole("button", { name: "Recuperar borrador", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ausente para Alumno Simulado", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Confirmar y cerrar clase|Guardar cambios de la clase/ }).click();
  await expect(page.getByText(/Clase guardada:/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("edunoza-draft:class:")).length)).toBe(0);
});
