import type { Page } from "@playwright/test";

/** Synthetic REST fixtures only: no requests are sent to the real school. */
export async function installMoodleFixture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const fixture = {
      calls: [] as { functionName: string; url: string; body: string }[],
      userId: 9,
      pupilName: "Moodle Pupil",
      activityTitle: "Moodle assignment",
      grade: 70,
      modifiedAt: 100,
      pending: false,
      failFunction: "",
      functions: ["core_webservice_get_site_info", "core_enrol_get_users_courses", "core_enrol_get_enrolled_users", "core_group_get_course_groups", "core_group_get_group_members", "core_course_get_contents", "mod_assign_get_assignments", "mod_assign_get_grades", "mod_assign_get_submissions", "core_grading_get_definitions", "core_course_get_course_module"]
    };
    Object.assign(window, { moodleFixture: fixture });
    window.addEventListener("message", (event) => {
      const message = event.data;
      if (message?.source !== "edunoza-web") return;
      const common = { source: "proxy-extension", protocol: "proxy-extension-bridge", version: 1 };
      if (message.type === "bridge-ping") {
        window.postMessage({ ...common, type: "bridge-available", extensionVersion: "1.0.0" }, location.origin);
        return;
      }
      if (message.type !== "bridge-request") return;
      const request = message.payload;
      const params = new URLSearchParams(request.body);
      const functionName = params.get("wsfunction") ?? "";
      fixture.calls.push({ functionName, url: request.url, body: request.body });
      if (fixture.pending) return;
      const server = "https://centros.edu.xunta.gal/iesmontevila/aulavirtual";
      let result: unknown;
      if (request.url.endsWith("/login/token.php")) result = { token: "syntheticLoginToken123", privatetoken: "syntheticPrivateToken" };
      else if (functionName === fixture.failFunction) result = { exception: "webservice_access_exception", errorcode: "accessexception", message: "Access denied" };
      else if (functionName === "core_webservice_get_site_info") result = { siteurl: server, sitename: "Synthetic Moodle", userid: fixture.userId, fullname: "Synthetic Teacher", functions: fixture.functions.map((name) => ({ name, version: "2024100700" })) };
      else if (functionName === "core_enrol_get_users_courses") result = [{ id: 4, fullname: "Synthetic course", shortname: "SYN-4" }];
      else if (functionName === "core_group_get_course_groups") result = [{ id: 50, courseid: 4, name: "Synthetic subgroup" }];
      else if (functionName === "core_group_get_group_members") result = [{ groupid: 50, userids: [11] }];
      else if (functionName === "core_enrol_get_enrolled_users") {
        const offsetKey = [...params.keys()].find((key) => params.get(key) === "limitfrom");
        const offset = offsetKey ? Number(params.get(offsetKey.replace("[name]", "[value]"))) : 0;
        result = offset > 0 ? [] : [{ id: 11, firstname: fixture.pupilName.split(" ")[0], lastname: fixture.pupilName.split(" ").slice(1).join(" "), fullname: fixture.pupilName, email: "synthetic@example.invalid", roles: [{ roleid: 5, name: "Student", shortname: "student" }] }];
      } else if (functionName === "core_course_get_contents") result = [{ id: 1, name: "Section", modules: [{ id: 71, instance: 7, modname: "assign", name: fixture.activityTitle, url: `${server}/mod/assign/view.php?id=71`, contextid: 701 }] }];
      else if (functionName === "mod_assign_get_assignments") result = { courses: [{ id: 4, fullname: "Synthetic course", shortname: "SYN-4", assignments: [{ id: 7, cmid: 71, course: 4, name: fixture.activityTitle, grade: 100, duedate: 1900000000, teamsubmission: 0, blindmarking: 0, markingworkflow: 0, markingallocation: 0, configs: [] }] }], warnings: [] };
      else if (functionName === "core_course_get_course_module") result = { cm: { id: 71, course: 4, modname: "assign", instance: 7, name: fixture.activityTitle, contextid: 701 }, warnings: [] };
      else if (functionName === "core_grading_get_definitions") result = { areas: [], warnings: [] };
      else if (functionName === "mod_assign_get_grades") result = { assignments: [{ assignmentid: 7, grades: [{ id: 2, userid: 11, grade: String(fixture.grade), timemodified: fixture.modifiedAt, attemptnumber: 0 }] }], warnings: [] };
      else if (functionName === "mod_assign_get_submissions") result = { assignments: [{ assignmentid: 7, submissions: [{ id: 3, userid: 11, status: "submitted", timemodified: 90, attemptnumber: 0, latest: 1 }] }], warnings: [] };
      else result = { exception: "invalid_parameter_exception", errorcode: "invalidparameter", message: `Unsupported synthetic function ${functionName}` };
      window.postMessage({ ...common, type: "bridge-response", requestId: message.requestId, ok: true, result: { status: 200, bodyText: JSON.stringify(result), finalUrl: request.url } }, location.origin);
    });
  });
}

export async function seedMoodleLocalRecords(page: Page): Promise<void> {
  // Wait for the app's initial database defaults before taking academic snapshots.
  await page.waitForFunction(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    return Boolean(await db.scheduleSettings.get("default"));
  });
  await page.evaluate(async () => {
    const { db } = await import(/* @vite-ignore */ "/src/shared/db/database.ts");
    await db.classGroups.put({ id: "moodle-local-class", name: "My existing group", level: "ESO", schoolYear: "2026-2027" });
    await db.subjects.put({ id: "moodle-local-subject", name: "My existing subject", scheduleSlotIds: [] });
    await db.subjectCourseLinks.put({ id: "moodle-local-scl", subjectId: "moodle-local-subject", classId: "moodle-local-class" });
    await db.students.put({ id: "moodle-local-student", personId: "stable-person", classId: "moodle-local-class", firstName: "Local", lastName: "Pupil", fullName: "Local Pupil", comments: "PRIVATE student note" });
    await db.subjectStudentLinks.put({ id: "moodle-local-ssl", subjectId: "moodle-local-subject", studentId: "moodle-local-student" });
    await db.tasks.put({ id: "moodle-local-task", title: "My existing task", description: "PRIVATE task instructions", sessionCount: 2, sendToGradebook: true });
    await db.taskSubjectLinks.put({ id: "moodle-local-tsl", taskId: "moodle-local-task", subjectId: "moodle-local-subject" });
    await db.taskGradebookConfigs.put({ id: "moodle-local-config", taskId: "moodle-local-task", classId: "moodle-local-class", subjectId: "moodle-local-subject", gradebookWeight: 1, directGradeEnabled: true });
    await db.taskDirectGrades.put({ id: "moodle-local-grade", taskId: "moodle-local-task", classId: "moodle-local-class", subjectId: "moodle-local-subject", studentId: "moodle-local-student", score: 6 });
    sessionStorage.setItem("profeplus_backup_reminder_dismissed", "1");
  });
}
