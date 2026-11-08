import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMoodleClient,
  normalizeMoodleUrl,
  type ProxyTransport
} from "./client";
import type { ProxyRequest } from "../backup/nextcloud";

const SERVER = "https://school.example/ies/aula/";
const ENDPOINT = `${SERVER}webservice/rest/server.php`;
const TOKEN = "abc123TOKEN";

afterEach(() => vi.useRealTimers());

const allFunctions = [
  "core_webservice_get_site_info",
  "core_enrol_get_users_courses",
  "core_enrol_get_enrolled_users",
  "core_course_get_contents",
  "mod_assign_get_assignments",
  "mod_assign_get_grades",
  "mod_assign_get_submissions",
  "core_grading_get_definitions",
  "gradereport_user_get_grade_items",
  // The account may expose writes, but this client must never call them.
  "mod_assign_save_grade"
];

function siteInfo(functions = allFunctions) {
  return {
    sitename: "Synthetic school",
    siteurl: SERVER,
    userid: 42,
    fullname: "Synthetic Teacher",
    functions: functions.map((name) => ({ name, version: "2024100700" }))
  };
}

function response(request: ProxyRequest, body: unknown, overrides: Partial<{ status: number; finalUrl: string }> = {}) {
  return {
    status: overrides.status ?? 200,
    bodyText: JSON.stringify(body),
    finalUrl: overrides.finalUrl ?? request.url
  };
}

function functionName(request: ProxyRequest): string {
  return new URLSearchParams(request.body).get("wsfunction") ?? "";
}

function fixtureTransport(requests: ProxyRequest[] = []): ProxyTransport {
  return async (request) => {
    requests.push(request);
    const params = new URLSearchParams(request.body);
    switch (functionName(request)) {
      case "core_webservice_get_site_info":
        return response(request, siteInfo());
      case "core_enrol_get_users_courses":
        return response(request, [{ id: 5, fullname: "Mathematics", shortname: "MATH" }]);
      case "core_enrol_get_enrolled_users":
        return response(request, [{ id: 11, firstname: "Ana", lastname: "Example", fullname: "Ana Example", email: "ana@example.test", groups: [{ id: 31, name: "Group A", description: "" }] }]);
      case "core_course_get_contents":
        return response(request, [{
          id: 1,
          name: "Topic",
          summary: "",
          summaryformat: 1,
          modules: [
            { id: 501, instance: 91, contextid: 701, name: "Worksheet", modname: "assign", url: `${SERVER}mod/assign/view.php?id=501` },
            { id: 502, instance: 12, contextid: 702, name: "Reference page", modname: "page", url: `${SERVER}mod/page/view.php?id=502` },
            { id: 505, instance: 13, contextid: 703, name: "Unit quiz", modname: "quiz", url: `${SERVER}mod/quiz/view.php?id=505` },
            { id: 506, instance: 14, contextid: 704, name: "Scaled forum", modname: "forum", url: `${SERVER}mod/forum/view.php?id=506` }
          ]
        }]);
      case "mod_assign_get_assignments":
        return response(request, {
          courses: [{ id: 5, fullname: "Mathematics", shortname: "MATH", timemodified: 1, assignments: [{
            id: 91,
            cmid: 501,
            course: 5,
            name: "Worksheet",
            nosubmissions: 0,
            submissiondrafts: 0,
            sendnotifications: 0,
            sendlatenotifications: 0,
            sendstudentnotifications: 0,
            duedate: 1_800_000_000,
            allowsubmissionsfromdate: 0,
            grade: 20,
            timemodified: 1,
            completionsubmit: 0,
            cutoffdate: 0,
            gradingduedate: 0,
            teamsubmission: 0,
            requireallteammemberssubmit: 0,
            teamsubmissiongroupingid: 0,
            blindmarking: 0,
            hidegrader: 0,
            revealidentities: 0,
            attemptreopenmethod: "none",
            maxattempts: -1,
            markingworkflow: 0,
            markingallocation: 0,
            markinganonymous: 0,
            requiresubmissionstatement: 0,
            configs: []
          }] }],
          warnings: []
        });
      case "core_grading_get_definitions":
        return response(request, { areas: [{ cmid: 501, activemethod: "", definitions: [] }], warnings: [] });
      case "mod_assign_get_grades":
        expect(params.get("assignmentids[0]")).toBe("91");
        return response(request, { assignments: [{ assignmentid: 91, grades: [{ id: 1, userid: 11, attemptnumber: 0, timecreated: 10, timemodified: 20, grader: 42, grade: "17.5" }] }], warnings: [] });
      case "mod_assign_get_submissions":
        expect(params.get("assignmentids[0]")).toBe("91");
        return response(request, { assignments: [{ assignmentid: 91, submissions: [{ id: 2, userid: 11, attemptnumber: 0, timecreated: 8, timemodified: 9, status: "submitted", groupid: 0 }] }], warnings: [] });
      case "gradereport_user_get_grade_items":
        expect(params.get("userid")).toBe("0");
        return response(request, { usergrades: [{ courseid: 5, userid: 11, userfullname: "Ana Example", maxdepth: 2, gradeitems: [
          { id: 1, itemname: "Worksheet", itemtype: "mod", itemmodule: "assign", iteminstance: 91, itemnumber: 0, cmid: 501, scaleid: 0, graderaw: 15, grademin: 0, grademax: 20, gradedategraded: 30 },
          { id: 2, itemname: "Unit quiz", itemtype: "mod", itemmodule: "quiz", iteminstance: 13, itemnumber: 0, cmid: 505, scaleid: 0, graderaw: 8.5, grademin: 0, grademax: 10, gradedategraded: 40 },
          { id: 3, itemname: "Scaled forum", itemtype: "mod", itemmodule: "forum", iteminstance: 14, itemnumber: 0, cmid: 506, scaleid: 2, graderaw: 3, grademin: 1, grademax: 4 },
          { id: 4, itemname: "Manual", itemtype: "manual", itemnumber: 0, scaleid: 0, graderaw: 9, grademin: 0, grademax: 10 },
          { id: 5, itemname: null, itemtype: "course", itemnumber: 0, scaleid: 0, graderaw: 50, grademin: 0, grademax: 100 }
        ] }], warnings: [] });
      default:
        throw new Error("Unexpected function");
    }
  };
}

