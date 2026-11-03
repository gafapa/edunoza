import { expect, test, type Page } from "@playwright/test";

async function navigate(page: Page, path: string) {
  await page.evaluate((route) => {
    history.pushState({}, "", route);
    dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/management/students");
  await page.locator(".group-context-selector select").waitFor();
  await page.evaluate(async () => {
    // The browser context and database are isolated for every test.
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    await db.open();
    const now = new Date().toISOString();
    await db.classGroups.bulkPut([
      { id: "a", name: "1 ESO A", level: "ESO", schoolYear: "2026-2027" },
      { id: "b", name: "2 ESO B", level: "ESO", schoolYear: "2026-2027" }
    ]);
    await db.subjects.bulkPut([
      { id: "math", name: "Matemáticas", scheduleSlotIds: ["slot"] },
      { id: "science", name: "Ciencias", scheduleSlotIds: [] }
    ]);
    await db.subjectCourseLinks.bulkPut([
      { id: "am", classId: "a", subjectId: "math" },
      { id: "bm", classId: "b", subjectId: "math" },
      { id: "bs", classId: "b", subjectId: "science" }
    ]);
    await db.students.put({ id: "student", classId: "b", firstName: "Ana", lastName: "García", fullName: "Ana García" });
    await db.subjectStudentLinks.put({ id: "sm", studentId: "student", subjectId: "math" });
    await db.scheduleDays.put({ id: "fri", dayOfWeek: 5, dayName: "Viernes", enabled: true, blocks: [{ id: "slot", startTime: "09:00", endTime: "09:50" }] });
    await db.unitBlocks.put({ id: "unit", subjectId: "math", name: "Unidad", description: "", position: 0, sessionCount: 1 });
    await db.tasks.put({ id: "task", title: "Tarea de Ana García", description: "", sessionCount: 1, sendToGradebook: true });
    await db.taskSubjectLinks.put({ id: "tm", taskId: "task", subjectId: "math", unitId: "unit" });
    await db.taskGradebookConfigs.put({ id: "config", taskId: "task", subjectId: "math", classId: "b", gradebookWeight: 100, directGradeEnabled: true });
    await db.taskSessions.put({ id: "session", taskId: "task", subjectId: "math", classId: "b", date: "2026-09-04", scheduleSlotId: "slot", status: "planned" });
    await db.attendanceEntries.put({ id: "attendance", classId: "b", subjectId: "math", studentId: "student", date: "2026-09-04", scheduleSlotId: "slot", status: "present", note: "Ana García ana@example.com", createdAt: now, updatedAt: now });
    sessionStorage.setItem("profeplus_backup_reminder_dismissed", "1");
  });
  await page.reload();
  await expect(page.locator(".group-context-selector select")).toBeEnabled();
  await page.locator(".group-context-selector select").selectOption("b");
});

test("group survives navigation in both directions and deep links can be overridden", async ({ page }) => {
  const selector = page.locator(".group-context-selector select");
  for (const path of ["/classroom", "/management/students", "/planner", "/management/periods", "/journal/work", "/management/subjects", "/management/units", "/management/tasks", "/gradebook"]) {
    await navigate(page, path);
    await expect(selector).toBeEnabled();
    await expect(selector).toHaveValue("b");
    await page.waitForTimeout(200);
    await expect(selector).toHaveValue("b");
  }
  await navigate(page, "/today?classId=a&date=2026-09-04");
  await expect(selector).toHaveValue("a");
  await selector.selectOption("b");
  await expect(page.getByText("Ana García", { exact: true }).first()).toBeVisible();
  await expect(selector).toHaveValue("b");
});

test("invalid evaluation and gradebook drafts block context changes", async ({ page }) => {
  const selector = page.locator(".group-context-selector select");
  await navigate(page, "/journal/work?classId=b&subjectId=math&taskId=task&date=2026-09-04&slotId=slot");
  const grade = page.getByPlaceholder("0-10");
  await grade.fill("11");
  await selector.selectOption("a");
  await expect(page.getByText("La nota directa debe estar entre 0 y 10.")).toBeVisible();
  await expect(selector).toHaveValue("b");
  await expect(grade).toHaveValue("11");
  await grade.fill("7");
  await selector.selectOption("a");
  await expect(selector).toHaveValue("a");
  await selector.selectOption("b");
  await navigate(page, "/gradebook");
  await page.getByRole("button", { name: "Matemáticas", exact: true }).click();
  const weight = page.getByLabel("Peso", { exact: true }).first();
  await weight.fill("-1");
  await selector.selectOption("a");
  await expect(page.getByText("El peso de tarea debe ser un numero mayor o igual a 0.")).toBeVisible();
  await expect(selector).toHaveValue("b");
  await expect(weight).toHaveValue("-1");
});

test("task evaluation keeps an unsaved draft when another tab closes its academic period", async ({ page }) => {
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    const { createAcademicPeriod } = await import(/* @vite-ignore */ "/src/shared/academic/periods.ts");
    const period = await createAcademicPeriod("b", { name: "Synthetic term", startDate: "2026-09-01", endDate: "2026-12-20" });
    await db.taskGradebookConfigs.update("config", { academicPeriodId: period.id });
    await db.taskDirectGrades.put({ id: "grade", taskId: "task", subjectId: "math", classId: "b", studentId: "student", score: 6 });
  });
  await navigate(page, "/journal/work?classId=b&subjectId=math&taskId=task&date=2026-09-04&slotId=slot");
  const grade = page.getByPlaceholder("0-10");
  await expect(grade).toHaveValue("6");
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    const { closeAcademicPeriod } = await import(/* @vite-ignore */ "/src/shared/academic/periods.ts");
    await closeAcademicPeriod((await db.taskGradebookConfigs.get("config"))!.academicPeriodId!);
  });
  await grade.fill("9");
  await grade.blur();
  await expect(page.getByText(/Reabre el periodo académico y comprueba su grupo/)).toBeVisible();
  await expect(grade).toHaveValue("9");
  expect(await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return { score: (await db.taskDirectGrades.get("grade"))?.score, snapshotScore: (await db.gradebookPeriodSnapshots.toArray())[0]?.data.taskDirectGrades[0]?.score };
  })).toEqual({ score: 6, snapshotScore: 6 });
});

