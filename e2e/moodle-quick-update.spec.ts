import { expect, test } from "@playwright/test";
import { installMoodleFixture, seedMoodleLocalRecords } from "./moodle-fixture";
import { REVIEW_HEADING, connectMoodleToken } from "./moodle-workflow-helpers";

async function prepareLinkedAccount(page: import("@playwright/test").Page) {
  await installMoodleFixture(page);
  await page.goto("/config/moodle");
  await seedMoodleLocalRecords(page);
  await page.evaluate(async () => {
    const { saveConnection, createMappingPreview, applyMappingPreview } = await import(/* @vite-ignore */ "/src/shared/moodle/service.ts");
    const { createMoodleClient } = await import(/* @vite-ignore */ "/src/shared/moodle/client.ts");
    const client = createMoodleClient("https://centros.edu.xunta.gal/iesmontevila/aulavirtual/", "syntheticToken123");
    const site = await client.getSiteInfo();
    const connection = await saveConnection(site);
    const [course] = await client.getCourses();
    const snapshot = await client.getCourseSnapshot(course);
    await applyMappingPreview(await createMappingPreview(connection.id, snapshot, { courseId: 4, classId: "moodle-local-class", subjectId: "moodle-local-subject" }, [
      { kind: "student", remoteId: 11, action: "link", localId: "moodle-local-student" },
      { kind: "activity", remoteId: 71, action: "link", localId: "moodle-local-task" }
    ]));
    client.dispose();
  });
  await page.reload();
  await connectMoodleToken(page, "syntheticToken123");
  // A previous import offers a one-click shortcut straight to the grades step.
  await page.getByRole("button", { name: "Traer novedades de Synthetic course", exact: true }).click();
  await expect(page.getByRole("heading", { name: REVIEW_HEADING, exact: true })).toBeVisible();
}

const stepper = (page: import("@playwright/test").Page) => page.getByRole("navigation", { name: "Pasos para importar datos de Moodle" });

test("quick update reviews fresh changes without repeating the matching", async ({ page }) => {
  await prepareLinkedAccount(page);
  await page.evaluate(() => {
    const fixture = (window as unknown as { moodleFixture: { activityTitle: string; modifiedAt: number; grade: number } }).moodleFixture;
    fixture.activityTitle = "Updated Moodle title";
    fixture.modifiedAt = 200;
    fixture.grade = 80;
  });
  await stepper(page).getByRole("button", { name: /Origen y destino/ }).click();
  await page.getByRole("button", { name: "Actualizar curso", exact: true }).click();
  await expect(page.getByRole("heading", { name: REVIEW_HEADING, exact: true })).toBeVisible();
  const titleField = page.locator("fieldset").filter({ has: page.locator("legend").filter({ hasText: "Título" }) });
  await expect(titleField.getByRole("radio", { name: "Usar Moodle Updated Moodle title", exact: true })).toBeVisible();
  // Preparing a review never writes the user's records.
  expect(await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return [(await db.tasks.get("moodle-local-task"))?.title, (await db.taskDirectGrades.get("moodle-local-grade"))?.score];
  })).toEqual(["My existing task", 6]);
  await titleField.getByRole("radio", { name: /Usar Moodle/ }).check();
  await page.getByRole("button", { name: "Usar 8", exact: true }).click();
  await page.getByRole("button", { name: "Importar 1 nota al cuaderno", exact: true }).click();
  await expect.poll(async () => page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return (await db.tasks.get("moodle-local-task"))?.title;
  })).toBe("Updated Moodle title");
  await expect.poll(async () => page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return (await db.taskDirectGrades.get("moodle-local-grade"))?.score;
  })).toBe(8);
  expect(await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return [await db.students.count(), await db.tasks.count(), (await db.students.get("moodle-local-student"))?.comments];
  })).toEqual([1, 1, "PRIVATE student note"]);
  await page.getByRole("button", { name: "Abrir el cuaderno", exact: true }).click();
  await expect(page).toHaveURL(/\/gradebook$/);
  await expect(page.getByText("Updated Moodle title").first()).toBeVisible();
});

test("failed refresh cannot leave an old update actionable", async ({ page }) => {
  await prepareLinkedAccount(page);
  await page.evaluate(() => { (window as unknown as { moodleFixture: { failFunction: string } }).moodleFixture.failFunction = "core_course_get_contents"; });
  await stepper(page).getByRole("button", { name: /Origen y destino/ }).click();
  await page.getByRole("button", { name: "Actualizar curso", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Importar|^Terminar sin importar/ })).toHaveCount(0);
});

test("rubric-style grades need one confirmation per activity and bulk choices cannot give it", async ({ page }, testInfo) => {
  await prepareLinkedAccount(page);
  await page.evaluate(() => {
    const fixture = (window as unknown as { moodleFixture: { functions: string[] } }).moodleFixture;
    fixture.functions = fixture.functions.filter(name => name !== "core_grading_get_definitions");
  });
  // Reconnect so capability discovery reflects the service without grading definitions.
  await page.getByRole("button", { name: "Desconectar", exact: true }).click();
  await connectMoodleToken(page, "syntheticToken123");
  await page.getByRole("combobox", { name: "Curso de Moodle", exact: true }).selectOption("4");
  // The missing function is reported as a warning, so the destination step stays open.
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  const confirmation = page.getByRole("checkbox", { name: /Moodle assignment: importar solo la nota final/ });
  await expect(confirmation).toBeVisible();
  await expect(page.getByText(/Tuya\s*6\s*·\s*Moodle\s*7/)).toBeVisible();
  await page.getByRole("button", { name: "Usar Moodle", exact: true }).click();
  await expect(confirmation).not.toBeChecked();
  await page.getByRole("button", { name: "Terminar sin importar notas", exact: true }).click();
  const readScore = () => page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return (await db.taskDirectGrades.get("moodle-local-grade"))?.score;
  });
  await expect(page.getByRole("heading", { name: "Importación terminada", exact: true })).toBeVisible();
  expect(await readScore()).toBe(6);
  await stepper(page).getByRole("button", { name: /Origen y destino/ }).click();
  await page.getByRole("button", { name: "Actualizar curso", exact: true }).click();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(confirmation).not.toBeChecked();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await confirmation.scrollIntoViewIfNeeded();
    await expect(confirmation).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`numeric-review-${width}.png`) });
  }
  await confirmation.check();
  await page.getByRole("button", { name: "Usar 7", exact: true }).click();
  await page.getByRole("button", { name: "Importar 1 nota al cuaderno", exact: true }).click();
  await expect.poll(readScore).toBe(7);
});
