import { expect, test } from "@playwright/test";

for (const width of [390, 768, 1440]) {
  test(`shared forms adapt across the app at ${width}px`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/management/students");
    await page.locator(".group-context-selector select").waitFor();
    await page.evaluate(async () => {
      const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
      await db.classGroups.put({ id: "compact-group", name: "Grupo de prueba", level: "ESO", schoolYear: "2026-2027" });
      await db.students.put({ id: "compact-student", classId: "compact-group", firstName: "Alumno", lastName: "Simulado", fullName: "Alumno Simulado" });
      await db.subjects.put({ id: "compact-subject", name: "Asignatura de prueba", scheduleSlotIds: [] });
      await db.subjectCourseLinks.put({ id: "compact-link", classId: "compact-group", subjectId: "compact-subject" });
      await db.subjectStudentLinks.put({ id: "compact-enrolment", studentId: "compact-student", subjectId: "compact-subject" });
      sessionStorage.setItem("profeplus_backup_reminder_dismissed", "1");
    });
    await page.reload();
    await page.locator(".group-context-selector select").selectOption("compact-group");
    const routes = ["/management/students", "/management/subjects", "/management/units", "/management/tasks", "/planner", "/gradebook", "/reports", "/agenda", "/classroom", "/config/preferences", "/config/ai", "/config/database/nextcloud"];
    let horizontalCount = 0;
    for (const route of routes) {
      await page.goto(route);
      await page.locator("main").waitFor();
      await page.locator("main .compact-field").first().waitFor();
      if (route === "/management/students") {
        await page.getByRole("button", { name: /Alumno Simulado|Simulado, Alumno/ }).first().click();
        await page.getByPlaceholder("Nombre", { exact: true }).waitFor();
      }
      const geometry = await page.evaluate(() => {
        const rows = [...document.querySelectorAll<HTMLElement>("main .compact-field")].filter(element => element.getClientRects().length && element.getBoundingClientRect().height > 0);
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          fields: rows.flatMap(row => {
            const label = row.querySelector<HTMLElement>(":scope > span, :scope > label");
            const input = row.querySelector<HTMLElement>(":scope > input, :scope > select, :scope > .ai-secret-input");
            if (!label || !input || !input.getClientRects().length) return [];
            const a = label.getBoundingClientRect(), b = input.getBoundingClientRect(), r = row.getBoundingClientRect();
            return [{ width: r.width, gap: b.left - a.right, hiddenLabel: label.classList.contains("sr-only"), horizontal: b.left >= a.right - 1 && b.top < a.bottom + 1, stacked: b.top >= a.bottom - 1, controlWidth: b.width, height: b.height }];
          })
        };
      });
      expect(geometry.overflow, route).toBe(false);
      for (const field of geometry.fields) {
        // Mouse-driven desktop layouts use 32px controls; touch-sized layouts keep 44px targets.
        expect(field.height, route).toBeGreaterThanOrEqual(width > 840 ? 32 : 44);
        expect(field.height, route).toBeLessThan(90);
        if (width <= 760) expect(field.stacked, route).toBe(true);
        else if (field.width >= 520) {
          expect(field.horizontal, route).toBe(true);
          if (!field.hiddenLabel) expect(field.gap, route).toBeLessThanOrEqual(12);
          expect(field.controlWidth, route).toBeLessThanOrEqual(448);
          horizontalCount++;
        }
      }
      if (["/config/database/nextcloud", "/reports", "/classroom", "/management/students"].includes(route) && width !== 768) {
        await page.screenshot({ path: `.impeccable/review/compact-${route.split("/").at(-1)}-${width}.png`, fullPage: true });
      }
    }
    if (width === 1440) expect(horizontalCount).toBeGreaterThan(8);
  });
}
