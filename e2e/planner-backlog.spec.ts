import { expect, test } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`a long planner backlog keeps every card readable and can be filtered at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await page.evaluate(async () => {
      const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
      await db.classGroups.put({ id: "class-a", name: "1º ESO A", level: "1º ESO", schoolYear: "2026/2027" });
      await db.subjects.put({ id: "subject-math", name: "Matemáticas", scheduleSlotIds: ["slot-1"] });
      await db.subjectCourseLinks.put({ id: "link-math", classId: "class-a", subjectId: "subject-math" });
      await db.scheduleDays.put({ id: "day-tue", dayOfWeek: 2, dayName: "Martes", enabled: true, blocks: [{ id: "slot-1", startTime: "09:00", endTime: "09:50" }] });
      for (let index = 0; index < 40; index += 1) {
        await db.tasks.put({ id: `task-${index}`, title: index % 3 ? `Cuestionario tema ${index}` : `Tarea de ejemplo con un título bastante largo número ${index}`, description: "", sessionCount: index === 1 ? 3 : 1, sendToGradebook: true });
        await db.taskSubjectLinks.put({ id: `tsl-${index}`, taskId: `task-${index}`, subjectId: "subject-math" });
      }
    });
    await page.goto("/planner?date=2026-09-08&classId=class-a&subjectId=subject-math");
    const list = page.getByRole("group", { name: "Sesiones por planificar" });
    await expect(list.getByRole("button")).toHaveCount(40);
    await expect(page.getByLabel("42 sesiones pendientes")).toBeVisible();

    // Height-capped lists used to squeeze every card below its content, overlapping the next one.
    const overflowing = await list.evaluate((element) => [...element.querySelectorAll<HTMLElement>(".planner-mini-card")]
      .filter((card) => card.scrollHeight > card.clientHeight + 1).length);
    expect(overflowing).toBe(0);
    await expect(list.getByRole("button", { name: /Cuestionario tema 1\b/ })).toContainText("0/3 sesiones");

    await page.getByRole("searchbox", { name: "Buscar tarea por planificar" }).fill("tema 1");
    // "Cuestionario tema 1" and 10–19, except the multiples of 3, which carry the long title.
    await expect(list.getByRole("button")).toHaveCount(8);
    await page.getByRole("searchbox", { name: "Buscar tarea por planificar" }).fill("no existe");
    await expect(page.getByText("Ninguna tarea coincide con la búsqueda.", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