test("stale task weight autosave preserves the academic period assigned by another tab", async ({ page }) => {
  await navigate(page, "/gradebook");
  await page.getByRole("button", { name: "Matemáticas", exact: true }).click();
  const weight = page.getByLabel("Peso", { exact: true }).first();
  await expect(weight).toHaveValue("100");
  const periodId = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    const { createAcademicPeriod } = await import(/* @vite-ignore */ "/src/shared/academic/periods.ts");
    const period = await createAcademicPeriod("b", { name: "Synthetic term", startDate: "2026-09-01", endDate: "2026-12-20" });
    await db.taskGradebookConfigs.update("config", { academicPeriodId: period.id });
    return period.id;
  });
  await weight.fill("50");
  await weight.blur();
  await expect(page.getByText(/La configuración de evaluación ha cambiado/)).toBeVisible();
  await expect(weight).toHaveValue("50");
  expect(await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    const config = await db.taskGradebookConfigs.get("config");
    return { periodId: config?.academicPeriodId, weight: config?.gradebookWeight };
  })).toEqual({ periodId, weight: 100 });
});

test("AI preview excludes free-text identifiers and cancellation sends nothing", async ({ page }) => {
  let requests = 0;
  let sentBody = "";
  await page.route(/https:\/\/(api\.openai\.com|openrouter\.ai|api\.anthropic\.com)/, (route) => {
    requests++;
    sentBody = route.request().postData() ?? "";
    return route.fulfill({ json: { choices: [{ message: { content: "Informe de prueba" } }] } });
  });
  await page.evaluate(async () => {
    const { saveAiConfiguration } = await import(/* @vite-ignore */ "/src/shared/ai/runtime.ts");
    saveAiConfiguration({ provider: "openai", model: "test-model", apiKey: "test-only", rememberApiKey: false });
  });
  await navigate(page, "/reports");
  await page.getByRole("button", { name: /Asistencia con IA/ }).click();
  await page.getByRole("button", { name: /^Generar .* con IA$/ }).first().click();
  const preview = page.getByRole("dialog", { name: "Revisar datos para la IA" });
  await expect(preview).toBeVisible();
  const content = await preview.getByLabel("Datos que se enviarán").textContent();
  expect(content).toContain("Alumno 1");
  expect(content).not.toMatch(/Ana|García|example\.com/);
  await preview.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(requests).toBe(0);
  await page.getByRole("button", { name: /^Generar .* con IA$/ }).first().click();
  await preview.getByRole("button", { name: "Enviar y generar informe" }).click();
  await expect(page.getByLabel("Contenido del informe", { exact: true })).toHaveValue("Informe de prueba");
  await page.getByLabel("Contenido del informe", { exact: true }).fill("Informe revisado por el docente");
  await page.screenshot({ path: "artifacts/persona-review/ai-editor-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "artifacts/persona-review/ai-editor-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: "Guardar versión", exact: true }).click();
  await expect(page.getByRole("button", { name: "Guardar versión", exact: true })).toBeDisabled();
  await page.getByLabel("Contenido del informe", { exact: true }).fill("Segunda revisión");
  await page.getByRole("button", { name: "Guardar versión", exact: true }).click();
  await expect.poll(() => page.evaluate(async () => (await import(/* @vite-ignore */ "/src/shared/db/database.ts")).db.aiReports.count())).toBe(2);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar HTML imprimible", exact: true }).click();
  expect((await downloading).suggestedFilename()).toMatch(/\.html$/);
  await page.reload();
  await page.locator(".group-context-selector select").selectOption("b");
  await expect(page.getByRole("region", { name: "Historial de informes IA" }).getByRole("button", { name: /^Plan de recuperación/ })).toHaveCount(2);
  expect(requests).toBe(1);
  expect(sentBody).not.toMatch(/Ana|García|example\.com/);
  expect(JSON.parse(sentBody).messages[1].content).toContain("Alumno 1");
});
