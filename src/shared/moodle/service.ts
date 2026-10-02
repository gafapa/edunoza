import { db } from "../db/database";
import type { ClassGroup, Student, Subject, Task, TaskDirectGrade, TaskGradebookConfig } from "../db/types";
import type {
  MoodleActivity,
  MoodleBinding,
  MoodleBindingKind,
  MoodleConnection,
  MoodleCourseSnapshot,
  MoodleMappingChoice,
  MoodleOperation,
  MoodleResolution,
  MoodleScope,
  MoodleSite
} from "./types";

type BaselineValue = string | number | null;

export type MoodleMappingPreviewRow = {
  kind: "student" | "activity";
  remoteId: number;
  choice: MoodleMappingChoice;
  remoteLabel: string;
  localLabel?: string;
  status: "ready" | "invalid";
  message?: string;
};

type MoodlePreviewState = {
  connectionUpdatedAt: string;
  scopeState: string;
  bindingState: string;
  localState: string;
};

const issuedPreviews = new Map<string, { kind: "mapping" | "updates" | "grades"; connectionId: string; fingerprint: string }>();

export type MoodleMappingPreview = {
  token: string;
  connectionId: string;
  scope: MoodleScope;
  snapshotFetchedAt: string;
  rows: MoodleMappingPreviewRow[];
  choices: MoodleMappingChoice[];
  snapshot: MoodleCourseSnapshot;
  state: MoodlePreviewState;
};

export type MoodleUpdatePreviewRow = {
  id: string;
  bindingId: string;
  kind: "student" | "activity";
  localId: string;
  field: "firstName" | "lastName" | "fullName" | "email" | "title" | "url" | "dueDate";
  sourceValue: BaselineValue;
  localValue: BaselineValue;
  localBaseline: BaselineValue;
  remoteBaseline: BaselineValue;
  conflict: boolean;
};

export type MoodleUpdatePreview = {
  token: string;
  connectionId: string;
  scope: MoodleScope;
  snapshotFetchedAt: string;
  rows: MoodleUpdatePreviewRow[];
  state: MoodlePreviewState;
};

export type MoodleGradePreviewRow = {
  id: string;
  activityId: number;
  userId: number;
  taskId: string;
  studentId: string;
  remoteGrade: number;
  gradeMax: number;
  scaledGrade: number;
  localGrade: number | null;
};

export type MoodleGradePreview = {
  token: string;
  connectionId: string;
  scope: MoodleScope;
  snapshotFetchedAt: string;
  rows: MoodleGradePreviewRow[];
  state: MoodlePreviewState;
};

export type CreateLocalScopeInput = {
  courseId: number;
  remoteGroupId?: number;
  /** Reuse this existing class instead of creating a new one; only a new subject is created. */
  existingClassId?: string;
  className: string;
  level: string;
  schoolYear: string;
  subjectName: string;
};

function now(): string {
  return new Date().toISOString();
}

