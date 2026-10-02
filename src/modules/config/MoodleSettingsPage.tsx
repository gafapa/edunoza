import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
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
  type MoodleMappingPreview,
  type MoodleUpdatePreview
} from "../../shared/moodle/service";
import type {
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

type Step = "connect" | "scope" | "review";
type Notice = { tone: "info" | "success" | "error"; text: string };
type BusyAction = "connect" | "snapshot" | "scope-create" | "mapping-check" | "mapping-apply" | "review-preview" | "review-apply" | "forget" | null;
type MappingDraft = { action: MoodleMappingChoice["action"]; localId?: string };

const dateFormatter = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "Operación cancelada.";
  return error instanceof Error ? error.message : "No se pudo completar la operación.";
}

function formatDate(value?: number | string): string {
  if (value === undefined) return "Sin fecha";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? "Fecha no disponible" : dateFormatter.format(date);
}

function mappingKey(kind: "student" | "activity", remoteId: number): string {
  return `${kind}:${remoteId}`;
}

/** Exact-match only (accents/case/whitespace-insensitive): a suggestion the teacher must
 * still confirm explicitly, never an automatic link — "similar" names are not enough. */
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
    core_group_get_course_groups: "Grupos de Moodle",
    core_course_get_contents: "Actividades",
    mod_assign_get_assignments: "Tareas",
    mod_assign_get_grades: "Lectura de calificaciones",
    mod_assign_get_submissions: "Estado de entregas"
  };
  return labels[name] ?? name;
}

function fieldLabel(field: string): string {
  return ({ firstName: "Nombre", lastName: "Apellidos", fullName: "Nombre completo", email: "Correo", title: "Título" } as Record<string, string>)[field] ?? field;
}

function mappingActionLabel(action: MoodleMappingChoice["action"]): string {
  return ({ link: "Vincular", create: "Crear", ignore: "Ignorar", unlink: "Quitar asociación" })[action];
}

function operationKindLabel(kind: MoodleOperation["kind"]): string {
  return ({ link: "asociaciones", update: "actualizaciones", grades: "calificaciones" })[kind];
}

function submissionStatusLabel(status: string): string {
  return ({ submitted: "Entregada", new: "Sin entregar", draft: "Borrador", graded: "Calificada", reopened: "Reabierta" } as Record<string, string>)[status.toLowerCase()] ?? status;
}

