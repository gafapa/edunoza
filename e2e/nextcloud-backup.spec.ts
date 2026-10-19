import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page, mode = "normal") {
  await page.addInitScript((mode) => {
    const files = new Map<string, string>();
    const calls: { method: string; body?: string; headers: Record<string, string> }[] = [];
    const fixture = { files, calls, mode };
    Object.assign(window, { nextcloudTest: fixture });
    const response = (href: string, collection: boolean) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype>${collection ? "<d:collection/>" : ""}</d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
    window.addEventListener("message", (event) => {
      const mode = fixture.mode;
      const data = event.data;
      if (data?.source !== "edunoza-web") return;
      const common = { source: "proxy-extension", protocol: "proxy-extension-bridge", version: 1 };
      if (data.type === "bridge-ping") {
        if (mode !== "missing") window.postMessage({ ...common, type: "bridge-available", extensionVersion: "0.2.7" }, location.origin);
        return;
      }
      if (data.type !== "bridge-request") return;
      const request = data.payload;
      calls.push(request);
      let status = 200;
      let bodyText = "";
      if (mode === "unauthorized" || (mode === "listing-failure" && request.method === "PROPFIND")) status = 401;
      else if (request.method === "PROPFIND") {
        status = 207;
        bodyText = `<d:multistatus xmlns:d="DAV:">${response(request.url, true)}${request.headers.Depth === "1" ? [...files.keys()].map((url) => response(url, false)).join("") : ""}</d:multistatus>`;
      } else if (request.method === "MKCOL") status = 201;
      else if (request.method === "PUT") {
        status = mode === "collision" ? 412 : 201;
        if (status === 201) files.set(request.url, request.body);
      } else if (request.method === "GET") bodyText = mode === "corrupt" ? "{}" : files.get(request.url) ?? "";
      window.postMessage({ ...common, type: "bridge-response", requestId: data.requestId, ok: true, result: { status, bodyText, finalUrl: request.url } }, location.origin);
    });
  }, mode);
  await page.goto("/config/nextcloud");
  await expect(page.getByRole("heading", { name: "Copia en Nextcloud" })).toBeVisible();
  await page.getByLabel("Servidor Nextcloud", { exact: true }).fill("https://boxabalar.edu.xunta.gal");
  await page.getByLabel("Usuario de Nextcloud", { exact: true }).fill("synthetic-teacher");
  await page.getByLabel("Contraseña de aplicación de Nextcloud", { exact: true }).fill("synthetic-app-secret");
}

