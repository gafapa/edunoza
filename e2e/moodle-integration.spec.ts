import { expect, test, type Page } from "@playwright/test";
import { installMoodleFixture, seedMoodleLocalRecords } from "./moodle-fixture";
import { MAPPING_HEADING, REVIEW_HEADING, chooseDestination, connectMoodleToken, openMoodleAccess } from "./moodle-workflow-helpers";

const TOKEN = "1234567890abcdef1234567890abcdef";

/** Picks the Moodle course and, unless a saved scope auto-restores straight to review, manually chooses the local destination. */
async function connectAndLoad(page: Page): Promise<void> {
  await connectMoodleToken(page, TOKEN);
  await page.getByRole("combobox", { name: "Curso de Moodle", exact: true }).selectOption("4");
  const remoteGroupSelect = page.getByRole("combobox", { name: "Grupo de Moodle (opcional)", exact: true });
  const mappingHeading = page.getByRole("heading", { name: MAPPING_HEADING });
  const reviewHeading = page.getByRole("heading", { name: REVIEW_HEADING });
  await expect(remoteGroupSelect.or(mappingHeading).or(reviewHeading)).toBeVisible();
  if (await remoteGroupSelect.isVisible()) {
    await chooseDestination(page, "moodle-local-class", "moodle-local-subject");
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
  }
}

