import { expect, test } from "@playwright/test";
import { installMoodleFixture, seedMoodleLocalRecords } from "./moodle-fixture";
import { MAPPING_HEADING, chooseDestination, connectMoodleToken } from "./moodle-workflow-helpers";

for (const width of [390, 1440]) {
  test(`Moodle steps preserve the connection and matching drafts at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await installMoodleFixture(page);
    await page.goto("/config/moodle");
    await seedMoodleLocalRecords(page);
    await page.reload();

    await connectMoodleToken(page, "syntheticToken123");
    await page.screenshot({ path: `.impeccable/review/moodle-connect-${width}.png`, fullPage: true });

    await page.getByRole("combobox", { name: "Curso de Moodle", exact: true }).selectOption("4");
    await chooseDestination(page, "moodle-local-class", "moodle-local-subject");
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(page.getByRole("heading", { name: MAPPING_HEADING })).toBeVisible();

    const studentChoice = page.getByRole("combobox", { name: "Alumno de Edunoza para Moodle Pupil", exact: true });
    await studentChoice.selectOption("link:moodle-local-student");

    // Navigating to an earlier step and back must not discard the unsaved choice.
    const stepper = page.getByRole("navigation", { name: "Pasos para importar datos de Moodle" });
    await stepper.getByRole("button", { name: /Origen y destino/ }).click();
    await expect(page.getByRole("combobox", { name: "Curso de Moodle", exact: true })).toBeVisible();
    await stepper.getByRole("button", { name: /Emparejar/ }).click();
    await expect(studentChoice).toHaveValue("link:moodle-local-student");
    await expect(page.getByRole("button", { name: "Guardar y ver notas", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Desconectar", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `.impeccable/review/moodle-review-${width}.png`, fullPage: true });
  });
}