test("one settings entry groups local backups and Nextcloud with visible installation guidance", async ({ page }) => {
  await page.goto("/config/database");
  await expect(page.getByRole("heading", { name: "Datos y copias de seguridad", exact: true })).toBeVisible();
  const settings = page.getByRole("navigation", { name: "Secciones de configuración" });
  await expect(settings.getByRole("link", { name: "Datos y copias de seguridad", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(settings.getByRole("link", { name: "Copia en Nextcloud", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Crear copia cifrada", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Ubicación de las copias" }).getByRole("link", { name: "Nextcloud", exact: true }).click();
  await expect(page).toHaveURL(/\/config\/database\/nextcloud$/);
  await expect(page.getByRole("link", { name: "Comprobar e instalar la extensión", exact: true })).toHaveAttribute("href", "/config/proxy");
  await expect(page.getByRole("link", { name: "Descargar Proxy (se abre en otra pestaña)", exact: true })).toHaveCount(0);
  await expect(page.locator("main h1")).toHaveCount(1);
  await expect(settings.getByRole("link", { name: "Datos y copias de seguridad", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("navigation", { name: "Ubicación de las copias" }).getByRole("link", { name: "En este dispositivo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Crear copia cifrada", exact: true })).toBeVisible();
  await page.goto("/config/nextcloud");
  await expect(page).toHaveURL(/\/config\/database\/nextcloud$/);
  await expect(page.getByRole("heading", { name: "Copia en Nextcloud", exact: true })).toBeVisible();
});

for (const listingFails of [false, true]) {
  test(`upload refreshes earlier backups and preserves verification when listing fails (${listingFails})`, async ({ page }) => {
    await setup(page);
    const previousName = "edunoza-backup-2026-10-11T12-00-00.000Z-00000000-0000-0000-0000-000000000000.json";
    await page.evaluate(({ previousName, listingFails }) => {
      const fixture = (window as unknown as { nextcloudTest: { files: Map<string, string>; mode: string } }).nextcloudTest;
      fixture.files.set(`https://boxabalar.edu.xunta.gal/remote.php/dav/files/synthetic-teacher/Edunoza/${previousName}`, "{}");
      if (listingFails) fixture.mode = "listing-failure";
    }, { previousName, listingFails });
    await page.getByLabel("Contraseña para cifrar la nueva copia", { exact: true }).fill("synthetic-encryption-secret");
    await page.getByLabel("Repite la contraseña de cifrado").fill("synthetic-encryption-secret");
    await page.getByRole("button", { name: "Cifrar y subir copia" }).click();
    await expect(page.getByText("Copia subida y verificada:", { exact: false })).toBeVisible();
    const backups = page.getByRole("combobox", { name: /Copia guardada/ });
    if (listingFails) {
      await expect(page.getByRole("alert")).toContainText("No repitas la subida");
      await expect(page.getByText("El listado puede estar incompleto.", { exact: false })).toBeVisible();
      await expect(backups.locator("option")).toHaveCount(1);
      await page.evaluate(() => { (window as unknown as { nextcloudTest: { mode: string } }).nextcloudTest.mode = "normal"; });
      await page.getByRole("button", { name: "Comprobar conexión y listar copias" }).click();
    }
    await expect(backups.locator("option")).toHaveCount(2);
    await expect(backups.locator("option", { hasText: previousName })).toHaveCount(1);
    expect(await backups.inputValue()).not.toBe(previousName);
    await expect(page.getByText("El listado puede estar incompleto.", { exact: false })).toHaveCount(0);
    expect(await page.evaluate(() => {
      const fixture = (window as unknown as { nextcloudTest: { calls: { method: string }[] } }).nextcloudTest;
      return fixture.calls.filter(call => call.method === "PUT").length;
    })).toBe(1);
  });
}

test("direct restoration validates, confirms and preserves current records in a preventive backup", async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    await db.classGroups.put({ id: "nc-group", name: "Synthetic Group", level: "ESO", schoolYear: "2026-2027" });
    await db.students.put({ id: "nc-student", classId: "nc-group", firstName: "Synthetic", lastName: "Pupil", fullName: "Synthetic Pupil" });
    await db.appPreferences.put({ id: "default", studentSortBy: "firstName", studentNameFormat: "firstLast", weekStartsOn: "sunday" });
    await db.scheduleDays.clear();
    await db.scheduleDays.put({ id: "nc-day", dayOfWeek: 1, dayName: "Lunes", enabled: true, blocks: [{ id: "nc-slot", startTime: "09:00", endTime: "09:50" }] });
    await db.subjects.put({ id: "nc-subject", name: "Synthetic subject", scheduleSlotIds: ["nc-slot"] });
    await db.subjectCourseLinks.put({ id: "nc-link", classId: "nc-group", subjectId: "nc-subject" });
    for (const id of ["nc-task-1", "nc-task-2"]) {
      await db.tasks.put({ id, title: id, description: "", sessionCount: 1, sendToGradebook: false });
      await db.taskSubjectLinks.put({ id: `${id}-link`, taskId: id, subjectId: "nc-subject" });
      await db.taskSessions.put({ id: `${id}-session`, taskId: id, subjectId: "nc-subject", classId: "nc-group", date: "2026-10-19", scheduleSlotId: "nc-slot", status: "planned" });
    }
  });
  await page.getByRole("button", { name: "Comprobar conexión y listar copias" }).click();
  await expect(page.getByText("Conexión comprobada. Todavía no hay copias", { exact: false })).toBeVisible();
  await page.getByLabel("Contraseña para cifrar la nueva copia", { exact: true }).fill("synthetic-encryption-secret");
  await page.getByLabel("Repite la contraseña de cifrado").fill("synthetic-encryption-secret");
  await page.getByRole("button", { name: "Cifrar y subir copia" }).click();
  await expect(page.getByText("Copia subida y verificada:", { exact: false })).toBeVisible();
  const wire = await page.evaluate(() => {
    const fixture = (window as unknown as { nextcloudTest: { calls: { method: string; body?: string; headers: Record<string, string> }[] } }).nextcloudTest;
    return { put: fixture.calls.find((call) => call.method === "PUT"), storage: JSON.stringify({ ...localStorage, ...sessionStorage }) };
  });
  expect(wire.put?.body).not.toContain("Synthetic Pupil");
  expect(wire.put?.body).not.toContain("synthetic-encryption-secret");
  expect(wire.put?.headers["If-None-Match"]).toBe("*");
  expect(wire.storage).not.toContain("synthetic-app-secret");
  expect(wire.storage).not.toContain("synthetic-encryption-secret");
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    await db.students.update("nc-student", { fullName: "Changed after backup", firstName: "Changed" });
    await db.appPreferences.update("default", { weekStartsOn: "monday" });
    localStorage.setItem("edunoza-draft:before-restore", "stale draft");
  });
  await page.getByLabel("Contraseña que usaste para cifrar esta copia").fill("wrong-password");
  await page.getByRole("button", { name: "Restaurar desde Nextcloud", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("No se pudo descifrar");
  await page.getByLabel("Contraseña que usaste para cifrar esta copia").fill("synthetic-encryption-secret");
  await page.getByRole("button", { name: "Restaurar desde Nextcloud", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Crear copia preventiva y restaurar", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return (await db.students.get("nc-student")).fullName;
  })).toBe("Changed after backup");
  await page.getByLabel("Contraseña que usaste para cifrar esta copia").fill("synthetic-encryption-secret");
  await page.getByRole("button", { name: "Restaurar desde Nextcloud", exact: true }).click();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `.impeccable/review/nextcloud-restore-${width}.png` });
  }
  await page.getByRole("checkbox", { name: "Entiendo que se sustituirán" }).check();
  await page.getByRole("button", { name: "Crear copia preventiva y restaurar", exact: true }).click();
  await expect(page.getByText("Restauración completada.", { exact: false })).toBeVisible();
  const restored = await page.evaluate(async () => {
    const { decryptBackupPayload } = await import(/* @vite-ignore */ "/src/shared/backup/encryption.ts");
    const { validateDatabasePayload } = await import(/* @vite-ignore */ "/src/modules/management/ManagementDatabasePage.tsx");
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    const fixture = (window as unknown as { nextcloudTest: { calls: { method: string; body?: string }[] } }).nextcloudTest;
    const text = fixture.calls.filter((call) => call.method === "PUT").at(-1)!.body!;
    const payload = await decryptBackupPayload(JSON.parse(text), "synthetic-encryption-secret");
    validateDatabasePayload(payload);
    return { saved: payload.tables.students, current: await db.students.get("nc-student"), sessions: await db.taskSessions.toArray(), preventiveSessions: payload.tables.taskSessions, preferences: await db.appPreferences.get("default"), preventivePreferences: payload.tables.appPreferences, draft: localStorage.getItem("edunoza-draft:before-restore") };
  });
  expect(restored.saved).toEqual(expect.arrayContaining([expect.objectContaining({ fullName: "Changed after backup" })]));
  expect(restored.current.fullName).toBe("Synthetic Pupil");
  expect(restored.sessions.map(session => session.taskId).sort()).toEqual(["nc-task-1", "nc-task-2"]);
  expect(restored.preventiveSessions).toEqual(restored.sessions);
  expect(restored.preferences.weekStartsOn).toBe("sunday");
  expect(restored.preventivePreferences).toEqual(expect.arrayContaining([expect.objectContaining({ weekStartsOn: "monday" })]));
  expect(restored.draft).toBeNull();
  await expect(page.getByRole("button", { name: "Verificar y descargar copia" })).toHaveCount(0);
});

