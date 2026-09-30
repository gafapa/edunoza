import { expect, test } from "@playwright/test";

test("preference storage failures retain a working application and visible notice", async ({ page }) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key: string) {
      if (key === "student_sort_by") throw new DOMException("Blocked", "SecurityError");
      return get.call(this, key);
    };
  });
  await page.goto("/today");
  await expect(page.getByText("El navegador no permite guardar las preferencias.", { exact: false })).toBeVisible();
  await expect(page.locator(".app-shell")).toBeVisible();
});

test("unavailable lock storage blocks academic access and offers recovery", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Blocked", "SecurityError"); } });
  });
  await page.goto("/today");
  await expect(page.getByRole("heading", { name: "No se puede comprobar el bloqueo local" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Volver a comprobar" })).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveCount(0);
});

test("modal traps reverse and forward tabbing from its panel and restores the background", async ({ page }) => {
  await page.goto("/config/database");
  const opener = page.getByRole("button", { name: "Crear copia cifrada", exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.focus();
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  await dialog.focus();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  await expect(page.locator("#root")).toHaveAttribute("inert", "");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("#root")).not.toHaveAttribute("inert", "");
  await expect(opener).toBeFocused();
});

for (const operation of ["import", "reset", "demo"] as const) {
  test(`${operation} preserves edits made while encrypting the safety backup`, async ({ page }) => {
    await page.goto("/config/database");
    const payload = await page.evaluate(async () => {
      const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
      const { buildCurrentPayload } = await import(/* @vite-ignore */ "/src/shared/backup/database.ts");
      await db.classGroups.put({ id: "review-course", name: "Original", level: "ESO", schoolYear: "2026-2027" });
      return buildCurrentPayload();
    });
    if (operation === "import") {
      await page.getByLabel("Seleccionar copia de seguridad JSON", { exact: true }).setInputFiles({ name: "synthetic.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(payload)) });
    } else {
      await page.locator("summary").filter({ hasText: /^Opciones avanzadas$/ }).click();
      await page.getByRole("button", { name: operation === "reset" ? "Borrar todo" : "Cargar datos de prueba", exact: true }).click();
    }
    await page.getByRole("dialog").waitFor();
    await page.getByLabel("Contraseña para la copia de seguridad", { exact: true }).fill("Synthetic-Backup-2026!");
    await page.evaluate(() => {
      const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
      crypto.subtle.encrypt = async (...args) => {
        const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
        await db.classGroups.update("review-course", { name: "Concurrent edit" });
        return encrypt(...args);
      };
    });
    await page.getByRole("button", { name: operation === "import" ? "Crear copia cifrada e importar" : operation === "reset" ? "Crear copia cifrada y borrar" : "Crear copia cifrada y continuar", exact: true }).click();
    await expect(page.getByText(/Los datos locales cambiaron mientras se creaba la copia preventiva/)).toBeVisible();
    const name = await page.evaluate(async () => (await (await import(/* @vite-ignore */ "/src/shared/db/database.ts")).db.classGroups.get("review-course"))?.name);
    expect(name).toBe("Concurrent edit");
  });
}
