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
  "core_group_get_course_groups",
  "core_group_get_group_members",
  "core_course_get_contents",
  "mod_assign_get_assignments",
  "mod_assign_get_grades",
  "mod_assign_get_submissions",
  "core_grading_get_definitions",
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
        return response(request, [{ id: 11, firstname: "Ana", lastname: "Example", fullname: "Ana Example", email: "ana@example.test" }]);
      case "core_group_get_course_groups":
        return response(request, [{ id: 31, courseid: 5, name: "Group A", description: "", descriptionformat: 1, enrolmentkey: "" }]);
      case "core_group_get_group_members":
        return response(request, [{ groupid: 31, userids: [11] }]);
      case "core_course_get_contents":
        return response(request, [{
          id: 1,
          name: "Topic",
          summary: "",
          summaryformat: 1,
          modules: [
            { id: 501, instance: 91, contextid: 701, name: "Worksheet", modname: "assign", url: `${SERVER}mod/assign/view.php?id=501` },
            { id: 502, instance: 12, contextid: 702, name: "Reference page", modname: "page", url: `${SERVER}mod/page/view.php?id=502` }
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
          body[0].modules.push({ id: 503, instance: 92, name: "Restricted task", modname: "assign", url: `${SERVER}mod/assign/view.php?id=503` });
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
      expect.objectContaining({ id: 502, instanceId: 12, module: "page", title: "Reference page" })
    ]);
    expect(snapshot.grades).toEqual([expect.objectContaining({ activityId: 501, userId: 11, grade: 17.5 })]);
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
    expect(snapshot.warnings.join(" ")).toMatch(/grupos y miembros/);
    expect(snapshot.warnings.join(" ")).toMatch(/calificaciones/);
    expect(snapshot.warnings.join(" ")).toMatch(/entregas/);
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
