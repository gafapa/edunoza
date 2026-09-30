import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";

test("edited report downloads as native Word, ODT and multipage PDF without external uploads", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const externalRequests: string[] = [];
  page.on("request", request => { if (request.url().startsWith("http") && !request.url().startsWith("http://127.0.0.1:5277")) externalRequests.push(request.url()); });
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Informes", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(async () =>
    (await indexedDB.databases()).some(database => database.name === "profeplus-db" && (database.version ?? 0) >= 100)
  )).toBe(true);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("profeplus-db");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction(["classGroups", "aiReports"], "readwrite");
    transaction.objectStore("classGroups").put({ id: "export", name: "Grupo simulado", level: "ESO", schoolYear: "2026-2027" });
    transaction.objectStore("aiReports").put({ id: "v", reportId: "r", classId: "export", title: "Informe simulado", text: "Revisión inicial", context: "Grupo simulado · 2026-2027", provider: "ollama", model: "simulated", createdAt: "2026-09-08T12:00:00Z" });
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    db.close();
  });
  await page.reload();
  await page.locator(".group-context-selector select").selectOption("export");
  await page.getByRole("button", { name: /^Informe simulado ·/ }).click();
  const body = "Lucía, Íñigo e Antón: evolución positiva. Texto <script> & contido editable.\n".repeat(50) + "FIN DO INFORME";
  await page.getByLabel("Contenido del informe", { exact: true }).fill(body);
  for (const [label, extension] of [["Word", "docx"], ["ODT", "odt"], ["PDF", "pdf"]]) {
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: `Descargar ${label}`, exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`));
    await download.saveAs(testInfo.outputPath(`report.${extension}`));
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    if (extension === "pdf") {
      expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
    } else {
      const files = unzipSync(bytes);
      const xml = strFromU8(files[extension === "docx" ? "word/document.xml" : "content.xml"]);
      expect(xml).toContain("Lucía, Íñigo e Antón");
      expect(xml).toContain("FIN DO INFORME");
      expect(xml).not.toContain("<script>");
    }
  }
  expect(externalRequests).toEqual([]);
  await expect(page.getByLabel("Contenido del informe", { exact: true })).toHaveValue(body);
  expect(await page.evaluate(() => new Promise<number>((resolve, reject) => {
    const opening = indexedDB.open("profeplus-db");
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const request = db.transaction("aiReports").objectStore("aiReports").count();
      request.onsuccess = () => { resolve(request.result); db.close(); };
      request.onerror = () => { reject(request.error); db.close(); };
    };
  }))).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Descargar PDF", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("export-mobile.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
