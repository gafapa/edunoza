import { expect, test, type Page } from "@playwright/test";
import { installMoodleFixture, seedMoodleLocalRecords } from "./moodle-fixture";
import { connectMoodleToken, openMoodleAccess } from "./moodle-workflow-helpers";

const TOKEN = "1234567890abcdef1234567890abcdef";

/** Picks the Moodle course and, unless a saved scope auto-restores straight to review, manually chooses the local destination. */
async function connectAndLoad(page: Page): Promise<void> {
  await connectMoodleToken(page, TOKEN);
  await page.getByRole("combobox", { name: "Curso Moodle", exact: true }).selectOption("4");
  const groupSelect = page.getByRole("combobox", { name: "Grupo de Edunoza", exact: true });
  const mappingHeading = page.getByRole("heading", { name: "Alumnado y actividades" });
  const reviewHeading = page.getByRole("heading", { name: "Cambios y notas" });
  await expect(groupSelect.or(mappingHeading).or(reviewHeading)).toBeVisible();
  if (await groupSelect.isVisible()) {
    await groupSelect.selectOption("moodle-local-class");
    await page.getByRole("combobox", { name: "Materia de Edunoza", exact: true }).selectOption("moodle-local-subject");
    await page.getByRole("button", { name: "Continuar a revisión", exact: true }).click();
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
    await page.getByRole("combobox", { name: "Decisión para Moodle Pupil", exact: true }).selectOption("link");
    await page.getByRole("combobox", { name: "Registro local para Moodle Pupil", exact: true }).selectOption("moodle-local-student");
    await page.getByRole("combobox", { name: "Decisión para Moodle assignment", exact: true }).selectOption("link");
    await page.getByRole("combobox", { name: "Registro local para Moodle assignment", exact: true }).selectOption("moodle-local-task");
    await page.getByRole("button", { name: "Comprobar asociaciones", exact: true }).click();
    await expect(page.getByRole("region", { name: "Vista previa de asociaciones", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^Guardar 2 asociaci/ }).click();
    // Saving mapping auto-triggers the changes/grades review; wait for it directly
    // rather than an intermediate notice, since the two async steps can be batched.
    await expect(page.getByText(/Moodle: 70.*100.*7.*10/)).toBeVisible();
    await page.getByRole("radio", { name: "Importar Moodle", exact: true }).check();
    await page.getByRole("button", { name: "Aplicar cambios y notas", exact: true }).click();
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
    // Existing bindings for this scope auto-advance past "Vincular" to "Revisar y aplicar"; step back to confirm the mapping itself survived reconnecting.
    await page.getByRole("navigation", { name: "Pasos para importar datos de Moodle" }).getByRole("button", { name: /Vincular/ }).click();
    await expect(page.getByRole("combobox", { name: "Registro local para Moodle Pupil", exact: true })).toHaveValue("moodle-local-student");
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
      expect(call.functionName).toMatch(/^(?:core_[a-z_]+_get_[a-z_]+|mod_assign_get_[a-z_]+)$/);
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
  await page.getByRole("navigation", { name: "Pasos para importar datos de Moodle" }).getByRole("button", { name: /Elegir clase/ }).click();
  await page.evaluate(() => { (window as unknown as { moodleFixture: { pending: boolean } }).moodleFixture.pending = true; });
  await page.getByRole("button", { name: "Actualizar curso", exact: true }).click();
  await page.getByRole("button", { name: "Desconectar", exact: true }).click();
  await openMoodleAccess(page);
  await expect(page.getByRole("button", { name: "Conectar", exact: true })).toBeVisible();
  await expect(page.getByLabel("Token del servicio web", { exact: true })).toHaveValue(TOKEN);
  await expect(page.getByRole("combobox", { name: "Curso Moodle", exact: true })).toHaveCount(0);
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
  await page.getByRole("combobox", { name: "Curso Moodle", exact: true }).selectOption("4");
  await page.getByRole("combobox", { name: "Grupo de Edunoza", exact: true }).selectOption("moodle-local-class");
  await page.getByRole("combobox", { name: "Materia de Edunoza", exact: true }).selectOption("__create__");
  await page.getByLabel("Nombre de la materia", { exact: true }).fill("Biología de Moodle");
  await page.getByRole("button", { name: "Continuar a revisión", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Alumnado y actividades" })).toBeVisible();
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
  await page.getByRole("combobox", { name: "Decisión para Moodle Pupil", exact: true }).selectOption("link");
  const localCandidates = await page.getByRole("combobox", { name: "Registro local para Moodle Pupil", exact: true }).locator("option").allTextContents();
  expect(localCandidates).toContain("Local Pupil");
  await page.getByRole("combobox", { name: "Registro local para Moodle Pupil", exact: true }).selectOption({ label: "Local Pupil" });
  await page.getByRole("button", { name: "Comprobar asociaciones", exact: true }).click();
  await expect(page.getByRole("region", { name: "Vista previa de asociaciones", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Guardar/ }).click();
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

test("suggests an exact accent-insensitive name match but never links it automatically", async ({ page }) => {
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
  await page.getByRole("combobox", { name: "Curso Moodle", exact: true }).selectOption("4");
  await page.getByRole("combobox", { name: "Grupo de Edunoza", exact: true }).waitFor({ state: "visible" });
  await page.getByRole("combobox", { name: "Grupo de Edunoza", exact: true }).selectOption("moodle-local-class");
  await page.getByRole("combobox", { name: "Materia de Edunoza", exact: true }).selectOption("__create__");
  await page.getByLabel("Nombre de la materia", { exact: true }).fill("Suggestion test subject");
  await page.getByRole("button", { name: "Continuar a revisión", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Alumnado y actividades" })).toBeVisible();

  // No decision has been made yet: nothing is linked, only a suggestion is offered.
  expect(await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return await db.moodleBindings.where("kind").equals("student").count();
  })).toBe(0);

  const row = page.locator(".moodle-mapping-row", { hasText: "Moodle Pupil" });
  await expect(row.getByText("Coincidencia: Moodle Púpil", { exact: false })).toBeVisible();
  await row.getByRole("button", { name: "Usar la coincidencia Moodle Púpil para Moodle Pupil", exact: true }).click();
  await expect(row.getByRole("combobox").nth(1)).toHaveValue("exact-match-student");

  // Reset the manual choice, then confirm the bulk shortcut reaches the same result.
  await row.getByRole("combobox").first().selectOption("ignore");
  await page.getByRole("button", { name: /^Vincular \d+ coincidencias? exactas?$/ }).click();
  await expect(row.getByRole("combobox").nth(1)).toHaveValue("exact-match-student");

  await page.getByRole("button", { name: "Comprobar asociaciones", exact: true }).click();
  await expect(page.getByRole("region", { name: "Vista previa de asociaciones", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Guardar/ }).click();
  await expect.poll(async () => page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    const binding = await db.moodleBindings.where("kind").equals("student").and((item) => item.remoteId === 11).first();
    return binding?.localId;
  })).toBe("exact-match-student");
});
