import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAppDispatch } from "../../app/hooks";
import { setSelectedClass, setSelectedSubject } from "../../app/store";
import { obtainMoodleToken } from "../../shared/moodle/auth";
import { hasConnectionPreference, useConnectionPreference } from "../../shared/hooks/useConnectionPreference";
import { readMoodleToken, removeMoodleToken, saveMoodleToken } from "../../shared/moodle/credentials";
import { db } from "../../shared/db/database";
import type { ClassGroup, Student, Subject, Task } from "../../shared/db/types";
import { createMoodleClient, normalizeMoodleUrl, type MoodleClient } from "../../shared/moodle/client";
import {
  applyGrades,
  applyMappingPreview,
  applyUpdates,
  createLocalScope,
  createMappingPreview,
  forgetConnection,
  getBindings,
  getOperations,
  listConnections,
  previewGrades,
  previewUpdates,
  saveConnection,
  type MoodleGradePreview,
  type MoodleGradePreviewRow,
  type MoodleGradeResolution,
  type MoodleGradeSkip,
  type MoodleUpdatePreview
} from "../../shared/moodle/service";
import type {
  MoodleActivity,
  MoodleBinding,
  MoodleConnection,
  MoodleCourse,
  MoodleCourseSnapshot,
  MoodleMappingChoice,
  MoodleOperation,
  MoodleResolution,
  MoodleScope
} from "../../shared/moodle/types";
import { MoodleWorkflowStepper, type MoodleWorkflowStep } from "./MoodleWorkflowStepper";
import "./MoodleSettingsPage.css";

const NEW_CLASS_OPTION = "__create__";
const NEW_SUBJECT_OPTION = "__create__";

type Step = "connect" | "scope" | "link" | "apply" | "done";
type Notice = { tone: "info" | "success" | "error"; text: string };
type BusyAction = "connect" | "snapshot" | "scope-create" | "mapping-apply" | "review-preview" | "review-apply" | "forget" | null;
type MappingDraft = { action: MoodleMappingChoice["action"]; localId?: string };
/** `null` means the teacher still has to choose. */
type MappingDecision = MappingDraft | null;
type ImportSummary = {
  classId: string;
  subjectId: string;
  imported: number;
  updates: number;
  tasks: Array<{ taskId: string; title: string; count: number; weight: number }>;
  unweightedTaskCount: number;
};

const dateFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});
const gradeFormatter = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 });

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "Operación cancelada.";
  return error instanceof Error ? error.message : "No se pudo completar la operación.";
}

function formatDate(value?: number | string): string {
  if (value === undefined) return "Sin fecha";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? "Fecha no disponible" : dateFormatter.format(date);
}

