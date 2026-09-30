import { expect, test } from "@playwright/test";

for (const width of [320, 768, 1280]) {
  test(`behavior controls fit at ${width}px and marks can be removed durably`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/today?date=2026-09-08&classId=class-a");
    await expect.poll(() => page.evaluate(async () =>
      (await indexedDB.databases()).some(database => database.name === "profeplus-db" && (database.version ?? 0) >= 100)
    )).toBe(true);
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("profeplus-db");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = db.transaction(["classGroups", "subjects", "subjectCourseLinks", "scheduleDays", "students", "subjectStudentLinks", "behaviorMarks"], "readwrite");
      transaction.objectStore("classGroups").put({ id: "class-a", name: "Grupo simulado", level: "ESO", schoolYear: "2026-2027" });
      transaction.objectStore("subjects").put({ id: "math", name: "Matemáticas", scheduleSlotIds: ["slot-1"] });
      transaction.objectStore("subjectCourseLinks").put({ id: "link", classId: "class-a", subjectId: "math" });
      transaction.objectStore("scheduleDays").put({ id: "tuesday", dayOfWeek: 2, dayName: "Martes", enabled: true, blocks: [{ id: "slot-1", startTime: "09:00", endTime: "09:50" }] });
      transaction.objectStore("students").put({ id: "student-1", classId: "class-a", firstName: "Alba", lastName: "Ejemplo Apellidos Largos Simulados", fullName: "Alba Ejemplo Apellidos Largos Simulados" });
      transaction.objectStore("students").put({ id: "other-student", classId: "class-a", firstName: "Otro", lastName: "Ejemplo" });
      transaction.objectStore("subjectStudentLinks").put({ id: "student-link", studentId: "student-1", subjectId: "math" });
      const base = { studentId: "student-1", classId: "class-a", subjectId: "math", date: "2026-09-08", kind: "positive", createdAt: "2026-09-08T09:00:00Z" };
      for (const mark of [
        { ...base, id: "positive-first" },
        { ...base, id: "positive-last", createdAt: "2026-09-08T09:10:00Z" },
        { ...base, id: "negative", kind: "negative" },
        { ...base, id: "other-date", date: "2026-09-07" },
        { ...base, id: "other-student-mark", studentId: "other-student" }
      ]) transaction.objectStore("behaviorMarks").put(mark);
      await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
      db.close();
    });
    await page.reload();
    await page.locator(".today-slot-list").getByText("Matemáticas", { exact: true }).click();
    const panel = page.locator(".students-panel");
    const counts = panel.locator(".today-behavior-count");
    await expect(counts).toHaveText(["2", "1"]);
    const addPositive = panel.getByRole("button", { name: /^Añadir positivo para/ });
    const removePositive = panel.getByRole("button", { name: /^Retirar positivo de/ });
    const addNegative = panel.getByRole("button", { name: /^Añadir negativo para/ });
    const removeNegative = panel.getByRole("button", { name: /^Retirar negativo de/ });
    expect(await panel.locator(".today-student-list").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await panel.locator(".today-behavior-tap").evaluateAll(buttons => buttons.every(button => {
      const bounds = button.getBoundingClientRect();
      const row = button.closest(".today-student-row")!.getBoundingClientRect();
      return bounds.width >= 44 && bounds.height >= 44 && bounds.left >= row.left && bounds.right <= row.right;
    }))).toBe(true);
    await panel.screenshot({ path: testInfo.outputPath("behavior-layout.png") });
    await removePositive.click();
    await expect(counts).toHaveText(["1", "1"]);
    await removeNegative.click();
    await expect(counts).toHaveText(["1", "0"]);
    await expect(removeNegative).toBeDisabled();
    await addPositive.click();
    await expect(counts).toHaveText(["2", "0"]);
    await removePositive.click();
    await expect(counts).toHaveText(["1", "0"]);
    await removePositive.click();
    await expect(counts).toHaveText(["0", "0"]);
    await expect(removePositive).toBeDisabled();
    await addNegative.click();
    await expect(counts).toHaveText(["0", "1"]);
    await removeNegative.click();
    await expect(counts).toHaveText(["0", "0"]);
    await page.reload();
    await page.locator(".today-slot-list").getByText("Matemáticas", { exact: true }).click();
    await expect(counts).toHaveText(["0", "0"]);
    await expect(removePositive).toBeDisabled();
    await expect(removeNegative).toBeDisabled();
    expect(await page.evaluate(() => new Promise<string[]>((resolve, reject) => {
      const opening = indexedDB.open("profeplus-db");
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const db = opening.result;
        const request = db.transaction("behaviorMarks").objectStore("behaviorMarks").getAllKeys();
        request.onsuccess = () => { resolve(request.result as string[]); db.close(); };
        request.onerror = () => { reject(request.error); db.close(); };
      };
    }))).toEqual(["other-date", "other-student-mark"]);
  });
}
