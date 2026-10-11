import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { startProductionServer } from "./isolated-server";

test("built recovery screen reports quota and persistence permission outcomes", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    let persistent = false;
    Object.defineProperty(navigator, "storage", { configurable: true, value: {
      estimate: async () => ({ usage: 90 * 1024 * 1024, quota: 100 * 1024 * 1024 }),
      persisted: async () => persistent,
      persist: async () => { persistent = true; return true; }
    } });
  });
  await page.goto("/config/database");
  const panel = page.getByRole("region", { name: "Almacenamiento de este dispositivo" });
  await expect(panel.getByRole("alert")).toContainText("se acerca a su límite");
  await panel.getByRole("button", { name: "Proteger almacenamiento local" }).click();
  await expect(panel.getByRole("status")).toContainText("ha concedido");
  await expect(panel.getByRole("button", { name: "Proteger almacenamiento local" })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("device-storage-mobile.png") });
});

test("built PDF worker exports a multipage report offline without external requests or CSP errors", async ({ page }) => {
  const server = await startProductionServer();
  const errors: string[] = [];
  const externalRequests: string[] = [];
  const workerUrls: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("worker", worker => workerUrls.push(worker.url()));
  page.on("request", request => { if (request.url().startsWith("http") && !request.url().startsWith(server.url)) externalRequests.push(request.url()); });
  await page.addInitScript(() => {
    window.addEventListener("securitypolicyviolation", event => { throw new Error(`CSP ${event.violatedDirective}`); });
  });
  try {
    await page.goto(`${server.url}/reports`);
    await expect(page.locator(".app-shell")).toBeVisible();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("profeplus-db");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(["classGroups", "aiReports"], "readwrite");
          transaction.objectStore("classGroups").put({ id: "synthetic-export", name: "Synthetic export group", level: "ESO", schoolYear: "2026-2027" });
          transaction.objectStore("aiReports").put({ id: "synthetic-version", reportId: "synthetic-report", classId: "synthetic-export", title: "Synthetic offline PDF", text: "Synthetic local report áéíóú.\n".repeat(150), context: "Synthetic context", provider: "ollama", model: "local", createdAt: "2026-10-11T12:00:00Z" });
          transaction.oncomplete = () => { database.close(); resolve(); };
          transaction.onabort = () => { database.close(); reject(transaction.error); };
        };
      });
    });
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await server.close();
    // Use ordinary offline navigation, as in the built-application smoke suite.
    const offlineResponse = await page.goto(`${server.url}/reports`);
    expect(offlineResponse?.fromServiceWorker()).toBe(true);
    await expect(page.locator(".app-shell")).toBeVisible();
    await page.locator(".group-context-selector select").selectOption("synthetic-export");
    await page.getByRole("button", { name: /^Synthetic offline PDF ·/ }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Descargar PDF", exact: true }).click();
    const download = await downloadPromise;
    const chunks: Buffer[] = [];
    for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk));
    const pdf = await PDFDocument.load(Buffer.concat(chunks));
    expect(pdf.getTitle()).toBe("Synthetic offline PDF");
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    expect(workerUrls.some(url => url.includes("pdfExport.worker"))).toBe(true);
    expect(externalRequests).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});
