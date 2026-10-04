import { expect, test } from "@playwright/test";
import { installMoodleFixture, seedMoodleLocalRecords } from "./moodle-fixture";
import { connectMoodleToken } from "./moodle-workflow-helpers";

for (const width of [390, 1440]) {
  test(`Moodle steps preserve the connection and mapping drafts at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await installMoodleFixture(page);
    await page.goto("/config/moodle");
    await seedMoodleLocalRecords(page);
    await page.reload();

    await connectMoodleToken(page, "syntheticToken123");
    await page.screenshot({ path: `.impeccable/review/moodle-connect-${width}.png`, fullPage: true });

    await page.getByRole("combobox", { name: "Curso Moodle", exact: true }).selectOption("4");
    await page.getByRole("combobox", { name: "Grupo de Edunoza", exact: true }).selectOption("moodle-local-class");
    await page.getByRole("combobox", { name: "Materia de Edunoza", exact: true }).selectOption("moodle-local-subject");
    await page.getByRole("button", { name: "Continuar a revisión", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Alumnado y actividades" })).toBeVisible();

    await page.getByRole("combobox", { name: "Decisión para Moodle Pupil", exact: true }).selectOption("link");
    await page.getByRole("combobox", { name: "Registro local para Moodle Pupil", exact: true }).selectOption("moodle-local-student");
    await page.getByRole("button", { name: "Comprobar asociaciones", exact: true }).click();
    await expect(page.getByRole("region", { name: "Vista previa de asociaciones" })).toBeVisible();

    // Navigating to an earlier step and back must not discard the draft mapping or its preview.
    const stepper = page.getByRole("navigation", { name: "Pasos para importar datos de Moodle" });
    await stepper.getByRole("button", { name: /Elegir clase/ }).click();
    await expect(page.getByRole("combobox", { name: "Curso Moodle", exact: true })).toBeVisible();
    await stepper.getByRole("button", { name: /Vincular/ }).click();
    await expect(page.getByRole("combobox", { name: "Registro local para Moodle Pupil", exact: true })).toHaveValue("moodle-local-student");
    await expect(page.getByRole("region", { name: "Vista previa de asociaciones" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Desconectar", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `.impeccable/review/moodle-review-${width}.png`, fullPage: true });
  });
}
