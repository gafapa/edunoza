import { expect, test } from "@playwright/test";

test("family contacts can start, complete and reopen durably without losing their contents", async ({ page }) => {
  await page.goto("/management/tutor");
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    await db.classGroups.put({ id: "family-class", name: "Synthetic class", level: "ESO", schoolYear: "2026-2027" });
    await db.students.put({ id: "family-student", classId: "family-class", firstName: "Synthetic", lastName: "Student", fullName: "Synthetic Student" });
    await db.familyContacts.put({ id: "family-contact", studentId: "family-student", classId: "family-class", date: "2026-10-01", channel: "phone", contactName: "Synthetic guardian", relationship: "Guardian", summary: "Synthetic contact summary", agreements: "Keep this agreement", nextStep: "Review progress", dueDate: "2026-10-02", createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-01T09:00:00.000Z" });
  });
  await page.reload();
  await page.getByRole("tab", { name: "Familias", exact: true }).click();
  const card = page.locator(".tutor-contact-card").filter({ hasText: "Synthetic contact summary" });
  await card.getByRole("button", { name: "Empezar", exact: true }).click();
  await expect(card.getByText("Estado: En curso", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "Familias", exact: true }).click();
  await expect(card.getByRole("button", { name: "Empezar", exact: true })).toHaveCount(0);
  await card.getByRole("button", { name: "Completar", exact: true }).click();
  await expect(card.getByRole("button", { name: "Reabrir", exact: true })).toBeVisible();
  await expect(card.locator(".overdue")).toHaveCount(0);
  await page.reload();
  await page.getByRole("tab", { name: "Familias", exact: true }).click();
  const saved = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    const { buildCurrentPayload, validateDatabasePayload } = await import(/* @vite-ignore */ "/src/shared/backup/database.ts");
    const { buildAgendaItems } = await import(/* @vite-ignore */ "/src/shared/agenda/agenda.ts");
    const payload = await buildCurrentPayload();
    validateDatabasePayload(payload);
    const contact = await db.familyContacts.get("family-contact");
    const agenda = buildAgendaItems({ today: "2026-10-19", horizonDays: 30, classGroups: await db.classGroups.toArray(), students: await db.students.toArray(), subjects: [], tasks: [], followUps: [], familyContacts: [contact], taskSessions: [], academicPeriods: [], assessments: [] });
    return { contact, agenda: agenda.filter(item => item.kind === "familyContact") };
  });
  expect(saved.contact).toMatchObject({ status: "done", summary: "Synthetic contact summary", agreements: "Keep this agreement" });
  expect(saved.agenda).toEqual([]);
  await card.getByRole("button", { name: "Reabrir", exact: true }).click();
  await expect(card.getByRole("button", { name: "Empezar", exact: true })).toBeVisible();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `.impeccable/review/family-status-${width}.png`, fullPage: true });
  }
});