export function MoodleSettingsPage() {
  const clientRef = useRef<MoodleClient | null>(null);
  const pendingClientRef = useRef<MoodleClient | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestVersionRef = useRef(0);
  const restorePreviousServer = useRef(!hasConnectionPreference("moodle.server"));

  const [busy, setBusy] = useState<BusyAction>(null);
  const [step, setStep] = useState<Step>("connect");
  const [notice, setNotice] = useState<Notice>({ tone: "info", text: "Conecta tu cuenta cuando necesites consultar datos de Moodle." });

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
  const [mappingPreview, setMappingPreview] = useState<MoodleMappingPreview | null>(null);
  const [updatePreview, setUpdatePreview] = useState<MoodleUpdatePreview | null>(null);
  const [updateResolutions, setUpdateResolutions] = useState<Record<string, MoodleResolution>>({});
  const [gradePreview, setGradePreview] = useState<MoodleGradePreview | null>(null);
  const [gradeResolutions, setGradeResolutions] = useState<Record<string, MoodleResolution>>({});

  const cancelPending = (announce = false): void => {
    requestVersionRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    pendingClientRef.current?.dispose();
    pendingClientRef.current = null;
    setBusy(null);
    setPassword("");
    if (announce) setNotice({ tone: "info", text: "Operación cancelada. No se ha aplicado ningún cambio local nuevo." });
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
  const availableSubjects = classIsNew ? [] : subjects.filter((subject) => !selectedClassId || subjectCourseKeys.has(`${selectedClassId}:${subject.id}`));
  // Any student in the class is a valid link target, not just ones already enrolled in
  // this subject: linking enrolls them (see applyMappingPreview), matching what the
  // engine actually validates (classId only) rather than gating on prior enrollment.
  const localStudents = scope ? students.filter((student) => student.classId === scope.classId) : [];
  const localTasks = scope ? tasks.filter((task) => taskSubjectKeys.has(`${task.id}:${scope.subjectId}`)) : [];
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
  const hasScopedLinks = scopedBindings.some((item) => item.kind === "student" || item.kind === "activity");
  const exactMatchCount = (() => {
    const studentCandidates = localStudents.map((item) => ({ id: item.id, label: item.fullName }));
    const taskCandidates = localTasks.map((item) => ({ id: item.id, label: item.title }));
    let count = 0;
    for (const student of scopedRemoteStudents) {
      if (scopedBindings.some((item) => item.kind === "student" && item.remoteId === student.id)) continue;
      const draftAction = mappingDrafts[mappingKey("student", student.id)]?.action ?? "ignore";
      if (draftAction !== "ignore") continue;
      if (findExactNameMatch(student.fullName, studentCandidates)) count += 1;
    }
    for (const activity of snapshot?.activities ?? []) {
      if (scopedBindings.some((item) => item.kind === "activity" && item.remoteId === activity.id)) continue;
      const draftAction = mappingDrafts[mappingKey("activity", activity.id)]?.action ?? "ignore";
      if (draftAction !== "ignore") continue;
      if (findExactNameMatch(activity.title, taskCandidates)) count += 1;
    }
    return count;
  })();
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

  const steps: MoodleWorkflowStep[] = [
    { id: "connect", label: "Conectar", description: "Servidor y cuenta", complete: Boolean(connection) },
    { id: "scope", label: "Elegir clase", description: "Curso y destino en Edunoza", disabled: !connection, complete: Boolean(snapshot && scope) },
    { id: "review", label: "Revisar y aplicar", description: "Asociaciones, cambios y notas", disabled: !connection || !snapshot || !scope }
  ];

  const clearPreviews = (): void => {
    setMappingPreview(null);
    setUpdatePreview(null);
    setUpdateResolutions({});
    setGradePreview(null);
    setGradeResolutions({});
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
      setStep("scope");
      const savedBindings = await getBindings(savedConnection.id);
      if (!isCurrent(version)) return;
      setBindings(savedBindings);
      await reloadMetadata(savedConnection.id, version);
      if (!isCurrent(version)) return;
      setNotice({ tone: "success", text: `Conectado a ${savedConnection.siteName} como ${savedConnection.userName}. ${tokenSaved ? "Token guardado en este navegador; no se guarda el usuario de acceso ni la contraseña." : "El navegador no permitió guardar el token; solo estará disponible en esta sesión."} Elige ahora un curso.` });
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
    setStep("connect");
    setNotice({ tone: "info", text: "Sesión desconectada. Las asociaciones y los datos académicos se conservan." });
  };

  const goToReview = async (targetScope: MoodleScope, availableBindings: MoodleBinding[], targetSnapshot: MoodleCourseSnapshot | null = snapshot): Promise<void> => {
    setStep("review");
    const scopedForReview = availableBindings.some((item) =>
      item.connectionId === connection?.id &&
      item.courseId === targetScope.courseId &&
      item.classId === targetScope.classId &&
      item.subjectId === targetScope.subjectId &&
      item.remoteGroupId === targetScope.remoteGroupId &&
      (item.kind === "student" || item.kind === "activity")
    );
    if (!scopedForReview || !targetSnapshot || !connection) return;
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
      setGradeResolutions(Object.fromEntries(grades.rows.map((row) => [row.id, "local"])));
      setNotice({ tone: "info", text: "Cambios y notas preparados. Revisa cada decisión antes de aplicarla." });
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
    setNotice({ tone: "info", text: "Leyendo participantes, actividades, notas y entregas disponibles…" });
    setSnapshot(null);
    resetScopeSelection();
    try {
      const nextSnapshot = await client.getCourseSnapshot(course);
      if (!isCurrent(version)) return;
      setSnapshot(nextSnapshot);
      const savedBindings = await getBindings(connection.id);
      if (!isCurrent(version)) return;
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
        setNotice({ tone: nextSnapshot.warnings.length ? "info" : "success", text: nextSnapshot.warnings.length ? `Curso cargado con ${nextSnapshot.warnings.length} aviso(s) de permisos o compatibilidad.` : "Curso y destino anterior recuperados." });
        if (nextSnapshot.warnings.length === 0) void goToReview(resolvedScope, savedBindings, nextSnapshot);
        else setStep("scope");
        return;
      }
      setStep("scope");
      setNotice({
        tone: nextSnapshot.warnings.length ? "info" : "success",
        text: nextSnapshot.warnings.length
          ? `Curso cargado con ${nextSnapshot.warnings.length} aviso(s) de permisos o compatibilidad.`
          : persistedScopes.length && uniqueScopes.length === 1
            ? "Curso cargado, pero su destino local guardado ya no está disponible. Elige otro destino."
            : uniqueScopes.length > 1
              ? "Curso cargado. Hay varios destinos guardados para este curso; elige el que quieres usar."
              : "Curso cargado. Elige o crea el destino en Edunoza."
      });
    } catch (error) {
      if (isCurrent(version)) {
        setSnapshot(null);
        clearPreviews();
        setStep("scope");
        setNotice({ tone: "error", text: `${errorMessage(error)} No se puede aplicar una revisión anterior; vuelve a cargar el curso.` });
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
    if (courseId) void loadSnapshot(courseId);
  };

  const selectClass = (classId: string): void => {
    cancelPending();
    setSelectedClassId(classId);
    setSelectedSubjectId(classId === NEW_CLASS_OPTION ? NEW_SUBJECT_OPTION : "");
    clearPreviews();
  };

  const buildMappingChoices = (): MoodleMappingChoice[] => [
    ...scopedRemoteStudents.map((student) => {
      const existing = scopedBindings.find((item) => item.kind === "student" && item.remoteId === student.id);
      return { kind: "student" as const, remoteId: student.id, ...(mappingDrafts[mappingKey("student", student.id)] ?? (existing ? { action: "link" as const, localId: existing.localId } : { action: "ignore" as const })) };
    }),
    ...(snapshot?.activities ?? []).map((activity) => {
      const existing = scopedBindings.find((item) => item.kind === "activity" && item.remoteId === activity.id);
      return { kind: "activity" as const, remoteId: activity.id, ...(mappingDrafts[mappingKey("activity", activity.id)] ?? (existing ? { action: "link" as const, localId: existing.localId } : { action: "ignore" as const })) };
    })
  ];

  const checkMappings = async (): Promise<void> => {
    if (!connection || !snapshot || !scope) return;
    const { version } = beginRequest("mapping-check");
    try {
      const preview = await createMappingPreview(connection.id, snapshot, scope, buildMappingChoices());
      if (!isCurrent(version)) return;
      setMappingPreview(preview);
      setNotice({ tone: "info", text: "Revisión preparada. Aún no se ha cambiado ningún dato local." });
    } catch (error) {
      if (isCurrent(version)) setNotice({ tone: "error", text: errorMessage(error) });
    } finally {
      if (isCurrent(version)) setBusy(null);
    }
  };

  const confirmMappings = async (): Promise<void> => {
    if (!mappingPreview || !connection || !snapshot || !scope) return;
    const { controller, version } = beginRequest("mapping-apply");
    try {
      const nextBindings = await applyMappingPreview(mappingPreview, controller.signal);
      if (!isCurrent(version)) return;
      setBindings(nextBindings);
      await reloadLocalCandidates();
      if (!isCurrent(version)) return;
      setMappingPreview(null);
      setMappingDrafts({});
      await reloadMetadata(connection.id, version);
      if (!isCurrent(version)) return;
      setNotice({ tone: "success", text: "Asociaciones guardadas. Los nombres y datos existentes de Edunoza no se han sobrescrito. Preparando cambios y notas…" });
      void goToReview(scope, nextBindings);
    } catch (error) {
      if (isCurrent(version)) setNotice({ tone: "error", text: errorMessage(error) });
    } finally {
      if (isCurrent(version)) setBusy(null);
    }
  };

  const reviewChangesAndGrades = async (): Promise<void> => {
    if (!scope) return;
    void goToReview(scope, bindings);
  };

  const applyChangesAndGrades = async (): Promise<void> => {
    if (!connection || !snapshot || !scope) return;
    const { controller, version } = beginRequest("review-apply");
    try {
      const updatesApplied = Boolean(updatePreview?.rows.length);
      if (updatesApplied && updatePreview) await applyUpdates(updatePreview, updateResolutions, controller.signal);
      if (!isCurrent(version)) return;
      if (gradePreview?.rows.length) {
        // Applying updates just invalidated every preview for this scope (including this
        // one), even though it only touched name/title fields: re-issue it before applying.
        const freshGradePreview = updatesApplied ? await previewGrades(connection.id, snapshot, scope) : gradePreview;
        if (!isCurrent(version)) return;
        await applyGrades(freshGradePreview, gradeResolutions, controller.signal);
      }
      if (!isCurrent(version)) return;
      await reloadLocalCandidates();
      if (!isCurrent(version)) return;
      setUpdatePreview(null);
      setUpdateResolutions({});
      setGradePreview(null);
      setGradeResolutions({});
      await reloadMetadata(connection.id, version);
      if (!isCurrent(version)) return;
      setNotice({ tone: "success", text: "Cambios y notas aplicados según tus decisiones. Las demás evaluaciones siguen intactas." });
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
      setStep("review");
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
      setStep("review");
      setNotice({ tone: "success", text: classIsNew ? "Grupo y materia creados. Revisa ahora cada asociación." : "Materia creada en el grupo existente. Revisa ahora cada asociación." });
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
      if (forgotten && !removeMoodleToken(forgotten.server, forgotten.userId)) throw new Error("Se eliminaron las asociaciones, pero no se pudo borrar el token del navegador. Elimínalo desde los datos del sitio.");
      if (connection?.id === id) disconnect();
      setToken(readMoodleToken(server)?.token ?? "");
      setHasSavedToken(Boolean(readMoodleToken(server)));
      setForgetTarget(null);
      await reloadMetadata();
      setNotice({ tone: "success", text: "Metadatos de conexión y asociaciones eliminados. No se ha borrado ningún dato académico." });
    } catch (error) {
      if (isCurrent(version)) setNotice({ tone: "error", text: errorMessage(error) });
    } finally {
      if (isCurrent(version)) setBusy(null);
    }
  };

  const updateMappingDraft = (kind: "student" | "activity", remoteId: number, action: MoodleMappingChoice["action"], localId?: string): void => {
    setMappingPreview(null);
    setMappingDrafts((current) => ({ ...current, [mappingKey(kind, remoteId)]: { action, ...(localId ? { localId } : {}) } }));
  };

  const bulkSetMappings = (action: "create-pending" | "ignore-pending" | "unlink-existing"): void => {
    setMappingPreview(null);
    const next: Record<string, MappingDraft> = { ...mappingDrafts };
    for (const student of scopedRemoteStudents) {
      const existing = scopedBindings.find((item) => item.kind === "student" && item.remoteId === student.id);
      if (action === "unlink-existing" && existing) next[mappingKey("student", student.id)] = { action: "unlink" };
      else if (action !== "unlink-existing" && !existing) next[mappingKey("student", student.id)] = { action: action === "create-pending" ? "create" : "ignore" };
    }
    for (const activity of snapshot?.activities ?? []) {
      const existing = scopedBindings.find((item) => item.kind === "activity" && item.remoteId === activity.id);
      if (action === "unlink-existing" && existing) next[mappingKey("activity", activity.id)] = { action: "unlink" };
      else if (action !== "unlink-existing" && !existing) next[mappingKey("activity", activity.id)] = { action: action === "create-pending" ? "create" : "ignore" };
    }
    setMappingDrafts(next);
  };

  const linkExactMatches = (): void => {
    setMappingPreview(null);
    const next: Record<string, MappingDraft> = { ...mappingDrafts };
    const studentCandidates = localStudents.map((item) => ({ id: item.id, label: item.fullName }));
    const taskCandidates = localTasks.map((item) => ({ id: item.id, label: item.title }));
    for (const student of scopedRemoteStudents) {
      const key = mappingKey("student", student.id);
      if (scopedBindings.some((item) => item.kind === "student" && item.remoteId === student.id)) continue;
      if ((mappingDrafts[key]?.action ?? "ignore") !== "ignore") continue;
      const match = findExactNameMatch(student.fullName, studentCandidates);
      if (match) next[key] = { action: "link", localId: match.id };
    }
    for (const activity of snapshot?.activities ?? []) {
      const key = mappingKey("activity", activity.id);
      if (scopedBindings.some((item) => item.kind === "activity" && item.remoteId === activity.id)) continue;
      if ((mappingDrafts[key]?.action ?? "ignore") !== "ignore") continue;
      const match = findExactNameMatch(activity.title, taskCandidates);
      if (match) next[key] = { action: "link", localId: match.id };
    }
    setMappingDrafts(next);
  };

  const bulkSetResolutions = (resolution: MoodleResolution): void => {
    if (updatePreview) setUpdateResolutions(Object.fromEntries(updatePreview.rows.map((row) => [row.id, resolution])));
    if (gradePreview) setGradeResolutions(Object.fromEntries(gradePreview.rows.map((row) => [row.id, resolution])));
  };

  return (
    <article className="management-card moodle-settings-page">
      <header className="moodle-page-heading">
        <div>
          <h1>Moodle</h1>
          <p>Consulta Moodle en modo de solo lectura, asocia lo que ya existe y revisa cada cambio local.</p>
        </div>
        {connection ? <div className="moodle-actions"><span className="moodle-status connected">Conectado · solo lectura</span><button type="button" className="btn secondary" onClick={disconnect}>Desconectar</button></div> : null}
      </header>

      <p className={`moodle-notice ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"} aria-live="polite">{notice.text}</p>

      <MoodleWorkflowStepper steps={steps} activeStep={step} onStepChange={(id) => setStep(id as Step)} label="Pasos para importar datos de Moodle" />

      {step === "connect" ? (
        <section className="detail-section moodle-section" aria-labelledby="moodle-connection-title">
          <div className="moodle-section-heading">
            <div><h2 id="moodle-connection-title">Conectar cuenta</h2><p>Conserva el token en este navegador, sin guardar las credenciales de acceso.</p></div>
          </div>
          {connection ? (
            <>
              <dl className="moodle-connection-facts">
                <div><dt>Sitio</dt><dd>{connection.siteName}</dd></div>
                <div><dt>Cuenta</dt><dd>{connection.userName}</dd></div>
                <div><dt>Dirección</dt><dd>{connection.server}</dd></div>
              </dl>
              <div className="moodle-actions"><button type="button" className="btn" onClick={() => setStep("scope")}>Continuar a elegir clase</button></div>
            </>
          ) : (
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
          )}
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
                    setNotice({ tone: "info", text: saved ? `Token recuperado para ${item.userName}. Pulsa Conectar.` : `Introduce un token de ${item.userName} o utiliza usuario y contraseña. Las asociaciones se recuperarán para esa misma cuenta.` });
                  }}>Reconectar</button><button type="button" className="moodle-danger-button" onClick={() => setForgetTarget(item.id)}>Olvidar</button></div>{forgetTarget === item.id ? <div className="moodle-confirm" role="alert"><p>Se eliminarán los metadatos, las asociaciones y el token guardado de esta cuenta. Los datos académicos locales no se borrarán.</p><button type="button" className="btn secondary" onClick={() => setForgetTarget(null)}>Conservar</button><button type="button" className="moodle-danger-button solid" disabled={busy === "forget"} onClick={() => void confirmForget(item.id)}>Sí, olvidar</button></div> : null}</li>)}
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
          <div className="moodle-section-heading"><div><h2 id="moodle-scope-title">Elegir clase</h2><p>Un grupo de Moodle es opcional. Cambiar el curso descarta las revisiones pendientes.</p></div></div>
          <form className="moodle-field-stack" onSubmit={confirmScope}>
            <label className="compact-field"><span>Curso Moodle</span><select value={selectedCourseId} disabled={Boolean(busy)} onChange={(event) => selectCourse(event.target.value)}><option value="">Seleccionar curso</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.fullName} · {course.shortName}</option>)}</select></label>
            {!courses.length ? <p className="moodle-empty">Esta cuenta no devolvió ningún curso accesible.</p> : null}
            {busy === "snapshot" ? <p className="moodle-step-guidance">Cargando curso…</p> : null}
            {snapshot ? <>
              <div className="moodle-actions"><button type="button" className="btn secondary" disabled={Boolean(busy)} onClick={() => void loadSnapshot(selectedCourseId)}>Actualizar curso</button></div>
              <label className="compact-field"><span>Grupo Moodle</span><select value={selectedGroupId} onChange={(event) => { setSelectedGroupId(event.target.value); clearPreviews(); }}><option value="">Todo el curso</option>{snapshot.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
              <label className="compact-field"><span>Grupo de Edunoza</span><select value={selectedClassId} onChange={(event) => selectClass(event.target.value)}><option value="">Selecciona un grupo</option><option value={NEW_CLASS_OPTION}>+ Crear grupo nuevo</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.schoolYear}</option>)}</select></label>
              {classIsNew ? <>
                <label className="compact-field"><span>Nombre del grupo</span><input className="input" required value={newClassName} onChange={(event) => setNewClassName(event.target.value)} /></label>
                <label className="compact-field"><span>Nivel</span><input className="input" required value={newClassLevel} onChange={(event) => setNewClassLevel(event.target.value)} /></label>
                <label className="compact-field"><span>Curso escolar</span><input className="input" required pattern="[0-9]{4}-[0-9]{4}" placeholder="2026-2027" value={newSchoolYear} onChange={(event) => setNewSchoolYear(event.target.value)} /></label>
              </> : null}
              {selectedClassId ? <label className="compact-field"><span>Materia de Edunoza</span><select value={selectedSubjectId} onChange={(event) => { setSelectedSubjectId(event.target.value); clearPreviews(); }}><option value="">Selecciona una materia</option><option value={NEW_SUBJECT_OPTION}>+ Crear materia nueva</option>{availableSubjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}
              {subjectIsNew ? <label className="compact-field"><span>Nombre de la materia</span><input className="input" required value={newSubjectName} onChange={(event) => setNewSubjectName(event.target.value)} /></label> : null}
              {snapshot.warnings.length ? <details className="moodle-warnings" open><summary>{snapshot.warnings.length} aviso(s) del servidor</summary><ul>{snapshot.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details> : null}
              <details className="moodle-capabilities"><summary>Detalles técnicos</summary><ul>{["core_enrol_get_enrolled_users", "core_group_get_course_groups", "core_course_get_contents", "mod_assign_get_assignments", "mod_assign_get_grades", "mod_assign_get_submissions"].map((name) => <li key={name}><span>{capabilityLabel(name)}</span><strong>{connection.functions.includes(name) ? "Disponible" : "No disponible"}</strong></li>)}</ul></details>
              <div className="moodle-actions moodle-step-actions"><button className="btn" type="submit" disabled={!scopeReady || Boolean(busy)}>{busy === "scope-create" ? "Creando…" : "Continuar a revisión"}</button></div>
            </> : null}
          </form>
        </section>
      ) : null}

      {step === "review" && connection && snapshot && scope ? (
        <>
          <p className="moodle-workflow-context"><strong>Ámbito actual:</strong> {snapshot.course.fullName} → {classes.find((item) => item.id === scope.classId)?.name ?? "Grupo local"} · {subjects.find((item) => item.id === scope.subjectId)?.name ?? "Materia local"}</p>

          <section className="detail-section moodle-section" aria-labelledby="moodle-mapping-title">
            <div className="moodle-section-heading"><div><h2 id="moodle-mapping-title">Alumnado y actividades</h2><p>Los nombres son solo sugerencias visuales: ninguna coincidencia se aplica automáticamente.</p></div></div>
            <div className="moodle-actions">
              {exactMatchCount > 0 ? <button type="button" className="btn" disabled={Boolean(busy)} onClick={linkExactMatches}>Vincular {exactMatchCount} coincidencia{exactMatchCount === 1 ? "" : "s"} exacta{exactMatchCount === 1 ? "" : "s"}</button> : null}
              <button type="button" className="btn secondary" disabled={Boolean(busy)} onClick={() => bulkSetMappings("create-pending")}>Crear todo lo pendiente</button>
              <button type="button" className="btn secondary" disabled={Boolean(busy)} onClick={() => bulkSetMappings("ignore-pending")}>Ignorar todo lo pendiente</button>
              {hasScopedLinks ? <button type="button" className="btn secondary" disabled={Boolean(busy)} onClick={() => bulkSetMappings("unlink-existing")}>Quitar todas las asociaciones</button> : null}
            </div>
            <details className="moodle-mapping-group" open><summary>Participantes · {scopedRemoteStudents.length}</summary>{scopedRemoteStudents.length ? <div className="moodle-mapping-list">{scopedRemoteStudents.map((student) => <MappingRow key={student.id} kind="student" remoteId={student.id} label={student.fullName} candidates={localStudents.map((item) => ({ id: item.id, label: item.fullName }))} binding={scopedBindings.find((item) => item.kind === "student" && item.remoteId === student.id)} draft={mappingDrafts[mappingKey("student", student.id)]} onChange={updateMappingDraft} />)}</div> : <p className="moodle-empty">No hay participantes en este ámbito.</p>}</details>
            <details className="moodle-mapping-group"><summary>Actividades · {snapshot.activities.length}</summary>{snapshot.activities.length ? <div className="moodle-mapping-list">{snapshot.activities.map((activity) => <MappingRow key={activity.id} kind="activity" remoteId={activity.id} label={activity.title} candidates={localTasks.map((item) => ({ id: item.id, label: item.title }))} binding={scopedBindings.find((item) => item.kind === "activity" && item.remoteId === activity.id)} draft={mappingDrafts[mappingKey("activity", activity.id)]} onChange={updateMappingDraft} />)}</div> : <p className="moodle-empty">No hay actividades compatibles.</p>}</details>
            <div className="moodle-actions">
              <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void checkMappings()}>Comprobar asociaciones</button>
              {mappingPreview ? <button type="button" className="btn" disabled={Boolean(busy) || mappingPreview.rows.some((row) => row.status === "invalid")} onClick={() => void confirmMappings()}>Guardar {mappingPreview.rows.length} asociación(es)</button> : null}
            </div>
            {!mappingPreview && Object.keys(mappingDrafts).length > 0 ? <p className="moodle-step-guidance">Pulsa <strong>«Comprobar asociaciones»</strong> para preparar y poder guardar los cambios que has marcado arriba. Nada se guarda hasta que pulses «Guardar».</p> : null}
            {mappingPreview ? <div className="moodle-preview" role="region" aria-label="Vista previa de asociaciones"><p><strong>Aún sin guardar.</strong> Revisa estas decisiones:</p><ul>{mappingPreview.rows.map((row) => <li key={`${row.kind}:${row.remoteId}`}><span>{row.remoteLabel}</span><span>{row.localLabel ?? mappingActionLabel(row.choice.action)}</span><strong className={row.status === "invalid" ? "invalid" : "ready"}>{row.message ?? (row.status === "ready" ? "Preparada" : "Revisar")}</strong></li>)}</ul></div> : null}
          </section>

          <section className="detail-section moodle-section" aria-labelledby="moodle-review-title">
            <div className="moodle-section-heading"><div><h2 id="moodle-review-title">Cambios y notas</h2><p>Las notas se convierten explícitamente a 0–10. Edunoza no modifica Moodle.</p></div></div>
            {!hasScopedLinks ? <p className="moodle-empty">Vincula primero alumnado o actividades arriba para poder revisar sus cambios y notas.</p> : (
              <>
                <div className="moodle-actions">
                  <button type="button" className="btn secondary" disabled={Boolean(busy)} onClick={() => void reviewChangesAndGrades()}>Revisar cambios y notas</button>
                  {(updatePreview || gradePreview) ? <>
                    <button type="button" className="btn secondary" disabled={Boolean(busy)} onClick={() => bulkSetResolutions("local")}>Mantener todo Edunoza</button>
                    <button type="button" className="btn secondary" disabled={Boolean(busy)} onClick={() => bulkSetResolutions("remote")}>Usar todo Moodle</button>
                  </> : null}
                </div>
                {updatePreview ? updatePreview.rows.length ? <div className="moodle-resolution-list">{updatePreview.rows.map((row) => <fieldset key={row.id}><legend>{row.kind === "student" ? "Participante" : "Actividad"} · {fieldLabel(row.field)}{row.conflict ? " · Conflicto" : ""}</legend><label><input type="radio" name={`update-${row.id}`} checked={updateResolutions[row.id] === "local"} onChange={() => setUpdateResolutions((current) => ({ ...current, [row.id]: "local" }))} /><span><strong>Conservar Edunoza</strong><small>{String(row.localValue ?? "Vacío")}</small></span></label><label><input type="radio" name={`update-${row.id}`} checked={updateResolutions[row.id] === "remote"} onChange={() => setUpdateResolutions((current) => ({ ...current, [row.id]: "remote" }))} /><span><strong>Usar Moodle</strong><small>{String(row.sourceValue ?? "Vacío")}</small></span></label></fieldset>)}</div> : <p className="moodle-empty">No hay cambios pendientes en los campos compatibles.</p> : null}
                {gradePreview ? gradePreview.rows.length ? <div className="moodle-grade-list">{gradePreview.rows.map((row) => <fieldset key={row.id}><legend>{tasks.find((item) => item.id === row.taskId)?.title ?? "Actividad"} · {students.find((item) => item.id === row.studentId)?.fullName ?? "Participante"}</legend><p>Moodle: {row.remoteGrade ?? "sin nota"} / {row.gradeMax} → {row.scaledGrade ?? "no compatible"} / 10 · Edunoza: {row.localGrade ?? "sin nota"}</p><label><input type="radio" name={`grade-${row.id}`} checked={gradeResolutions[row.id] === "local"} onChange={() => setGradeResolutions((current) => ({ ...current, [row.id]: "local" }))} /> Conservar Edunoza</label><label><input type="radio" name={`grade-${row.id}`} checked={gradeResolutions[row.id] === "remote"} onChange={() => setGradeResolutions((current) => ({ ...current, [row.id]: "remote" }))} /> Importar Moodle</label></fieldset>)}</div> : <p className="moodle-empty">No hay notas vinculadas y compatibles para importar.</p> : null}
                {(updatePreview?.rows.length || gradePreview?.rows.length) ? <div className="moodle-actions"><button type="button" className="btn" disabled={Boolean(busy)} onClick={() => void applyChangesAndGrades()}>Aplicar cambios y notas</button></div> : null}
              </>
            )}
            <SubmissionSummary snapshot={snapshot} />
          </section>
        </>
      ) : null}

      <section className="detail-section moodle-section" aria-labelledby="moodle-operations-title">
        <details className="moodle-help">
          <summary id="moodle-operations-title">Operaciones recientes</summary>
          {operations.length ? <ol className="moodle-operation-list">{operations.map((operation) => <li key={operation.id}><div><strong>{operation.summary}</strong><span>{operation.count} elemento(s) · {operationKindLabel(operation.kind)}</span></div><time dateTime={operation.createdAt}>{formatDate(operation.createdAt)}</time></li>)}</ol> : <p className="moodle-empty">Todavía no hay operaciones Moodle registradas.</p>}
        </details>
      </section>
    </article>
  );
}

function MappingRow({ kind, remoteId, label, candidates, binding, draft, onChange }: { kind: "student" | "activity"; remoteId: number; label: string; candidates: Array<{ id: string; label: string }>; binding?: MoodleBinding; draft?: MappingDraft; onChange: (kind: "student" | "activity", remoteId: number, action: MoodleMappingChoice["action"], localId?: string) => void }) {
  const action = draft?.action ?? (binding ? "link" : "ignore");
  const localId = draft?.localId ?? binding?.localId ?? "";
  const linkedLabel = candidates.find((candidate) => candidate.id === binding?.localId)?.label;
  const suggestion = !binding ? findExactNameMatch(label, candidates) : undefined;
  const status = binding
    ? <span>Vinculado a {linkedLabel ?? "un registro local no disponible"}</span>
    : action === "ignore" && suggestion
      ? <span className="moodle-mapping-suggestion">Coincidencia: {suggestion.label} <button type="button" className="moodle-text-button" aria-label={`Usar la coincidencia ${suggestion.label} para ${label}`} onClick={() => onChange(kind, remoteId, "link", suggestion.id)}>Usar</button></span>
      : null;
  return <div className="moodle-mapping-row"><div><strong>{label}</strong>{status}</div><label><span className="sr-only">Decisión para {label}</span><select value={action} onChange={(event) => { const nextAction = event.target.value as MoodleMappingChoice["action"]; onChange(kind, remoteId, nextAction, nextAction === "link" ? localId : undefined); }}><option value="ignore">Ignorar</option><option value="link">{binding ? "Mantener o cambiar vínculo" : "Vincular existente"}</option><option value="create">Crear nuevo en Edunoza</option>{binding ? <option value="unlink">Quitar asociación</option> : null}</select></label>{action === "link" ? <label><span className="sr-only">Registro local para {label}</span><select required value={localId} onChange={(event) => onChange(kind, remoteId, "link", event.target.value)}><option value="">Seleccionar registro local</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</select></label> : (action === "create" || action === "unlink") ? <span className="moodle-mapping-note">{action === "create" ? "Se creará al guardar" : "El registro local se conserva"}</span> : <span />}</div>;
}

function SubmissionSummary({ snapshot }: { snapshot: MoodleCourseSnapshot }) {
  if (!snapshot.activities.length) return <p className="moodle-empty">Moodle no devolvió actividades compatibles.</p>;
  return (
    <div className="moodle-submission-list">
      <h3>Entregas leídas</h3>
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