function formatGrade(value: number | null): string {
  return value === null ? "sin nota" : gradeFormatter.format(value);
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function mappingKey(kind: "student" | "activity", remoteId: number): string {
  return `${kind}:${remoteId}`;
}

/** Exact match only (accents/case/whitespace-insensitive). Similar names are never enough. */
function normalizeNameForMatch(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}

function findExactNameMatch(label: string, candidates: Array<{ id: string; label: string }>): { id: string; label: string } | undefined {
  const normalized = normalizeNameForMatch(label);
  if (!normalized) return undefined;
  const matches = candidates.filter((candidate) => normalizeNameForMatch(candidate.label) === normalized);
  return matches.length === 1 ? matches[0] : undefined;
}

function capabilityLabel(name: string): string {
  const labels: Record<string, string> = {
    core_enrol_get_enrolled_users: "Participantes",
    core_course_get_contents: "Actividades",
    mod_assign_get_assignments: "Tareas",
    mod_assign_get_grades: "Notas de tareas",
    gradereport_user_get_grade_items: "Calificador (cuestionarios y otras actividades)",
    mod_assign_get_submissions: "Estado de entregas"
  };
  return labels[name] ?? name;
}

function moduleLabel(module: string): string {
  return ({ assign: "Tarea", quiz: "Cuestionario", forum: "Foro", workshop: "Taller", lesson: "Lección", glossary: "Glosario", h5pactivity: "H5P", scorm: "SCORM" } as Record<string, string>)[module] ?? module;
}

function fieldLabel(field: string): string {
  return ({ firstName: "Nombre", lastName: "Apellidos", fullName: "Nombre completo", email: "Correo", title: "Título" } as Record<string, string>)[field] ?? field;
}

function operationKindLabel(kind: MoodleOperation["kind"]): string {
  return ({ link: "emparejamiento", update: "cambios de nombre", grades: "notas" })[kind];
}

function submissionStatusLabel(status: string): string {
  return ({ submitted: "Entregada", new: "Sin entregar", draft: "Borrador", graded: "Calificada", reopened: "Reabierta" } as Record<string, string>)[status.toLowerCase()] ?? status;
}

function encodeDecision(decision: MappingDecision): string {
  if (!decision) return "";
  return decision.action === "link" ? `link:${decision.localId ?? ""}` : decision.action;
}

function decodeDecision(value: string): MappingDraft | undefined {
  if (value.startsWith("link:")) return { action: "link", localId: value.slice(5) };
  if (value === "create" || value === "ignore" || value === "unlink") return { action: value };
  return undefined;
}

export function MoodleSettingsPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const clientRef = useRef<MoodleClient | null>(null);
  const pendingClientRef = useRef<MoodleClient | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestVersionRef = useRef(0);
  const restorePreviousServer = useRef(!hasConnectionPreference("moodle.server"));

  const [busy, setBusy] = useState<BusyAction>(null);
  const [step, setStep] = useState<Step>("connect");
  const [notice, setNotice] = useState<Notice>({ tone: "info", text: "Conecta tu cuenta de Moodle para empezar." });

  const [server, setServer] = useConnectionPreference("moodle.server");
  const [token, setToken] = useState(() => readMoodleToken(server)?.token ?? "");
  const [hasSavedToken, setHasSavedToken] = useState(() => Boolean(readMoodleToken(server)));
  const [authMode, setAuthMode] = useConnectionPreference("moodle.authMode", "token");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [service, setService] = useConnectionPreference("moodle.service", "moodle_mobile_app");
  const [showAdvancedAuth, setShowAdvancedAuth] = useState(false);
  const [showKnownConnections, setShowKnownConnections] = useState(false);
  const [connections, setConnections] = useState<MoodleConnection[]>([]);
  const [connection, setConnection] = useState<MoodleConnection | null>(null);
  const [forgetTarget, setForgetTarget] = useState<string | null>(null);

  const [courses, setCourses] = useState<MoodleCourse[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [newClassName, setNewClassName] = useState("");
  const [newClassLevel, setNewClassLevel] = useState("");
  const [newSchoolYear, setNewSchoolYear] = useState("");
  const [newSubjectName, setNewSubjectName] = useState("");
  const [snapshot, setSnapshot] = useState<MoodleCourseSnapshot | null>(null);
  const [bindings, setBindings] = useState<MoodleBinding[]>([]);
  const [operations, setOperations] = useState<MoodleOperation[]>([]);
  const [classes, setClasses] = useState<ClassGroup[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [subjectCourseKeys, setSubjectCourseKeys] = useState<Set<string>>(new Set());
  const [taskSubjectKeys, setTaskSubjectKeys] = useState<Set<string>>(new Set());

  const [mappingDrafts, setMappingDrafts] = useState<Record<string, MappingDraft>>({});
  const [mappingErrors, setMappingErrors] = useState<string[]>([]);
  const [updatePreview, setUpdatePreview] = useState<MoodleUpdatePreview | null>(null);
  const [updateResolutions, setUpdateResolutions] = useState<Record<string, MoodleResolution>>({});
  const [gradePreview, setGradePreview] = useState<MoodleGradePreview | null>(null);
  /** Only rows whose Moodle grade differs from an existing local grade need a choice. */
  const [conflictChoices, setConflictChoices] = useState<Record<string, "local" | "remote">>({});
  /** Activities graded with a rubric (or an unverified method) whose final grade the teacher accepted. */
  const [confirmedNumericActivities, setConfirmedNumericActivities] = useState<Set<number>>(new Set());
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const cancelPending = (announce = false): void => {
    requestVersionRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    pendingClientRef.current?.dispose();
    pendingClientRef.current = null;
    setBusy(null);
    setPassword("");
    if (announce) setNotice({ tone: "info", text: "Operación cancelada. No se ha cambiado nada en Edunoza." });
  };

  const beginRequest = (action: Exclude<BusyAction, null>): { controller: AbortController; version: number } => {
    cancelPending();
    const controller = new AbortController();
    abortRef.current = controller;
    const version = requestVersionRef.current;
    setBusy(action);
    return { controller, version };
  };

  const isCurrent = (version: number): boolean => version === requestVersionRef.current;

  const reloadMetadata = async (connectionId?: string, version?: number): Promise<void> => {
    const [savedConnections, recentOperations] = await Promise.all([
      listConnections(),
      getOperations(connectionId, 8)
    ]);
    if (version !== undefined && !isCurrent(version)) return;
    setConnections(savedConnections);
    setOperations(recentOperations);
  };

  const reloadLocalCandidates = async (): Promise<void> => {
    const [localClasses, localSubjects, localStudents, localTasks, courseLinks, taskLinks] = await Promise.all([
      db.classGroups.orderBy("name").toArray(),
      db.subjects.orderBy("name").toArray(),
      db.students.toArray(),
      db.tasks.toArray(),
      db.subjectCourseLinks.toArray(),
      db.taskSubjectLinks.toArray()
    ]);
    setClasses(localClasses);
    setSubjects(localSubjects);
    setStudents(localStudents);
    setTasks(localTasks);
    setSubjectCourseKeys(new Set(courseLinks.map((link) => `${link.classId}:${link.subjectId}`)));
    setTaskSubjectKeys(new Set(taskLinks.map((link) => `${link.taskId}:${link.subjectId}`)));
  };

  useEffect(() => {
    let active = true;
    void Promise.all([
      listConnections(),
      getOperations(undefined, 8),
      db.classGroups.orderBy("name").toArray(),
      db.subjects.orderBy("name").toArray(),
      db.students.toArray(),
      db.tasks.toArray(),
      db.subjectCourseLinks.toArray(),
      db.taskSubjectLinks.toArray()
    ]).then(([savedConnections, recentOperations, localClasses, localSubjects, localStudents, localTasks, courseLinks, taskLinks]) => {
      if (!active) return;
      if (restorePreviousServer.current && savedConnections.length) {
        const previous = [...savedConnections].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
        setServer((current) => current || previous.server);
        setToken(readMoodleToken(previous.server)?.token ?? "");
        setHasSavedToken(Boolean(readMoodleToken(previous.server)));
        restorePreviousServer.current = false;
      }
      setConnections(savedConnections);
      setOperations(recentOperations);
      setClasses(localClasses);
      setSubjects(localSubjects);
      setStudents(localStudents);
      setTasks(localTasks);
      setSubjectCourseKeys(new Set(courseLinks.map((link) => `${link.classId}:${link.subjectId}`)));
      setTaskSubjectKeys(new Set(taskLinks.map((link) => `${link.taskId}:${link.subjectId}`)));
    }).catch((error) => {
      if (active) setNotice({ tone: "error", text: errorMessage(error) });
    });
    return () => {
      active = false;
      requestVersionRef.current += 1;
      abortRef.current?.abort();
      pendingClientRef.current?.dispose();
      pendingClientRef.current = null;
      clientRef.current?.dispose();
      clientRef.current = null;
    };
  }, [setServer]);

  const classIsNew = selectedClassId === NEW_CLASS_OPTION;
  const subjectIsNew = selectedSubjectId === NEW_SUBJECT_OPTION;
  const scope: MoodleScope | null = (!selectedCourseId || classIsNew || subjectIsNew || !selectedClassId || !selectedSubjectId) ? null : {
    courseId: Number(selectedCourseId),
    ...(selectedGroupId ? { remoteGroupId: Number(selectedGroupId) } : {}),
    classId: selectedClassId,
    subjectId: selectedSubjectId
  };
  const className = (classId: string) => classes.find((item) => item.id === classId)?.name ?? "Clase";
  const subjectName = (subjectId: string) => subjects.find((item) => item.id === subjectId)?.name ?? "Materia";
  const availableSubjects = classIsNew ? [] : subjects.filter((subject) => !selectedClassId || subjectCourseKeys.has(`${selectedClassId}:${subject.id}`));
  // Any student in the class is a valid target: linking enrolls them in the subject.
  const localStudents = scope ? students.filter((student) => student.classId === scope.classId) : [];
  const localTasks = scope ? tasks.filter((task) => taskSubjectKeys.has(`${task.id}:${scope.subjectId}`)) : [];
  // Assignments and any activity with a numeric gradebook item can carry grades; other resources stay out.
  const isGradable = (activity: { module: string; gradeMax?: number }) => activity.module === "assign" || activity.gradeMax !== undefined;
  const gradableActivities = (snapshot?.activities ?? []).filter(isGradable);
  const otherActivities = (snapshot?.activities ?? []).filter((activity) => !isGradable(activity));
  const scopedRemoteStudents = (() => {
    if (!snapshot) return [];
    if (!selectedGroupId) return snapshot.students;
    const memberIds = new Set(snapshot.groups.find((group) => group.id === Number(selectedGroupId))?.memberIds ?? []);
    return snapshot.students.filter((student) => memberIds.has(student.id));
  })();
  const scopedBindings = bindings.filter((item) => scope &&
    item.connectionId === connection?.id &&
    item.courseId === scope.courseId &&
    item.classId === scope.classId &&
    item.subjectId === scope.subjectId &&
    item.remoteGroupId === scope.remoteGroupId
  );
  const bindingFor = (kind: "student" | "activity", remoteId: number) =>
    scopedBindings.find((item) => item.kind === kind && item.remoteId === remoteId);
  const hasScopedLinks = scopedBindings.some((item) => item.kind === "student" || item.kind === "activity");

  // Exact, unambiguous name matches against local records that nothing else is linked to are
  // pre-selected. They are only saved when the teacher presses "Guardar", and can be changed.
  const autoMatches = (() => {
    const result = new Map<string, string>();
    const boundStudents = new Set(scopedBindings.filter((item) => item.kind === "student").map((item) => item.localId));
    const boundTasks = new Set(scopedBindings.filter((item) => item.kind === "activity").map((item) => item.localId));
    const studentCandidates = localStudents.filter((item) => !boundStudents.has(item.id)).map((item) => ({ id: item.id, label: item.fullName }));
    const taskCandidates = localTasks.filter((item) => !boundTasks.has(item.id)).map((item) => ({ id: item.id, label: item.title }));
    const uses = new Map<string, number>();
    const propose = (key: string, match?: { id: string }) => {
      if (!match) return;
      result.set(key, match.id);
      uses.set(match.id, (uses.get(match.id) ?? 0) + 1);
    };
    for (const student of scopedRemoteStudents) {
      if (!bindingFor("student", student.id)) propose(mappingKey("student", student.id), findExactNameMatch(student.fullName, studentCandidates));
    }
    for (const activity of gradableActivities) {
      if (!bindingFor("activity", activity.id)) propose(mappingKey("activity", activity.id), findExactNameMatch(activity.title, taskCandidates));
    }
    for (const [key, localId] of result) if ((uses.get(localId) ?? 0) > 1) result.delete(key);
    return result;
  })();
  const freeLocalStudentCount = (() => {
    const used = new Set([...scopedBindings.filter((item) => item.kind === "student").map((item) => item.localId), ...autoMatches.values()]);
    return localStudents.filter((item) => !used.has(item.id)).length;
  })();
  const studentDecision = (remoteId: number): MappingDecision => {
    const key = mappingKey("student", remoteId);
    const binding = bindingFor("student", remoteId);
    if (mappingDrafts[key]) return mappingDrafts[key];
    if (binding) return { action: "link", localId: binding.localId };
    if (autoMatches.has(key)) return { action: "link", localId: autoMatches.get(key) };
    // With unlinked students left in the class, a new record could duplicate one of them: ask.
    return freeLocalStudentCount > 0 ? null : { action: "create" };
  };
  const activityDecision = (remoteId: number): MappingDraft => {
    const key = mappingKey("activity", remoteId);
    const binding = bindingFor("activity", remoteId);
    if (mappingDrafts[key]) return mappingDrafts[key];
    if (binding) return { action: "link", localId: binding.localId };
    if (autoMatches.has(key)) return { action: "link", localId: autoMatches.get(key) };
    return { action: "create" };
  };
  const studentRows = scopedRemoteStudents.map((student) => ({ student, decision: studentDecision(student.id), binding: bindingFor("student", student.id) }));
  const matchedStudentRows = studentRows.filter((row) => row.decision?.action === "link" && !mappingDrafts[mappingKey("student", row.student.id)]);
  const attentionStudentRows = studentRows.filter((row) => !matchedStudentRows.includes(row));
  const undecidedCount = studentRows.filter((row) => row.decision === null).length;
  const newStudentCount = studentRows.filter((row) => row.decision?.action === "create").length;
  const linkedStudentCount = studentRows.filter((row) => row.decision?.action === "link").length;
  const unlinkedRemoteCount = scopedRemoteStudents.filter((item) => !bindingFor("student", item.id)).length +
    gradableActivities.filter((item) => !bindingFor("activity", item.id)).length;

  const hasValidServer = (() => {
    try {
      normalizeMoodleUrl(server);
      return true;
    } catch {
      return false;
    }
  })();
  const classFieldsValid = !classIsNew || (newClassName.trim().length > 0 && newClassLevel.trim().length > 0 && /^\d{4}-\d{4}$/.test(newSchoolYear));
  const subjectFieldsValid = !subjectIsNew || newSubjectName.trim().length > 0;
  const scopeReady = Boolean(snapshot && selectedClassId && classFieldsValid && selectedSubjectId && subjectFieldsValid);
  const previousImports = (() => {
    if (!connection) return [];
    const seen = new Map<string, MoodleBinding>();
    for (const item of bindings) {
      if (item.kind !== "course" || item.connectionId !== connection.id) continue;
      if (!courses.some((course) => course.id === item.courseId)) continue;
      if (!classes.some((entry) => entry.id === item.classId) || !subjects.some((entry) => entry.id === item.subjectId)) continue;
      seen.set(`${item.courseId}:${item.remoteGroupId ?? "all"}:${item.classId}:${item.subjectId}`, item);
    }
    return [...seen.values()];
  })();

  const steps: MoodleWorkflowStep[] = [
    { id: "scope", label: "Origen y destino", complete: Boolean(snapshot && scope && (step === "link" || step === "apply" || step === "done")) },
    { id: "link", label: "Emparejar", disabled: !snapshot || !scope, complete: hasScopedLinks && (step === "apply" || step === "done") },
    { id: "apply", label: "Notas", disabled: !snapshot || !scope || !hasScopedLinks, complete: step === "done" }
  ];

  const clearPreviews = (): void => {
    setMappingErrors([]);
    setUpdatePreview(null);
    setUpdateResolutions({});
    setGradePreview(null);
    setConflictChoices({});
    setConfirmedNumericActivities(new Set());
  };

  const resetScopeSelection = (): void => {
    setSelectedGroupId("");
    setSelectedClassId("");
    setSelectedSubjectId("");
    setNewClassName("");
    setNewClassLevel("");
    setNewSchoolYear("");
    setNewSubjectName("");
    setMappingDrafts({});
    clearPreviews();
  };

  const connect = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    let credential = token.trim();
    if (authMode === "token" ? !credential : !username.trim() || !password) return;
    const { version, controller } = beginRequest("connect");
    setNotice({ tone: "info", text: "Comprobando la cuenta de Moodle…" });
    try {
      const normalizedServer = normalizeMoodleUrl(server);
      if (authMode === "password") {
        credential = await obtainMoodleToken(normalizedServer, username, password, service, { signal: controller.signal });
        if (!isCurrent(version)) return;
      }
      const nextClient = createMoodleClient(normalizedServer, credential);
      pendingClientRef.current = nextClient;
      const [site, availableCourses] = await Promise.all([nextClient.getSiteInfo(), nextClient.getCourses()]);
      if (!isCurrent(version)) {
        nextClient.dispose();
        if (pendingClientRef.current === nextClient) pendingClientRef.current = null;
        return;
      }
      const savedConnection = await saveConnection(site, controller.signal);
      if (!isCurrent(version)) {
        nextClient.dispose();
        if (pendingClientRef.current === nextClient) pendingClientRef.current = null;
        return;
      }
      clientRef.current?.dispose();
      clientRef.current = nextClient;
      pendingClientRef.current = null;
      setConnection(savedConnection);
      const tokenSaved = saveMoodleToken(savedConnection.server, credential, savedConnection.userId);
      setHasSavedToken(tokenSaved);
      setAuthMode("token");
      setUsername("");
      setCourses(availableCourses);
      setServer(savedConnection.server);
      setToken("");
      setSelectedCourseId("");
      setSnapshot(null);
      setSummary(null);
      setStep("scope");
      const savedBindings = await getBindings(savedConnection.id);
      if (!isCurrent(version)) return;
      setBindings(savedBindings);
      await reloadMetadata(savedConnection.id, version);
      if (!isCurrent(version)) return;
      setNotice({ tone: "success", text: `Conectado a ${savedConnection.siteName} como ${savedConnection.userName}. ${tokenSaved ? "El token queda guardado en este navegador; el usuario y la contraseña no." : "El navegador no permitió guardar el token; solo estará disponible en esta sesión."}` });
    } catch (error) {
      if (isCurrent(version)) {
        pendingClientRef.current?.dispose();
        pendingClientRef.current = null;
        setNotice({ tone: "error", text: errorMessage(error) });
      }
    } finally {
      if (isCurrent(version)) setBusy(null);
    }
  };

  const disconnect = (): void => {
    cancelPending();
    clientRef.current?.dispose();
    clientRef.current = null;
    pendingClientRef.current?.dispose();
    pendingClientRef.current = null;
    setConnection(null);
    setToken(readMoodleToken(server)?.token ?? "");
    setHasSavedToken(Boolean(readMoodleToken(server)));
    setUsername("");
    setCourses([]);
    setSelectedCourseId("");
    resetScopeSelection();
    setSnapshot(null);
    setBindings([]);
    setSummary(null);
    setStep("connect");
    setNotice({ tone: "info", text: "Sesión desconectada. Los emparejamientos y los datos de Edunoza se conservan." });
  };

  /** Opens the grades step when this destination already has links; otherwise the matching step. */
  const goToReview = async (targetScope: MoodleScope, availableBindings: MoodleBinding[], targetSnapshot: MoodleCourseSnapshot | null = snapshot): Promise<void> => {
    const scopedForReview = availableBindings.some((item) =>
      item.connectionId === connection?.id &&
      item.courseId === targetScope.courseId &&
      item.classId === targetScope.classId &&
      item.subjectId === targetScope.subjectId &&
      item.remoteGroupId === targetScope.remoteGroupId &&
      (item.kind === "student" || item.kind === "activity")
    );
    if (!scopedForReview || !targetSnapshot || !connection) {
      setStep("link");
      return;
    }
    setStep("apply");
    const { version } = beginRequest("review-preview");
    try {
      const [updates, grades] = await Promise.all([
        previewUpdates(connection.id, targetSnapshot, targetScope),
        previewGrades(connection.id, targetSnapshot, targetScope)
      ]);
      if (!isCurrent(version)) return;
      setUpdatePreview(updates);
      setUpdateResolutions(Object.fromEntries(updates.rows.map((row) => [row.id, "local"])));
      setGradePreview(grades);
      setConflictChoices({});
      setConfirmedNumericActivities(new Set());
      setNotice({ tone: "info", text: "Notas preparadas. Revísalas antes de importarlas." });
    } catch (error) {
      if (isCurrent(version)) setNotice({ tone: "error", text: errorMessage(error) });
    } finally {
      if (isCurrent(version)) setBusy(null);
    }
  };

  const loadSnapshot = async (courseId: string): Promise<void> => {
    const client = clientRef.current;
    const course = courses.find((item) => item.id === Number(courseId));
    if (!client || !course || !connection) return;
    const { version } = beginRequest("snapshot");
    setNotice({ tone: "info", text: "Leyendo participantes, actividades y notas de Moodle…" });
    setSnapshot(null);
    setSummary(null);
    resetScopeSelection();
    try {
      const nextSnapshot = await client.getCourseSnapshot(course);
      if (!isCurrent(version)) return;
      const savedBindings = await getBindings(connection.id);
      if (!isCurrent(version)) return;
      // Set together so a restored destination never flashes the destination form first.
      setSnapshot(nextSnapshot);
      setBindings(savedBindings);
      const persistedScopes = savedBindings.filter((item) => item.kind === "course" && item.courseId === course.id);
      const uniqueScopes = [...new Map(persistedScopes.map((item) => [`${item.remoteGroupId ?? "all"}:${item.classId}:${item.subjectId}`, item])).values()];
      const restoredScope = uniqueScopes.length === 1 ? uniqueScopes[0] : undefined;
      const restoredScopeIsValid = restoredScope &&
        classes.some((item) => item.id === restoredScope.classId) &&
        subjects.some((item) => item.id === restoredScope.subjectId) &&
        subjectCourseKeys.has(`${restoredScope.classId}:${restoredScope.subjectId}`) &&
        (restoredScope.remoteGroupId === undefined || nextSnapshot.groups.some((item) => item.id === restoredScope.remoteGroupId));
      if (restoredScopeIsValid && restoredScope) {
        setSelectedGroupId(restoredScope.remoteGroupId?.toString() ?? "");
        setSelectedClassId(restoredScope.classId);
        setSelectedSubjectId(restoredScope.subjectId);
        const resolvedScope: MoodleScope = { courseId: course.id, ...(restoredScope.remoteGroupId === undefined ? {} : { remoteGroupId: restoredScope.remoteGroupId }), classId: restoredScope.classId, subjectId: restoredScope.subjectId };
        setNotice({ tone: nextSnapshot.warnings.length ? "info" : "success", text: nextSnapshot.warnings.length ? `Curso cargado con ${plural(nextSnapshot.warnings.length, "aviso", "avisos")} de Moodle. Revísalos antes de continuar.` : "Curso cargado con el destino que usaste la última vez." });
        if (nextSnapshot.warnings.length === 0) void goToReview(resolvedScope, savedBindings, nextSnapshot);
        else setStep("scope");
        return;
      }
      setStep("scope");
      setNotice({
        tone: nextSnapshot.warnings.length ? "info" : "success",
        text: nextSnapshot.warnings.length
          ? `Curso cargado con ${plural(nextSnapshot.warnings.length, "aviso", "avisos")} de Moodle.`
          : persistedScopes.length && uniqueScopes.length === 1
            ? "Curso cargado, pero la clase o materia que usaste antes ya no existe. Elige otra."
            : uniqueScopes.length > 1
              ? "Curso cargado. Lo importaste antes a varias clases; elige a cuál quieres traerlo."
              : "Curso cargado. Elige ahora la clase y la materia de Edunoza."
      });
    } catch (error) {
      if (isCurrent(version)) {
        setSnapshot(null);
        clearPreviews();
        setStep("scope");
        setNotice({ tone: "error", text: `${errorMessage(error)} Vuelve a cargar el curso para continuar.` });
      }
    } finally {
      if (isCurrent(version)) setBusy(null);
    }
  };

  const selectCourse = (courseId: string): void => {
    cancelPending();
    setSelectedCourseId(courseId);
    resetScopeSelection();
    setSnapshot(null);
    setSummary(null);
    if (courseId) void loadSnapshot(courseId);
  };

  const selectClass = (classId: string): void => {
    cancelPending();
    setSelectedClassId(classId);
    setSelectedSubjectId(classId === NEW_CLASS_OPTION ? NEW_SUBJECT_OPTION : "");
    if (classId === NEW_CLASS_OPTION && snapshot) {
      setNewClassName((current) => current || snapshot.course.shortName);
      setNewSubjectName((current) => current || snapshot.course.fullName);
    }
    clearPreviews();
  };

  const selectSubject = (subjectId: string): void => {
    setSelectedSubjectId(subjectId);
    if (subjectId === NEW_SUBJECT_OPTION && snapshot) setNewSubjectName((current) => current || snapshot.course.fullName);
    clearPreviews();
  };

  const setDraft = (kind: "student" | "activity", remoteId: number, draft: MappingDraft | undefined): void => {
    setMappingErrors([]);
    setMappingDrafts((current) => {
      const next = { ...current };
      if (draft) next[mappingKey(kind, remoteId)] = draft;
      else delete next[mappingKey(kind, remoteId)];
      return next;
    });
  };

  const saveMappings = async (): Promise<void> => {
    if (!connection || !snapshot || !scope || undecidedCount > 0) return;
    const choices: MoodleMappingChoice[] = [
      ...studentRows.map((row) => ({ kind: "student" as const, remoteId: row.student.id, ...(row.decision ?? { action: "ignore" as const }) })),
      ...gradableActivities.map((activity) => ({ kind: "activity" as const, remoteId: activity.id, ...activityDecision(activity.id) }))
    ];
    const { controller, version } = beginRequest("mapping-apply");
    try {
      const preview = await createMappingPreview(connection.id, snapshot, scope, choices);
      if (!isCurrent(version)) return;
      const invalid = preview.rows.filter((row) => row.status === "invalid");
      if (invalid.length) {
        setMappingErrors(invalid.map((row) => `${row.remoteLabel}: ${row.message ?? "revisa esta elección"}`));
        setNotice({ tone: "error", text: `No se ha guardado nada: ${plural(invalid.length, "elección necesita", "elecciones necesitan")} revisión.` });
        return;
      }
      const nextBindings = await applyMappingPreview(preview, controller.signal);
      if (!isCurrent(version)) return;
      setBindings(nextBindings);
      await reloadLocalCandidates();
      if (!isCurrent(version)) return;
      setMappingDrafts({});
      await reloadMetadata(connection.id, version);
      if (!isCurrent(version)) return;
      setNotice({ tone: "success", text: "Emparejamiento guardado. Preparando las notas…" });
      void goToReview(scope, nextBindings);
    } catch (error) {
      if (isCurrent(version)) setNotice({ tone: "error", text: errorMessage(error) });
    } finally {
      if (isCurrent(version)) setBusy(null);
    }
  };

  const activityById = new Map((snapshot?.activities ?? []).map((activity) => [activity.id, activity]));
  const gradeRows = gradePreview?.rows ?? [];
  const isNewGrade = (row: MoodleGradePreviewRow) => row.localGrade === null;
  const isSameGrade = (row: MoodleGradePreviewRow) => row.localGrade !== null && row.localGrade === row.scaledGrade;
  const isConflict = (row: MoodleGradePreviewRow) => !isNewGrade(row) && !isSameGrade(row);
  const numericOnlyActivities = [...new Map(gradeRows.filter((row) => row.gradingMethod !== "direct" && !isSameGrade(row))
    .map((row) => [row.activityId, row])).values()];
  const finalGradeResolution = (row: MoodleGradePreviewRow): MoodleGradeResolution => {
    const importResolution: MoodleGradeResolution = row.gradingMethod === "direct" ? "remote" : "numeric-result";
    if (row.gradingMethod !== "direct" && !confirmedNumericActivities.has(row.activityId)) return "local";
    if (isNewGrade(row)) return importResolution;
    if (isSameGrade(row)) return "local";
    return conflictChoices[row.id] === "remote" ? importResolution : "local";
  };
  const gradesToImport = gradeRows.filter((row) => finalGradeResolution(row) !== "local");
  const conflictRows = gradeRows.filter(isConflict);
  const updatesToApply = (updatePreview?.rows ?? []).filter((row) => updateResolutions[row.id] === "remote").length;
  const skippedGroups = (() => {
    const groups = new Map<string, { taskId: string; code: MoodleGradeSkip["code"]; reason: string; count: number }>();
    for (const skip of gradePreview?.skipped ?? []) {
      const key = `${skip.taskId}:${skip.code}`;
      const group = groups.get(key) ?? { taskId: skip.taskId, code: skip.code, reason: skip.reason, count: 0 };
      group.count += 1;
      groups.set(key, group);
    }
    return [...groups.values()];
  })();

  const applyChangesAndGrades = async (): Promise<void> => {
    if (!connection || !snapshot || !scope) return;
    const { controller, version } = beginRequest("review-apply");
    try {
      const updatesApplied = Boolean(updatePreview?.rows.length);
      if (updatesApplied && updatePreview) await applyUpdates(updatePreview, updateResolutions, controller.signal);
      if (!isCurrent(version)) return;
      let imported: MoodleGradePreviewRow[] = [];
      if (gradePreview?.rows.length) {
        // Applying name updates invalidates every preview for this scope: re-issue it first.
        const freshGradePreview = updatesApplied ? await previewGrades(connection.id, snapshot, scope) : gradePreview;
        if (!isCurrent(version)) return;
        const resolutions = Object.fromEntries(freshGradePreview.rows.map((row) => [row.id, finalGradeResolution(row)]));
        await applyGrades(freshGradePreview, resolutions, controller.signal);
        imported = freshGradePreview.rows.filter((row) => resolutions[row.id] !== "local");
      }
      if (!isCurrent(version)) return;
      const counts = new Map<string, number>();
      for (const row of imported) counts.set(row.taskId, (counts.get(row.taskId) ?? 0) + 1);
      const [configs, importedTasks] = await Promise.all([
        db.taskGradebookConfigs.where("[classId+subjectId]").equals([scope.classId, scope.subjectId]).toArray(),
        db.tasks.bulkGet([...counts.keys()])
      ]);
      if (!isCurrent(version)) return;
      const weightOf = (taskId: string) => Number(configs.find((config) => config.taskId === taskId)?.gradebookWeight ?? 0);
      const someTaskWeighted = configs.some((config) => Number(config.gradebookWeight ?? 0) > 0);
      const taskSummaries = [...counts].map(([taskId, count], index) => ({ taskId, title: importedTasks[index]?.title ?? "Tarea", count, weight: weightOf(taskId) }));
      await reloadLocalCandidates();
      if (!isCurrent(version)) return;
      clearPreviews();
      await reloadMetadata(connection.id, version);
      if (!isCurrent(version)) return;
      setSummary({
        classId: scope.classId,
        subjectId: scope.subjectId,
        imported: imported.length,
        updates: updatesToApply,
        tasks: taskSummaries,
        unweightedTaskCount: someTaskWeighted ? taskSummaries.filter((item) => item.weight <= 0).length : 0
      });
      setStep("done");
      setNotice({ tone: "success", text: imported.length ? `${plural(imported.length, "nota importada", "notas importadas")} al cuaderno.` : "Importación terminada. No había notas nuevas que traer." });
    } catch (error) {
      if (isCurrent(version)) setNotice({ tone: "error", text: errorMessage(error) });
    } finally {
      if (isCurrent(version)) setBusy(null);
    }
  };

  const confirmScope = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!selectedCourseId || !scopeReady) return;
    if (!classIsNew && !subjectIsNew && scope) {
      void goToReview(scope, bindings);
      return;
    }
    const { controller, version } = beginRequest("scope-create");
    try {
      const createdScope = await createLocalScope({
        courseId: Number(selectedCourseId),
        ...(selectedGroupId ? { remoteGroupId: Number(selectedGroupId) } : {}),
        ...(classIsNew ? {} : { existingClassId: selectedClassId }),
        className: newClassName,
        level: newClassLevel,
        schoolYear: newSchoolYear,
        subjectName: newSubjectName
      }, controller.signal);
      if (!isCurrent(version)) return;
      const [localClasses, localSubjects, links] = await Promise.all([db.classGroups.orderBy("name").toArray(), db.subjects.orderBy("name").toArray(), db.subjectCourseLinks.toArray()]);
      if (!isCurrent(version)) return;
      setClasses(localClasses);
      setSubjects(localSubjects);
      setSubjectCourseKeys(new Set(links.map((link) => `${link.classId}:${link.subjectId}`)));
      setSelectedClassId(createdScope.classId);
      setSelectedSubjectId(createdScope.subjectId);
      setNewClassName("");
      setNewClassLevel("");
      setNewSchoolYear("");
      setNewSubjectName("");
      setNotice({ tone: "success", text: classIsNew ? "Clase y materia creadas. Comprueba ahora el emparejamiento." : "Materia creada. Comprueba ahora el emparejamiento." });
      void goToReview(createdScope, bindings);
    } catch (error) {
      if (isCurrent(version)) setNotice({ tone: "error", text: errorMessage(error) });
    } finally {
      if (isCurrent(version)) setBusy(null);
    }
  };

  const confirmForget = async (id: string): Promise<void> => {
    const { controller, version } = beginRequest("forget");
    try {
      await forgetConnection(id, controller.signal);
      if (!isCurrent(version)) return;
      const forgotten = connections.find((item) => item.id === id);
      if (forgotten && !removeMoodleToken(forgotten.server, forgotten.userId)) throw new Error("Se eliminaron los emparejamientos, pero no se pudo borrar el token del navegador. Elimínalo desde los datos del sitio.");
      if (connection?.id === id) disconnect();
      setToken(readMoodleToken(server)?.token ?? "");
      setHasSavedToken(Boolean(readMoodleToken(server)));
      setForgetTarget(null);
      await reloadMetadata();
      setNotice({ tone: "success", text: "Cuenta olvidada junto con sus emparejamientos. No se ha borrado ningún dato de Edunoza." });
    } catch (error) {
      if (isCurrent(version)) setNotice({ tone: "error", text: errorMessage(error) });
    } finally {
      if (isCurrent(version)) setBusy(null);
    }
  };

  const openGradebook = (classId: string, subjectId: string): void => {
    dispatch(setSelectedClass(classId));
    dispatch(setSelectedSubject(subjectId));
    navigate("/gradebook");
  };

  const setAllConflicts = (choice: "local" | "remote"): void => {
    setConflictChoices(Object.fromEntries(conflictRows.map((row) => [row.id, choice])));
  };

  const importButtonLabel = gradesToImport.length
    ? `Importar ${plural(gradesToImport.length, "nota", "notas")} al cuaderno`
    : updatesToApply ? "Aplicar cambios" : "Terminar sin importar notas";

  return (
    <article className="management-card moodle-settings-page">
      <header className="moodle-page-heading">
        <div>
          <h1>Importar de Moodle</h1>
          <p>Trae alumnado, actividades y notas a tu cuaderno. Edunoza solo lee Moodle: nunca cambia nada allí.</p>
        </div>
        {connection ? <div className="moodle-actions"><span className="moodle-status connected">Conectado a {connection.siteName}</span><button type="button" className="btn secondary" onClick={disconnect}>Desconectar</button></div> : null}
      </header>

      <p className={`moodle-notice ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"} aria-live="polite">{notice.text}</p>

      {connection ? <MoodleWorkflowStepper steps={steps} activeStep={step} onStepChange={(id) => setStep(id as Step)} label="Pasos para importar datos de Moodle" /> : null}

      {step === "connect" || !connection ? (
        <section className="detail-section moodle-section" aria-labelledby="moodle-connection-title">
          <div className="moodle-section-heading">
            <div><h2 id="moodle-connection-title">Conectar cuenta</h2><p>Solo hace falta la primera vez: el token queda guardado en este navegador.</p></div>
          </div>
            <form className="moodle-connect-form" onSubmit={connect}>
              <label className="compact-field"><span>Dirección HTTPS</span><input className="input" type="url" required disabled={busy === "connect"} value={server} onChange={(event) => { restorePreviousServer.current = false; setServer(event.target.value); setToken(readMoodleToken(event.target.value)?.token ?? ""); setHasSavedToken(Boolean(readMoodleToken(event.target.value))); }} autoComplete="url" /></label>
              <p className="moodle-step-guidance">Introduce la dirección HTTPS exacta de la instalación de tu centro, incluyendo su ruta si la tiene.</p>
              {hasValidServer ? <>
                <label className="compact-field"><span>Forma de acceso</span><select className="input" value={authMode} disabled={busy === "connect"} onChange={(event) => { setAuthMode(event.target.value); setPassword(""); setToken(event.target.value === "token" ? readMoodleToken(server)?.token ?? "" : ""); }}><option value="token">Token manual</option><option value="password">Usuario y contraseña</option></select></label>
                {authMode === "token" ? <label className="compact-field"><span>Token del servicio web</span><input className="input" type="password" required disabled={busy === "connect"} value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" spellCheck={false} /></label> : <>
                  <label className="compact-field"><span>Usuario de Moodle</span><input className="input" required disabled={busy === "connect"} value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} /></label>
                  <label className="compact-field"><span>Contraseña de Moodle</span><input className="input" type="password" required disabled={busy === "connect"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="off" aria-describedby="moodle-password-help" /></label>
                  <p id="moodle-password-help">Proxy recibirá el usuario y la contraseña y los enviará al Moodle indicado para obtener el token. Edunoza no guarda la contraseña y la borra del campo al enviarla. Si tu centro exige acceso institucional o doble factor, utiliza un token manual.</p>
                  <button type="button" className="moodle-text-button" aria-expanded={showAdvancedAuth} onClick={() => setShowAdvancedAuth((value) => !value)}>Opciones avanzadas</button>
                  {showAdvancedAuth ? <>
                    <label className="compact-field"><span>Servicio web</span><input className="input" required disabled={busy === "connect"} value={service} onChange={(event) => setService(event.target.value)} autoComplete="off" spellCheck={false} aria-describedby="moodle-service-help" /></label>
                    <p id="moodle-service-help">Nombre corto del servicio habilitado por el centro. El valor habitual es moodle_mobile_app; puede no estar disponible o no ofrecer todas las consultas.</p>
                  </> : null}
                </>}
                <div className="moodle-actions"><button className="btn" type="submit" disabled={busy === "connect" || (authMode === "token" ? !token.trim() : !username.trim() || !password || !service.trim())}>{busy === "connect" ? "Conectando…" : authMode === "password" ? "Obtener token y conectar" : "Conectar"}</button>{busy === "connect" ? <button type="button" className="btn secondary" onClick={() => cancelPending(true)}>Cancelar</button> : null}</div>
              </> : null}
            </form>
          <p>El token se guarda en este navegador al conectar, fuera de las copias de seguridad. No guardamos el usuario de acceso ni la contraseña. Desconectar conserva el token; cualquier persona con acceso a este perfil del navegador podría utilizarlo.</p>
          {hasSavedToken ? <button type="button" className="btn secondary" disabled={Boolean(busy)} onClick={() => {
            if (!removeMoodleToken(server)) { setNotice({ tone: "error", text: "No se pudo borrar el token. Elimínalo desde los datos del sitio en el navegador." }); return; }
            disconnect(); setToken(""); setHasSavedToken(false);
            setNotice({ tone: "success", text: "Token eliminado de este navegador y sesión desconectada. Los datos académicos se conservan. El token no se ha revocado en Moodle." });
          }}>Borrar token guardado</button> : null}
          <p>Requiere Proxy. <Link to="/config/proxy">Comprobar e instalar la extensión</Link>.</p>
          {connections.length ? (
            <>
              <button type="button" className="moodle-text-button" aria-expanded={showKnownConnections} onClick={() => setShowKnownConnections((value) => !value)}>¿Ya conectaste antes? Elegir cuenta guardada ({connections.length})</button>
              {showKnownConnections ? (
                <ul className="moodle-saved-list">
                  {connections.map((item) => <li key={item.id}><div><strong>{item.siteName}</strong><span>{item.userName} · {item.server}</span></div><div className="moodle-row-actions"><button type="button" className="btn secondary" disabled={Boolean(connection) || Boolean(busy)} onClick={() => {
                    restorePreviousServer.current = false;
                    setServer(item.server); setPassword(""); setUsername("");
                    const saved = readMoodleToken(item.server, item.userId);
                    setToken(saved?.token ?? ""); setHasSavedToken(Boolean(saved)); setAuthMode("token");
                    setNotice({ tone: "info", text: saved ? `Token recuperado para ${item.userName}. Pulsa Conectar.` : `Introduce un token de ${item.userName} o utiliza usuario y contraseña. Los emparejamientos se recuperarán para esa misma cuenta.` });
                  }}>Reconectar</button><button type="button" className="moodle-danger-button" onClick={() => setForgetTarget(item.id)}>Olvidar</button></div>{forgetTarget === item.id ? <div className="moodle-confirm" role="alert"><p>Se olvidarán esta cuenta, sus emparejamientos y su token guardado. Los datos de Edunoza no se borran.</p><button type="button" className="btn secondary" onClick={() => setForgetTarget(null)}>Conservar</button><button type="button" className="moodle-danger-button solid" disabled={busy === "forget"} onClick={() => void confirmForget(item.id)}>Sí, olvidar</button></div> : null}</li>)}
                </ul>
              ) : null}
            </>
          ) : null}
          <details className="moodle-help">
            <summary>Permisos y ayuda para administradores</summary>
            <div>
              <p>El administrador debe habilitar los servicios web REST y autorizar tu cuenta. Puedes introducir un token o solicitarlo con usuario y contraseña si el centro lo permite. Se recomienda un servicio limitado a funciones de lectura; Edunoza no modifica datos académicos en Moodle.</p>
            </div>
          </details>
        </section>
      ) : null}

      {step === "scope" && connection ? (
        <section className="detail-section moodle-section" aria-labelledby="moodle-scope-title">
          {previousImports.length && !snapshot && busy !== "snapshot" ? (
            <div className="moodle-callout">
              <ul className="moodle-previous-list">
                {previousImports.map((item) => (
                  <li key={item.id}>
                    <div><strong>Ya importaste «{item.remoteLabel}» a {className(item.classId)} · {subjectName(item.subjectId)}</strong><span>Trae solo lo nuevo sin repetir el emparejamiento.</span></div>
                    <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => selectCourse(String(item.courseId))} aria-label={`Traer novedades de ${item.remoteLabel}`}>Traer novedades</button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="moodle-section-heading"><div><h2 id="moodle-scope-title">¿Qué quieres traer y a dónde?</h2><p>Elige un curso de Moodle y la clase de Edunoza en la que quieres sus notas.</p></div></div>
          <form className="moodle-route-form" onSubmit={confirmScope}>
            <div className="moodle-route">
              <fieldset className="moodle-route-side">
                <legend>Desde Moodle</legend>
                <label className="compact-field"><span>Curso de Moodle</span><select value={selectedCourseId} disabled={Boolean(busy) && busy !== "snapshot"} onChange={(event) => selectCourse(event.target.value)}><option value="">Elige un curso</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.fullName}</option>)}</select></label>
                {!courses.length ? <p className="moodle-empty">Esta cuenta no devolvió ningún curso accesible.</p> : null}
                {busy === "snapshot" ? <p className="moodle-step-guidance">Leyendo el curso…</p> : null}
                {snapshot ? <label className="compact-field"><span>Grupo de Moodle (opcional)</span><select value={selectedGroupId} onChange={(event) => { setSelectedGroupId(event.target.value); clearPreviews(); }}><option value="">Todo el curso · {snapshot.students.length} participantes</option>{snapshot.groups.map((group) => <option key={group.id} value={group.id}>{group.name} · {group.memberIds.length}</option>)}</select></label> : null}
              </fieldset>
              <span className="moodle-route-arrow" aria-hidden="true">→</span>
              <fieldset className="moodle-route-side" disabled={!snapshot}>
                <legend>A Edunoza</legend>
                <label className="compact-field"><span>Clase de Edunoza</span><select value={selectedClassId} onChange={(event) => selectClass(event.target.value)}><option value="">Elige una clase</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.schoolYear}</option>)}<option value={NEW_CLASS_OPTION}>+ Crear una clase nueva</option></select></label>
                {classIsNew ? <>
                  <label className="compact-field"><span>Nombre de la clase</span><input className="input" required value={newClassName} onChange={(event) => setNewClassName(event.target.value)} /></label>
                  <label className="compact-field"><span>Nivel</span><input className="input" required placeholder="1º ESO" value={newClassLevel} onChange={(event) => setNewClassLevel(event.target.value)} /></label>
                  <label className="compact-field"><span>Curso escolar</span><input className="input" required pattern="[0-9]{4}-[0-9]{4}" placeholder="2026-2027" value={newSchoolYear} onChange={(event) => setNewSchoolYear(event.target.value)} /></label>
                </> : null}
                {selectedClassId ? <label className="compact-field"><span>Materia de Edunoza</span><select value={selectedSubjectId} onChange={(event) => selectSubject(event.target.value)}><option value="">Elige una materia</option>{availableSubjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}<option value={NEW_SUBJECT_OPTION}>+ Crear una materia nueva</option></select></label> : null}
                {subjectIsNew ? <label className="compact-field"><span>Nombre de la materia</span><input className="input" required value={newSubjectName} onChange={(event) => setNewSubjectName(event.target.value)} /></label> : null}
              </fieldset>
            </div>
            {snapshot?.warnings.length ? <details className="moodle-warnings" open><summary>{plural(snapshot.warnings.length, "aviso", "avisos")} de Moodle</summary><ul>{snapshot.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details> : null}
            <div className="moodle-actions moodle-step-actions">
              <button className="btn" type="submit" disabled={!scopeReady || Boolean(busy)}>{busy === "scope-create" ? "Creando…" : "Continuar"}</button>
              {snapshot ? <button type="button" className="btn secondary" disabled={Boolean(busy)} onClick={() => void loadSnapshot(selectedCourseId)}>Actualizar curso</button> : null}
            </div>
            {snapshot ? <details className="moodle-capabilities"><summary>Detalles técnicos</summary><ul>{["core_enrol_get_enrolled_users", "core_course_get_contents", "mod_assign_get_assignments", "mod_assign_get_grades", "gradereport_user_get_grade_items", "mod_assign_get_submissions"].map((name) => <li key={name}><span>{capabilityLabel(name)}</span><strong>{connection.functions.includes(name) ? "Disponible" : "No disponible"}</strong></li>)}</ul></details> : null}
          </form>
        </section>
      ) : null}

      {(step === "link" || step === "apply") && connection && snapshot && scope ? (
        <p className="moodle-workflow-context"><strong>{snapshot.course.fullName}</strong> → {className(scope.classId)} · {subjectName(scope.subjectId)}</p>
      ) : null}

      {step === "link" && connection && snapshot && scope ? (
        <section className="detail-section moodle-section" aria-labelledby="moodle-mapping-title">
          <div className="moodle-section-heading"><div><h2 id="moodle-mapping-title">Comprueba el emparejamiento</h2><p>Lo que coincide exactamente por nombre ya está emparejado. Revisa solo lo que aparece aquí; nada se guarda hasta que pulses «Guardar».</p></div></div>

          <div className="moodle-mapping-block">
            <div className="moodle-block-heading">
              <h3>Alumnado · {scopedRemoteStudents.length}</h3>
              <div className="moodle-tags">
                {linkedStudentCount ? <span className="moodle-tag ok">{plural(linkedStudentCount, "emparejado", "emparejados")}</span> : null}
                {newStudentCount ? <span className="moodle-tag info">{plural(newStudentCount, "nuevo", "nuevos")}</span> : null}
                {undecidedCount ? <span className="moodle-tag warn">{undecidedCount} por decidir</span> : null}
              </div>
            </div>
            {attentionStudentRows.length ? <div className="moodle-mapping-list">{attentionStudentRows.map(({ student, decision, binding }) => (
              <StudentRow key={student.id} label={student.fullName} decision={decision} hasBinding={Boolean(binding)} candidates={localStudents} onChange={(draft) => setDraft("student", student.id, draft)} />
            ))}</div> : null}
            {matchedStudentRows.length ? <details className="moodle-mapping-group"><summary>Ver {plural(matchedStudentRows.length, "alumno emparejado", "alumnos emparejados")}</summary><div className="moodle-mapping-list">{matchedStudentRows.map(({ student, decision, binding }) => (
              <StudentRow key={student.id} label={student.fullName} decision={decision} hasBinding={Boolean(binding)} candidates={localStudents} onChange={(draft) => setDraft("student", student.id, draft)} />
            ))}</div></details> : null}
            {!scopedRemoteStudents.length ? <p className="moodle-empty">Moodle no devolvió participantes para este curso o grupo.</p> : null}
          </div>

          <div className="moodle-mapping-block">
            <div className="moodle-block-heading">
              <h3>Actividades con nota · {gradableActivities.length}</h3>
              <span className="moodle-step-guidance">Las marcadas entran en el cuaderno como tareas.</span>
            </div>
            {gradableActivities.length ? <div className="moodle-mapping-list">{gradableActivities.map((activity) => (
              <ActivityRow key={activity.id} activity={activity} decision={activityDecision(activity.id)} hasBinding={Boolean(bindingFor("activity", activity.id))} candidates={localTasks} onChange={(draft) => setDraft("activity", activity.id, draft)} />
            ))}</div> : <p className="moodle-empty">Este curso de Moodle no tiene actividades con nota.</p>}
            {otherActivities.length ? <p className="moodle-step-guidance">{plural(otherActivities.length, "recurso sin nota (apuntes, enlaces…) no se importa", "recursos sin nota (apuntes, enlaces…) no se importan")}.</p> : null}
          </div>

          {mappingErrors.length ? <div className="moodle-warnings" role="alert"><ul>{mappingErrors.map((message) => <li key={message}>{message}</li>)}</ul></div> : null}
          <div className="moodle-actions moodle-footer-actions">
            <button type="button" className="btn secondary" disabled={Boolean(busy)} onClick={() => setStep("scope")}>Atrás</button>
            <span className="moodle-footer-spacer" />
            {undecidedCount ? <span className="moodle-pending-note">Falta{undecidedCount === 1 ? "" : "n"} {plural(undecidedCount, "decisión", "decisiones")}</span> : null}
            <button type="button" className="btn" disabled={Boolean(busy) || undecidedCount > 0} onClick={() => void saveMappings()}>{busy === "mapping-apply" ? "Guardando…" : "Guardar y ver notas"}</button>
          </div>
        </section>
      ) : null}

      {step === "apply" && connection && snapshot && scope ? (
        <section className="detail-section moodle-section" aria-labelledby="moodle-review-title">
          <div className="moodle-section-heading"><div><h2 id="moodle-review-title">Revisa las notas antes de importarlas</h2><p>Se pasan a escala 0–10. Solo tienes que decidir cuando no coinciden con las tuyas.</p></div></div>
          {unlinkedRemoteCount ? <div className="moodle-callout"><span>Hay {plural(unlinkedRemoteCount, "alumno o actividad nueva", "alumnos o actividades nuevas")} en Moodle sin emparejar; sus notas no aparecen aquí.</span><button type="button" className="btn secondary" disabled={Boolean(busy)} onClick={() => setStep("link")}>Emparejar</button></div> : null}
          {busy === "review-preview" ? <p className="moodle-step-guidance">Preparando las notas…</p> : null}
          {gradePreview ? <>
            <div className="moodle-stats" role="list" aria-label="Resumen de notas">
              <div role="listitem" className="moodle-stat"><strong>{gradeRows.filter(isNewGrade).length}</strong><span>Nuevas</span></div>
              <div role="listitem" className="moodle-stat"><strong>{gradeRows.filter(isSameGrade).length}</strong><span>Iguales, sin cambios</span></div>
              <div role="listitem" className={`moodle-stat${conflictRows.length ? " warn" : ""}`}><strong>{conflictRows.length}</strong><span>Distintas a las tuyas</span></div>
              <div role="listitem" className="moodle-stat"><strong>{gradePreview.skipped.length}</strong><span>No se pueden importar</span></div>
            </div>

            {conflictRows.length ? (
              <div className="moodle-mapping-block warn">
                <div className="moodle-block-heading">
                  <h3>{plural(conflictRows.length, "nota distinta a la tuya", "notas distintas a las tuyas")}</h3>
                  <div className="moodle-actions"><span className="moodle-step-guidance">Para todas:</span><button type="button" className="btn secondary" disabled={Boolean(busy)} onClick={() => setAllConflicts("local")}>Mantener las mías</button><button type="button" className="btn secondary" disabled={Boolean(busy)} onClick={() => setAllConflicts("remote")}>Usar Moodle</button></div>
                </div>
                <div className="moodle-mapping-list">{conflictRows.map((row) => {
                  const useMoodle = conflictChoices[row.id] === "remote";
                  const studentName = students.find((item) => item.id === row.studentId)?.fullName ?? "Participante";
                  return <div key={row.id} className="moodle-conflict-row">
                    <div><strong>{studentName}</strong><span>{tasks.find((item) => item.id === row.taskId)?.title ?? "Tarea"}</span></div>
                    <span>Tuya <strong>{formatGrade(row.localGrade)}</strong> · Moodle <strong>{formatGrade(row.scaledGrade)}</strong> <small>({gradeFormatter.format(row.remoteGrade)}/{gradeFormatter.format(row.gradeMax)})</small></span>
                    <div className="moodle-segmented" role="group" aria-label={`Nota para ${studentName}`}>
                      <button type="button" aria-pressed={!useMoodle} onClick={() => setConflictChoices((current) => ({ ...current, [row.id]: "local" }))}>Mantener {formatGrade(row.localGrade)}</button>
                      <button type="button" aria-pressed={useMoodle} onClick={() => setConflictChoices((current) => ({ ...current, [row.id]: "remote" }))}>Usar {formatGrade(row.scaledGrade)}</button>
                    </div>
                  </div>;
                })}</div>
              </div>
            ) : null}

            {numericOnlyActivities.length ? (
              <div className="moodle-mapping-block">
                <h3>Actividades corregidas con rúbrica o guía</h3>
                <p className="moodle-step-guidance">Edunoza solo puede traer la nota final, sin criterios ni niveles. Confírmalo una vez por actividad.</p>
                {numericOnlyActivities.map((row) => {
                  const title = activityById.get(row.activityId)?.title ?? "Actividad";
                  const count = gradeRows.filter((item) => item.activityId === row.activityId && !isSameGrade(item)).length;
                  return <label key={row.activityId} className="moodle-check">
                    <input type="checkbox" checked={confirmedNumericActivities.has(row.activityId)} onChange={(event) => setConfirmedNumericActivities((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(row.activityId); else next.delete(row.activityId);
                      return next;
                    })} />
                    <span>{title}: importar solo la nota final ({plural(count, "nota", "notas")}){row.gradingMethod === "unknown" ? ". No se pudo comprobar cómo se corrige en Moodle." : ""}</span>
                  </label>;
                })}
              </div>
            ) : null}

            {updatePreview?.rows.length ? (
              <div className="moodle-mapping-block">
                <h3>Nombres que han cambiado en Moodle</h3>
                <div className="moodle-resolution-list">{updatePreview.rows.map((row) => <fieldset key={row.id}><legend>{row.kind === "student" ? "Alumno" : "Actividad"} · {fieldLabel(row.field)}</legend><label><input type="radio" name={`update-${row.id}`} checked={updateResolutions[row.id] === "local"} onChange={() => setUpdateResolutions((current) => ({ ...current, [row.id]: "local" }))} /><span><strong>Mantener Edunoza</strong><small>{String(row.localValue ?? "Vacío")}</small></span></label><label><input type="radio" name={`update-${row.id}`} checked={updateResolutions[row.id] === "remote"} onChange={() => setUpdateResolutions((current) => ({ ...current, [row.id]: "remote" }))} /><span><strong>Usar Moodle</strong><small>{String(row.sourceValue ?? "Vacío")}</small></span></label></fieldset>)}</div>
              </div>
            ) : null}

            {skippedGroups.length ? (
              <div className="moodle-mapping-block">
                <h3>{plural(gradePreview.skipped.length, "nota que no entra", "notas que no entran")}, y cómo arreglarlo</h3>
                <ul className="moodle-skip-list">{skippedGroups.map((group) => (
                  <li key={`${group.taskId}:${group.code}`}>
                    <span><strong>{tasks.find((item) => item.id === group.taskId)?.title ?? "Tarea"}</strong> · {plural(group.count, "nota", "notas")}. {group.reason}</span>
                    {group.code === "instrument" ? <button type="button" className="moodle-text-button" onClick={() => openGradebook(scope.classId, scope.subjectId)}>Cambiar a nota directa en el cuaderno</button> : null}
                    {group.code === "closed-period" ? <Link to="/management/periods">Ver evaluaciones</Link> : null}
                  </li>
                ))}</ul>
              </div>
            ) : null}

            {!gradeRows.length && !updatePreview?.rows.length ? <p className="moodle-empty">No hay notas nuevas en Moodle para lo que tienes emparejado.</p> : null}

            <div className="moodle-actions moodle-footer-actions">
              <button type="button" className="btn secondary" disabled={Boolean(busy)} onClick={() => setStep("link")}>Atrás</button>
              <span className="moodle-footer-spacer" />
              <span className="moodle-pending-note neutral">Moodle no se modifica</span>
              <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void applyChangesAndGrades()}>{busy === "review-apply" ? "Importando…" : importButtonLabel}</button>
            </div>
          </> : null}
          <details className="moodle-help">
            <summary>Entregas leídas en Moodle</summary>
            <SubmissionSummary snapshot={snapshot} />
          </details>
        </section>
      ) : null}

      {step === "done" && summary ? (
        <section className="detail-section moodle-section moodle-done" aria-labelledby="moodle-done-title">
          <div>
            <h2 id="moodle-done-title">{summary.imported ? `${plural(summary.imported, "nota ya está", "notas ya están")} en el cuaderno` : "Importación terminada"}</h2>
            <p>{className(summary.classId)} · {subjectName(summary.subjectId)}{summary.updates ? `. También se ${summary.updates === 1 ? "actualizó 1 nombre" : `actualizaron ${summary.updates} nombres`}.` : "."}</p>
          </div>
          {summary.tasks.length ? (
            <table className="moodle-done-table">
              <thead><tr><th scope="col">Tarea</th><th scope="col">Notas</th><th scope="col">Peso</th></tr></thead>
              <tbody>{summary.tasks.map((item) => <tr key={item.taskId}><td>{item.title}</td><td>{item.count}</td><td className={item.weight > 0 ? "" : "warn"}>{item.weight > 0 ? gradeFormatter.format(item.weight) : "Sin peso"}</td></tr>)}</tbody>
            </table>
          ) : null}
          {summary.unweightedTaskCount ? (
            <div className="moodle-callout warn">
              <span><strong>{summary.unweightedTaskCount === 1 ? "1 tarea aún no cuenta en la media." : `${summary.unweightedTaskCount} tareas aún no cuentan en la media.`}</strong> Tiene{summary.unweightedTaskCount === 1 ? "" : "n"} peso 0 y otras tareas sí tienen peso. Dale{summary.unweightedTaskCount === 1 ? "" : "s"} un peso en el cuaderno.</span>
            </div>
          ) : null}
          <div className="moodle-actions">
            <button type="button" className="btn" onClick={() => openGradebook(summary.classId, summary.subjectId)}>Abrir el cuaderno</button>
            <button type="button" className="btn secondary" onClick={() => { setSummary(null); setSelectedCourseId(""); setSnapshot(null); resetScopeSelection(); setStep("scope"); }}>Importar otro curso</button>
          </div>
          <p className="moodle-step-guidance">La próxima vez, «Traer novedades» importa solo lo nuevo de este curso sin repetir el emparejamiento.</p>
        </section>
      ) : null}

      <section className="detail-section moodle-section" aria-labelledby="moodle-operations-title">
        <details className="moodle-help">
          <summary id="moodle-operations-title">Importaciones recientes</summary>
          {operations.length ? <ol className="moodle-operation-list">{operations.map((operation) => <li key={operation.id}><div><strong>{operation.summary}</strong><span>{operation.count} elemento(s) · {operationKindLabel(operation.kind)}</span></div><time dateTime={operation.createdAt}>{formatDate(operation.createdAt)}</time></li>)}</ol> : <p className="moodle-empty">Todavía no has importado nada de Moodle.</p>}
        </details>
      </section>
    </article>
  );
}

function StudentRow({ label, decision, hasBinding, candidates, onChange }: { label: string; decision: MappingDecision; hasBinding: boolean; candidates: Student[]; onChange: (draft: MappingDraft | undefined) => void }) {
  const linked = decision?.action === "link" ? candidates.find((item) => item.id === decision.localId) : undefined;
  const status = decision === null
    ? <span className="moodle-tag warn">Por decidir</span>
    : decision.action === "create" ? <span className="moodle-tag info">Nuevo</span>
      : decision.action === "link" ? <span className="moodle-tag ok">Emparejado</span>
        : <span className="moodle-tag">No se importa</span>;
  return <div className={`moodle-mapping-row${decision === null ? " pending" : ""}`}>
    <div><strong>{label}</strong><span>{decision === null ? "Hay alumnos en la clase que podrían ser esta persona" : linked ? `En Edunoza: ${linked.fullName}` : decision.action === "create" ? "Se creará en la clase" : ""}</span></div>
    <label><span className="sr-only">Alumno de Edunoza para {label}</span>
      <select value={encodeDecision(decision)} onChange={(event) => onChange(decodeDecision(event.target.value))}>
        {decision === null ? <option value="">Elige…</option> : null}
        <optgroup label="Emparejar con">{candidates.map((item) => <option key={item.id} value={`link:${item.id}`}>{item.fullName}</option>)}</optgroup>
        <option value="create">Crear alumno nuevo</option>
        <option value="ignore">No importar</option>
        {hasBinding ? <option value="unlink">Quitar emparejamiento</option> : null}
      </select>
    </label>
    {status}
  </div>;
}

function ActivityRow({ activity, decision, hasBinding, candidates, onChange }: { activity: MoodleActivity; decision: MappingDraft; hasBinding: boolean; candidates: Task[]; onChange: (draft: MappingDraft | undefined) => void }) {
  const included = decision.action === "link" || decision.action === "create";
  const target = decision.action === "link" ? `link:${decision.localId ?? ""}` : "create";
  return <div className="moodle-mapping-row">
    <div>
      <strong>{activity.title}</strong>
      <span className="moodle-tags"><span className="moodle-tag">{moduleLabel(activity.module)}</span>{activity.advancedGrading ? <span className="moodle-tag accent">Rúbrica en Moodle</span> : null}</span>
    </div>
    <label><span className="sr-only">Tarea de Edunoza para {activity.title}</span>
      <select value={included ? target : "create"} disabled={!included} onChange={(event) => onChange(decodeDecision(event.target.value))}>
        <option value="create">Tarea nueva</option>
        <optgroup label="Tarea existente">{candidates.map((item) => <option key={item.id} value={`link:${item.id}`}>{item.title}</option>)}</optgroup>
      </select>
    </label>
    <label className="moodle-check"><input type="checkbox" checked={included} onChange={(event) => onChange(event.target.checked ? undefined : { action: hasBinding ? "unlink" : "ignore" })} /><span>Incluir<span className="sr-only"> {activity.title} en el cuaderno</span></span></label>
  </div>;
}

function SubmissionSummary({ snapshot }: { snapshot: MoodleCourseSnapshot }) {
  if (!snapshot.activities.length) return <p className="moodle-empty">Moodle no devolvió actividades.</p>;
  return (
    <div className="moodle-submission-list">
      {snapshot.activities.map((activity) => {
        const submissions = snapshot.submissions.filter((item) => item.activityId === activity.id);
        return (
          <details key={activity.id}>
            <summary><span><strong>{activity.title}</strong><small>{formatDate(activity.dueDate)} · {submissions.length} estado(s)</small></span></summary>
            <p><a href={activity.url} target="_blank" rel="noopener noreferrer">Abrir actividad en Moodle (nueva pestaña)</a></p>
            {submissions.length ? <ul>{submissions.map((submission) => <li key={`${submission.activityId}:${submission.userId}`}><span>{snapshot.students.find((student) => student.id === submission.userId)?.fullName ?? `Usuario ${submission.userId}`}</span><strong>{submissionStatusLabel(submission.status)}</strong><time dateTime={new Date(submission.modifiedAt * 1000).toISOString()}>{formatDate(submission.modifiedAt)}</time></li>)}</ul> : <p>No hay estados de entrega disponibles.</p>}
          </details>
        );
      })}
    </div>
  );
}