for (const mode of ["collision", "corrupt"]) {
  test(`failed preventive backup (${mode}) never replaces local records`, async ({ page }) => {
    await setup(page);
    await page.getByLabel("Contraseña para cifrar la nueva copia", { exact: true }).fill("synthetic-encryption-secret");
    await page.getByLabel("Repite la contraseña de cifrado").fill("synthetic-encryption-secret");
    await page.getByRole("button", { name: "Cifrar y subir copia" }).click();
    await expect(page.getByText("Copia subida y verificada:", { exact: false })).toBeVisible();
    await page.evaluate(async () => {
      const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
      await db.classGroups.put({ id: "keep-group", name: "Keep group", level: "ESO", schoolYear: "2026-2027" });
    });
    await page.getByLabel("Contraseña que usaste para cifrar esta copia").fill("synthetic-encryption-secret");
    await page.getByRole("button", { name: "Restaurar desde Nextcloud", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.evaluate((mode) => { (window as unknown as { nextcloudTest: { mode: string } }).nextcloudTest.mode = mode; }, mode);
    await page.getByRole("checkbox", { name: "Entiendo que se sustituirán" }).check();
    await page.getByRole("button", { name: "Crear copia preventiva y restaurar", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    expect(await page.evaluate(async () => {
      const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
      return Boolean(await db.classGroups.get("keep-group"));
    })).toBe(true);
  });
}

test("restoration refuses stale snapshots and rolls back all tables on a write failure", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    const { buildCurrentPayload, restoreDatabasePayload } = await import(/* @vite-ignore */ "/src/modules/management/ManagementDatabasePage.tsx");
    await db.classGroups.put({ id: "g", name: "Original", level: "ESO", schoolYear: "2026-2027" });
    const snapshot = await buildCurrentPayload();
    await db.classGroups.update("g", { name: "Concurrent change" });
    let stale = false;
    try { await restoreDatabasePayload(snapshot, snapshot.tables); } catch { stale = true; }
    const afterStale = (await db.classGroups.get("g")).name;
    const current = await buildCurrentPayload();
    const failInsert = () => { throw new Error("Simulated write failure"); };
    db.classGroups.hook("creating", failInsert);
    let rolledBack = false;
    try { await restoreDatabasePayload(snapshot, current.tables); } catch { rolledBack = true; }
    finally { db.classGroups.hook("creating").unsubscribe(failInsert); }
    return { stale, afterStale, rolledBack, afterFailure: (await db.classGroups.get("g")).name };
  });
  expect(result).toEqual({ stale: true, afterStale: "Concurrent change", rolledBack: true, afterFailure: "Concurrent change" });
});

for (const mode of ["missing", "unauthorized", "collision", "corrupt"]) {
  test(`reports ${mode} without claiming a verified backup`, async ({ page }) => {
    await setup(page, mode);
    if (["missing", "unauthorized"].includes(mode)) await page.getByRole("button", { name: "Comprobar conexión y listar copias" }).click();
    else {
      await page.getByLabel("Contraseña para cifrar la nueva copia", { exact: true }).fill("synthetic-encryption-secret");
      await page.getByLabel("Repite la contraseña de cifrado").fill("synthetic-encryption-secret");
      await page.getByRole("button", { name: "Cifrar y subir copia" }).click();
    }
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByText("Copia subida y verificada:", { exact: false })).toHaveCount(0);
  });
}