for (const width of [390, 1440]) {
  test(`read-only Moodle links existing work and reconnects without loss at ${width}px`, async ({ page }) => {
    test.setTimeout(90000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await installMoodleFixture(page);
    await page.goto("/config/moodle");
    await seedMoodleLocalRecords(page);
    await page.reload();
    await connectAndLoad(page);
    // "Local Pupil" could be the same person, so the row waits for an explicit decision.
    const save = page.getByRole("button", { name: "Guardar y ver notas", exact: true });
    await expect(save).toBeDisabled();
    await expect(page.getByText("Falta 1 decisión", { exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Alumno de Edunoza para Moodle Pupil", exact: true }).selectOption("link:moodle-local-student");
    await page.getByRole("combobox", { name: "Tarea de Edunoza para Moodle assignment", exact: true }).selectOption("link:moodle-local-task");
    await save.click();
    // Saving the matching opens the grades review; the local 6 differs from Moodle's 70/100.
    await expect(page.getByRole("heading", { name: REVIEW_HEADING })).toBeVisible();
    await expect(page.getByRole("button", { name: "Terminar sin importar notas", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Usar 7", exact: true }).click();
    await page.getByRole("button", { name: "Importar 1 nota al cuaderno", exact: true }).click();
    await expect(page.getByRole("heading", { name: "1 nota ya está en el cuaderno" })).toBeVisible();
    await expect.poll(async () => page.evaluate(async () => {
      const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
      return (await db.taskDirectGrades.get("moodle-local-grade"))?.score;
    })).toBe(7);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `.impeccable/review/moodle-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Desconectar", exact: true }).click();
    await openMoodleAccess(page);
    await expect(page.getByLabel("Token del servicio web", { exact: true })).toHaveValue(TOKEN);
    await connectAndLoad(page);
    // A saved destination opens the grades step directly; step back to confirm the matching survived reconnecting.
    await expect(page.getByRole("heading", { name: REVIEW_HEADING })).toBeVisible();
    await page.getByRole("navigation", { name: "Pasos para importar datos de Moodle" }).getByRole("button", { name: /Emparejar/ }).click();
    await page.getByText("Ver 1 alumno emparejado", { exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Alumno de Edunoza para Moodle Pupil", exact: true })).toHaveValue("link:moodle-local-student");
    const wire = await page.evaluate(async () => {
      const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
      const fixture = (window as unknown as { moodleFixture: { calls: { functionName: string; url: string; body: string }[] } }).moodleFixture;
      const persisted = JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, records: await Promise.all(db.tables.map((table) => table.toArray())) });
      return { calls: fixture.calls, persisted, student: await db.students.get("moodle-local-student"), task: await db.tasks.get("moodle-local-task"), studentCount: await db.students.count(), taskCount: await db.tasks.count() };
    });
    expect(wire.persisted).toContain(TOKEN);
    expect(wire.calls.length).toBeGreaterThan(5);
    for (const call of wire.calls) {
      expect(call.url).not.toContain(TOKEN);
      expect(call.functionName).toMatch(/^(?:core_[a-z_]+_get_[a-z_]+|mod_assign_get_[a-z_]+|gradereport_user_get_grade_items)$/);
      expect(call.body).not.toContain("PRIVATE");
      expect(call.body).not.toContain("moodle-local");
    }
    expect(wire.studentCount).toBe(1);
    expect(wire.taskCount).toBe(1);
    expect(wire.student).toMatchObject({ fullName: "Local Pupil", personId: "stable-person", comments: "PRIVATE student note" });
    expect(wire.task).toMatchObject({ title: "My existing task", description: "PRIVATE task instructions" });
    await page.getByRole("button", { name: "Desconectar", exact: true }).click();
    await page.getByRole("button", { name: /Ya conectaste antes/ }).click();
    await page.getByRole("button", { name: "Olvidar", exact: true }).click();
    await page.getByRole("button", { name: "Sí, olvidar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Olvidar", exact: true })).toHaveCount(0);
    expect(await page.evaluate(async () => {
      const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
      return [(await db.students.count()), (await db.tasks.count()), (await db.taskDirectGrades.get("moodle-local-grade"))?.score];
    })).toEqual([1, 1, 7]);
    expect(errors).toEqual([]);
  });
}

test("disconnect during Moodle loading discards pending results and tokens", async ({ page }) => {
  await installMoodleFixture(page);
  await page.goto("/config/moodle");
  await seedMoodleLocalRecords(page);
  await page.reload();
  await connectAndLoad(page);
  await page.getByRole("navigation", { name: "Pasos para importar datos de Moodle" }).getByRole("button", { name: /Origen y destino/ }).click();
  await page.evaluate(() => { (window as unknown as { moodleFixture: { pending: boolean } }).moodleFixture.pending = true; });
  await page.getByRole("button", { name: "Actualizar curso", exact: true }).click();
  await page.getByRole("button", { name: "Desconectar", exact: true }).click();
  await openMoodleAccess(page);
  await expect(page.getByRole("button", { name: "Conectar", exact: true })).toBeVisible();
  await expect(page.getByLabel("Token del servicio web", { exact: true })).toHaveValue(TOKEN);
  await expect(page.getByRole("combobox", { name: "Curso de Moodle", exact: true })).toHaveCount(0);
  expect(await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return await db.moodleBindings.count();
  })).toBe(0);
});

test("creating a scope for an existing group only adds a subject, never a duplicate group", async ({ page }) => {
  await installMoodleFixture(page);
  await page.goto("/config/moodle");
  await seedMoodleLocalRecords(page);
  await page.reload();
  await connectMoodleToken(page, TOKEN);
  await page.getByRole("combobox", { name: "Curso de Moodle", exact: true }).selectOption("4");
  await chooseDestination(page, "moodle-local-class", "__create__");
  await page.getByLabel("Nombre de la materia", { exact: true }).fill("Biología de Moodle");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByRole("heading", { name: MAPPING_HEADING })).toBeVisible();
  const state = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    const classes = await db.classGroups.toArray();
    const subjects = await db.subjects.toArray();
    const links = await db.subjectCourseLinks.where("classId").equals("moodle-local-class").toArray();
    return { classCount: classes.length, subjectNames: subjects.map((subject) => subject.name).sort(), linkedSubjectIds: links.map((link) => link.subjectId) };
  });
  expect(state.classCount).toBe(1);
  expect(state.subjectNames).toEqual(["Biología de Moodle", "My existing subject"]);
  expect(state.linkedSubjectIds).toHaveLength(2);

  // moodle-local-student exists in the class but isn't enrolled in this brand-new
  // subject yet: linking must still offer them as a candidate (regression coverage for
  // a teacher who couldn't complete any student associations at all because the
  // candidate list only offered students already enrolled in the subject).
  const localCandidates = await page.getByRole("combobox", { name: "Alumno de Edunoza para Moodle Pupil", exact: true }).locator("option").allTextContents();
  expect(localCandidates).toContain("Local Pupil");
  await page.getByRole("combobox", { name: "Alumno de Edunoza para Moodle Pupil", exact: true }).selectOption({ label: "Local Pupil" });
  await page.getByRole("checkbox", { name: "Incluir Moodle assignment en el cuaderno", exact: true }).uncheck();
  await page.getByRole("button", { name: "Guardar y ver notas", exact: true }).click();
  // Linking must bind the student without silently touching academic data (no
  // auto-enrollment): only a moodleBindings row appears, subjectStudentLinks is untouched.
  await expect.poll(async () => page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return (await db.moodleBindings.where("kind").equals("student").and((binding) => binding.remoteId === 11).toArray()).length;
  })).toBe(1);
  const newSubjectEnrollment = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    const newSubject = (await db.subjects.toArray()).find((subject) => subject.name === "Biología de Moodle");
    if (!newSubject) return null;
    return Boolean(await db.subjectStudentLinks.where("[subjectId+studentId]").equals([newSubject.id, "moodle-local-student"]).first());
  });
  expect(newSubjectEnrollment).toBe(false);
});

test("preselects an exact accent-insensitive name match but saves nothing until confirmed", async ({ page }) => {
  await installMoodleFixture(page);
  await page.goto("/config/moodle");
  await seedMoodleLocalRecords(page);
  // A second local student whose name exactly matches the remote "Moodle Pupil" once
  // accents are ignored - "Local Pupil" (from the shared fixture) must not suggest a match.
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    await db.students.put({ id: "exact-match-student", personId: "exact-match-person", classId: "moodle-local-class", firstName: "Moodle", lastName: "Púpil", fullName: "Moodle Púpil" });
  });
  await page.reload();
  await connectMoodleToken(page, TOKEN);
  await page.getByRole("combobox", { name: "Curso de Moodle", exact: true }).selectOption("4");
  await chooseDestination(page, "moodle-local-class", "__create__");
  await page.getByLabel("Nombre de la materia", { exact: true }).fill("Suggestion test subject");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByRole("heading", { name: MAPPING_HEADING })).toBeVisible();

  // The match is only preselected: nothing is linked until the teacher saves.
  expect(await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return await db.moodleBindings.where("kind").equals("student").count();
  })).toBe(0);

  // "Local Pupil" is not an exact match, so it is neither suggested nor left pending.
  await expect(page.getByText("Falta 1 decisión", { exact: true })).toHaveCount(0);
  await page.getByText("Ver 1 alumno emparejado", { exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Alumno de Edunoza para Moodle Pupil", exact: true })).toHaveValue("link:exact-match-student");
  await page.getByRole("checkbox", { name: "Incluir Moodle assignment en el cuaderno", exact: true }).uncheck();
  await page.getByRole("button", { name: "Guardar y ver notas", exact: true }).click();
  await expect.poll(async () => page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    const binding = await db.moodleBindings.where("kind").equals("student").and((item) => item.remoteId === 11).first();
    return binding?.localId;
  })).toBe("exact-match-student");
});
