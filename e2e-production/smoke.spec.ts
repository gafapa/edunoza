import { expect, test } from "@playwright/test";
import { startUpdateServer } from "./update-server";

test("built application loads lazy routes without script or CSP errors and works offline", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    window.addEventListener("securitypolicyviolation", event => {
      throw new Error(`CSP ${event.violatedDirective} blocked ${event.blockedURI}`);
    });
  });
  await page.goto("/today");
  await expect(page.locator(".app-shell")).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  for (const route of ["/classroom", "/reports", "/config/database", "/config/ai"]) {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator(".app-shell")).toBeVisible();
  }
  await context.addCookies([{ name: "review_offline", value: "1", url: "http://127.0.0.1:5277" }]);
  expect(await page.evaluate(async () => {
    try { await fetch("/__review_network_probe", { cache: "no-store" }); return false; }
    catch { return true; }
  })).toBe(true);
  await page.goto("/config/database");
  await expect(page.getByRole("button", { name: "Crear copia cifrada", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("built application downloads a private encrypted backup with an accessible modal", async ({ page }) => {
  await page.goto("/config/database");
  await page.getByRole("button", { name: "Crear copia cifrada", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.focus();
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
  await page.getByLabel("Contraseña de la copia", { exact: true }).fill("Synthetic-Production-2026!");
  await page.getByLabel("Repetir contraseña", { exact: true }).fill("Synthetic-Production-2026!");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar copia cifrada", exact: true }).click();
  const download = await downloading;
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk));
  const envelope = JSON.parse(Buffer.concat(chunks).toString());
  expect(envelope.format).toBe("encrypted-backup");
  expect(envelope.encryption.algorithm).toBe("AES-GCM");
  expect(envelope.tables).toBeUndefined();
});

test("accepting a worker update reloads the built application and retains local storage", async ({ page }) => {
  const updateServer = await startUpdateServer();
  try {
    await page.goto(`${updateServer.url}/today`);
    await expect(page.locator(".app-shell")).toBeVisible();
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await page.evaluate(() => localStorage.setItem("review-update-marker", "kept"));
    page.on("console", message => {
      if (message.text().startsWith("Worker update")) console.info(message.text());
    });
    await page.evaluate(async () => {
      const registration = (await navigator.serviceWorker.getRegistration())!;
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        console.info("Worker update found", worker?.state);
        worker?.addEventListener("statechange", () => console.info("Worker update state", worker.state));
      });
    });
    updateServer.update();
    const prompt = page.waitForEvent("dialog");
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
    const dialog = await prompt;
    expect(dialog.message()).toContain("nueva versión");
    const reloaded = page.waitForEvent("load");
    await dialog.accept();
    await reloaded;
    await expect(page.locator(".app-shell")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("review-update-marker"))).toBe("kept");
  } finally {
    await updateServer.close();
  }
});