test("DAV parsing excludes hostile paths and rejects inaccessible collections", async ({ page }) => {
  await setup(page);
  const result = await page.evaluate(async () => {
    const { parseBackupListing } = await import(/* @vite-ignore */ "/src/shared/backup/nextcloud.ts");
    const folder = new URL("https://cloud.example/remote.php/dav/files/teacher/Edunoza/");
    const name = "edunoza-backup-2026-09-09T10-00-00.000Z-00000000-0000-0000-0000-000000000000.json";
    const row = (url: string, collection = false, status = 200) => `<d:response><d:href>${url}</d:href><d:propstat><d:prop><d:resourcetype>${collection ? "<d:collection/>" : ""}</d:resourcetype></d:prop><d:status>HTTP/1.1 ${status} Status</d:status></d:propstat></d:response>`;
    const xml = (rows: string) => `<d:multistatus xmlns:d="DAV:">${rows}</d:multistatus>`;
    const safe = parseBackupListing(xml(row(folder.href, true) + [folder.href + name, `https://evil.example/${name}`, folder.href + `nested/${name}`, folder.href + name + "?redirect=evil"].map((url) => row(url)).join("")), folder);
    let inaccessible = false;
    let entity = false;
    try { parseBackupListing(xml(row(folder.href, true, 403)), folder); } catch { inaccessible = true; }
    try { parseBackupListing('<!DOCTYPE test SYSTEM "https://evil.example">' + xml(row(folder.href, true)), folder); } catch { entity = true; }
    return { safe, inaccessible, entity };
  });
  expect(result.safe).toHaveLength(1);
  expect(result.inaccessible).toBe(true);
  expect(result.entity).toBe(true);
});

for (const width of [390, 1440]) {
  test(`Nextcloud settings fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await setup(page);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.getByRole("link", { name: "Comprobar e instalar la extensión", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Extensión necesaria: Proxy", exact: true })).toHaveCount(0);
    await page.getByRole("heading", { name: "Copia en Nextcloud", exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `.impeccable/review/nextcloud-${width}.png`, fullPage: true });
  });
}

test("Nextcloud reports an unavailable Proxy and links to central setup", async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { (window as unknown as { nextcloudTest: { mode: string } }).nextcloudTest.mode = "missing"; });
  await page.getByRole("button", { name: "Comprobar conexión y listar copias" }).click();
  await expect(page.getByRole("alert")).toContainText("No se detecta Proxy");
  await page.getByRole("link", { name: "Comprobar e instalar la extensión", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Extensión Proxy", exact: true })).toBeVisible();
});
