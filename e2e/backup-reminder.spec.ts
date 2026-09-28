import { expect, test } from "@playwright/test";

async function seedLocalData(page: import("@playwright/test").Page) {
  await page.goto("/today");
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    await db.classGroups.put({ id: "class-a", name: "1º ESO A · Simulado", level: "1º ESO", schoolYear: "2026/2027" });
  });
}

test("escalates the backup reminder from due to overdue instead of staying dismissed", async ({ page }) => {
  await seedLocalData(page);

  const dueAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  await page.evaluate((value) => localStorage.setItem("profeplus_last_backup_at", value), dueAt);
  await page.reload();

  const reminder = page.locator(".backup-reminder");
  await expect(reminder).toHaveClass(/\bdue\b/);
  await expect(reminder.getByText("Actualiza tu copia de seguridad", { exact: true })).toBeVisible();
  await reminder.getByLabel("Descartar recordatorio durante esta sesión", { exact: true }).click();
  await expect(reminder).toBeHidden();

  const overdueAt = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
  await page.evaluate((value) => localStorage.setItem("profeplus_last_backup_at", value), overdueAt);
  await page.reload();

  const overdueReminder = page.locator(".backup-reminder");
  await expect(overdueReminder).toHaveClass(/\boverdue\b/);
  await expect(overdueReminder.getByText("Tu copia de seguridad lleva mucho retraso", { exact: true })).toBeVisible();
});