describe("Moodle URL and transport safety", () => {
  it("normalizes installation-relative HTTPS paths", () => {
    expect(normalizeMoodleUrl(" HTTPS://School.Example//ies/aula/// ")).toBe(SERVER);
  });

  it.each([
    "http://school.example/aula",
    "https://user:secret@school.example/aula",
    "https://school.example/aula?token=secret",
    "https://school.example/aula#fragment",
    "https://school.example/aula/webservice/rest/server.php"
  ])("rejects unsafe Moodle installation URL %s", (server) => {
    expect(() => normalizeMoodleUrl(server)).toThrow();
  });

  it("sends the token only in a POST form body", async () => {
    const requests: ProxyRequest[] = [];
    const site = await createMoodleClient(SERVER, TOKEN, { transport: fixtureTransport(requests) }).getSiteInfo();
    expect(site.userId).toBe(42);
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe("POST");
    expect(requests[0].url).toBe(ENDPOINT);
    expect(requests[0].url).not.toContain(TOKEN);
    expect(new URLSearchParams(requests[0].body).get("wstoken")).toBe(TOKEN);
    expect(requests[0].headers["Content-Type"]).toContain("application/x-www-form-urlencoded");
  });

  it("rejects redirects and redacts Moodle exception details", async () => {
    const redirect: ProxyTransport = async (request) => response(request, siteInfo(), { finalUrl: "https://evil.example/rest" });
    await expect(createMoodleClient(SERVER, TOKEN, { transport: redirect }).getSiteInfo()).rejects.toThrow("redirigió");

    const exception: ProxyTransport = async (request) => response(request, {
      exception: "moodle_exception",
      errorcode: "invalidtoken",
      message: `Leaked ${TOKEN}`,
      debuginfo: `wstoken=${TOKEN}`
    });
    const error = await createMoodleClient(SERVER, TOKEN, { transport: exception }).getSiteInfo().catch((reason: unknown) => reason);
    expect(String(error)).toContain("invalidtoken");
    expect(String(error)).not.toContain(TOKEN);
  });

  it("blocks late transport output after disposal", async () => {
    let release: ((value: ReturnType<typeof response>) => void) | undefined;
    let captured: ProxyRequest | undefined;
    const transport: ProxyTransport = (request) => {
      captured = request;
      return new Promise((resolve) => { release = resolve; });
    };
    const client = createMoodleClient(SERVER, TOKEN, { transport });
    const pending = client.getSiteInfo();
    client.dispose();
    release!(response(captured!, siteInfo()));
    await expect(pending).rejects.toThrow("interrumpió");
    await expect(client.getCourses()).rejects.toThrow("interrumpió");
  });

  it("enforces response-size and request-time limits", async () => {
    const oversized: ProxyTransport = async (request) => ({
      status: 200,
      bodyText: "x".repeat(10 * 1024 * 1024 + 1),
      finalUrl: request.url
    });
    await expect(createMoodleClient(SERVER, TOKEN, { transport: oversized }).getSiteInfo()).rejects.toThrow("10 MiB");

    vi.useFakeTimers();
    const pendingTransport: ProxyTransport = () => new Promise(() => undefined);
    const pending = expect(createMoodleClient(SERVER, TOKEN, { transport: pendingTransport }).getSiteInfo()).rejects.toThrow("interrumpió");
    await vi.advanceTimersByTimeAsync(45_000);
    await pending;
  });
});

