import { proxyMessage, type ProxyRequest, type ProxyResponse } from "../backup/nextcloud";
import type {
  MoodleActivity,
  MoodleCourse,
  MoodleCourseSnapshot,
  MoodleGrade,
  MoodleGroup,
  MoodleSite,
  MoodleSubmission,
  MoodleUser
} from "./types";

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 45_000;
const ROSTER_PAGE_SIZE = 100;
const MAX_ROSTER_USERS = 10_000;
const TOKEN_PATTERN = /^[a-zA-Z0-9]+$/;
const FUNCTION_PATTERN = /^[a-z][a-z0-9_]{0,127}$/;
const MODULE_PATTERN = /^[a-z][a-z0-9_]{0,79}$/;
const SAFE_CODE_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;

const FUNCTIONS = {
  siteInfo: "core_webservice_get_site_info",
  courses: "core_enrol_get_users_courses",
  users: "core_enrol_get_enrolled_users",
  courseGroups: "core_group_get_course_groups",
  groupMembers: "core_group_get_group_members",
  contents: "core_course_get_contents",
  assignments: "mod_assign_get_assignments",
  grades: "mod_assign_get_grades",
  submissions: "mod_assign_get_submissions",
  gradingDefinitions: "core_grading_get_definitions"
} as const;

const READ_ONLY_FUNCTIONS = new Set<string>(Object.values(FUNCTIONS));

type MoodleFunction = typeof FUNCTIONS[keyof typeof FUNCTIONS];
type FormValue = string | number | boolean | readonly FormValue[] | { readonly [key: string]: FormValue };
type RecordValue = Record<string, unknown>;

export type ProxyTransport = (request: ProxyRequest, signal?: AbortSignal) => Promise<ProxyResponse>;

export type MoodleClient = {
  getSiteInfo(): Promise<MoodleSite>;
  getCourses(): Promise<MoodleCourse[]>;
  getCourseSnapshot(course: MoodleCourse): Promise<MoodleCourseSnapshot>;
  dispose(): void;
};

type AssignmentWire = {
  id: number;
  cmid: number;
  course: number;
  name: string;
  dueDate: number;
  grade: number;
  teamSubmission: boolean;
};

type CourseModuleWire = { id: number; instanceId: number; module: string; name: string; url?: string; contextId?: number };
type MoodleWarning = { code?: string; item?: string; itemId?: number };

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(functionName: string): never {
  throw new Error(`Moodle devolvió una respuesta no válida para ${functionName}. Actualiza los datos antes de continuar.`);
}

function asRecord(value: unknown, functionName: string): RecordValue {
  if (!isRecord(value)) invalidResponse(functionName);
  return value;
}

function asArray(value: unknown, functionName: string): unknown[] {
  if (!Array.isArray(value)) invalidResponse(functionName);
  return value;
}

function asString(value: unknown, functionName: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) invalidResponse(functionName);
  return value;
}

function asInteger(value: unknown, functionName: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) invalidResponse(functionName);
  return value as number;
}

function asNumber(value: unknown, functionName: string): number {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  if (!Number.isFinite(number)) invalidResponse(functionName);
  return number;
}

function asBooleanFlag(value: unknown, functionName: string): boolean {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  invalidResponse(functionName);
}

function appendForm(params: URLSearchParams, key: string, value: FormValue): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => appendForm(params, `${key}[${index}]`, entry));
    return;
  }
  if (typeof value === "object" && value !== null) {
    Object.entries(value).forEach(([childKey, entry]) => appendForm(params, `${key}[${childKey}]`, entry));
    return;
  }
  params.append(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
}

function normalizePath(pathname: string): string {
  const path = pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  return `${path || ""}/`;
}

/** Returns an HTTPS Moodle installation URL with one trailing slash. */
export function normalizeMoodleUrl(server: string): string {
  let url: URL;
  try {
    url = new URL(server.trim());
  } catch {
    throw new Error("Introduce una dirección HTTPS válida para Moodle.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Usa la dirección HTTPS de Moodle, sin credenciales, parámetros ni fragmentos.");
  }
  if (/\/webservice\/rest\/server\.php\/?$/i.test(url.pathname)) {
    throw new Error("Introduce la dirección de la instalación de Moodle, no la del servicio REST.");
  }
  url.pathname = normalizePath(url.pathname);
  return url.href;
}

