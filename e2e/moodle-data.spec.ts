import { expect, test } from "@playwright/test";
import { seedMoodleLocalRecords } from "./moodle-fixture";

test("Moodle associations, remapping, backup and forgetting preserve existing academic work", async ({ page }) => {
  await page.goto("/config/preferences");
  await page.locator("main").waitFor();
  await seedMoodleLocalRecords(page);
  const result = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    const service = await import(/* @vite-ignore */ "/src/shared/moodle/service.ts");
    const backup = await import(/* @vite-ignore */ "/src/modules/management/ManagementDatabasePage.tsx");
    const site = { siteUrl: "https://moodle.example.invalid/school/", siteName: "Synthetic", userId: 9, fullName: "Teacher", functions: [] };
    const snapshot = { course: { id: 4, fullName: "Remote course", shortName: "RC" }, groups: [], students: [{ id: 11, firstName: "Remote", lastName: "Pupil", fullName: "Remote Pupil" }], activities: [{ id: 71, courseId: 4, instanceId: 7, module: "assign", title: "Remote title", url: "https://moodle.example.invalid/school/mod/assign/view.php?id=71", gradeMax: 100, advancedGrading: false, teamSubmission: false }], grades: [{ activityId: 71, userId: 11, grade: 70, modifiedAt: 100 }], submissions: [], warnings: [], fetchedAt: new Date().toISOString() };
    const scope = { courseId: 4, classId: "moodle-local-class", subjectId: "moodle-local-subject" };
    const academicTables = db.tables.filter((table) => !table.name.startsWith("moodle"));
    const academicState = async () => JSON.stringify(await Promise.all(academicTables.map(async (table) => [table.name, await table.orderBy(":id").toArray()])));
    const before = await academicState();
    const connection = await service.saveConnection(site);
    const choices = [{ kind: "student" as const, remoteId: 11, action: "link" as const, localId: "moodle-local-student" }, { kind: "activity" as const, remoteId: 71, action: "link" as const, localId: "moodle-local-task" }];
    await service.applyMappingPreview(await service.createMappingPreview(connection.id, snapshot, scope, choices));
    const afterLink = await academicState();
    await service.applyMappingPreview(await service.createMappingPreview(connection.id, snapshot, scope, choices));
    const linkCount = (await service.getBindings(connection.id)).length;
    const reconnect = await service.saveConnection({ ...site, siteUrl: "https://moodle.example.invalid/school" });
    const otherAccount = await service.saveConnection({ ...site, userId: 10 });
    const otherAccountBindings = await service.getBindings(otherAccount.id);
    const payload = await backup.buildCurrentPayload();
    const validated = backup.validateDatabasePayload(payload);
    const metadataIncluded = (validated.moodleBindings?.length ?? 0) === linkCount;
    const corrupt = structuredClone(payload);
    const tables = corrupt.tables as Record<string, Record<string, unknown>[]>;
    // A backup must not be able to smuggle an access token into metadata.
    tables.moodleConnections[0].token = "synthetic-secret-must-be-rejected";
    let secretRejected = false;
    try { backup.validateDatabasePayload(corrupt); } catch { secretRejected = true; }
    await db.students.put({ id: "moodle-second-student", classId: scope.classId, personId: "another-person", firstName: "Other", lastName: "Local", fullName: "Other Local", comments: "SECOND PRIVATE note" });
    const beforeRemap = await academicState();
    await service.applyMappingPreview(await service.createMappingPreview(connection.id, snapshot, scope, [{ kind: "student", remoteId: 11, action: "link", localId: "moodle-second-student" }]));
    const remapPreserved = beforeRemap === await academicState();
    await service.forgetConnection(connection.id);
    const afterForget = await academicState();
    return { linkingPreserved: before === afterLink, linkCount, reconnectId: reconnect.id, connectionId: connection.id, isolatedAccount: otherAccount.id !== connection.id && otherAccountBindings.length === 0, metadataIncluded, secretRejected, remapPreserved, forgetPreserved: beforeRemap === afterForget, forgottenBindings: (await service.getBindings(connection.id)).length, remainingConnections: (await service.listConnections()).length };
  });
  expect(result.linkingPreserved).toBe(true);
  expect(result.linkCount).toBe(3);
  expect(result.reconnectId).toBe(result.connectionId);
  expect(result.isolatedAccount).toBe(true);
  expect(result.metadataIncluded).toBe(true);
  expect(result.secretRejected).toBe(true);
  expect(result.remapPreserved).toBe(true);
  expect(result.forgetPreserved).toBe(true);
  expect(result.forgottenBindings).toBe(0);
  expect(result.remainingConnections).toBe(1);
});