describe("Moodle read-only protocol adapter", () => {
  it("keeps verified direct grades available when a different module has a permission warning", async () => {
    const baseTransport = fixtureTransport();
    const transport: ProxyTransport = async (request, signal) => {
      const base = await baseTransport(request, signal);
      const body = JSON.parse(base.bodyText);
      switch (functionName(request)) {
        case "core_course_get_contents":
          body[0].modules.push({ id: 503, instance: 92, name: "Restricted task", modname: "assign", url: `${SERVER}mod/assign/view.php?id=505` });
          break;
        case "mod_assign_get_assignments":
          body.courses[0].assignments.push({ ...body.courses[0].assignments[0], id: 92, cmid: 503, name: "Restricted task" });
          break;
        case "mod_assign_get_grades":
          body.assignments.push({ assignmentid: 92, grades: [] });
          break;
        case "mod_assign_get_submissions":
          body.assignments.push({ assignmentid: 92, submissions: [] });
          break;
        case "core_grading_get_definitions":
          body.warnings = [{ item: "module", itemid: 503, warningcode: "1", message: `private ${TOKEN}` }];
          break;
      }
      return response(request, body);
    };
    const snapshot = await createMoodleClient(SERVER, TOKEN, { transport })
      .getCourseSnapshot({ id: 5, fullName: "Mathematics", shortName: "MATH" });
    expect(snapshot.activities.find(activity => activity.id === 501)?.advancedGrading).toBe(false);
    expect(snapshot.activities.find(activity => activity.id === 503)?.advancedGrading).toBeUndefined();
    expect(snapshot.grades[0].grade).toBe(17.5);
    expect(snapshot.warnings.join(" ")).not.toContain(TOKEN);
  });

  it.each(["missing", "unscoped-warning", "unavailable"])("does not classify unverified grading as direct or rubric: %s", async (mode) => {
    const baseTransport = fixtureTransport();
    const transport: ProxyTransport = async (request, signal) => {
      if (mode === "unavailable" && functionName(request) === "core_webservice_get_site_info") {
        return response(request, siteInfo(allFunctions.filter(name => name !== "core_grading_get_definitions")));
      }
      if (functionName(request) === "core_grading_get_definitions") {
        return response(request, {
          areas: mode === "missing" ? [] : [{ cmid: 501, activemethod: "", definitions: [] }],
          warnings: mode === "unscoped-warning" ? [{ warningcode: "1", message: "Private warning" }] : []
        });
      }
      return baseTransport(request, signal);
    };
    const snapshot = await createMoodleClient(SERVER, TOKEN, { transport })
      .getCourseSnapshot({ id: 5, fullName: "Mathematics", shortName: "MATH" });
    expect(snapshot.activities.find(activity => activity.id === 501)?.advancedGrading).toBeUndefined();
    expect(snapshot.warnings.length).toBeGreaterThan(0);
    if (mode === "unavailable") {
      expect(snapshot.warnings.join(" ")).toContain("importar solo su resultado numérico");
      expect(snapshot.warnings.join(" ")).toContain("No se copiarán los criterios");
    }
  });

  it("gates course reads using the token function allowlist", async () => {
    const requests: ProxyRequest[] = [];
    const transport: ProxyTransport = async (request) => {
      requests.push(request);
      return response(request, siteInfo(["core_webservice_get_site_info"]));
    };
    await expect(createMoodleClient(SERVER, TOKEN, { transport }).getCourses()).rejects.toThrow("core_enrol_get_users_courses");
    expect(requests.map(functionName)).toEqual(["core_webservice_get_site_info"]);
  });

  it("maps real envelopes, keeps cmid separate from assignment id, and includes non-assignment activities", async () => {
    const requests: ProxyRequest[] = [];
    const client = createMoodleClient(SERVER, TOKEN, { transport: fixtureTransport(requests) });
    await expect(client.getCourses()).resolves.toEqual([{ id: 5, fullName: "Mathematics", shortName: "MATH" }]);
    const snapshot = await client.getCourseSnapshot({ id: 5, fullName: "Mathematics", shortName: "MATH" });
    expect(snapshot.students).toEqual([{ id: 11, firstName: "Ana", lastName: "Example", fullName: "Ana Example", email: "ana@example.test" }]);
    expect(snapshot.groups).toEqual([{ id: 31, courseId: 5, name: "Group A", memberIds: [11] }]);
    expect(snapshot.activities).toEqual([
      expect.objectContaining({ id: 501, instanceId: 91, module: "assign", gradeMax: 20, advancedGrading: false }),
      expect.objectContaining({ id: 502, instanceId: 12, module: "page", title: "Reference page" }),
      expect.objectContaining({ id: 505, module: "quiz", gradeMax: 10, advancedGrading: false }),
      expect.objectContaining({ id: 506, module: "forum" })
    ]);
    expect(snapshot.activities[1]).not.toHaveProperty("gradeMax");
    expect(snapshot.activities[3]).not.toHaveProperty("gradeMax");
    // Assignment grades still come from mod_assign; the gradebook adds the quiz; scales are skipped.
    expect(snapshot.grades).toEqual([
      expect.objectContaining({ activityId: 501, userId: 11, grade: 17.5 }),
      expect.objectContaining({ activityId: 505, userId: 11, grade: 8.5, modifiedAt: 40 })
    ]);
    expect(snapshot.warnings.join(" ")).toContain("escalas");
    expect(snapshot.submissions).toEqual([expect.objectContaining({ activityId: 501, userId: 11, status: "submitted" })]);

    const rosterRequest = requests.find((request) => functionName(request) === "core_enrol_get_enrolled_users")!;
    const rosterParams = new URLSearchParams(rosterRequest.body);
    expect(rosterParams.get("options[0][name]")).toBe("withcapability");
    expect(rosterParams.get("options[0][value]")).toBe("mod/assign:submit");
    const calledFunctions = requests.map(functionName);
    expect(calledFunctions).not.toContain("mod_assign_save_grade");
    expect(calledFunctions.every((name) => name !== "mod_assign_save_grade")).toBe(true);
    expect("publishGrade" in client).toBe(false);
  });

  it("paginates the active student roster and refuses duplicate cross-page results", async () => {
    const rosterOffsets: number[] = [];
    const transport: ProxyTransport = async (request) => {
      const params = new URLSearchParams(request.body);
      const name = functionName(request);
      if (name === "core_webservice_get_site_info") {
        return response(request, siteInfo([
          "core_webservice_get_site_info",
          "core_enrol_get_enrolled_users",
          "core_course_get_contents",
          "mod_assign_get_assignments"
        ]));
      }
      if (name === "core_enrol_get_enrolled_users") {
        const offset = Number(params.get("options[2][value]"));
        rosterOffsets.push(offset);
        const users = offset === 0
          ? Array.from({ length: 100 }, (_, index) => ({ id: index + 1, firstname: "", lastname: "", fullname: `Student ${index + 1}` }))
          : [{ id: 100, firstname: "", lastname: "", fullname: "Duplicate student" }];
        return response(request, users);
      }
      if (name === "core_course_get_contents") return response(request, []);
      if (name === "mod_assign_get_assignments") {
        return response(request, { courses: [{ id: 5, assignments: [] }], warnings: [] });
      }
      throw new Error(`Unexpected ${name}`);
    };
    await expect(createMoodleClient(SERVER, TOKEN, { transport }).getCourseSnapshot({ id: 5, fullName: "Math", shortName: "M" }))
      .rejects.toThrow("cambió durante la descarga");
    expect(rosterOffsets).toEqual([0, 100]);
  });

  it("reports unavailable optional reads instead of presenting confirmed empty remote data", async () => {
    const transport: ProxyTransport = async (request) => {
      switch (functionName(request)) {
        case "core_webservice_get_site_info":
          return response(request, siteInfo([
            "core_webservice_get_site_info",
            "core_enrol_get_enrolled_users",
            "core_course_get_contents",
            "mod_assign_get_assignments"
          ]));
        case "core_enrol_get_enrolled_users":
        case "core_course_get_contents":
          return response(request, []);
        case "mod_assign_get_assignments":
          return response(request, { courses: [{ id: 5, assignments: [] }], warnings: [] });
        default:
          throw new Error("Unexpected function");
      }
    };
    const snapshot = await createMoodleClient(SERVER, TOKEN, { transport })
      .getCourseSnapshot({ id: 5, fullName: "Math", shortName: "M" });
    expect(snapshot.groups).toEqual([]);
    expect(snapshot.grades).toEqual([]);
    expect(snapshot.submissions).toEqual([]);
    expect(snapshot.warnings.join(" ")).toMatch(/calificaciones/);
    expect(snapshot.warnings.join(" ")).toMatch(/entregas/);
  });

  it("reads grades from the gradebook when the service lacks mod_assign_get_grades (plain mobile service)", async () => {
    const base = fixtureTransport();
    const requests: string[] = [];
    const transport: ProxyTransport = async (request, signal) => {
      requests.push(functionName(request));
      if (functionName(request) === "core_webservice_get_site_info") {
        return response(request, siteInfo(allFunctions.filter((name) => name !== "mod_assign_get_grades" && name !== "core_grading_get_definitions")));
      }
      return base(request, signal);
    };
    const snapshot = await createMoodleClient(SERVER, TOKEN, { transport })
      .getCourseSnapshot({ id: 5, fullName: "Mathematics", shortName: "MATH" });
    expect(requests).not.toContain("mod_assign_get_grades");
    expect(snapshot.grades).toEqual([
      expect.objectContaining({ activityId: 501, grade: 15 }),
      expect.objectContaining({ activityId: 505, grade: 8.5 })
    ]);
    expect(snapshot.groups).toEqual([{ id: 31, courseId: 5, name: "Group A", memberIds: [11] }]);
  });

  it("keeps the snapshot when the gradebook rejects the request", async () => {
    const base = fixtureTransport();
    const transport: ProxyTransport = async (request, signal) => functionName(request) === "gradereport_user_get_grade_items"
      ? response(request, { exception: "required_capability_exception", errorcode: "nopermissions", message: `x ${TOKEN}` })
      : base(request, signal);
    const snapshot = await createMoodleClient(SERVER, TOKEN, { transport })
      .getCourseSnapshot({ id: 5, fullName: "Mathematics", shortName: "MATH" });
    expect(snapshot.grades).toEqual([expect.objectContaining({ activityId: 501, grade: 17.5 })]);
    expect(snapshot.warnings.join(" ")).toContain("nopermissions");
    expect(snapshot.warnings.join(" ")).not.toContain(TOKEN);
  });

  it("surfaces Moodle warning envelopes without echoing remote messages", async () => {
    const transport = fixtureTransport();
    const warningTransport: ProxyTransport = async (request, signal) => {
      if (functionName(request) === "mod_assign_get_grades") {
        return response(request, {
          assignments: [],
          warnings: [{ item: "assignment", itemid: 91, warningcode: "3", message: `secret ${TOKEN}` }]
        });
      }
      return transport(request, signal);
    };
    const snapshot = await createMoodleClient(SERVER, TOKEN, { transport: warningTransport })
      .getCourseSnapshot({ id: 5, fullName: "Mathematics", shortName: "MATH" });
    expect(snapshot.warnings.join(" ")).toContain("código 3");
    expect(snapshot.warnings.join(" ")).not.toContain(TOKEN);
  });
});