function abortMessage(): Error {
  return new Error("La operación con Moodle se interrumpió. Actualiza los datos antes de volver a intentarlo.");
}

/** Proxy-extension transport with Moodle-specific validation and errors. */
export const moodleProxyFetch: ProxyTransport = async (request, signal) => {
  let result: unknown;
  try {
    result = await proxyMessage("bridge-request", request, signal);
  } catch {
    if (signal?.aborted) throw abortMessage();
    throw new Error("La extensión Proxy no pudo completar la petición a Moodle. Revisa sus permisos y vuelve a intentarlo.");
  }
  if (!isRecord(result) || !Number.isInteger(result.status) || typeof result.bodyText !== "string" || typeof result.finalUrl !== "string") {
    throw new Error("Proxy devolvió una respuesta no válida para Moodle. Actualiza la extensión.");
  }
  let finalUrl: string;
  try {
    finalUrl = new URL(result.finalUrl).href;
  } catch {
    throw new Error("Proxy devolvió una dirección de respuesta no válida para Moodle.");
  }
  if (finalUrl !== new URL(request.url).href) {
    throw new Error("Moodle redirigió la petición. Comprueba la dirección del servidor; no se aceptan redirecciones.");
  }
  if (new TextEncoder().encode(result.bodyText).length > MAX_RESPONSE_BYTES) {
    throw new Error("La respuesta de Moodle supera el límite de 10 MiB.");
  }
  return result as ProxyResponse;
};

function redactedException(value: RecordValue): Error | undefined {
  if (typeof value.exception !== "string" && typeof value.errorcode !== "string") return undefined;
  const rawCode = typeof value.errorcode === "string" ? value.errorcode : value.exception;
  const code = typeof rawCode === "string" && SAFE_CODE_PATTERN.test(rawCode) ? ` (código ${rawCode})` : "";
  return new Error(`Moodle rechazó la petición${code}. Revisa los permisos del servicio web.`);
}

function warningDetails(value: unknown, functionName: string): MoodleWarning[] {
  return asArray(value, functionName).map((entry) => {
    const warning = asRecord(entry, functionName);
    const codeValue = warning.warningcode ?? warning.errorcode;
    const code = typeof codeValue === "string" && SAFE_CODE_PATTERN.test(codeValue) ? codeValue : undefined;
    const item = typeof warning.item === "string" && SAFE_CODE_PATTERN.test(warning.item) ? warning.item : undefined;
    const itemId = Number.isSafeInteger(warning.itemid) && (warning.itemid as number) >= 0 ? warning.itemid as number : undefined;
    return { code, item, itemId };
  });
}

function warningText(functionName: string, warning: MoodleWarning): string {
  const details = [warning.code ? `código ${warning.code}` : undefined,
    warning.item ? `${warning.item}${warning.itemId === undefined ? "" : ` ${warning.itemId}`}` : undefined]
    .filter(Boolean).join(", ");
  return `Moodle devolvió un aviso en ${functionName}${details ? ` (${details})` : ""}; el resultado puede estar incompleto.`;
}

function warningsFromEnvelope(envelope: RecordValue, functionName: string): string[] {
  if (!("warnings" in envelope)) invalidResponse(functionName);
  const warnings = warningDetails(envelope.warnings, functionName);
  return warnings.map((warning) => warningText(functionName, warning));
}

function stableUniqueIntegers(values: unknown, functionName: string): number[] {
  const result = asArray(values, functionName).map((value) => asInteger(value, functionName, 1));
  if (new Set(result).size !== result.length) invalidResponse(functionName);
  return result;
}

function ensureCourse(course: MoodleCourse): void {
  if (!Number.isSafeInteger(course.id) || course.id <= 0 || !course.fullName?.trim() || !course.shortName?.trim()) {
    throw new Error("El curso de Moodle seleccionado no es válido.");
  }
}