test("Moodle stale previews, cancellation and missing remote records never overwrite local work", async ({ page }) => {
  await page.goto("/config/preferences");
  await seedMoodleLocalRecords(page);
  const result = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    const service = await import(/* @vite-ignore */ "/src/shared/moodle/service.ts");
    const connection = await service.saveConnection({ siteUrl: "https://moodle.example.invalid", siteName: "Synthetic", userId: 9, fullName: "Teacher", functions: [] });
    const scope = { courseId: 4, classId: "moodle-local-class", subjectId: "moodle-local-subject" };
    const snapshot = { course: { id: 4, fullName: "Remote course", shortName: "RC" }, groups: [], students: [{ id: 11, firstName: "Remote", lastName: "Pupil", fullName: "Remote Pupil" }], activities: [{ id: 71, courseId: 4, instanceId: 7, module: "assign", title: "Remote title", url: "https://moodle.example.invalid/mod/assign/view.php?id=71", gradeMax: 100, advancedGrading: false, teamSubmission: false }], grades: [{ activityId: 71, userId: 11, grade: 70, modifiedAt: 100 }], submissions: [], warnings: [], fetchedAt: new Date().toISOString() };
    await service.applyMappingPreview(await service.createMappingPreview(connection.id, snapshot, scope, [{ kind: "student", remoteId: 11, action: "link", localId: "moodle-local-student" }, { kind: "activity", remoteId: 71, action: "link", localId: "moodle-local-task" }]));
    snapshot.activities[0].title = "Updated remote title";
    const stale = await service.previewUpdates(connection.id, snapshot, scope);
    await db.tasks.update("moodle-local-task", { title: "New local title" });
    let staleRejected = false;
    try { await service.applyUpdates(stale, Object.fromEntries(stale.rows.map((row) => [row.id, "remote"]))); } catch { staleRejected = true; }
    const fresh = await service.previewUpdates(connection.id, snapshot, scope);
    const conflictDetected = fresh.rows.some((row) => row.field === "title" && row.conflict);
    await service.applyUpdates(fresh, Object.fromEntries(fresh.rows.map((row) => [row.id, "local"])));
    const titlePreserved = (await db.tasks.get("moodle-local-task"))?.title === "New local title";
    const grades = await service.previewGrades(connection.id, snapshot, scope);
    await service.applyGrades(grades, Object.fromEntries(grades.rows.map((row) => [row.id, "remote"])));
    const localGrade = await db.taskDirectGrades.get("moodle-local-grade");
    const mapping = await service.createMappingPreview(connection.id, snapshot, scope, [{ kind: "activity", remoteId: 71, action: "unlink" }]);
    const controller = new AbortController(); controller.abort();
    let aborted = false;
    try { await service.applyMappingPreview(mapping, controller.signal); } catch { aborted = true; }
    const missing = await service.previewUpdates(connection.id, { ...snapshot, students: [], activities: [], grades: [] }, scope);
    await service.applyUpdates(missing, {});
    const student = await db.students.get("moodle-local-student");
    const task = await db.tasks.get("moodle-local-task");
    return { staleRejected, conflictDetected, titlePreserved, score: localGrade?.score, gradeId: localGrade?.id, aborted, count: (await service.getBindings(connection.id)).length, studentPrivate: student?.comments, taskPrivate: task?.description, students: await db.students.count(), tasks: await db.tasks.count() };
  });
  expect(result).toMatchObject({ staleRejected: true, conflictDetected: true, titlePreserved: true, score: 7, gradeId: "moodle-local-grade", aborted: true, count: 3, studentPrivate: "PRIVATE student note", taskPrivate: "PRIVATE task instructions", students: 1, tasks: 1 });
});