function newId(): string {
  return crypto.randomUUID();
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stable(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function issuePreview<T extends { token: string; connectionId: string }>(kind: "mapping" | "updates" | "grades", preview: T): T {
  issuedPreviews.set(preview.token, { kind, connectionId: preview.connectionId, fingerprint: stable(preview) });
  return preview;
}

function consumePreview(kind: "mapping" | "updates" | "grades", preview: { token: string; connectionId: string }): void {
  const issued = issuedPreviews.get(preview.token);
  issuedPreviews.delete(preview.token);
  if (!issued || issued.kind !== kind || issued.connectionId !== preview.connectionId || issued.fingerprint !== stable(preview)) {
    throw new Error("La vista previa no es válida o ya se ha aplicado. Actualízala antes de continuar.");
  }
}

function invalidateConnectionPreviews(connectionId: string): void {
  for (const [token, preview] of issuedPreviews) {
    if (preview.connectionId === connectionId) issuedPreviews.delete(token);
  }
}

export function normalizeMoodleServer(value: string): string {
  if (typeof value !== "string") throw new Error("La dirección de Moodle no es válida.");
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("La dirección de Moodle no es válida.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("La dirección de Moodle debe usar HTTPS y no puede incluir credenciales, parámetros ni fragmentos.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function scaleMoodleGrade(grade: number, gradeMax: number): number {
  if (!Number.isFinite(grade) || !Number.isFinite(gradeMax) || gradeMax <= 0 || grade < 0 || grade > gradeMax) {
    throw new Error("La calificación de Moodle queda fuera de su escala numérica.");
  }
  return Math.round((grade / gradeMax) * 1000) / 100;
}

function matchesScope(binding: MoodleBinding, scope: MoodleScope): boolean {
  return binding.courseId === scope.courseId &&
    binding.classId === scope.classId &&
    binding.subjectId === scope.subjectId &&
    binding.remoteGroupId === scope.remoteGroupId;
}

function scopedStudents(snapshot: MoodleCourseSnapshot, scope: MoodleScope) {
  if (scope.remoteGroupId === undefined) return snapshot.students;
  const group = snapshot.groups.find((candidate) => candidate.id === scope.remoteGroupId);
  if (!group || group.courseId !== scope.courseId) {
    throw new Error("El grupo remoto no pertenece al curso de Moodle seleccionado.");
  }
  const memberIds = new Set(group.memberIds);
  return snapshot.students.filter((student) => memberIds.has(student.id));
}

function requireSafeRemoteUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Moodle ha devuelto un enlace de actividad no válido.");
  }
  const sensitiveParameter = [...url.searchParams.keys()].some((key) => /token|secret|password|key/i.test(key));
  if (url.protocol !== "https:" || url.username || url.password || url.hash || sensitiveParameter) {
    throw new Error("Moodle ha devuelto un enlace de actividad que no se puede guardar de forma segura.");
  }
}

async function requireConnection(connectionId: string): Promise<MoodleConnection> {
  const connection = await db.moodleConnections.get(connectionId);
  if (!connection) throw new Error("La conexión de Moodle ya no existe.");
  return connection;
}

async function requireScope(scope: MoodleScope): Promise<void> {
  const [classGroup, subject, subjectCourseLinks] = await Promise.all([
    db.classGroups.get(scope.classId),
    db.subjects.get(scope.subjectId),
    db.subjectCourseLinks.where("subjectId").equals(scope.subjectId).toArray()
  ]);
  if (!classGroup || !subject || !subjectCourseLinks.some((link) => link.classId === scope.classId)) {
    throw new Error("El ámbito local ya no existe o la materia no pertenece al grupo seleccionado.");
  }
}

function validateSnapshot(snapshot: MoodleCourseSnapshot, scope: MoodleScope): void {
  if (!Number.isSafeInteger(snapshot.course.id) || snapshot.course.id <= 0 || snapshot.course.id !== scope.courseId) {
    throw new Error("La instantánea no pertenece al curso de Moodle seleccionado.");
  }
  if (!snapshot.course.fullName.trim() || !snapshot.course.shortName.trim()) throw new Error("La instantánea no identifica correctamente el curso de Moodle.");
  if (!Number.isFinite(new Date(snapshot.fetchedAt).getTime())) throw new Error("La instantánea de Moodle no tiene una fecha válida.");
  if (!Array.isArray(snapshot.warnings) || snapshot.warnings.some((warning) => typeof warning !== "string")) {
    throw new Error("Moodle devolvió una instantánea con avisos en un formato no reconocido.");
  }
  const studentIds = new Set<number>();
  for (const student of snapshot.students) {
    if (!Number.isSafeInteger(student.id) || student.id <= 0 || studentIds.has(student.id) ||
        !student.firstName.trim() || !student.lastName.trim() || !student.fullName.trim()) {
      throw new Error("La instantánea contiene identidades de alumnos remotas duplicadas o no válidas.");
    }
    studentIds.add(student.id);
  }
  const groupIds = new Set<number>();
  for (const group of snapshot.groups) {
    if (!Number.isSafeInteger(group.id) || group.id <= 0 || group.courseId !== scope.courseId || groupIds.has(group.id) ||
        new Set(group.memberIds).size !== group.memberIds.length) {
      throw new Error("La instantánea contiene grupos remotos duplicados o no válidos.");
    }
    groupIds.add(group.id);
  }
  const activityIds = new Set<number>();
  for (const activity of snapshot.activities) {
    if (!Number.isSafeInteger(activity.id) || activity.id <= 0 || !Number.isSafeInteger(activity.instanceId) || activity.instanceId <= 0 ||
        activity.courseId !== scope.courseId || activityIds.has(activity.id) || !activity.title.trim()) {
      throw new Error("La instantánea contiene actividades remotas duplicadas o no válidas.");
    }
    requireSafeRemoteUrl(activity.url);
    activityIds.add(activity.id);
  }
  scopedStudents(snapshot, scope);
}

async function scopeState(scope: MoodleScope): Promise<string> {
  const [classGroup, subject, links] = await Promise.all([
    db.classGroups.get(scope.classId),
    db.subjects.get(scope.subjectId),
    db.subjectCourseLinks.where("subjectId").equals(scope.subjectId).toArray()
  ]);
  return stable({ classGroup, subject, links: links.filter((link) => link.classId === scope.classId) });
}

async function bindingState(connectionId: string, courseId: number): Promise<string> {
  const bindings = await db.moodleBindings
    .where("[connectionId+courseId]")
    .equals([connectionId, courseId])
    .sortBy("id");
  return stable(bindings);
}

async function relevantLocalState(scope: MoodleScope): Promise<string> {
  const [students, tasks, configs, grades, subjectStudents, taskSubjects, periods] = await Promise.all([
    db.students.where("classId").equals(scope.classId).sortBy("id"),
    db.tasks.toArray(),
    db.taskGradebookConfigs.where("[classId+subjectId]").equals([scope.classId, scope.subjectId]).sortBy("id"),
    db.taskDirectGrades.where("classId").equals(scope.classId)
      .filter((grade) => grade.subjectId === scope.subjectId).sortBy("id"),
    db.subjectStudentLinks.where("subjectId").equals(scope.subjectId).sortBy("id"),
    db.taskSubjectLinks.where("subjectId").equals(scope.subjectId).sortBy("id"),
    db.academicPeriods.where("classId").equals(scope.classId).sortBy("id")
  ]);
  return stable({ students, tasks, configs, grades, subjectStudents, taskSubjects, periods });
}

async function captureState(connection: MoodleConnection, scope: MoodleScope): Promise<MoodlePreviewState> {
  return {
    connectionUpdatedAt: connection.updatedAt,
    scopeState: await scopeState(scope),
    bindingState: await bindingState(connection.id, scope.courseId),
    localState: await relevantLocalState(scope)
  };
}

async function requireFreshPreview(
  connectionId: string,
  scope: MoodleScope,
  expected: MoodlePreviewState,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted();
  const connection = await requireConnection(connectionId);
  if (connection.updatedAt !== expected.connectionUpdatedAt ||
      await scopeState(scope) !== expected.scopeState ||
      await bindingState(connectionId, scope.courseId) !== expected.bindingState ||
      await relevantLocalState(scope) !== expected.localState) {
    throw new Error("La vista previa ha quedado obsoleta porque los datos o las asociaciones han cambiado. Actualízala antes de aplicar cambios.");
  }
  signal?.throwIfAborted();
}

async function addOperation(connectionId: string, kind: MoodleOperation["kind"], summary: string, count: number): Promise<void> {
  await db.moodleOperations.add({ id: newId(), connectionId, kind, summary, count, createdAt: now() });
}

export async function listConnections(): Promise<MoodleConnection[]> {
  return db.moodleConnections.orderBy("updatedAt").reverse().toArray();
}

export async function saveConnection(site: MoodleSite, signal?: AbortSignal): Promise<MoodleConnection> {
  const server = normalizeMoodleServer(site.siteUrl);
  if (!Number.isSafeInteger(site.userId) || site.userId <= 0) throw new Error("La cuenta de Moodle no tiene un identificador válido.");
  if (typeof site.siteName !== "string" || typeof site.fullName !== "string" || !site.siteName.trim() || !site.fullName.trim()) {
    throw new Error("Moodle no ha devuelto la identidad completa del sitio y del usuario.");
  }
  if (!Array.isArray(site.functions) || site.functions.some((name) => typeof name !== "string" || !name.trim())) {
    throw new Error("Moodle ha devuelto una lista de capacidades no válida.");
  }
  signal?.throwIfAborted();
  return db.transaction("rw", db.moodleConnections, async (transaction) => {
    const abort = () => transaction.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const existing = await db.moodleConnections.where("[server+userId]").equals([server, site.userId]).first();
      const timestamp = now();
      const connection: MoodleConnection = {
        id: existing?.id ?? newId(), server, userId: site.userId,
        siteName: site.siteName.trim(), userName: site.fullName.trim(),
        functions: [...new Set(site.functions)].sort(), createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp
      };
      await db.moodleConnections.put(connection);
      signal?.throwIfAborted();
      invalidateConnectionPreviews(connection.id);
      return connection;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  });
}

export async function forgetConnection(connectionId: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  invalidateConnectionPreviews(connectionId);
  await db.transaction("rw", db.moodleConnections, db.moodleBindings, db.moodleOperations, async (transaction) => {
    const abort = () => transaction.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await db.moodleBindings.where("connectionId").equals(connectionId).delete();
      await db.moodleOperations.where("connectionId").equals(connectionId).delete();
      await db.moodleConnections.delete(connectionId);
      signal?.throwIfAborted();
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  });
}

export async function getBindings(connectionId: string, scope?: MoodleScope): Promise<MoodleBinding[]> {
  const bindings = await db.moodleBindings.where("connectionId").equals(connectionId).toArray();
  return scope ? bindings.filter((binding) => matchesScope(binding, scope)) : bindings;
}

export async function getOperations(connectionId?: string, limit = 50): Promise<MoodleOperation[]> {
  const rows = connectionId
    ? await db.moodleOperations.where("connectionId").equals(connectionId).toArray()
    : await db.moodleOperations.toArray();
  return rows.sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, Math.max(0, limit));
}

export async function createLocalScope(input: CreateLocalScopeInput, signal?: AbortSignal): Promise<MoodleScope> {
  const subjectName = input.subjectName.trim();
  const existingClassId = input.existingClassId?.trim() || undefined;
  if (!subjectName) {
    throw new Error("Completa el nombre de la materia antes de crear el ámbito local.");
  }
  const className = input.className.trim();
  if (!existingClassId && (!className || !input.level.trim() || !input.schoolYear.trim())) {
    throw new Error("Completa el nombre, nivel y curso escolar del grupo antes de crear el ámbito local.");
  }
  if (!Number.isSafeInteger(input.courseId) || input.courseId <= 0 ||
      (input.remoteGroupId !== undefined && (!Number.isSafeInteger(input.remoteGroupId) || input.remoteGroupId <= 0))) {
    throw new Error("El curso o grupo remoto no tiene un identificador válido.");
  }
  const scope: MoodleScope = { courseId: input.courseId, remoteGroupId: input.remoteGroupId, classId: existingClassId ?? newId(), subjectId: newId() };
  signal?.throwIfAborted();
  await db.transaction("rw", db.classGroups, db.subjects, db.subjectCourseLinks, async (transaction) => {
    const abort = () => transaction.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      if (existingClassId) {
        const existingClass = await db.classGroups.get(existingClassId);
        if (!existingClass) throw new Error("El grupo seleccionado ya no existe.");
      } else {
        const classGroup: ClassGroup = { id: scope.classId, name: className, level: input.level.trim(), schoolYear: input.schoolYear.trim() };
        await db.classGroups.add(classGroup);
      }
      const subject: Subject = { id: scope.subjectId, name: subjectName, scheduleSlotIds: [] };
      await db.subjects.add(subject);
      await db.subjectCourseLinks.add({ id: newId(), classId: scope.classId, subjectId: scope.subjectId });
      signal?.throwIfAborted();
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  });
  return scope;
}

function remoteForChoice(snapshot: MoodleCourseSnapshot, scope: MoodleScope, choice: MoodleMappingChoice) {
  if (choice.kind === "student") return scopedStudents(snapshot, scope).find((student) => student.id === choice.remoteId);
  return snapshot.activities.find((activity) => activity.id === choice.remoteId && activity.courseId === scope.courseId);
}

export async function createMappingPreview(
  connectionId: string,
  snapshot: MoodleCourseSnapshot,
  scope: MoodleScope,
  choices: MoodleMappingChoice[]
): Promise<MoodleMappingPreview> {
  const connection = await requireConnection(connectionId);
  await requireScope(scope);
  validateSnapshot(snapshot, scope);
  const existing = await db.moodleBindings.where("[connectionId+courseId]").equals([connectionId, scope.courseId]).toArray();
  const scopedExisting = existing.filter((binding) => matchesScope(binding, scope));
  const choiceKeys = new Set<string>();
  const resultingMappings = new Map(scopedExisting.map((binding) => [`${binding.kind}:${binding.remoteId}`, binding.localId]));
  for (const choice of choices) {
    const key = `${choice.kind}:${choice.remoteId}`;
    if (choice.action === "unlink") resultingMappings.delete(key);
    else if (choice.action === "link" && choice.localId) resultingMappings.set(key, choice.localId);
    else if (choice.action === "create") resultingMappings.set(key, `new:${key}`);
  }
  const duplicateLocalKeys = new Set<string>();
  const seenLocalKeys = new Set<string>();
  for (const [remoteKey, localId] of resultingMappings) {
    const kind = remoteKey.split(":", 1)[0];
    const localKey = `${kind}:${localId}`;
    if (seenLocalKeys.has(localKey)) duplicateLocalKeys.add(localKey);
    seenLocalKeys.add(localKey);
  }
  const rows: MoodleMappingPreviewRow[] = [];
  for (const choice of choices) {
    const key = `${choice.kind}:${choice.remoteId}`;
    let message: string | undefined;
    if (choiceKeys.has(key)) message = "La misma identidad remota aparece más de una vez.";
    choiceKeys.add(key);
    const remote = remoteForChoice(snapshot, scope, choice);
    if (!remote) message = "El elemento remoto no pertenece al ámbito seleccionado.";
    let localLabel: string | undefined;
    if (choice.action === "link") {
      if (!choice.localId) message = "Selecciona un registro local para crear la asociación.";
      else if (choice.kind === "student") {
        const local = await db.students.get(choice.localId);
        if (!local || local.classId !== scope.classId) message = "El alumno local no pertenece al grupo seleccionado.";
        else localLabel = local.fullName;
      } else {
        const local = await db.tasks.get(choice.localId);
        const linked = local && await db.taskSubjectLinks.where("[taskId+subjectId]").equals([local.id, scope.subjectId]).first();
        if (!local || !linked) message = "La tarea local no pertenece a la materia seleccionada.";
        else localLabel = local.title;
      }
      if (choice.localId && duplicateLocalKeys.has(`${choice.kind}:${choice.localId}`)) message = "Ese registro local ya está asociado en este ámbito.";
    } else if (choice.action === "create") {
      const oldBinding = scopedExisting.find((binding) => binding.kind === choice.kind && binding.remoteId === choice.remoteId);
      const crossScopeBinding = existing.find((binding) =>
        binding.kind === choice.kind && binding.remoteId === choice.remoteId && !matchesScope(binding, scope));
      if (!oldBinding && crossScopeBinding) {
        message = "Este elemento remoto ya está asociado en otro ámbito. Selecciona explícitamente el registro local que quieras vincular.";
      }
      if (oldBinding && choice.kind === "student") {
        const local = await db.students.get(oldBinding.localId);
        if (!local || local.classId !== scope.classId) message = "La asociación anterior está obsoleta. Elimínala antes de volver a crear el alumno.";
        else localLabel = local.fullName;
      } else if (oldBinding) {
        const local = await db.tasks.get(oldBinding.localId);
        const taskLink = local && await db.taskSubjectLinks.where("[taskId+subjectId]").equals([local.id, scope.subjectId]).first();
        if (!local || !taskLink) message = "La asociación anterior está obsoleta. Elimínala antes de volver a crear la tarea.";
        else localLabel = local.title;
      }
    }
    const remoteLabel = choice.kind === "student" ? (remote && "fullName" in remote ? remote.fullName : `Alumno ${choice.remoteId}`) :
      (remote && "title" in remote ? remote.title : `Actividad ${choice.remoteId}`);
    rows.push({ kind: choice.kind, remoteId: choice.remoteId, choice: { ...choice }, remoteLabel, localLabel, status: message ? "invalid" : "ready", message });
  }
  return issuePreview("mapping", { token: newId(), connectionId, scope: { ...scope }, snapshotFetchedAt: snapshot.fetchedAt,
    rows, choices: choices.map((choice) => ({ ...choice })), snapshot, state: await captureState(connection, scope) });
}

function initialBaselines(kind: MoodleBindingKind, remote: MoodleCourseSnapshot["students"][number] | MoodleActivity, local: Student | Task): Pick<MoodleBinding, "localBaseline" | "remoteBaseline"> {
  if (kind === "student" && "fullName" in remote && "firstName" in local) {
    return {
      localBaseline: { firstName: local.firstName, lastName: local.lastName, fullName: local.fullName, email: local.email ?? null },
      remoteBaseline: { firstName: remote.firstName, lastName: remote.lastName, fullName: remote.fullName, email: remote.email ?? null }
    };
  }
  const activity = remote as MoodleActivity;
  return {
    localBaseline: { title: (local as Task).title },
    remoteBaseline: { title: activity.title, url: activity.url, dueDate: activity.dueDate ?? null }
  };
}

export async function applyMappingPreview(preview: MoodleMappingPreview, signal?: AbortSignal): Promise<MoodleBinding[]> {
  consumePreview("mapping", preview);
  if (preview.rows.some((row) => row.status === "invalid")) throw new Error("La vista previa contiene asociaciones no válidas.");
  if (preview.snapshot.fetchedAt !== preview.snapshotFetchedAt) throw new Error("La instantánea de Moodle no coincide con la vista previa.");
  signal?.throwIfAborted();
  const transactionTables = [db.moodleConnections, db.moodleBindings, db.moodleOperations, db.classGroups, db.subjects,
    db.subjectCourseLinks, db.subjectStudentLinks, db.students, db.tasks, db.taskSubjectLinks, db.taskGradebookConfigs,
    db.taskDirectGrades, db.academicPeriods] as const;
  return db.transaction("rw", transactionTables, async (transaction) => {
    const abort = () => transaction.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await requireFreshPreview(preview.connectionId, preview.scope, preview.state, signal);
      validateSnapshot(preview.snapshot, preview.scope);
      const timestamp = now();
      for (const choice of preview.choices) {
        signal?.throwIfAborted();
        if (choice.action === "ignore") continue;
        const old = (await db.moodleBindings.where("[connectionId+courseId+kind+remoteId]")
          .equals([preview.connectionId, preview.scope.courseId, choice.kind, choice.remoteId]).toArray())
          .filter((binding) => matchesScope(binding, preview.scope));
        if (choice.action === "unlink") {
          await db.moodleBindings.bulkDelete(old.map((binding) => binding.id));
          continue;
        }
        const remote = remoteForChoice(preview.snapshot, preview.scope, choice);
        if (!remote) throw new Error("Un elemento remoto ya no pertenece al ámbito seleccionado.");
        let local: Student | Task;
        const existingLocal = choice.action === "create" && old.length === 1
          ? (choice.kind === "student" ? await db.students.get(old[0].localId) : await db.tasks.get(old[0].localId))
          : undefined;
        if (existingLocal) {
          local = existingLocal;
        } else if (choice.action === "create" && choice.kind === "student" && "firstName" in remote) {
          local = { id: newId(), personId: newId(), classId: preview.scope.classId, firstName: remote.firstName, lastName: remote.lastName, fullName: remote.fullName, ...(remote.email ? { email: remote.email } : {}) };
          local.personId = local.id;
          await db.students.add(local);
          await db.subjectStudentLinks.add({ id: newId(), subjectId: preview.scope.subjectId, studentId: local.id });
        } else if (choice.action === "create" && choice.kind === "activity" && "title" in remote) {
          local = { id: newId(), title: remote.title, description: "", sessionCount: 1, sendToGradebook: false };
          await db.tasks.add(local);
          await db.taskSubjectLinks.add({ id: newId(), taskId: local.id, subjectId: preview.scope.subjectId });
          const config: TaskGradebookConfig = { id: newId(), taskId: local.id, subjectId: preview.scope.subjectId, classId: preview.scope.classId, gradebookWeight: 0, directGradeEnabled: true };
          await db.taskGradebookConfigs.add(config);
        } else if (choice.action === "link" && choice.localId) {
          const candidate = choice.kind === "student" ? await db.students.get(choice.localId) : await db.tasks.get(choice.localId);
          if (!candidate) throw new Error("El registro local seleccionado ya no existe.");
          local = candidate;
        } else {
          throw new Error("La acción de asociación no es válida.");
        }
        await db.moodleBindings.bulkDelete(old.map((binding) => binding.id));
        const priorSameTarget = old.find((binding) => binding.localId === local.id);
        const baselines = priorSameTarget
          ? { localBaseline: priorSameTarget.localBaseline, remoteBaseline: priorSameTarget.remoteBaseline }
          : initialBaselines(choice.kind, remote, local);
        await db.moodleBindings.add({ id: newId(), connectionId: preview.connectionId, courseId: preview.scope.courseId,
          remoteGroupId: preview.scope.remoteGroupId, classId: preview.scope.classId, subjectId: preview.scope.subjectId,
          kind: choice.kind, remoteId: choice.remoteId, localId: local.id,
          remoteLabel: "fullName" in remote ? remote.fullName : remote.title, ...baselines, updatedAt: timestamp });
      }
      const priorCourse = await db.moodleBindings.where("[connectionId+courseId+kind+remoteId]")
        .equals([preview.connectionId, preview.scope.courseId, "course", preview.scope.courseId]).toArray();
      await db.moodleBindings.bulkDelete(priorCourse.filter((binding) => matchesScope(binding, preview.scope)).map((binding) => binding.id));
      await db.moodleBindings.add({ id: newId(), connectionId: preview.connectionId, courseId: preview.scope.courseId,
        remoteGroupId: preview.scope.remoteGroupId, classId: preview.scope.classId, subjectId: preview.scope.subjectId,
        kind: "course", remoteId: preview.scope.courseId, localId: preview.scope.classId,
        remoteLabel: preview.snapshot.course.fullName, localBaseline: {},
        remoteBaseline: { fullName: preview.snapshot.course.fullName, shortName: preview.snapshot.course.shortName }, updatedAt: timestamp });
      await addOperation(preview.connectionId, "link", "Asociaciones de Moodle actualizadas", preview.choices.filter((choice) => choice.action !== "ignore").length);
      signal?.throwIfAborted();
      return getBindings(preview.connectionId, preview.scope);
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  });
}

export async function previewUpdates(connectionId: string, snapshot: MoodleCourseSnapshot, scope: MoodleScope): Promise<MoodleUpdatePreview> {
  const connection = await requireConnection(connectionId);
  await requireScope(scope);
  validateSnapshot(snapshot, scope);
  const bindings = (await getBindings(connectionId, scope)).filter(
    (binding): binding is MoodleBinding & { kind: "student" | "activity" } => binding.kind !== "course"
  );
  const rows: MoodleUpdatePreviewRow[] = [];
  for (const binding of bindings) {
    const remote = binding.kind === "student" ? scopedStudents(snapshot, scope).find((student) => student.id === binding.remoteId) :
      snapshot.activities.find((activity) => activity.id === binding.remoteId && activity.courseId === scope.courseId);
    const local = binding.kind === "student" ? await db.students.get(binding.localId) : await db.tasks.get(binding.localId);
    if (!remote || !local) continue;
    const fields = binding.kind === "student" ? ["firstName", "lastName", "fullName", "email"] as const : ["title", "url", "dueDate"] as const;
    for (const field of fields) {
      const sourceValue = (remote as unknown as Record<string, BaselineValue | undefined>)[field] ?? null;
      const remoteBaseline = binding.remoteBaseline[field] ?? null;
      const isRemoteMetadata = field === "url" || field === "dueDate";
      const localValue = isRemoteMetadata ? remoteBaseline : (local as unknown as Record<string, BaselineValue | undefined>)[field] ?? null;
      const localBaseline = isRemoteMetadata ? remoteBaseline : binding.localBaseline[field] ?? null;
      if (sourceValue === localValue && sourceValue === remoteBaseline && localValue === localBaseline) continue;
      rows.push({ id: `${binding.id}:${field}`, bindingId: binding.id, kind: binding.kind, localId: binding.localId, field,
        sourceValue, localValue, localBaseline, remoteBaseline,
        conflict: sourceValue !== remoteBaseline && localValue !== localBaseline && sourceValue !== localValue });
    }
  }
  return issuePreview("updates", { token: newId(), connectionId, scope: { ...scope }, snapshotFetchedAt: snapshot.fetchedAt,
    rows, state: await captureState(connection, scope) });
}

export async function applyUpdates(preview: MoodleUpdatePreview, resolutions: Record<string, MoodleResolution>, signal?: AbortSignal): Promise<void> {
  consumePreview("updates", preview);
  signal?.throwIfAborted();
  const transactionTables = [db.moodleConnections, db.moodleBindings, db.moodleOperations, db.classGroups, db.subjects,
    db.subjectCourseLinks, db.subjectStudentLinks, db.taskSubjectLinks, db.students, db.tasks, db.taskGradebookConfigs,
    db.taskDirectGrades, db.academicPeriods] as const;
  await db.transaction("rw", transactionTables, async (transaction) => {
    const abort = () => transaction.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await requireFreshPreview(preview.connectionId, preview.scope, preview.state, signal);
      let applied = 0;
      for (const row of preview.rows) {
        const resolution = resolutions[row.id];
        if (resolution !== "remote" && resolution !== "local") throw new Error("Selecciona una resolución para cada cambio de Moodle.");
        const binding = await db.moodleBindings.get(row.bindingId);
        if (!binding || !matchesScope(binding, preview.scope) || binding.localId !== row.localId) throw new Error("Una asociación cambió mientras se revisaban las actualizaciones.");
        const localTable = row.kind === "student" ? db.students : db.tasks;
        const local = await localTable.get(row.localId) as (Student | Task | undefined);
        const isRemoteMetadata = row.field === "url" || row.field === "dueDate";
        const currentLocalValue = isRemoteMetadata ? binding.remoteBaseline[row.field] ?? null :
          (local as unknown as Record<string, unknown> | undefined)?.[row.field] ?? null;
        if (!local || currentLocalValue !== row.localValue) throw new Error("Un registro local cambió mientras se revisaban las actualizaciones.");
        const finalValue = resolution === "remote" ? row.sourceValue : row.localValue;
        if (resolution === "remote" && !isRemoteMetadata) {
          if (row.field === "email" && finalValue === null) await db.students.update(row.localId, { email: undefined });
          else await localTable.update(row.localId, { [row.field]: finalValue } as never);
          applied += 1;
        }
        if (resolution === "remote" && isRemoteMetadata) applied += 1;
        await db.moodleBindings.update(binding.id, {
          localBaseline: isRemoteMetadata ? binding.localBaseline : { ...binding.localBaseline, [row.field]: finalValue },
          // Record the remote value we just reconciled against regardless of resolution,
          // otherwise a "keep local" choice keeps resurfacing the same diff every sync.
          remoteBaseline: { ...binding.remoteBaseline, [row.field]: row.sourceValue }, updatedAt: now()
        });
        signal?.throwIfAborted();
      }
      await addOperation(preview.connectionId, "update", "Actualizaciones de Moodle revisadas", applied);
      signal?.throwIfAborted();
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  });
}

async function compatibleConfig(taskId: string, scope: MoodleScope): Promise<TaskGradebookConfig | undefined> {
  const configs = await db.taskGradebookConfigs.where("[taskId+subjectId+classId]").equals([taskId, scope.subjectId, scope.classId]).toArray();
  if (configs.length !== 1 || configs[0].directGradeEnabled !== true || configs[0].rubricTemplateId || configs[0].checklistTemplateId) return undefined;
  if (configs[0].academicPeriodId) {
    const period = await db.academicPeriods.get(configs[0].academicPeriodId);
    if (!period || period.classId !== scope.classId || period.status === "closed") return undefined;
  }
  return configs[0];
}

export async function previewGrades(connectionId: string, snapshot: MoodleCourseSnapshot, scope: MoodleScope): Promise<MoodleGradePreview> {
  const connection = await requireConnection(connectionId);
  await requireScope(scope);
  validateSnapshot(snapshot, scope);
  const bindings = await getBindings(connectionId, scope);
  const activities = new Map(snapshot.activities.map((activity) => [activity.id, activity]));
  const activityBindings = new Map(bindings.filter((binding) => binding.kind === "activity").map((binding) => [binding.remoteId, binding]));
  const studentBindings = new Map(bindings.filter((binding) => binding.kind === "student").map((binding) => [binding.remoteId, binding]));
  const rows: MoodleGradePreviewRow[] = [];
  const latestGrades = new Map<string, MoodleCourseSnapshot["grades"][number]>();
  for (const grade of snapshot.grades) {
    const key = `${grade.activityId}:${grade.userId}`;
    const existing = latestGrades.get(key);
    if (!existing || grade.modifiedAt > existing.modifiedAt) latestGrades.set(key, grade);
  }
  for (const grade of latestGrades.values()) {
    if (grade.grade === null || !Number.isFinite(grade.grade)) continue;
    const activity = activities.get(grade.activityId);
    const activityBinding = activityBindings.get(grade.activityId);
    const studentBinding = studentBindings.get(grade.userId);
    if (!activity || activity.module !== "assign" || !activityBinding || !studentBinding || !activity.gradeMax || activity.gradeMax <= 0 ||
        activity.advancedGrading || activity.teamSubmission || !await compatibleConfig(activityBinding.localId, scope)) continue;
    const [student, subjectLink] = await Promise.all([
      db.students.get(studentBinding.localId),
      db.subjectStudentLinks.where("[subjectId+studentId]").equals([scope.subjectId, studentBinding.localId]).first()
    ]);
    if (!student || student.classId !== scope.classId || !subjectLink) continue;
    const direct = await db.taskDirectGrades.where("[taskId+subjectId+classId]")
      .equals([activityBinding.localId, scope.subjectId, scope.classId]).filter((candidate) => candidate.studentId === studentBinding.localId).first();
    rows.push({ id: `${activityBinding.id}:${studentBinding.id}:${grade.modifiedAt}`, activityId: activity.id, userId: grade.userId,
      taskId: activityBinding.localId, studentId: studentBinding.localId, remoteGrade: grade.grade, gradeMax: activity.gradeMax,
      scaledGrade: scaleMoodleGrade(grade.grade, activity.gradeMax), localGrade: direct?.score ?? null });
  }
  return issuePreview("grades", { token: newId(), connectionId, scope: { ...scope }, snapshotFetchedAt: snapshot.fetchedAt,
    rows, state: await captureState(connection, scope) });
}

export async function applyGrades(preview: MoodleGradePreview, resolutions: Record<string, MoodleResolution>, signal?: AbortSignal): Promise<void> {
  consumePreview("grades", preview);
  signal?.throwIfAborted();
  const transactionTables = [db.moodleConnections, db.moodleBindings, db.moodleOperations, db.classGroups, db.subjects,
    db.subjectCourseLinks, db.subjectStudentLinks, db.taskSubjectLinks, db.students, db.tasks, db.taskGradebookConfigs,
    db.taskDirectGrades, db.academicPeriods] as const;
  await db.transaction("rw", transactionTables, async (transaction) => {
    const abort = () => transaction.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await requireFreshPreview(preview.connectionId, preview.scope, preview.state, signal);
      let applied = 0;
      for (const row of preview.rows) {
        const resolution = resolutions[row.id];
        if (resolution !== "remote" && resolution !== "local") throw new Error("Selecciona una resolución para cada calificación.");
        if (!Number.isFinite(row.scaledGrade) || row.scaledGrade < 0 || row.scaledGrade > 10) {
          throw new Error("La calificación remota queda fuera del rango local de 0 a 10.");
        }
        if (!await compatibleConfig(row.taskId, preview.scope)) throw new Error("La configuración de evaluación directa ya no es compatible.");
        const existing = await db.taskDirectGrades.where("[taskId+subjectId+classId]")
          .equals([row.taskId, preview.scope.subjectId, preview.scope.classId]).filter((candidate) => candidate.studentId === row.studentId).first();
        if ((existing?.score ?? null) !== row.localGrade) throw new Error("Una calificación local cambió mientras se revisaba la importación.");
        const [activityBinding, studentBinding, student, subjectLink] = await Promise.all([
          db.moodleBindings.where("[connectionId+courseId+kind+remoteId]")
            .equals([preview.connectionId, preview.scope.courseId, "activity", row.activityId]).filter((binding) => matchesScope(binding, preview.scope)).first(),
          db.moodleBindings.where("[connectionId+courseId+kind+remoteId]")
            .equals([preview.connectionId, preview.scope.courseId, "student", row.userId]).filter((binding) => matchesScope(binding, preview.scope)).first(),
          db.students.get(row.studentId),
          db.subjectStudentLinks.where("[subjectId+studentId]").equals([preview.scope.subjectId, row.studentId]).first()
        ]);
        if (!activityBinding || activityBinding.localId !== row.taskId || !studentBinding || studentBinding.localId !== row.studentId ||
            !student || student.classId !== preview.scope.classId || !subjectLink) {
          throw new Error("Las asociaciones de la calificación ya no son compatibles con el ámbito local.");
        }
        if (resolution === "remote") {
          const direct: TaskDirectGrade = { id: existing?.id ?? newId(), taskId: row.taskId, subjectId: preview.scope.subjectId,
            classId: preview.scope.classId, studentId: row.studentId, score: row.scaledGrade };
          await db.taskDirectGrades.put(direct);
          applied += 1;
        }
        signal?.throwIfAborted();
      }
      await addOperation(preview.connectionId, "grades", "Calificaciones de Moodle revisadas", applied);
      signal?.throwIfAborted();
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  });
}