function safeActivityUrl(raw: unknown, base: URL, module: string, cmid: number): string {
  const fallback = new URL(`mod/${encodeURIComponent(module)}/view.php?id=${cmid}`, base).href;
  if (typeof raw !== "string") return fallback;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.origin !== base.origin ||
      url.pathname !== new URL(`mod/${encodeURIComponent(module)}/view.php`, base).pathname ||
      url.searchParams.size !== 1 || url.searchParams.get("id") !== String(cmid) || url.hash) return fallback;
    return url.href;
  } catch {
    return fallback;
  }
}

export function createMoodleClient(
  server: string,
  token: string,
  options: { transport?: ProxyTransport; signal?: AbortSignal } = {}
): MoodleClient {
  const normalizedServer = normalizeMoodleUrl(server);
  const endpoint = new URL("webservice/rest/server.php", normalizedServer);
  const baseUrl = new URL(normalizedServer);
  const transport = options.transport ?? moodleProxyFetch;
  const lifetime = new AbortController();
  let tokenValue = token.trim();
  let disposed = false;
  let sitePromise: Promise<MoodleSite> | undefined;

  if (!tokenValue || tokenValue.length > 256 || !TOKEN_PATTERN.test(tokenValue)) {
    throw new Error("Introduce un token válido del servicio web de Moodle.");
  }

  const stop = () => lifetime.abort();
  if (options.signal?.aborted) stop();
  else options.signal?.addEventListener("abort", stop, { once: true });

  const ensureActive = () => {
    if (disposed || lifetime.signal.aborted || !tokenValue) throw abortMessage();
  };

  const call = async (functionName: MoodleFunction, parameters: Record<string, FormValue> = {}): Promise<unknown> => {
    ensureActive();
    if (!READ_ONLY_FUNCTIONS.has(functionName)) {
      throw new Error("Edunoza solo permite funciones de lectura en Moodle.");
    }
    const body = new URLSearchParams();
    body.set("wstoken", tokenValue);
    body.set("wsfunction", functionName);
    body.set("moodlewsrestformat", "json");
    Object.entries(parameters).forEach(([key, value]) => appendForm(body, key, value));

    const requestController = new AbortController();
    const abortRequest = () => requestController.abort();
    lifetime.signal.addEventListener("abort", abortRequest, { once: true });
    const timer = globalThis.setTimeout(abortRequest, REQUEST_TIMEOUT_MS);
    const abortPromise = new Promise<never>((_resolve, reject) => {
      requestController.signal.addEventListener("abort", () => reject(abortMessage()), { once: true });
    });
    let response: ProxyResponse;
    try {
      response = await Promise.race([
        transport({
          url: endpoint.href,
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Accept: "application/json" },
          body: body.toString(),
          responseType: "text"
        }, requestController.signal),
        abortPromise
      ]);
    } catch {
      if (requestController.signal.aborted || lifetime.signal.aborted || disposed) throw abortMessage();
      throw new Error("No se pudo completar la petición a Moodle. Comprueba la conexión y los permisos de Proxy.");
    } finally {
      globalThis.clearTimeout(timer);
      lifetime.signal.removeEventListener("abort", abortRequest);
    }
    ensureActive();
    if (!response || !Number.isInteger(response.status) || typeof response.bodyText !== "string" || typeof response.finalUrl !== "string") {
      throw new Error("Proxy devolvió una respuesta no válida para Moodle. Actualiza la extensión.");
    }
    let responseUrl: string;
    try {
      responseUrl = new URL(response.finalUrl).href;
    } catch {
      throw new Error("Proxy devolvió una dirección de respuesta no válida para Moodle.");
    }
    if (responseUrl !== endpoint.href) {
      throw new Error("Moodle redirigió la petición. Comprueba la dirección del servidor; no se aceptan redirecciones.");
    }
    if (new TextEncoder().encode(response.bodyText).length > MAX_RESPONSE_BYTES) {
      throw new Error("La respuesta de Moodle supera el límite de 10 MiB.");
    }
    if (response.status !== 200) {
      throw new Error(`Moodle devolvió un error HTTP ${response.status}. No se ha confirmado la operación.`);
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(response.bodyText);
    } catch {
      throw new Error("Moodle no devolvió una respuesta JSON válida.");
    }
    ensureActive();
    if (isRecord(decoded)) {
      const exception = redactedException(decoded);
      if (exception) throw exception;
    }
    return decoded;
  };

  const readSiteInfo = async (): Promise<MoodleSite> => {
    const value = asRecord(await call(FUNCTIONS.siteInfo), FUNCTIONS.siteInfo);
    const functions = asArray(value.functions, FUNCTIONS.siteInfo).map((entry) => {
      const record = asRecord(entry, FUNCTIONS.siteInfo);
      const name = asString(record.name, FUNCTIONS.siteInfo);
      if (!FUNCTION_PATTERN.test(name)) invalidResponse(FUNCTIONS.siteInfo);
      return name;
    });
    const siteUrl = normalizeMoodleUrl(asString(value.siteurl, FUNCTIONS.siteInfo));
    if (siteUrl !== normalizedServer) {
      throw new Error("Moodle identifica esta instalación con otra dirección. Usa la dirección canónica indicada por el centro.");
    }
    return {
      siteUrl,
      siteName: asString(value.sitename, FUNCTIONS.siteInfo),
      userId: asInteger(value.userid, FUNCTIONS.siteInfo, 1),
      fullName: asString(value.fullname, FUNCTIONS.siteInfo),
      functions: [...new Set(functions)].sort()
    };
  };

  const getSiteInfo = (): Promise<MoodleSite> => {
    ensureActive();
    if (!sitePromise) {
      sitePromise = readSiteInfo().catch((error) => {
        sitePromise = undefined;
        throw error;
      });
    }
    return sitePromise;
  };

  const requireFunction = async (functionName: MoodleFunction): Promise<MoodleSite> => {
    const site = await getSiteInfo();
    if (!site.functions.includes(functionName)) {
      throw new Error(`El servicio web de Moodle no permite ${functionName}. Solicita al administrador que habilite esa función.`);
    }
    return site;
  };

  const getCourses = async (): Promise<MoodleCourse[]> => {
    const site = await requireFunction(FUNCTIONS.courses);
    const values = asArray(await call(FUNCTIONS.courses, { userid: site.userId, returnusercount: false }), FUNCTIONS.courses);
    const seen = new Set<number>();
    return values.map((entry) => {
      const record = asRecord(entry, FUNCTIONS.courses);
      const id = asInteger(record.id, FUNCTIONS.courses, 1);
      if (seen.has(id)) invalidResponse(FUNCTIONS.courses);
      seen.add(id);
      return {
        id,
        fullName: asString(record.fullname, FUNCTIONS.courses),
        shortName: asString(record.shortname, FUNCTIONS.courses)
      };
    });
  };

  const getRoster = async (courseId: number): Promise<MoodleUser[]> => {
    const students: MoodleUser[] = [];
    const seen = new Set<number>();
    for (let offset = 0; ; offset += ROSTER_PAGE_SIZE) {
      if (offset >= MAX_ROSTER_USERS) {
        throw new Error(`La matrícula de Moodle supera el límite seguro de ${MAX_ROSTER_USERS} personas; no se usará una lista parcial.`);
      }
      const page = asArray(await call(FUNCTIONS.users, {
        courseid: courseId,
        options: [
          { name: "withcapability", value: "mod/assign:submit" },
          { name: "onlyactive", value: 1 },
          { name: "limitfrom", value: offset },
          { name: "limitnumber", value: ROSTER_PAGE_SIZE },
          { name: "sortby", value: "id" },
          { name: "sortdirection", value: "ASC" }
        ]
      }), FUNCTIONS.users);
      for (const entry of page) {
        const record = asRecord(entry, FUNCTIONS.users);
        const id = asInteger(record.id, FUNCTIONS.users, 1);
        if (seen.has(id)) {
          throw new Error("La matrícula de Moodle cambió durante la descarga; actualízala para evitar una lista parcial.");
        }
        seen.add(id);
        const firstName = typeof record.firstname === "string" ? record.firstname : "";
        const lastName = typeof record.lastname === "string" ? record.lastname : "";
        const fullName = asString(record.fullname, FUNCTIONS.users);
        const email = typeof record.email === "string" && record.email.trim() ? record.email : undefined;
        students.push({ id, firstName, lastName, fullName, ...(email ? { email } : {}) });
      }
      if (page.length < ROSTER_PAGE_SIZE) break;
    }
    return students;
  };

  const getCourseModules = async (courseId: number): Promise<Map<number, CourseModuleWire>> => {
    const sections = asArray(await call(FUNCTIONS.contents, { courseid: courseId }), FUNCTIONS.contents);
    const modules = new Map<number, CourseModuleWire>();
    for (const sectionValue of sections) {
      const section = asRecord(sectionValue, FUNCTIONS.contents);
      for (const moduleValue of asArray(section.modules, FUNCTIONS.contents)) {
        const module = asRecord(moduleValue, FUNCTIONS.contents);
        const id = asInteger(module.id, FUNCTIONS.contents, 1);
        const instanceId = asInteger(module.instance, FUNCTIONS.contents, 1);
        const moduleName = asString(module.modname, FUNCTIONS.contents);
        if (!MODULE_PATTERN.test(moduleName) || modules.has(id)) invalidResponse(FUNCTIONS.contents);
        const contextId = Number.isSafeInteger(module.contextid) && (module.contextid as number) > 0 ? module.contextid as number : undefined;
        modules.set(id, {
          id,
          instanceId,
          module: moduleName,
          name: asString(module.name, FUNCTIONS.contents),
          ...(typeof module.url === "string" ? { url: module.url } : {}),
          ...(contextId ? { contextId } : {})
        });
      }
    }
    return modules;
  };

  const getAssignments = async (courseId: number): Promise<{ assignments: AssignmentWire[]; warnings: string[] }> => {
    const envelope = asRecord(await call(FUNCTIONS.assignments, { courseids: [courseId] }), FUNCTIONS.assignments);
    const warnings = warningsFromEnvelope(envelope, FUNCTIONS.assignments);
    const courses = asArray(envelope.courses, FUNCTIONS.assignments);
    const matching = courses.filter((entry) => asInteger(asRecord(entry, FUNCTIONS.assignments).id, FUNCTIONS.assignments, 1) === courseId);
    if (matching.length > 1 || courses.length !== matching.length) invalidResponse(FUNCTIONS.assignments);
    if (matching.length === 0) {
      const details = warningDetails(envelope.warnings, FUNCTIONS.assignments);
      if (!details.some((warning) => warning.itemId === courseId)) invalidResponse(FUNCTIONS.assignments);
      return { assignments: [], warnings };
    }
    const course = asRecord(matching[0], FUNCTIONS.assignments);
    const seenIds = new Set<number>();
    const seenCmids = new Set<number>();
    const assignments = asArray(course.assignments, FUNCTIONS.assignments).map((entry): AssignmentWire => {
      const record = asRecord(entry, FUNCTIONS.assignments);
      const id = asInteger(record.id, FUNCTIONS.assignments, 1);
      const cmid = asInteger(record.cmid, FUNCTIONS.assignments, 1);
      const recordCourse = asInteger(record.course, FUNCTIONS.assignments, 1);
      if (recordCourse !== courseId || seenIds.has(id) || seenCmids.has(cmid)) invalidResponse(FUNCTIONS.assignments);
      seenIds.add(id);
      seenCmids.add(cmid);
      return {
        id,
        cmid,
        course: recordCourse,
        name: asString(record.name, FUNCTIONS.assignments),
        dueDate: asInteger(record.duedate, FUNCTIONS.assignments),
        grade: asNumber(record.grade, FUNCTIONS.assignments),
        teamSubmission: asBooleanFlag(record.teamsubmission, FUNCTIONS.assignments)
      };
    });
    return { assignments, warnings };
  };

  const getGroups = async (courseId: number): Promise<MoodleGroup[]> => {
    const groupValues = asArray(await call(FUNCTIONS.courseGroups, { courseid: courseId }), FUNCTIONS.courseGroups);
    const groups = groupValues.map((entry) => {
      const record = asRecord(entry, FUNCTIONS.courseGroups);
      const id = asInteger(record.id, FUNCTIONS.courseGroups, 1);
      const returnedCourse = asInteger(record.courseid, FUNCTIONS.courseGroups, 1);
      if (returnedCourse !== courseId) invalidResponse(FUNCTIONS.courseGroups);
      return { id, courseId, name: asString(record.name, FUNCTIONS.courseGroups) };
    });
    const ids = groups.map((group) => group.id);
    if (new Set(ids).size !== ids.length) invalidResponse(FUNCTIONS.courseGroups);
    if (ids.length === 0) return [];
    const memberValues = asArray(await call(FUNCTIONS.groupMembers, { groupids: ids }), FUNCTIONS.groupMembers);
    const members = new Map<number, number[]>();
    for (const entry of memberValues) {
      const record = asRecord(entry, FUNCTIONS.groupMembers);
      const groupId = asInteger(record.groupid, FUNCTIONS.groupMembers, 1);
      if (!ids.includes(groupId) || members.has(groupId)) invalidResponse(FUNCTIONS.groupMembers);
      members.set(groupId, stableUniqueIntegers(record.userids, FUNCTIONS.groupMembers));
    }
    if (members.size !== ids.length) invalidResponse(FUNCTIONS.groupMembers);
    return groups.map((group) => ({ ...group, memberIds: members.get(group.id)! }));
  };

  const readGrades = async (assignmentIds: number[]): Promise<{ grades: MoodleGrade[]; warnings: string[] }> => {
    if (assignmentIds.length === 0) return { grades: [], warnings: [] };
    const envelope = asRecord(await call(FUNCTIONS.grades, { assignmentids: assignmentIds, since: 0 }), FUNCTIONS.grades);
    const warnings = warningsFromEnvelope(envelope, FUNCTIONS.grades);
    const warningRecords = warningDetails(envelope.warnings, FUNCTIONS.grades);
    const allowed = new Set(assignmentIds);
    const grades: MoodleGrade[] = [];
    const seen = new Set<string>();
    const returnedAssignments = new Set<number>();
    for (const assignmentValue of asArray(envelope.assignments, FUNCTIONS.grades)) {
      const assignment = asRecord(assignmentValue, FUNCTIONS.grades);
      const assignmentId = asInteger(assignment.assignmentid, FUNCTIONS.grades, 1);
      if (!allowed.has(assignmentId) || returnedAssignments.has(assignmentId)) invalidResponse(FUNCTIONS.grades);
      returnedAssignments.add(assignmentId);
      for (const gradeValue of asArray(assignment.grades, FUNCTIONS.grades)) {
        const grade = asRecord(gradeValue, FUNCTIONS.grades);
        const userId = asInteger(grade.userid, FUNCTIONS.grades, 1);
        const attemptNumber = asInteger(grade.attemptnumber, FUNCTIONS.grades);
        const key = `${assignmentId}:${userId}`;
        if (seen.has(key)) invalidResponse(FUNCTIONS.grades);
        seen.add(key);
        const numericGrade = asNumber(grade.grade, FUNCTIONS.grades);
        grades.push({
          activityId: assignmentId,
          userId,
          grade: numericGrade < 0 ? null : numericGrade,
          modifiedAt: asInteger(grade.timemodified, FUNCTIONS.grades),
          attemptNumber
        });
      }
    }
    for (const assignmentId of assignmentIds) {
      if (!returnedAssignments.has(assignmentId) && !warningRecords.some((warning) => warning.itemId === assignmentId)) {
        invalidResponse(FUNCTIONS.grades);
      }
    }
    return { grades, warnings };
  };

  const readSubmissions = async (assignmentIds: number[]): Promise<{ submissions: MoodleSubmission[]; warnings: string[] }> => {
    if (assignmentIds.length === 0) return { submissions: [], warnings: [] };
    const envelope = asRecord(await call(FUNCTIONS.submissions, {
      assignmentids: assignmentIds,
      status: "",
      since: 0,
      before: 0
    }), FUNCTIONS.submissions);
    const warnings = warningsFromEnvelope(envelope, FUNCTIONS.submissions);
    const warningRecords = warningDetails(envelope.warnings, FUNCTIONS.submissions);
    const allowed = new Set(assignmentIds);
    const submissions: MoodleSubmission[] = [];
    const seen = new Set<string>();
    const returnedAssignments = new Set<number>();
    for (const assignmentValue of asArray(envelope.assignments, FUNCTIONS.submissions)) {
      const assignment = asRecord(assignmentValue, FUNCTIONS.submissions);
      const assignmentId = asInteger(assignment.assignmentid, FUNCTIONS.submissions, 1);
      if (!allowed.has(assignmentId) || returnedAssignments.has(assignmentId)) invalidResponse(FUNCTIONS.submissions);
      returnedAssignments.add(assignmentId);
      for (const submissionValue of asArray(assignment.submissions, FUNCTIONS.submissions)) {
        const submission = asRecord(submissionValue, FUNCTIONS.submissions);
        const userId = asInteger(submission.userid, FUNCTIONS.submissions, 1);
        const key = `${assignmentId}:${userId}`;
        if (seen.has(key)) invalidResponse(FUNCTIONS.submissions);
        seen.add(key);
        submissions.push({
          activityId: assignmentId,
          userId,
          status: asString(submission.status, FUNCTIONS.submissions, true),
          modifiedAt: asInteger(submission.timemodified, FUNCTIONS.submissions)
        });
      }
    }
    for (const assignmentId of assignmentIds) {
      if (!returnedAssignments.has(assignmentId) && !warningRecords.some((warning) => warning.itemId === assignmentId)) {
        invalidResponse(FUNCTIONS.submissions);
      }
    }
    return { submissions, warnings };
  };

  const getAdvancedGrading = async (modules: CourseModuleWire[]): Promise<{ byCmid: Map<number, boolean>; warnings: string[] }> => {
    const byCmid = new Map<number, boolean>();
    if (modules.length === 0) return { byCmid, warnings: [] };
    const site = await getSiteInfo();
    if (!site.functions.includes(FUNCTIONS.gradingDefinitions)) {
      return {
        byCmid,
        warnings: ["Moodle no permite comprobar el método de evaluación de las tareas. Puedes revisar cada nota e importar solo su resultado numérico. No se copiarán los criterios de rúbricas o guías."]
      };
    }
    const envelope = asRecord(await call(FUNCTIONS.gradingDefinitions, {
      cmids: modules.map((module) => module.id),
      areaname: "submissions",
      activeonly: true
    }), FUNCTIONS.gradingDefinitions);
    const warnings = warningsFromEnvelope(envelope, FUNCTIONS.gradingDefinitions);
    const warningRecords = warningDetails(envelope.warnings, FUNCTIONS.gradingDefinitions);
    const hasUnscopedWarning = warningRecords.some((warning) =>
      warning.item !== "module" || !modules.some((module) => module.id === warning.itemId));
    const warnedModules = new Set(warningRecords.map((warning) => warning.itemId));
    const returnedModules = new Set<number>();
    for (const areaValue of asArray(envelope.areas, FUNCTIONS.gradingDefinitions)) {
      const area = asRecord(areaValue, FUNCTIONS.gradingDefinitions);
      const cmid = asInteger(area.cmid, FUNCTIONS.gradingDefinitions, 1);
      if (!modules.some((module) => module.id === cmid) || returnedModules.has(cmid)) invalidResponse(FUNCTIONS.gradingDefinitions);
      returnedModules.add(cmid);
      if (area.activemethod != null && typeof area.activemethod !== "string") invalidResponse(FUNCTIONS.gradingDefinitions);
      const activeMethod = typeof area.activemethod === "string" ? area.activemethod.trim() : "";
      if (!hasUnscopedWarning && !warnedModules.has(cmid)) byCmid.set(cmid, activeMethod !== "");
    }
    if (modules.some((module) => !byCmid.has(module.id))) {
      warnings.push("No se ha podido comprobar el método de evaluación de algunas tareas. Puedes importar sus resultados numéricos tras revisarlos y elegirlos individualmente.");
    }
    return { byCmid, warnings };
  };

  const getCourseSnapshot = async (course: MoodleCourse): Promise<MoodleCourseSnapshot> => {
    ensureCourse(course);
    const site = await getSiteInfo();
    for (const functionName of [FUNCTIONS.users, FUNCTIONS.contents, FUNCTIONS.assignments]) {
      if (!site.functions.includes(functionName)) {
        throw new Error(`El servicio web de Moodle no permite ${functionName}; no se creará una instantánea parcial del curso.`);
      }
    }
    const warnings: string[] = [];
    const supportsGroups = site.functions.includes(FUNCTIONS.courseGroups) && site.functions.includes(FUNCTIONS.groupMembers);
    if (!supportsGroups) warnings.push("El servicio web de Moodle no permite leer grupos y miembros; no se mostrarán como una lista vacía confirmada.");
    const [students, modules, assignmentResult, groups] = await Promise.all([
      getRoster(course.id),
      getCourseModules(course.id),
      getAssignments(course.id),
      supportsGroups ? getGroups(course.id) : Promise.resolve([])
    ]);
    warnings.push(...assignmentResult.warnings);
    const assignmentModules = assignmentResult.assignments.map((assignment) => {
      const module = modules.get(assignment.cmid);
      if (!module || module.module !== "assign" || module.instanceId !== assignment.id) {
        throw new Error("Moodle devolvió identificadores de tarea incoherentes; no se mezclarán cmid e id de instancia.");
      }
      return module;
    });
    const grading = await getAdvancedGrading(assignmentModules);
    warnings.push(...grading.warnings);
    const assignmentsByCmid = new Map(assignmentResult.assignments.map((assignment) => [assignment.cmid, assignment]));
    const activities: MoodleActivity[] = [...modules.values()].map((module) => {
      const assignment = assignmentsByCmid.get(module.id);
      if (!assignment) {
        return {
          id: module.id,
          courseId: course.id,
          instanceId: module.instanceId,
          module: module.module,
          title: module.name,
          url: safeActivityUrl(module.url, baseUrl, module.module, module.id)
        };
      }
      const advancedGrading = grading.byCmid.get(assignment.cmid);
      return {
        id: assignment.cmid,
        courseId: course.id,
        instanceId: assignment.id,
        module: "assign",
        title: assignment.name || module.name,
        url: safeActivityUrl(module.url, baseUrl, module.module, assignment.cmid),
        ...(assignment.dueDate > 0 ? { dueDate: assignment.dueDate } : {}),
        ...(assignment.grade > 0 ? { gradeMax: assignment.grade } : {}),
        ...(advancedGrading === undefined ? {} : { advancedGrading }),
        teamSubmission: assignment.teamSubmission
      };
    });
    const assignmentIds = assignmentResult.assignments.map((assignment) => assignment.id);
    const assignmentCmid = new Map(assignmentResult.assignments.map((assignment) => [assignment.id, assignment.cmid]));
    let grades: MoodleGrade[] = [];
    let submissions: MoodleSubmission[] = [];
    if (site.functions.includes(FUNCTIONS.grades)) {
      const result = await readGrades(assignmentIds);
      grades = result.grades.map((grade) => ({ ...grade, activityId: assignmentCmid.get(grade.activityId)! }));
      warnings.push(...result.warnings);
    } else {
      warnings.push("El servicio web de Moodle no permite leer calificaciones; no se mostrarán como una lista vacía confirmada.");
    }
    if (site.functions.includes(FUNCTIONS.submissions)) {
      const result = await readSubmissions(assignmentIds);
      submissions = result.submissions.map((submission) => ({ ...submission, activityId: assignmentCmid.get(submission.activityId)! }));
      warnings.push(...result.warnings);
    } else {
      warnings.push("El servicio web de Moodle no permite leer entregas; no se mostrarán como una lista vacía confirmada.");
    }
    ensureActive();
    return {
      course,
      groups,
      students,
      activities,
      grades,
      submissions,
      warnings: [...new Set(warnings)],
      fetchedAt: new Date().toISOString()
    };
  };

  return {
    getSiteInfo,
    getCourses,
    getCourseSnapshot,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      tokenValue = "";
      options.signal?.removeEventListener("abort", stop);
      lifetime.abort();
      sitePromise = undefined;
    }
  };
}