test("Moodle grade review requires individual numeric confirmation and rolls back an unconfirmed batch", async ({ page }) => {
  await page.goto("/config/preferences");
  await seedMoodleLocalRecords(page);
  const result = await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    const service = await import(/* @vite-ignore */ "/src/shared/moodle/service.ts");
    const connection = await service.saveConnection({ siteUrl: "https://school.example.invalid", siteName: "Synthetic", userId: 9, fullName: "Teacher", functions: [] });
    const scope = { courseId: 4, classId: "moodle-local-class", subjectId: "moodle-local-subject" };
    const methods = [false, undefined, true];
    const task = (await db.tasks.get("moodle-local-task"))!;
    const config = (await db.taskGradebookConfigs.get("moodle-local-config"))!;
    const taskLink = (await db.taskSubjectLinks.get("moodle-local-tsl"))!;
    const activities = [];
    for (let index = 0; index < methods.length; index += 1) {
      const taskId = `grade-task-${index}`;
      await db.tasks.put({ ...task, id: taskId });
      await db.taskSubjectLinks.put({ ...taskLink, id: `grade-link-${index}`, taskId });
      await db.taskGradebookConfigs.put({ ...config, id: `grade-config-${index}`, taskId });
      await db.taskDirectGrades.put({ id: `grade-${index}`, taskId, classId: scope.classId, subjectId: scope.subjectId, studentId: "moodle-local-student", score: 6 });
      activities.push({ id: 71 + index, courseId: 4, instanceId: 7 + index, module: "assign", title: `Synthetic task ${index}`, url: `https://school.example.invalid/mod/assign/view.php?id=${71 + index}`, gradeMax: 100, advancedGrading: methods[index], teamSubmission: false });
    }
    const snapshot = { course: { id: 4, fullName: "Synthetic", shortName: "SYN" }, groups: [], students: [{ id: 11, firstName: "Local", lastName: "Pupil", fullName: "Local Pupil" }], activities, grades: activities.map(activity => ({ activityId: activity.id, userId: 11, grade: 70, modifiedAt: 100 })), submissions: [], warnings: [], fetchedAt: new Date().toISOString() };
    await service.applyMappingPreview(await service.createMappingPreview(connection.id, snapshot, scope, [
      { kind: "student", remoteId: 11, action: "link", localId: "moodle-local-student" },
      ...activities.map((activity, index) => ({ kind: "activity" as const, remoteId: activity.id, action: "link" as const, localId: `grade-task-${index}` }))
    ]));
    const preview = await service.previewGrades(connection.id, snapshot, scope);
    let confirmationRejected = false;
    try {
      await service.applyGrades(preview, Object.fromEntries(preview.rows.map(row => [row.id, "remote"])));
    } catch (error) {
      confirmationRejected = (error as Error).message.includes("Confirma individualmente");
    }
    const rolledBackScores = await Promise.all(methods.map(async (_, index) => (await db.taskDirectGrades.get(`grade-${index}`))?.score));
    const confirmed = await service.previewGrades(connection.id, snapshot, scope);
    await service.applyGrades(confirmed, Object.fromEntries(confirmed.rows.map(row => [row.id, row.gradingMethod === "direct" ? "remote" : row.gradingMethod === "unknown" ? "numeric-result" : "local"])));
    const reviewedScores = await Promise.all(methods.map(async (_, index) => (await db.taskDirectGrades.get(`grade-${index}`))?.score));
    const advanced = await service.previewGrades(connection.id, snapshot, scope);
    await service.applyGrades(advanced, Object.fromEntries(advanced.rows.map(row => [row.id, row.gradingMethod === "advanced" ? "numeric-result" : "local"])));
    return { confirmationRejected, rolledBackScores, reviewedScores, methods: preview.rows.map(row => row.gradingMethod), skipped: preview.skipped, scores: await Promise.all(methods.map(async (_, index) => (await db.taskDirectGrades.get(`grade-${index}`))?.score)) };
  });
  expect(result).toEqual({ confirmationRejected: true, rolledBackScores: [6, 6, 6], reviewedScores: [7, 7, 6], methods: ["direct", "unknown", "advanced"], skipped: [], scores: [7, 7, 7] });
});
