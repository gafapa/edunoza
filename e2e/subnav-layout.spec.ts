import { expect, test } from "@playwright/test";

for (const width of [320, 390, 768, 1440]) {
  const isDesktop = width > 840;
  test(`workflow submenus ${isDesktop ? "use text underline tabs" : "keep icons beside labels"} at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of ["/today", "/planner", "/journal/work", "/journal/attendance", "/management/courses", "/classroom"]) {
      await page.goto(route);
      const navigation = page.locator(".workflow-subnav");
      await navigation.waitFor();
      if (route === "/today") await expect(navigation.getByRole("link", { name: "Aula", exact: true })).toHaveCount(0);
      if (route === "/management/courses") {
        await expect(navigation.getByRole("link", { name: "Aula", exact: true })).toHaveAttribute("href", "/classroom");
      }
      if (route === "/classroom") {
        await expect(navigation.getByRole("link", { name: "Aula", exact: true })).toHaveAttribute("aria-current", "page");
        await expect(navigation.getByRole("link", { name: "Grupos", exact: true })).toBeVisible();
      }
      const geometry = await navigation.locator(".workflow-subnav-list a").evaluateAll(links => links.map(link => {
        const icon = link.querySelector("svg")!.getBoundingClientRect();
        const label = link.querySelector("span")!.getBoundingClientRect();
        const box = link.getBoundingClientRect();
        return { iconWidth: icon.width, before: icon.right <= label.left, aligned: Math.abs((icon.top + icon.height / 2) - (label.top + label.height / 2)), height: box.height, right: box.right };
      }));
      for (const item of geometry) {
        if (isDesktop) {
          expect(item.iconWidth).toBe(0);
          expect(item.height).toBeGreaterThanOrEqual(24);
        } else {
          expect(item.iconWidth).toBeGreaterThan(0);
          expect(item.before).toBe(true);
          expect(item.aligned).toBeLessThan(2);
          expect(item.height).toBeGreaterThanOrEqual(44);
        }
        expect(item.right).toBeLessThanOrEqual(width);
      }
      await expect(navigation.locator('a[aria-current="page"]')).toHaveCount(1);
      if (route === "/management/courses" && [390, 1440].includes(width)) {
        await page.locator(".app-navigation").screenshot({ path: `.impeccable/review/subnav-${width}.png` });
      }
    }
  });
}
