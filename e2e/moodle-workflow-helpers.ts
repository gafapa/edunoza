import { expect, type Page } from "@playwright/test";

export const MOODLE_TEST_SERVER = "https://centros.edu.xunta.gal/iesmontevila/aulavirtual/";
export const MAPPING_HEADING = "Comprueba el emparejamiento";
export const REVIEW_HEADING = "Revisa las notas antes de importarlas";

/** The access fields (token / user+password) appear inline once the server URL is valid. */
export async function openMoodleAccess(page: Page): Promise<void> {
  await expect(page.getByRole("combobox", { name: "Forma de acceso", exact: true })).toBeVisible();
}

export async function connectMoodleToken(page: Page, token: string): Promise<void> {
  // .fill() auto-waits for the field (absorbs the lazy-loaded route's initial render).
  await page.getByLabel("Dirección HTTPS", { exact: true }).fill(MOODLE_TEST_SERVER);
  await openMoodleAccess(page);
  await page.getByRole("combobox", { name: "Forma de acceso", exact: true }).selectOption("token");
  await page.getByLabel("Token del servicio web", { exact: true }).fill(token);
  await page.getByRole("button", { name: "Conectar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Desconectar", exact: true })).toBeVisible();
}

/** From "Origen y destino": pick a Moodle course and wait until it has been read. */
export async function selectMoodleCourse(page: Page, courseValue: string): Promise<void> {
  await page.getByRole("combobox", { name: "Curso de Moodle", exact: true }).selectOption(courseValue);
  await expect(page.getByRole("combobox", { name: "Grupo de Moodle (opcional)", exact: true })).toBeVisible();
}

/** Chooses the local class and subject, then continues to the next step. */
export async function chooseDestination(page: Page, classId: string, subjectId: string): Promise<void> {
  await page.getByRole("combobox", { name: "Clase de Edunoza", exact: true }).selectOption(classId);
  await page.getByRole("combobox", { name: "Materia de Edunoza", exact: true }).selectOption(subjectId);
}
