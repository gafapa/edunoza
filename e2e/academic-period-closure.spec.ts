import { expect, test } from "@playwright/test";

test("closing an academic period locks its grades until it is reopened, versioning each closure", async ({ page }) => {
  await page.goto("/management/students");
  await page.locator(".group-context-selector select").waitFor();
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    await db.classGroups.put({ id: "class-a", name: "1º ESO A · Simulado", level: "1º ESO", schoolYear: "2026/2027" });
    await db.subjects.put({ id: "subject-math", name: "Matemáticas", scheduleSlotIds: [] });
    await db.subjectCourseLinks.put({ id: "link-math", classId: "class-a", subjectId: "subject-math" });
    await db.students.put({ id: "student-1", classId: "class-a", firstName: "Alba", lastName: "Ejemplo", fullName: "Alba Ejemplo" });
    await db.subjectStudentLinks.put({ id: "ssl-1", studentId: "student-1", subjectId: "subject-math" });
    await db.assessments.put({ id: "assessment-1", classId: "class-a", subjectId: "subject-math", title: "Examen", weight: 1, period: "", assessmentDate: "2026-09-15" });
    sessionStorage.setItem("profeplus_backup_reminder_dismissed", "1");
  });
  await page.reload();
  await expect(page.locator(".group-context-selector select")).toBeEnabled();
  await page.locator(".group-context-selector select").selectOption("class-a");

  const enterGrade = async (value: string) => {
    await page.goto("/gradebook");
    await page.locator(".group-context-selector select").selectOption("class-a");
    await page.getByRole("button", { name: "Matemáticas", exact: true }).click();
    await page.getByRole("button", { name: "Notas", exact: true }).click();
    const gradeCell = page.getByLabel("Nota de Alba Ejemplo en Examen", { exact: true });
    await gradeCell.fill(value);
    await gradeCell.blur();
    await page.waitForTimeout(200);
  };

  // Create the period and assign the assessment to it.
  await page.goto("/management/periods");
  await page.locator(".group-context-selector select").selectOption("class-a");
  await page.getByLabel("Nombre", { exact: true }).fill("1ª evaluación");
  await page.getByLabel("Desde", { exact: true }).fill("2026-09-01");
  await page.getByLabel("Hasta", { exact: true }).fill("2026-12-20");
  await page.getByRole("button", { name: "Crear periodo", exact: true }).click();
  await expect(page.getByText("1ª evaluación", { exact: true })).toBeVisible();
  await page.getByLabel("Periodo de Examen", { exact: true }).selectOption({ label: "1ª evaluación · abierto" });
  await expect(page.getByText("Asignación de periodo actualizada.", { exact: true })).toBeVisible();

  // Enter a grade while the period is open.
  await enterGrade("7");
  const initialEntries = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return db.gradeEntries.toArray();
  });
  expect(initialEntries).toHaveLength(1);
  expect(initialEntries[0].numericValue).toBe(7);

  // Close the period: it should snapshot and lock editing.
  await page.goto("/management/periods");
  await page.locator(".group-context-selector select").selectOption("class-a");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(page.getByText("Periodo cerrado e instantánea guardada.", { exact: true })).toBeVisible();
  await expect(page.getByText(/Cerrado · 1 instantáneas/, { exact: false })).toBeVisible();

  // Editing the grade should now be blocked, and the stored value must not change.
  await enterGrade("9");
  const lockedEntries = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return db.gradeEntries.toArray();
  });
  expect(lockedEntries).toHaveLength(1);
  expect(lockedEntries[0].numericValue).toBe(7);

  // Reopen: editing works again.
  await page.goto("/management/periods");
  await page.locator(".group-context-selector select").selectOption("class-a");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reabrir", exact: true }).click();
  await expect(page.getByText("Periodo reabierto. El próximo cierre creará una nueva versión.", { exact: true })).toBeVisible();

  await enterGrade("9");
  const reopenedEntries = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return db.gradeEntries.toArray();
  });
  expect(reopenedEntries[0].numericValue).toBe(9);

  // Closing again must version the snapshot rather than overwrite it.
  await page.goto("/management/periods");
  await page.locator(".group-context-selector select").selectOption("class-a");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cerrar", exact: true }).click();
  await expect(page.getByText(/Cerrado · 2 instantáneas · versión 2/, { exact: false })).toBeVisible();

  const snapshots = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return db.gradebookPeriodSnapshots.toArray();
  });
  expect(snapshots).toHaveLength(2);
  const firstSnapshotGrade = snapshots.find((snapshot) => snapshot.version === 1)?.data.gradeEntries[0]?.numericValue;
  const secondSnapshotGrade = snapshots.find((snapshot) => snapshot.version === 2)?.data.gradeEntries[0]?.numericValue;
  expect(firstSnapshotGrade).toBe(7);
  expect(secondSnapshotGrade).toBe(9);
});
