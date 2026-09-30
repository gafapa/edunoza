import { clearLocalDrafts } from "../drafts/localDrafts";
import { PRODUCT_NAME, isCompatibleProductName } from "../brand";
import { db } from "../db/database";
import { isSavedAiReport } from "../reports/aiReportArchive";
import { MAX_LAYOUT_DIMENSION, MIN_LAYOUT_DIMENSION } from "../classroom/layout";
import {
  FEEDBACK_COMMENT_CATEGORIES,
  MAX_FEEDBACK_COMMENT_LENGTH,
  normalizeFeedbackComment
} from "../feedback/comments";
import {
  MAX_RESOURCE_FILE_BYTES,
  MAX_RESOURCE_FILE_NAME_LENGTH,
  MAX_RESOURCE_TITLE_LENGTH,
  MAX_RESOURCE_URL_LENGTH,
  MAX_TOTAL_RESOURCE_BYTES,
  base64DecodedByteLength,
  isAllowedResourceMimeType,
  normalizeHttpUrl,
  parseJournalEntryOwnerId
} from "../resources/resources";
import { defaultScheduleDays } from "../schedule/weekDays";
import { toLocalIsoDate } from "../utils/date";

export async function seedDatabase(expectedCurrentTables: Record<string, unknown[]>): Promise<void> {
  const uid = () => crypto.randomUUID();

  await db.transaction("rw", db.tables, async () => {
    await assertCurrentDatabase(expectedCurrentTables);
    for (const table of db.tables) await table.clear();

  const course1Id = uid();
  const course2Id = uid();
  await db.classGroups.bulkPut([
    { id: course1Id, name: "1º ESO A", level: "1 ESO", schoolYear: "2025-2026" },
    { id: course2Id, name: "2º ESO B", level: "2 ESO", schoolYear: "2025-2026" }
  ]);

  const course1Students = [
    { firstName: "Lucía",     lastName: "Martínez García"  },
    { firstName: "Alejandro", lastName: "López Fernández"  },
    { firstName: "Sofía",     lastName: "González Ruiz"    },
    { firstName: "Daniel",    lastName: "Sánchez Moreno"   },
    { firstName: "María",     lastName: "Rodríguez Díaz"   }
  ];
  const course2Students = [
    { firstName: "Pablo",  lastName: "Jiménez Álvarez" },
    { firstName: "Carmen", lastName: "Romero Torres"   },
    { firstName: "Adrián", lastName: "Navarro Molina"  },
    { firstName: "Elena",  lastName: "Serrano Castro"  },
    { firstName: "Javier", lastName: "Morales Vega"    }
  ];
  const course1StudentIds = course1Students.map(() => uid());
  const course2StudentIds = course2Students.map(() => uid());
  await db.students.bulkPut([
    ...course1Students.map((student, index) => ({ id: course1StudentIds[index], personId: course1StudentIds[index], classId: course1Id, firstName: student.firstName, lastName: student.lastName, fullName: `${student.firstName} ${student.lastName}` })),
    ...course2Students.map((student, index) => ({ id: course2StudentIds[index], personId: course2StudentIds[index], classId: course2Id, firstName: student.firstName, lastName: student.lastName, fullName: `${student.firstName} ${student.lastName}` }))
  ]);
  const timeSlots = [
    { start: "08:00", end: "08:55" },
    { start: "08:55", end: "09:50" },
    { start: "09:50", end: "10:45" },
    { start: "11:05", end: "12:00" },
    { start: "12:00", end: "12:55" },
    { start: "12:55", end: "13:50" }
  ];
  const slotMap: Record<number, string[]> = {};
  const scheduleDaysData = defaultScheduleDays().map((day) => {
    if (!day.enabled) {
      return day;
    }
    slotMap[day.dayOfWeek] = timeSlots.map(() => uid());
    return {
      ...day,
      id: uid(),
      blocks: timeSlots.map((slot, slotIndex) => ({
        id: slotMap[day.dayOfWeek][slotIndex],
        startTime: slot.start,
        endTime: slot.end
      }))
    };
  });
  await db.scheduleDays.bulkPut(scheduleDaysData);
  await db.scheduleSettings.put({ id: "default", defaultBlockDurationMinutes: 55 });

  const pickSeedSlot = (dayOfWeek: number, slotIndex: number): string => {
    const slotId = slotMap[dayOfWeek]?.[slotIndex];
    if (!slotId) {
      throw new Error(`Dev seed: schedule slot missing for day ${dayOfWeek} at index ${slotIndex}.`);
    }
    return slotId;
  };
  const matSlots = [pickSeedSlot(1, 0), pickSeedSlot(2, 0), pickSeedSlot(3, 1), pickSeedSlot(4, 0)];
  const lenSlots = [pickSeedSlot(1, 1), pickSeedSlot(2, 1), pickSeedSlot(4, 1), pickSeedSlot(5, 0)];
  const ingSlots = [pickSeedSlot(1, 2), pickSeedSlot(3, 2), pickSeedSlot(5, 1)];

  const matId = uid();
  const lenId = uid();
  const ingId = uid();
  await db.subjects.bulkPut([
    { id: matId, name: "Matemáticas",       teachingHours: "4", scheduleSlotIds: matSlots },
    { id: lenId, name: "Lengua Castellana", teachingHours: "4", scheduleSlotIds: lenSlots },
    { id: ingId, name: "Inglés",            teachingHours: "3", scheduleSlotIds: ingSlots }
  ]);

  await db.subjectCourseLinks.bulkPut([
    { id: uid(), subjectId: matId, classId: course1Id },
    { id: uid(), subjectId: lenId, classId: course2Id },
    { id: uid(), subjectId: ingId, classId: course1Id }
  ]);
  await db.subjectStudentLinks.bulkPut(
    [
      ...course1StudentIds.map((studentId) => ({ id: uid(), subjectId: matId, studentId })),
      ...course2StudentIds.map((studentId) => ({ id: uid(), subjectId: lenId, studentId })),
      ...course1StudentIds.map((studentId) => ({ id: uid(), subjectId: ingId, studentId }))
    ]
  );

  const units = [
    { subjectId: matId, name: "Números y operaciones",  desc: "Repaso de aritmética y fracciones",   sessions: 8  },
    { subjectId: matId, name: "Álgebra básica",         desc: "Ecuaciones de primer grado",           sessions: 10 },
    { subjectId: matId, name: "Geometría",              desc: "Figuras planas y sólidos geométricos", sessions: 7  },
    { subjectId: lenId, name: "Comprensión lectora",    desc: "Textos narrativos y expositivos",      sessions: 6  },
    { subjectId: lenId, name: "Gramática",              desc: "Morfología y sintaxis básica",         sessions: 9  },
    { subjectId: lenId, name: "Expresión escrita",      desc: "Técnicas de redacción y coherencia",   sessions: 7  },
    { subjectId: ingId, name: "Present & Past Tenses",  desc: "Simple, continuous, perfect",          sessions: 8  },
    { subjectId: ingId, name: "Vocabulary: Daily Life", desc: "Routines, hobbies, travel",            sessions: 6  }
  ];
  const unitIds = units.map(() => uid());
  await db.unitBlocks.bulkPut(
    units.map((unit, index) => ({
      id: unitIds[index],
      subjectId: unit.subjectId,
      name: unit.name,
      description: unit.desc,
      sessionCount: unit.sessions,
      position: index
    }))
  );

  const today = new Date();
  const dateForWeekday = (dayOfWeek: number, weekOffset: number): string => {
    const date = new Date(today);
    const currentDay = date.getDay() === 0 ? 7 : date.getDay();
    date.setDate(date.getDate() + (dayOfWeek - currentDay) + weekOffset * 7);
    return toLocalIsoDate(date);
  };

  const t1Id = uid();
  const t2Id = uid();
  const t3Id = uid();
  const t4Id = uid();
  const t5Id = uid();

  await db.tasks.bulkPut([
    {
      id: t1Id,
      title: "Examen U1 — Números",
      description: "Prueba escrita sobre aritmética y fracciones. Calculadora no permitida.",
      sessionCount: 1,
      sendToGradebook: true
    },
    {
      id: t2Id,
      title: "Redacción libre",
      description: "Texto narrativo de 300 palabras sobre un recuerdo de infancia.",
      sessionCount: 1,
      sendToGradebook: true
    },
    {
      id: t3Id,
      title: "Ejercicios: ecuaciones de 1er grado",
      description: "Hoja de ejercicios sobre resolución de ecuaciones lineales.",
      sessionCount: 1,
      sendToGradebook: false
    },
    {
      id: t4Id,
      title: "Listening: Daily routines",
      description: "Actividad de comprensión oral con audio. Responder cuestionario.",
      sessionCount: 1,
      sendToGradebook: true
    },
    {
      id: t5Id,
      title: "Lectura: texto expositivo",
      description: "Lectura y análisis de un texto expositivo sobre el cambio climático.",
      sessionCount: 1,
      sendToGradebook: false
    }
  ]);

  await db.taskSubjectLinks.bulkPut([
    { id: uid(), taskId: t1Id, subjectId: matId, unitId: unitIds[0] },
    { id: uid(), taskId: t2Id, subjectId: lenId, unitId: unitIds[5] },
    { id: uid(), taskId: t3Id, subjectId: matId, unitId: unitIds[1] },
    { id: uid(), taskId: t4Id, subjectId: ingId, unitId: unitIds[6] }, // U1 Ing
    { id: uid(), taskId: t5Id, subjectId: lenId, unitId: unitIds[3] }  // U1 Len
  ]);

  const sessions: {
    taskId: string; subjectId: string; classId: string; date: string; scheduleSlotId: string;
  }[] = [
    { taskId: t1Id, subjectId: matId, classId: course1Id, date: dateForWeekday(1, -2), scheduleSlotId: slotMap[1][0] },
    { taskId: t2Id, subjectId: lenId, classId: course2Id, date: dateForWeekday(1, -1), scheduleSlotId: slotMap[1][1] },
    { taskId: t3Id, subjectId: matId, classId: course1Id, date: dateForWeekday(3, -1), scheduleSlotId: slotMap[3][1] },
    { taskId: t4Id, subjectId: ingId, classId: course1Id, date: dateForWeekday(1, 1), scheduleSlotId: slotMap[1][2] },
    { taskId: t5Id, subjectId: lenId, classId: course2Id, date: dateForWeekday(2, 1), scheduleSlotId: slotMap[2][1] }
  ];
  await db.taskSessions.bulkPut(
    sessions.map((s) => ({ id: uid(), ...s, status: "planned" as const }))
  );
  });
}

export type DatabaseExportPayload = {
  app: string;
  schemaVersion: number;
  exportedAt: string;
  tables: Record<string, unknown[]>;
};

export const DATABASE_SCHEMA_VERSION = 7;
const LEGACY_DATABASE_SCHEMA_VERSIONS = new Set([6]);
export const MAX_IMPORT_FILE_BYTES = 75 * 1024 * 1024;
const MAX_STUDENT_PHOTO_DATA_URL_CHARS = 1_500_000;

export function buildBackupFileName(label = "backup"): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `edunoza-${label}-${stamp}.json`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(row: Record<string, unknown>, tableName: string, fieldName: string): string {
  const value = row[fieldName];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`La tabla '${tableName}' contiene filas sin '${fieldName}' válido.`);
  }
  return value;
}

function requireText(row: Record<string, unknown>, tableName: string, fieldName: string): void {
  if (typeof row[fieldName] !== "string") {
    throw new Error(`La tabla '${tableName}' contiene filas sin '${fieldName}' válido.`);
  }
}

function requireNumber(row: Record<string, unknown>, tableName: string, fieldName: string): void {
  const value = row[fieldName];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`La tabla '${tableName}' contiene filas sin '${fieldName}' numérico válido.`);
  }
}

function requireMinNumber(row: Record<string, unknown>, tableName: string, fieldName: string, minValue: number): void {
  requireNumber(row, tableName, fieldName);
  if ((row[fieldName] as number) < minValue) {
    throw new Error(`La tabla '${tableName}' contiene '${fieldName}' por debajo de ${minValue}.`);
  }
}

function requireDateString(row: Record<string, unknown>, tableName: string, fieldName: string): string {
  const value = requireString(row, tableName, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`La tabla '${tableName}' contiene '${fieldName}' con formato de fecha no valido.`);
  }
  const [year, month, day] = value.split("-").map((part) => Number(part));
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    parsedDate.getUTCFullYear() === year &&
    parsedDate.getUTCMonth() === month - 1 &&
    parsedDate.getUTCDate() === day;
  if (!isRealDate) {
    throw new Error(`La tabla '${tableName}' contiene '${fieldName}' con una fecha inexistente.`);
  }
  return value;
}

function isoDayOfWeek(value: string): number {
  const day = new Date(`${value}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function requireSlotMatchesDate(
  tableName: string,
  date: string,
  scheduleSlotId: string,
  scheduleDayBySlotId: Map<string, number>
): void {
  if (scheduleDayBySlotId.get(scheduleSlotId) !== isoDayOfWeek(date)) {
    throw new Error(`La tabla '${tableName}' usa una franja horaria que no corresponde al día de la fecha.`);
  }
}

function requireIsoDateTimeString(value: unknown, fieldName: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`La copia de seguridad contiene '${fieldName}' no válido.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    throw new Error(`La copia de seguridad contiene '${fieldName}' no válido.`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`La copia de seguridad contiene '${fieldName}' no válido.`);
  }
  const datePart = value.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    const [year, month, day] = datePart.split("-").map((part) => Number(part));
    const parsedDate = new Date(Date.UTC(year, month - 1, day));
    const isRealDate =
      parsedDate.getUTCFullYear() === year &&
      parsedDate.getUTCMonth() === month - 1 &&
      parsedDate.getUTCDate() === day;
    if (!isRealDate) {
      throw new Error(`La copia de seguridad contiene '${fieldName}' con una fecha inexistente.`);
    }
  }
}

function requireTimeString(row: Record<string, unknown>, tableName: string, fieldName: string): string {
  const value = requireString(row, tableName, fieldName);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error(`La tabla '${tableName}' contiene '${fieldName}' con formato de hora no valido.`);
  }
  return value;
}

function minutesFromTime(value: string): number {
  const [hour, minute] = value.split(":").map((part) => Number(part));
  return hour * 60 + minute;
}

function requireBoolean(row: Record<string, unknown>, tableName: string, fieldName: string): void {
  if (typeof row[fieldName] !== "boolean") {
    throw new Error(`La tabla '${tableName}' contiene filas sin '${fieldName}' booleano válido.`);
  }
}

function optionalString(row: Record<string, unknown>, tableName: string, fieldName: string): string | undefined {
  const value = row[fieldName];
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`La tabla '${tableName}' contiene '${fieldName}' no válido.`);
  }
  return value;
}

function requireOnlyFields(row: Record<string, unknown>, tableName: string, allowedFields: readonly string[]): void {
  const allowed = new Set(allowedFields);
  const unexpected = Object.keys(row).filter((field) => !allowed.has(field));
  if (unexpected.length > 0) {
    throw new Error(`La tabla '${tableName}' contiene campos no permitidos: ${unexpected.join(", ")}.`);
  }
}

function requireBaseline(row: Record<string, unknown>, tableName: string, fieldName: string): void {
  const baseline = row[fieldName];
  if (!isPlainObject(baseline) || Object.values(baseline).some((value) =>
    value !== null && typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value)))) {
    throw new Error(`La tabla '${tableName}' contiene '${fieldName}' no válido.`);
  }
}

function requireSecretFreeMoodleUrl(value: unknown): void {
  if (typeof value !== "string") throw new Error("La tabla 'moodleBindings' contiene un enlace remoto no válido.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("La tabla 'moodleBindings' contiene un enlace remoto no válido.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
      [...url.searchParams.keys()].some((key) => /token|secret|password|key/i.test(key))) {
    throw new Error("La tabla 'moodleBindings' contiene un enlace remoto con datos sensibles o no seguros.");
  }
}

function requireReference(
  value: string | undefined,
  targetIds: Set<string>,
  tableName: string,
  fieldName: string
): void {
  if (value && !targetIds.has(value)) {
    throw new Error(`La tabla '${tableName}' referencia '${fieldName}' inexistente: ${value}.`);
  }
}

function requireUniqueLogicalRows(
  tableRows: Record<string, unknown>[],
  tableName: string,
  logicalKeyName: string,
  keyForRow: (row: Record<string, unknown>) => string
): void {
  const seen = new Set<string>();
  for (const row of tableRows) {
    const key = keyForRow(row);
    if (seen.has(key)) {
      throw new Error(`La tabla '${tableName}' contiene filas duplicadas para '${logicalKeyName}'.`);
    }
    seen.add(key);
  }
}

function collectScheduleSlotIds(scheduleDays: Record<string, unknown>[]): Set<string> {
  const slotIds = new Set<string>();
  for (const day of scheduleDays) {
    if (!Array.isArray(day.blocks)) {
      continue;
    }
    for (const block of day.blocks) {
      if (isPlainObject(block) && block.isBreak !== true && typeof block.id === "string" && block.id.trim()) {
        slotIds.add(block.id);
      }
    }
  }
  return slotIds;
}

function validateSubjectScheduleSlots(subject: Record<string, unknown>, scheduleSlotIds: Set<string>): void {
  const value = subject.scheduleSlotIds;
  if (!Array.isArray(value) || value.some((slotId) => typeof slotId !== "string" || !slotId.trim())) {
    throw new Error("La tabla 'subjects' contiene 'scheduleSlotIds' no valido.");
  }
  const seen = new Set<string>();
  for (const slotId of value) {
    if (seen.has(slotId)) {
      throw new Error("La tabla 'subjects' contiene franjas de horario duplicadas.");
    }
    seen.add(slotId);
    requireReference(slotId, scheduleSlotIds, "subjects", "scheduleSlotIds");
  }
}

function validateScheduleDayRows(scheduleDays: Record<string, unknown>[]): void {
  const dayNumbers = new Set<number>();
  for (const row of scheduleDays) {
    const dayOfWeek = row.dayOfWeek as number;
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) {
      throw new Error("La tabla 'scheduleDays' contiene 'dayOfWeek' fuera del rango 1-7.");
    }
    if (dayNumbers.has(dayOfWeek)) {
      throw new Error("La tabla 'scheduleDays' contiene dias de la semana duplicados.");
    }
    dayNumbers.add(dayOfWeek);
  }
}

function validateStudentPhotoDataUrl(row: Record<string, unknown>): void {
  const photoDataUrl = optionalString(row, "students", "photoDataUrl");
  if (!photoDataUrl) {
    return;
  }
  if (photoDataUrl.length > MAX_STUDENT_PHOTO_DATA_URL_CHARS) {
    throw new Error("La tabla 'students' contiene 'photoDataUrl' demasiado grande.");
  }
  if (!/^data:image\/(jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(photoDataUrl)) {
    throw new Error("La tabla 'students' contiene 'photoDataUrl' no valido.");
  }
}

function validateGradebookGroupTree(groups: Record<string, unknown>[]): void {
  const byId = new Map(groups.map((group) => [group.id as string, group]));
  for (const group of groups) {
    const startId = group.id as string;
    const seen = new Set<string>();
    let currentParent = optionalString(group, "gradebookGroups", "parentId");
    while (currentParent) {
      if (currentParent === startId || seen.has(currentParent)) {
        throw new Error("La tabla 'gradebookGroups' contiene un ciclo de carpetas.");
      }
      seen.add(currentParent);
      const parent = byId.get(currentParent);
      if (!parent) {
        break;
      }
      currentParent = optionalString(parent, "gradebookGroups", "parentId");
    }
  }
}

function validateRubricLevels(levels: unknown, tableName: string): void {
  if (!Array.isArray(levels)) {
    throw new Error(`La tabla '${tableName}' contiene niveles no validos.`);
  }
  if (levels.length < 2) {
    throw new Error(`La tabla '${tableName}' contiene menos de dos niveles.`);
  }
  const levelIds = new Set<string>();
  for (const level of levels) {
    if (!isPlainObject(level)) {
      throw new Error(`La tabla '${tableName}' contiene niveles no validos.`);
    }
    const levelId = requireString(level, tableName, "id");
    if (levelIds.has(levelId)) {
      throw new Error(`La tabla '${tableName}' contiene niveles duplicados.`);
    }
    levelIds.add(levelId);
    requireString(level, tableName, "name");
    requireNumber(level, tableName, "score");
  }
}

function validateRubricTemplateShape(row: Record<string, unknown>): void {
  requireString(row, "rubricTemplates", "name");
  optionalString(row, "rubricTemplates", "description");
  if (row.criteriaCount !== undefined) {
    requireNumber(row, "rubricTemplates", "criteriaCount");
  }
  if (row.levelCount !== undefined) {
    requireNumber(row, "rubricTemplates", "levelCount");
  }
  if (row.levels !== undefined) {
    validateRubricLevels(row.levels, "rubricTemplates.levels");
  }
  if (row.criteria === undefined) {
    return;
  }
  if (!Array.isArray(row.criteria)) {
    throw new Error("La tabla 'rubricTemplates' contiene 'criteria' no valido.");
  }
  if (row.criteria.length === 0) {
    throw new Error("La tabla 'rubricTemplates' contiene una rubrica sin criterios.");
  }
  const criterionIds = new Set<string>();
  for (const criterion of row.criteria) {
    if (!isPlainObject(criterion)) {
      throw new Error("La tabla 'rubricTemplates' contiene criterios no validos.");
    }
    const criterionId = requireString(criterion, "rubricTemplates.criteria", "id");
    if (criterionIds.has(criterionId)) {
      throw new Error("La tabla 'rubricTemplates' contiene criterios duplicados.");
    }
    criterionIds.add(criterionId);
    requireString(criterion, "rubricTemplates.criteria", "name");
    optionalString(criterion, "rubricTemplates.criteria", "description");
    if (criterion.levels !== undefined) {
      validateRubricLevels(criterion.levels, "rubricTemplates.criteria.levels");
    }
  }
}

function validateChecklistTemplateShape(row: Record<string, unknown>): void {
  requireString(row, "checklistTemplates", "name");
  optionalString(row, "checklistTemplates", "description");
  if (row.items === undefined) {
    return;
  }
  if (!Array.isArray(row.items)) {
    throw new Error("La tabla 'checklistTemplates' contiene 'items' no valido.");
  }
  if (row.items.length === 0) {
    throw new Error("La tabla 'checklistTemplates' contiene una lista sin items.");
  }
  const itemIds = new Set<string>();
  for (const item of row.items) {
    if (!isPlainObject(item)) {
      throw new Error("La tabla 'checklistTemplates' contiene items no validos.");
    }
    const itemId = requireString(item, "checklistTemplates.items", "id");
    if (itemIds.has(itemId)) {
      throw new Error("La tabla 'checklistTemplates' contiene items duplicados.");
    }
    itemIds.add(itemId);
    requireString(item, "checklistTemplates.items", "text");
  }
}

export function validateDatabasePayload(parsed: unknown): Record<string, unknown[]> {
  if (!isPlainObject(parsed)) {
    throw new Error("El archivo no contiene una copia de seguridad valida.");
  }
  if (!isCompatibleProductName(parsed.app)) {
    throw new Error("El archivo no pertenece a Edunoza.");
  }
  const schemaVersion = parsed.schemaVersion;
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion) ||
      (schemaVersion !== DATABASE_SCHEMA_VERSION && !LEGACY_DATABASE_SCHEMA_VERSIONS.has(schemaVersion))) {
    throw new Error("La copia de seguridad no pertenece al esquema actual.");
  }
  requireIsoDateTimeString(parsed.exportedAt, "exportedAt");
  if (!isPlainObject(parsed.tables)) {
    throw new Error("El archivo no contiene un bloque 'tables' válido.");
  }

  const tableNames = new Set(db.tables.map((table) => table.name));
  const unknownTables = Object.keys(parsed.tables).filter((tableName) => !tableNames.has(tableName));
  if (unknownTables.length > 0) {
    throw new Error(`El archivo contiene tablas desconocidas: ${unknownTables.join(", ")}.`);
  }

  const validatedTables: Record<string, unknown[]> = {};
  for (const table of db.tables) {
    const optionalLegacyTable = ["aiReports", "behaviorMarks"].includes(table.name) ||
      (schemaVersion < DATABASE_SCHEMA_VERSION && ["moodleConnections", "moodleBindings", "moodleOperations"].includes(table.name));
    const rows = parsed.tables[table.name] ?? (optionalLegacyTable ? [] : undefined);
    if (rows === undefined) {
      throw new Error(`El archivo no contiene la tabla '${table.name}'.`);
    }
    if (!Array.isArray(rows)) {
      throw new Error(`La tabla '${table.name}' no contiene una lista de filas valida.`);
    }
    const ids = new Set<string>();
    for (const row of rows) {
      if (!isPlainObject(row) || typeof row.id !== "string" || row.id.trim().length === 0) {
        throw new Error(`La tabla '${table.name}' contiene filas sin id válido.`);
      }
      if (ids.has(row.id)) {
        throw new Error(`La tabla '${table.name}' contiene ids duplicados: ${row.id}.`);
      }
      ids.add(row.id);
    }
    validatedTables[table.name] = rows;
  }

  const rows = (tableName: string): Record<string, unknown>[] =>
    (validatedTables[tableName] ?? []) as Record<string, unknown>[];
  const ids = (tableName: string): Set<string> => new Set(rows(tableName).map((row) => row.id as string));

  const classIds = ids("classGroups");
  for (const row of rows("aiReports")) {
    if (!isSavedAiReport(row)) throw new Error("La tabla 'aiReports' contiene un informe no válido.");
  }
  const subjectIds = ids("subjects");
  const studentIds = ids("students");
  const unitIds = ids("unitBlocks");
  const taskIds = ids("tasks");
  const assessmentIds = ids("assessments");
  const gradebookGroupIds = ids("gradebookGroups");
  const academicPeriodIds = ids("academicPeriods");
  const periodSnapshotIds = ids("gradebookPeriodSnapshots");
  const rubricTemplateIds = ids("rubricTemplates");
  const checklistTemplateIds = ids("checklistTemplates");
  const studentClassById = new Map(rows("students").map((row) => [row.id as string, row.classId as string]));

  for (const row of rows("classroomLayouts")) {
    const classId = requireString(row, "classroomLayouts", "classId");
    requireReference(classId, classIds, "classroomLayouts", "classId");
    if (row.id !== classId) {
      throw new Error("La tabla 'classroomLayouts' contiene un id que no coincide con su curso.");
    }
    requireNumber(row, "classroomLayouts", "rows");
    requireNumber(row, "classroomLayouts", "columns");
    const layoutRows = row.rows as number;
    const layoutColumns = row.columns as number;
    if (
      !Number.isInteger(layoutRows) ||
      !Number.isInteger(layoutColumns) ||
      layoutRows < MIN_LAYOUT_DIMENSION ||
      layoutRows > MAX_LAYOUT_DIMENSION ||
      layoutColumns < MIN_LAYOUT_DIMENSION ||
      layoutColumns > MAX_LAYOUT_DIMENSION
    ) {
      throw new Error("La tabla 'classroomLayouts' contiene dimensiones no válidas.");
    }
    if (!isPlainObject(row.assignments)) {
      throw new Error("La tabla 'classroomLayouts' contiene 'assignments' no válido.");
    }
    const occupiedSeats = new Set<number>();
    for (const [studentId, seat] of Object.entries(row.assignments)) {
      requireReference(studentId, studentIds, "classroomLayouts", "assignments");
      if (studentClassById.get(studentId) !== classId) {
        throw new Error("La tabla 'classroomLayouts' contiene un alumno de otro curso.");
      }
      if (!Number.isInteger(seat) || (seat as number) < 0 || (seat as number) >= layoutRows * layoutColumns) {
        throw new Error("La tabla 'classroomLayouts' contiene un asiento fuera del plano.");
      }
      if (occupiedSeats.has(seat as number)) {
        throw new Error("La tabla 'classroomLayouts' contiene asientos duplicados.");
      }
      occupiedSeats.add(seat as number);
    }
    requireIsoDateTimeString(row.createdAt, "classroomLayouts.createdAt");
    requireIsoDateTimeString(row.updatedAt, "classroomLayouts.updatedAt");
  }
  requireUniqueLogicalRows(rows("classroomLayouts"), "classroomLayouts", "classId", (row) => row.classId as string);
  for (const row of rows("feedbackComments")) {
    const category = requireString(row, "feedbackComments", "category");
    if (!FEEDBACK_COMMENT_CATEGORIES.includes(category as (typeof FEEDBACK_COMMENT_CATEGORIES)[number])) {
      throw new Error("La tabla 'feedbackComments' contiene una categoría no válida.");
    }
    const feedbackText = requireString(row, "feedbackComments", "text");
    if (feedbackText.length > MAX_FEEDBACK_COMMENT_LENGTH || normalizeFeedbackComment(feedbackText) !== feedbackText) {
      throw new Error("La tabla 'feedbackComments' contiene texto no válido.");
    }
    requireIsoDateTimeString(row.createdAt, "feedbackComments.createdAt");
    requireIsoDateTimeString(row.updatedAt, "feedbackComments.updatedAt");
  }
  requireUniqueLogicalRows(
    rows("feedbackComments"),
    "feedbackComments",
    "category+text",
    (row) => `${row.category as string}:${(row.text as string).toLocaleLowerCase("es")}`
  );
  const assessmentById = new Map(rows("assessments").map((row) => [row.id as string, row]));
  const unitSubjectById = new Map(rows("unitBlocks").map((row) => [row.id as string, row.subjectId as string]));
  const subjectById = new Map(rows("subjects").map((row) => [row.id as string, row]));
  const scheduleSlotIds = collectScheduleSlotIds(rows("scheduleDays"));
  const scheduleDayBySlotId = new Map<string, number>();
  for (const day of rows("scheduleDays")) {
    if (!Array.isArray(day.blocks)) continue;
    for (const block of day.blocks) {
      if (isPlainObject(block) && block.isBreak !== true && typeof block.id === "string") {
        scheduleDayBySlotId.set(block.id, Number(day.dayOfWeek));
      }
    }
  }
  const subjectCourseKeys = new Set(
    rows("subjectCourseLinks").map((row) => `${row.subjectId as string}:${row.classId as string}`)
  );
  const subjectStudentKeys = new Set(
    rows("subjectStudentLinks").map((row) => `${row.subjectId as string}:${row.studentId as string}`)
  );
  const taskSubjectKeys = new Set(
    rows("taskSubjectLinks").map((row) => `${row.taskId as string}:${row.subjectId as string}`)
  );
  const exceptionalDailyRecordKeys = new Set(
    rows("dailyClassRecords")
      .filter((row) => typeof row.scheduleSlotId === "string" && row.scheduleSlotId.startsWith("exception-"))
      .map(
        (row) =>
          `${row.classId as string}:${row.subjectId as string}:${row.date as string}:${row.scheduleSlotId as string}`
      )
  );
  const hasExceptionalDailyRecord = (
    classId: string,
    subjectId: string,
    date: string,
    scheduleSlotId: string
  ): boolean =>
    scheduleSlotId.startsWith("exception-") &&
    exceptionalDailyRecordKeys.has(`${classId}:${subjectId}:${date}:${scheduleSlotId}`);
  const rubricTemplateById = new Map(rows("rubricTemplates").map((row) => [row.id as string, row]));
  const checklistTemplateById = new Map(rows("checklistTemplates").map((row) => [row.id as string, row]));
  const academicPeriodById = new Map(rows("academicPeriods").map((row) => [row.id as string, row]));
  const periodSnapshotById = new Map(rows("gradebookPeriodSnapshots").map((row) => [row.id as string, row]));

  for (const row of rows("classGroups")) {
    requireText(row, "classGroups", "name");
    requireString(row, "classGroups", "level");
    requireString(row, "classGroups", "schoolYear");
  }
  for (const row of rows("academicPeriods")) {
    const classId = requireString(row, "academicPeriods", "classId");
    requireReference(classId, classIds, "academicPeriods", "classId");
    requireString(row, "academicPeriods", "name");
    const startDate = requireDateString(row, "academicPeriods", "startDate");
    const endDate = requireDateString(row, "academicPeriods", "endDate");
    if (startDate > endDate) {
      throw new Error("La tabla 'academicPeriods' contiene un periodo con fechas invertidas.");
    }
    requireMinNumber(row, "academicPeriods", "position", 0);
    requireMinNumber(row, "academicPeriods", "closureVersion", 0);
    if (!Number.isInteger(row.position) || !Number.isInteger(row.closureVersion)) {
      throw new Error("La tabla 'academicPeriods' contiene posiciones o versiones no enteras.");
    }
    const status = requireString(row, "academicPeriods", "status");
    if (!["open", "closed"].includes(status)) {
      throw new Error("La tabla 'academicPeriods' contiene 'status' no válido.");
    }
    requireIsoDateTimeString(row.createdAt, "academicPeriods.createdAt");
    requireIsoDateTimeString(row.updatedAt, "academicPeriods.updatedAt");
    if (optionalString(row, "academicPeriods", "closedAt")) {
      requireIsoDateTimeString(row.closedAt, "academicPeriods.closedAt");
    }
    if (optionalString(row, "academicPeriods", "reopenedAt")) {
      requireIsoDateTimeString(row.reopenedAt, "academicPeriods.reopenedAt");
    }
    requireReference(
      optionalString(row, "academicPeriods", "currentSnapshotId"),
      periodSnapshotIds,
      "academicPeriods",
      "currentSnapshotId"
    );
  }
  requireUniqueLogicalRows(
    rows("academicPeriods"),
    "academicPeriods",
    "classId+position",
    (row) => `${row.classId as string}:${row.position as number}`
  );
  for (const classId of classIds) {
    const classPeriods = rows("academicPeriods")
      .filter((row) => row.classId === classId)
      .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
    for (let index = 1; index < classPeriods.length; index += 1) {
      if (String(classPeriods[index].startDate) <= String(classPeriods[index - 1].endDate)) {
        throw new Error("La tabla 'academicPeriods' contiene periodos solapados.");
      }
    }
  }
  for (const row of rows("students")) {
    if ("classIds" in row) {
      throw new Error("La tabla 'students' usa el campo antiguo 'classIds'.");
    }
    requireReference(requireString(row, "students", "classId"), classIds, "students", "classId");
    requireText(row, "students", "firstName");
    requireText(row, "students", "lastName");
    requireText(row, "students", "fullName");
    optionalString(row, "students", "personId");
    optionalString(row, "students", "comments");
    optionalString(row, "students", "email");
    validateStudentPhotoDataUrl(row);
    if (row.hasAcs !== undefined && typeof row.hasAcs !== "boolean") {
      throw new Error("La tabla 'students' contiene 'hasAcs' no valido.");
    }
    if (row.hasReinforcement !== undefined && typeof row.hasReinforcement !== "boolean") {
      throw new Error("La tabla 'students' contiene 'hasReinforcement' no valido.");
    }
  }
  for (const row of rows("subjects")) {
    requireText(row, "subjects", "name");
    optionalString(row, "subjects", "teachingHours");
    validateSubjectScheduleSlots(row, scheduleSlotIds);
  }
  for (const row of rows("subjectCourseLinks")) {
    requireReference(requireString(row, "subjectCourseLinks", "subjectId"), subjectIds, "subjectCourseLinks", "subjectId");
    requireReference(requireString(row, "subjectCourseLinks", "classId"), classIds, "subjectCourseLinks", "classId");
  }
  requireUniqueLogicalRows(
    rows("subjectCourseLinks"),
    "subjectCourseLinks",
    "subjectId+classId",
    (row) => `${row.subjectId as string}:${row.classId as string}`
  );
  requireUniqueLogicalRows(
    rows("subjectCourseLinks"),
    "subjectCourseLinks",
    "subjectId",
    (row) => row.subjectId as string
  );
  for (const subjectId of subjectIds) {
    if (!rows("subjectCourseLinks").some((row) => row.subjectId === subjectId)) {
      throw new Error("La tabla 'subjects' contiene una asignatura sin curso asociado.");
    }
  }
  for (const row of rows("subjectStudentLinks")) {
    const subjectId = requireString(row, "subjectStudentLinks", "subjectId");
    const studentId = requireString(row, "subjectStudentLinks", "studentId");
    requireReference(subjectId, subjectIds, "subjectStudentLinks", "subjectId");
    requireReference(studentId, studentIds, "subjectStudentLinks", "studentId");
    const classId = studentClassById.get(studentId);
    if (classId && !subjectCourseKeys.has(`${subjectId}:${classId}`)) {
      throw new Error("La tabla 'subjectStudentLinks' asigna un alumno a una asignatura no asociada a su curso.");
    }
  }
  requireUniqueLogicalRows(
    rows("subjectStudentLinks"),
    "subjectStudentLinks",
    "subjectId+studentId",
    (row) => `${row.subjectId as string}:${row.studentId as string}`
  );
  for (const row of rows("scheduleDays")) {
    requireNumber(row, "scheduleDays", "dayOfWeek");
    requireString(row, "scheduleDays", "dayName");
    if (row.enabled !== undefined && typeof row.enabled !== "boolean") {
      throw new Error("La tabla 'scheduleDays' contiene 'enabled' no valido.");
    }
    if (!Array.isArray(row.blocks)) {
      throw new Error("La tabla 'scheduleDays' contiene 'blocks' no valido.");
    }
    const blockIds = new Set<string>();
    const blockRanges: Array<{ start: number; end: number }> = [];
    for (const block of row.blocks) {
      if (!isPlainObject(block)) {
        throw new Error("La tabla 'scheduleDays' contiene bloques de horario no validos.");
      }
      const blockId = requireString(block, "scheduleDays.blocks", "id");
      if (blockIds.has(blockId)) {
        throw new Error("La tabla 'scheduleDays' contiene bloques de horario duplicados.");
      }
      blockIds.add(blockId);
      const startTime = requireTimeString(block, "scheduleDays.blocks", "startTime");
      const endTime = requireTimeString(block, "scheduleDays.blocks", "endTime");
      if (endTime <= startTime) {
        throw new Error("La tabla 'scheduleDays' contiene un bloque con hora de fin anterior o igual a la de inicio.");
      }
      const startMinutes = minutesFromTime(startTime);
      const endMinutes = minutesFromTime(endTime);
      if (blockRanges.some((range) => startMinutes < range.end && endMinutes > range.start)) {
        throw new Error("La tabla 'scheduleDays' contiene bloques de horario solapados.");
      }
      blockRanges.push({ start: startMinutes, end: endMinutes });
      if (block.isBreak !== undefined && typeof block.isBreak !== "boolean") {
        throw new Error("La tabla 'scheduleDays' contiene 'isBreak' no valido.");
      }
    }
  }
  validateScheduleDayRows(rows("scheduleDays"));
  for (const row of rows("unitBlocks")) {
    requireReference(requireString(row, "unitBlocks", "subjectId"), subjectIds, "unitBlocks", "subjectId");
    requireText(row, "unitBlocks", "name");
    requireText(row, "unitBlocks", "description");
    requireMinNumber(row, "unitBlocks", "sessionCount", 1);
    requireMinNumber(row, "unitBlocks", "position", 0);
  }
  for (const row of rows("tasks")) {
    requireText(row, "tasks", "title");
    requireText(row, "tasks", "description");
    requireMinNumber(row, "tasks", "sessionCount", 1);
    requireBoolean(row, "tasks", "sendToGradebook");
  }
  for (const row of rows("taskSubjectLinks")) {
    requireReference(requireString(row, "taskSubjectLinks", "taskId"), taskIds, "taskSubjectLinks", "taskId");
    const subjectId = requireString(row, "taskSubjectLinks", "subjectId");
    const unitId = optionalString(row, "taskSubjectLinks", "unitId");
    requireReference(subjectId, subjectIds, "taskSubjectLinks", "subjectId");
    requireReference(unitId, unitIds, "taskSubjectLinks", "unitId");
    if (unitId && unitSubjectById.get(unitId) !== subjectId) {
      throw new Error("La tabla 'taskSubjectLinks' vincula una tarea a una unidad de otra asignatura.");
    }
  }
  requireUniqueLogicalRows(
    rows("taskSubjectLinks"),
    "taskSubjectLinks",
    "taskId+subjectId",
    (row) => `${row.taskId as string}:${row.subjectId as string}`
  );
  for (const row of rows("taskGradebookConfigs")) {
    const taskId = requireString(row, "taskGradebookConfigs", "taskId");
    const subjectId = requireString(row, "taskGradebookConfigs", "subjectId");
    const classId = requireString(row, "taskGradebookConfigs", "classId");
    requireReference(taskId, taskIds, "taskGradebookConfigs", "taskId");
    requireReference(subjectId, subjectIds, "taskGradebookConfigs", "subjectId");
    requireReference(classId, classIds, "taskGradebookConfigs", "classId");
    const academicPeriodId = optionalString(row, "taskGradebookConfigs", "academicPeriodId");
    requireReference(academicPeriodId, academicPeriodIds, "taskGradebookConfigs", "academicPeriodId");
    const academicPeriod = academicPeriodId ? academicPeriodById.get(academicPeriodId) : null;
    if (academicPeriod && academicPeriod.classId !== classId) {
      throw new Error("La tabla 'taskGradebookConfigs' usa un periodo académico de otro curso.");
    }
    if (!subjectCourseKeys.has(`${subjectId}:${classId}`)) {
      throw new Error("La tabla 'taskGradebookConfigs' usa una asignatura no asociada al curso.");
    }
    if (!taskSubjectKeys.has(`${taskId}:${subjectId}`)) {
      throw new Error("La tabla 'taskGradebookConfigs' usa una tarea no vinculada a la asignatura.");
    }
    requireMinNumber(row, "taskGradebookConfigs", "gradebookWeight", 0);
    const groupId = optionalString(row, "taskGradebookConfigs", "groupId");
    requireReference(groupId, gradebookGroupIds, "taskGradebookConfigs", "groupId");
    const group = groupId ? rows("gradebookGroups").find((item) => item.id === groupId) : null;
    if (group && (group.classId !== classId || group.subjectId !== subjectId)) {
      throw new Error("La tabla 'taskGradebookConfigs' usa una carpeta de otro curso o asignatura.");
    }
    const rubricTemplateId = optionalString(row, "taskGradebookConfigs", "rubricTemplateId");
    const checklistTemplateId = optionalString(row, "taskGradebookConfigs", "checklistTemplateId");
    requireReference(rubricTemplateId, rubricTemplateIds, "taskGradebookConfigs", "rubricTemplateId");
    requireReference(checklistTemplateId, checklistTemplateIds, "taskGradebookConfigs", "checklistTemplateId");
    const enabledMethods = [rubricTemplateId, checklistTemplateId, row.directGradeEnabled === true ? "direct" : ""].filter(Boolean);
    if (enabledMethods.length > 1) {
      throw new Error("La tabla 'taskGradebookConfigs' contiene mas de un metodo de evaluacion activo.");
    }
    const rubricTemplate = rubricTemplateId ? rubricTemplateById.get(rubricTemplateId) : null;
    const checklistTemplate = checklistTemplateId ? checklistTemplateById.get(checklistTemplateId) : null;
    if (rubricTemplate && (rubricTemplate.classId !== classId || (rubricTemplate.taskId && rubricTemplate.taskId !== taskId))) {
      throw new Error("La tabla 'taskGradebookConfigs' usa una rubrica incompatible con la tarea.");
    }
    if (checklistTemplate && (checklistTemplate.classId !== classId || (checklistTemplate.taskId && checklistTemplate.taskId !== taskId))) {
      throw new Error("La tabla 'taskGradebookConfigs' usa una lista de cotejo incompatible con la tarea.");
    }
    if (row.directGradeEnabled !== undefined && typeof row.directGradeEnabled !== "boolean") {
      throw new Error("La tabla 'taskGradebookConfigs' contiene 'directGradeEnabled' no valido.");
    }
  }
  requireUniqueLogicalRows(
    rows("taskGradebookConfigs"),
    "taskGradebookConfigs",
    "taskId+subjectId+classId",
    (row) => `${row.taskId as string}:${row.subjectId as string}:${row.classId as string}`
  );
  for (const row of rows("gradebookGroups")) {
    const classId = requireString(row, "gradebookGroups", "classId");
    const subjectId = requireString(row, "gradebookGroups", "subjectId");
    requireReference(classId, classIds, "gradebookGroups", "classId");
    requireReference(subjectId, subjectIds, "gradebookGroups", "subjectId");
    if (!subjectCourseKeys.has(`${subjectId}:${classId}`)) {
      throw new Error("La tabla 'gradebookGroups' usa una asignatura no asociada al curso.");
    }
    const parentId = optionalString(row, "gradebookGroups", "parentId");
    requireReference(parentId, gradebookGroupIds, "gradebookGroups", "parentId");
    const parent = parentId ? rows("gradebookGroups").find((item) => item.id === parentId) : null;
    if (parent && (parent.classId !== classId || parent.subjectId !== subjectId)) {
      throw new Error("La tabla 'gradebookGroups' contiene una carpeta padre de otro curso o asignatura.");
    }
    requireString(row, "gradebookGroups", "name");
    requireMinNumber(row, "gradebookGroups", "position", 0);
    if (row.weight !== undefined) {
      requireMinNumber(row, "gradebookGroups", "weight", 0);
    }
  }
  validateGradebookGroupTree(rows("gradebookGroups"));
  for (const row of rows("assessments")) {
    const classId = requireString(row, "assessments", "classId");
    const subjectId = requireString(row, "assessments", "subjectId");
    requireReference(classId, classIds, "assessments", "classId");
    requireReference(subjectId, subjectIds, "assessments", "subjectId");
    const academicPeriodId = optionalString(row, "assessments", "academicPeriodId");
    requireReference(academicPeriodId, academicPeriodIds, "assessments", "academicPeriodId");
    const academicPeriod = academicPeriodId ? academicPeriodById.get(academicPeriodId) : null;
    if (academicPeriod && academicPeriod.classId !== classId) {
      throw new Error("La tabla 'assessments' usa un periodo académico de otro curso.");
    }
    const assessmentDate = optionalString(row, "assessments", "assessmentDate");
    if (assessmentDate) {
      requireDateString(row, "assessments", "assessmentDate");
      if (
        academicPeriod &&
        (assessmentDate < String(academicPeriod.startDate) ||
          assessmentDate > String(academicPeriod.endDate))
      ) {
        throw new Error("La tabla 'assessments' contiene una fecha fuera de su periodo académico.");
      }
    }
    if (!subjectCourseKeys.has(`${subjectId}:${classId}`)) {
      throw new Error("La tabla 'assessments' usa una asignatura no asociada al curso.");
    }
    requireReference(optionalString(row, "assessments", "groupId"), gradebookGroupIds, "assessments", "groupId");
    requireString(row, "assessments", "title");
    requireText(row, "assessments", "period");
    optionalString(row, "assessments", "competency");
    requireMinNumber(row, "assessments", "weight", 0);
  }
  for (const row of rows("gradeEntries")) {
    const classId = requireString(row, "gradeEntries", "classId");
    const assessmentId = requireString(row, "gradeEntries", "assessmentId");
    const studentId = requireString(row, "gradeEntries", "studentId");
    requireReference(classId, classIds, "gradeEntries", "classId");
    requireReference(assessmentId, assessmentIds, "gradeEntries", "assessmentId");
    requireReference(studentId, studentIds, "gradeEntries", "studentId");
    const assessment = assessmentById.get(assessmentId);
    if (assessment && assessment.classId !== classId) {
      throw new Error("La tabla 'gradeEntries' tiene una nota en un curso distinto al de su evaluación.");
    }
    if (studentClassById.get(studentId) !== classId) {
      throw new Error("La tabla 'gradeEntries' tiene una nota de un alumno que no pertenece al curso.");
    }
    if (assessment && !subjectStudentKeys.has(`${assessment.subjectId as string}:${studentId}`)) {
      throw new Error("La tabla 'gradeEntries' tiene una nota de un alumno no matriculado en la asignatura.");
    }
    if (row.numericValue !== undefined) {
      requireNumber(row, "gradeEntries", "numericValue");
      const numericValue = row.numericValue as number;
      if (numericValue < 0 || numericValue > 10) {
        throw new Error("La tabla 'gradeEntries' contiene notas fuera del rango 0-10.");
      }
    }
    optionalString(row, "gradeEntries", "textValue");
    optionalString(row, "gradeEntries", "colorTag");
    optionalString(row, "gradeEntries", "iconTag");
    optionalString(row, "gradeEntries", "comment");
  }
  requireUniqueLogicalRows(
    rows("gradeEntries"),
    "gradeEntries",
    "assessmentId+studentId",
    (row) => `${row.assessmentId as string}:${row.studentId as string}`
  );
  for (const row of rows("gradebookPeriodSnapshots")) {
    const academicPeriodId = requireString(row, "gradebookPeriodSnapshots", "academicPeriodId");
    const classId = requireString(row, "gradebookPeriodSnapshots", "classId");
    requireReference(academicPeriodId, academicPeriodIds, "gradebookPeriodSnapshots", "academicPeriodId");
    requireReference(classId, classIds, "gradebookPeriodSnapshots", "classId");
    const period = academicPeriodById.get(academicPeriodId);
    if (period && period.classId !== classId) {
      throw new Error("La tabla 'gradebookPeriodSnapshots' usa un periodo académico de otro curso.");
    }
    requireMinNumber(row, "gradebookPeriodSnapshots", "version", 1);
    if (!Number.isInteger(row.version)) {
      throw new Error("La tabla 'gradebookPeriodSnapshots' contiene una versión no entera.");
    }
    requireIsoDateTimeString(row.createdAt, "gradebookPeriodSnapshots.createdAt");
    const snapshotData = row.data;
    if (!isPlainObject(snapshotData) || !isPlainObject(snapshotData.classGroup)) {
      throw new Error("La tabla 'gradebookPeriodSnapshots' contiene una instantánea sin datos de curso.");
    }
    if (snapshotData.classGroup.id !== classId) {
      throw new Error("La tabla 'gradebookPeriodSnapshots' contiene datos de otro curso.");
    }
    const snapshotArrayFields = [
      "students",
      "subjects",
      "subjectCourseLinks",
      "subjectStudentLinks",
      "assessments",
      "gradeEntries",
      "gradebookGroups",
      "taskGradebookConfigs",
      "tasks",
      "taskSubjectLinks",
      "taskSessions",
      "taskDailyEvaluationSettings",
      "taskRubricAssessments",
      "taskChecklistAssessments",
      "taskDirectGrades",
      "rubricTemplates",
      "checklistTemplates"
    ];
    if (snapshotArrayFields.some((fieldName) => !Array.isArray(snapshotData[fieldName]))) {
      throw new Error("La tabla 'gradebookPeriodSnapshots' contiene datos de instantánea incompletos.");
    }
  }
  requireUniqueLogicalRows(
    rows("gradebookPeriodSnapshots"),
    "gradebookPeriodSnapshots",
    "academicPeriodId+version",
    (row) => `${row.academicPeriodId as string}:${row.version as number}`
  );
  for (const period of rows("academicPeriods")) {
    const currentSnapshotId = optionalString(period, "academicPeriods", "currentSnapshotId");
    const snapshot = currentSnapshotId ? periodSnapshotById.get(currentSnapshotId) : null;
    if (
      snapshot &&
      (snapshot.academicPeriodId !== period.id || snapshot.classId !== period.classId)
    ) {
      throw new Error("La tabla 'academicPeriods' referencia una instantánea de otro periodo.");
    }
  }
  for (const row of rows("attendanceEntries")) {
    const classId = requireString(row, "attendanceEntries", "classId");
    const subjectId = requireString(row, "attendanceEntries", "subjectId");
    const studentId = requireString(row, "attendanceEntries", "studentId");
    requireReference(classId, classIds, "attendanceEntries", "classId");
    requireReference(studentId, studentIds, "attendanceEntries", "studentId");
    requireReference(subjectId, subjectIds, "attendanceEntries", "subjectId");
    if (!subjectCourseKeys.has(`${subjectId}:${classId}`)) {
      throw new Error("La tabla 'attendanceEntries' usa una asignatura no asociada al curso.");
    }
    if (studentClassById.get(studentId) !== classId) {
      throw new Error("La tabla 'attendanceEntries' tiene asistencia de un alumno que no pertenece al curso.");
    }
    if (!subjectStudentKeys.has(`${subjectId}:${studentId}`)) {
      throw new Error("La tabla 'attendanceEntries' tiene asistencia de un alumno no matriculado en la asignatura.");
    }
    const date = requireDateString(row, "attendanceEntries", "date");
    const scheduleSlotId = requireString(row, "attendanceEntries", "scheduleSlotId");
    if (!hasExceptionalDailyRecord(classId, subjectId, date, scheduleSlotId)) {
      requireReference(scheduleSlotId, scheduleSlotIds, "attendanceEntries", "scheduleSlotId");
      const subjectScheduleSlotIds = subjectById.get(subjectId)?.scheduleSlotIds;
      if (!Array.isArray(subjectScheduleSlotIds) || !subjectScheduleSlotIds.includes(scheduleSlotId)) {
        throw new Error("La tabla 'attendanceEntries' usa una hora no asociada a la asignatura.");
      }
      requireSlotMatchesDate("attendanceEntries", date, scheduleSlotId, scheduleDayBySlotId);
    }
    const attendanceStatus = requireString(row, "attendanceEntries", "status");
    if (!["present", "late", "absent"].includes(attendanceStatus)) {
      throw new Error("La tabla 'attendanceEntries' contiene 'status' no valido.");
    }
    if (row.absenceJustified !== undefined && typeof row.absenceJustified !== "boolean") {
      throw new Error("La tabla 'attendanceEntries' contiene 'absenceJustified' no válido.");
    }
    if (row.absenceJustified === true && attendanceStatus !== "absent") {
      throw new Error("La tabla 'attendanceEntries' justifica una asistencia que no es ausencia.");
    }
    for (const fieldName of ["lateMinutes", "earlyDepartureMinutes"] as const) {
      const value = row[fieldName];
      if (
        value !== undefined &&
        (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 720)
      ) {
        throw new Error(`La tabla 'attendanceEntries' contiene '${fieldName}' no válido.`);
      }
    }
    if (row.lateMinutes !== undefined && attendanceStatus !== "late") {
      throw new Error("La tabla 'attendanceEntries' registra minutos de retraso sin estado de retraso.");
    }
    optionalString(row, "attendanceEntries", "note");
    requireIsoDateTimeString(row.createdAt, "attendanceEntries.createdAt");
    requireIsoDateTimeString(row.updatedAt, "attendanceEntries.updatedAt");
    if (String(row.updatedAt) < String(row.createdAt)) {
      throw new Error("La tabla 'attendanceEntries' contiene una fecha de actualización anterior a su creación.");
    }
  }
  requireUniqueLogicalRows(
    rows("attendanceEntries"),
    "attendanceEntries",
    "classId+subjectId+studentId+date+scheduleSlotId",
    (row) => `${row.classId as string}:${row.subjectId as string}:${row.studentId as string}:${row.date as string}:${row.scheduleSlotId as string}`
  );
  for (const row of rows("dailyClassRecords")) {
    const classId = requireString(row, "dailyClassRecords", "classId");
    const subjectId = requireString(row, "dailyClassRecords", "subjectId");
    requireReference(classId, classIds, "dailyClassRecords", "classId");
    requireReference(subjectId, subjectIds, "dailyClassRecords", "subjectId");
    if (!subjectCourseKeys.has(`${subjectId}:${classId}`)) {
      throw new Error("La tabla 'dailyClassRecords' usa una asignatura no asociada al curso.");
    }
    const date = requireDateString(row, "dailyClassRecords", "date");
    const scheduleSlotId = requireString(row, "dailyClassRecords", "scheduleSlotId");
    const sessionKind = optionalString(row, "dailyClassRecords", "sessionKind");
    const isExceptional = scheduleSlotId.startsWith("exception-");
    if (isExceptional) {
      if (
        scheduleSlotId !== `exception-${row.id as string}` ||
        !["adHoc", "rescheduled"].includes(sessionKind ?? "") ||
        !optionalString(row, "dailyClassRecords", "sessionTitle") ||
        !optionalString(row, "dailyClassRecords", "startTime") ||
        !optionalString(row, "dailyClassRecords", "endTime")
      ) {
        throw new Error("La tabla 'dailyClassRecords' contiene una sesión excepcional no válida.");
      }
      const startTime = requireTimeString(row, "dailyClassRecords", "startTime");
      const endTime = requireTimeString(row, "dailyClassRecords", "endTime");
      if (endTime <= startTime) {
        throw new Error("La tabla 'dailyClassRecords' contiene una sesión excepcional con horas invertidas.");
      }
      if (sessionKind === "rescheduled") {
        requireDateString(row, "dailyClassRecords", "originalDate");
        const originalScheduleSlotId = requireString(row, "dailyClassRecords", "originalScheduleSlotId");
        requireReference(originalScheduleSlotId, scheduleSlotIds, "dailyClassRecords", "originalScheduleSlotId");
      }
    } else {
      if (sessionKind) {
        throw new Error("La tabla 'dailyClassRecords' usa 'sessionKind' sin un ID excepcional.");
      }
      requireReference(scheduleSlotId, scheduleSlotIds, "dailyClassRecords", "scheduleSlotId");
      const subjectScheduleSlotIds = subjectById.get(subjectId)?.scheduleSlotIds;
      if (!Array.isArray(subjectScheduleSlotIds) || !subjectScheduleSlotIds.includes(scheduleSlotId)) {
        throw new Error("La tabla 'dailyClassRecords' usa una hora no asociada a la asignatura.");
      }
      requireSlotMatchesDate("dailyClassRecords", date, scheduleSlotId, scheduleDayBySlotId);
    }
    requireText(row, "dailyClassRecords", "generalComment");
    if (!isPlainObject(row.studentComments)) {
      throw new Error("La tabla 'dailyClassRecords' contiene comentarios de alumnado no válidos.");
    }
    for (const [studentId, comment] of Object.entries(row.studentComments)) {
      requireReference(studentId, studentIds, "dailyClassRecords", "studentComments");
      if (studentClassById.get(studentId) !== classId) {
        throw new Error("La tabla 'dailyClassRecords' contiene comentarios de alumnado de otro curso.");
      }
      if (!subjectStudentKeys.has(`${subjectId}:${studentId}`)) {
        throw new Error("La tabla 'dailyClassRecords' contiene comentarios de alumnado no matriculado en la asignatura.");
      }
      if (typeof comment !== "string") {
        throw new Error("La tabla 'dailyClassRecords' contiene un comentario no válido.");
      }
    }
    requireIsoDateTimeString(row.createdAt, "dailyClassRecords.createdAt");
    requireIsoDateTimeString(row.updatedAt, "dailyClassRecords.updatedAt");
    if (String(row.updatedAt) < String(row.createdAt)) {
      throw new Error("La tabla 'dailyClassRecords' contiene una fecha de actualización anterior a su creación.");
    }
  }
  requireUniqueLogicalRows(
    rows("dailyClassRecords"),
    "dailyClassRecords",
    "classId+subjectId+date+scheduleSlotId",
    (row) => `${row.classId as string}:${row.subjectId as string}:${row.date as string}:${row.scheduleSlotId as string}`
  );
  for (const row of rows("rubricTemplates")) {
    requireReference(requireString(row, "rubricTemplates", "classId"), classIds, "rubricTemplates", "classId");
    requireReference(optionalString(row, "rubricTemplates", "taskId"), taskIds, "rubricTemplates", "taskId");
    validateRubricTemplateShape(row);
  }
  for (const row of rows("checklistTemplates")) {
    requireReference(requireString(row, "checklistTemplates", "classId"), classIds, "checklistTemplates", "classId");
    requireReference(optionalString(row, "checklistTemplates", "taskId"), taskIds, "checklistTemplates", "taskId");
    validateChecklistTemplateShape(row);
  }
  for (const row of rows("taskSessions")) {
    const taskId = requireString(row, "taskSessions", "taskId");
    const subjectId = requireString(row, "taskSessions", "subjectId");
    const classId = requireString(row, "taskSessions", "classId");
    requireReference(taskId, taskIds, "taskSessions", "taskId");
    requireReference(subjectId, subjectIds, "taskSessions", "subjectId");
    requireReference(classId, classIds, "taskSessions", "classId");
    if (!subjectCourseKeys.has(`${subjectId}:${classId}`)) {
      throw new Error("La tabla 'taskSessions' usa una asignatura no asociada al curso.");
    }
    if (!taskSubjectKeys.has(`${taskId}:${subjectId}`)) {
      throw new Error("La tabla 'taskSessions' usa una tarea no vinculada a la asignatura.");
    }
    const subject = subjectById.get(subjectId);
    const scheduleSlotId = requireString(row, "taskSessions", "scheduleSlotId");
    const date = requireDateString(row, "taskSessions", "date");
    if (!hasExceptionalDailyRecord(classId, subjectId, date, scheduleSlotId)) {
      requireReference(scheduleSlotId, scheduleSlotIds, "taskSessions", "scheduleSlotId");
      const subjectSlotIds = Array.isArray(subject?.scheduleSlotIds) ? subject.scheduleSlotIds : [];
      if (!subjectSlotIds.includes(scheduleSlotId)) {
        throw new Error("La tabla 'taskSessions' usa una hora no asociada a la asignatura.");
      }
      requireSlotMatchesDate("taskSessions", date, scheduleSlotId, scheduleDayBySlotId);
    }
    if (!["planned", "done", "moved", "cancelled"].includes(requireString(row, "taskSessions", "status"))) {
      throw new Error("La tabla 'taskSessions' contiene 'status' no válido.");
    }
    optionalString(row, "taskSessions", "objectives");
    optionalString(row, "taskSessions", "competencies");
    optionalString(row, "taskSessions", "materials");
    optionalString(row, "taskSessions", "homework");
    optionalString(row, "taskSessions", "teacherNotes");
  }
  requireUniqueLogicalRows(
    rows("taskSessions"),
    "taskSessions",
    "taskId+classId+subjectId+date+scheduleSlotId",
    (row) =>
      `${row.taskId as string}:${row.classId as string}:${row.subjectId as string}:${row.date as string}:${row.scheduleSlotId as string}`
  );
  requireUniqueLogicalRows(
    rows("taskSessions"),
    "taskSessions",
    "classId+date+scheduleSlotId",
    (row) => `${row.classId as string}:${row.date as string}:${row.scheduleSlotId as string}`
  );
  for (const row of rows("taskStudentComments")) {
    const taskId = requireString(row, "taskStudentComments", "taskId");
    const studentId = requireString(row, "taskStudentComments", "studentId");
    const classId = requireString(row, "taskStudentComments", "classId");
    const subjectId = requireString(row, "taskStudentComments", "subjectId");
    requireReference(taskId, taskIds, "taskStudentComments", "taskId");
    requireReference(studentId, studentIds, "taskStudentComments", "studentId");
    requireReference(classId, classIds, "taskStudentComments", "classId");
    requireReference(subjectId, subjectIds, "taskStudentComments", "subjectId");
    if (studentClassById.get(studentId) !== classId) {
      throw new Error("La tabla 'taskStudentComments' tiene comentarios de un alumno fuera del curso indicado.");
    }
    if (!subjectStudentKeys.has(`${subjectId}:${studentId}`)) {
      throw new Error("La tabla 'taskStudentComments' tiene comentarios de un alumno no matriculado en la asignatura.");
    }
    if (!subjectCourseKeys.has(`${subjectId}:${classId}`)) {
      throw new Error("La tabla 'taskStudentComments' usa una asignatura no asociada al curso.");
    }
    if (!taskSubjectKeys.has(`${taskId}:${subjectId}`)) {
      throw new Error("La tabla 'taskStudentComments' usa una tarea no vinculada a la asignatura.");
    }
    const date = requireDateString(row, "taskStudentComments", "date");
    const scheduleSlotId = requireString(row, "taskStudentComments", "scheduleSlotId");
    requireText(row, "taskStudentComments", "comment");
    if (!hasExceptionalDailyRecord(classId, subjectId, date, scheduleSlotId)) {
      requireReference(scheduleSlotId, scheduleSlotIds, "taskStudentComments", "scheduleSlotId");
    }
    // Intentionally not required: a matching taskSessions row for this exact date/slot, or even
    // any taskSessions row for this task+class+subject at all. The planner can reassign, move or
    // remove a session that already has comments/evaluation (with a warning), which leaves this
    // row pointing at a session that no longer exists - by design, not corruption.
  }
  requireUniqueLogicalRows(
    rows("taskStudentComments"),
    "taskStudentComments",
    "taskId+classId+subjectId+date+scheduleSlotId+studentId",
    (row) => `${row.taskId as string}:${row.classId as string}:${row.subjectId as string}:${row.date as string}:${row.scheduleSlotId as string}:${row.studentId as string}`
  );
  for (const row of rows("taskDailyEvaluationSettings")) {
    const taskId = requireString(row, "taskDailyEvaluationSettings", "taskId");
    const classId = requireString(row, "taskDailyEvaluationSettings", "classId");
    const subjectId = requireString(row, "taskDailyEvaluationSettings", "subjectId");
    const date = requireDateString(row, "taskDailyEvaluationSettings", "date");
    const scheduleSlotId = requireString(row, "taskDailyEvaluationSettings", "scheduleSlotId");
    optionalString(row, "taskDailyEvaluationSettings", "generalComment");
    const rubricTemplateId = optionalString(row, "taskDailyEvaluationSettings", "rubricTemplateId");
    const checklistTemplateId = optionalString(row, "taskDailyEvaluationSettings", "checklistTemplateId");
    requireReference(taskId, taskIds, "taskDailyEvaluationSettings", "taskId");
    requireReference(classId, classIds, "taskDailyEvaluationSettings", "classId");
    requireReference(subjectId, subjectIds, "taskDailyEvaluationSettings", "subjectId");
    if (!hasExceptionalDailyRecord(classId, subjectId, date, scheduleSlotId)) {
      requireReference(scheduleSlotId, scheduleSlotIds, "taskDailyEvaluationSettings", "scheduleSlotId");
    }
    requireReference(rubricTemplateId, rubricTemplateIds, "taskDailyEvaluationSettings", "rubricTemplateId");
    requireReference(checklistTemplateId, checklistTemplateIds, "taskDailyEvaluationSettings", "checklistTemplateId");
    if (rubricTemplateId && checklistTemplateId) {
      throw new Error("La tabla 'taskDailyEvaluationSettings' contiene rubrica y lista a la vez.");
    }
    if (!subjectCourseKeys.has(`${subjectId}:${classId}`)) {
      throw new Error("La tabla 'taskDailyEvaluationSettings' usa una asignatura no asociada al curso.");
    }
    if (!taskSubjectKeys.has(`${taskId}:${subjectId}`)) {
      throw new Error("La tabla 'taskDailyEvaluationSettings' usa una tarea no vinculada a la asignatura.");
    }
    const rubricTemplate = rubricTemplateId ? rubricTemplateById.get(rubricTemplateId) : null;
    const checklistTemplate = checklistTemplateId ? checklistTemplateById.get(checklistTemplateId) : null;
    if (rubricTemplate?.taskId && rubricTemplate.taskId !== taskId) {
      throw new Error("La tabla 'taskDailyEvaluationSettings' usa una rubrica de otra tarea.");
    }
    if (checklistTemplate?.taskId && checklistTemplate.taskId !== taskId) {
      throw new Error("La tabla 'taskDailyEvaluationSettings' usa una lista de otra tarea.");
    }
  }
  requireUniqueLogicalRows(
    rows("taskDailyEvaluationSettings"),
    "taskDailyEvaluationSettings",
    "taskId+classId+subjectId+date+scheduleSlotId",
    (row) =>
      `${row.taskId as string}:${row.classId as string}:${row.subjectId as string}:${row.date as string}:${row.scheduleSlotId as string}`
  );
  for (const row of rows("taskRubricAssessments")) {
    const taskId = requireString(row, "taskRubricAssessments", "taskId");
    const classId = requireString(row, "taskRubricAssessments", "classId");
    const subjectId = requireString(row, "taskRubricAssessments", "subjectId");
    const date = requireDateString(row, "taskRubricAssessments", "date");
    const scheduleSlotId = requireString(row, "taskRubricAssessments", "scheduleSlotId");
    const studentId = requireString(row, "taskRubricAssessments", "studentId");
    const rubricTemplateId = requireString(row, "taskRubricAssessments", "rubricTemplateId");
    const criterionId = requireString(row, "taskRubricAssessments", "criterionId");
    const levelId = requireString(row, "taskRubricAssessments", "levelId");
    requireReference(taskId, taskIds, "taskRubricAssessments", "taskId");
    requireReference(classId, classIds, "taskRubricAssessments", "classId");
    requireReference(subjectId, subjectIds, "taskRubricAssessments", "subjectId");
    requireReference(studentId, studentIds, "taskRubricAssessments", "studentId");
    requireReference(rubricTemplateId, rubricTemplateIds, "taskRubricAssessments", "rubricTemplateId");
    if (!hasExceptionalDailyRecord(classId, subjectId, date, scheduleSlotId)) {
      requireReference(scheduleSlotId, scheduleSlotIds, "taskRubricAssessments", "scheduleSlotId");
    }
    requireMinNumber(row, "taskRubricAssessments", "score", 0);
    if (studentClassById.get(studentId) !== classId) {
      throw new Error("La tabla 'taskRubricAssessments' evalua a un alumno fuera del curso indicado.");
    }
    if (!subjectStudentKeys.has(`${subjectId}:${studentId}`)) {
      throw new Error("La tabla 'taskRubricAssessments' evalua a un alumno no matriculado en la asignatura.");
    }
    if (!subjectCourseKeys.has(`${subjectId}:${classId}`)) {
      throw new Error("La tabla 'taskRubricAssessments' usa una asignatura no asociada al curso.");
    }
    if (!taskSubjectKeys.has(`${taskId}:${subjectId}`)) {
      throw new Error("La tabla 'taskRubricAssessments' usa una tarea no vinculada a la asignatura.");
    }
    const template = rubricTemplateById.get(rubricTemplateId);
    if (template?.taskId && template.taskId !== taskId) {
      throw new Error("La tabla 'taskRubricAssessments' usa una rubrica de otra tarea.");
    }
    const criteria = Array.isArray(template?.criteria) ? template.criteria : [];
    const criterion = criteria.find((item) => isPlainObject(item) && item.id === criterionId);
    const levels = Array.isArray((criterion as Record<string, unknown> | undefined)?.levels)
      ? ((criterion as Record<string, unknown>).levels as unknown[])
      : Array.isArray(template?.levels)
        ? template.levels
        : [];
    if (!criterion || !levels.some((item) => isPlainObject(item) && item.id === levelId)) {
      throw new Error("La tabla 'taskRubricAssessments' contiene criterio o nivel inexistente.");
    }
  }
  requireUniqueLogicalRows(
    rows("taskRubricAssessments"),
    "taskRubricAssessments",
    "taskId+classId+subjectId+date+scheduleSlotId+studentId+rubricTemplateId+criterionId",
    (row) =>
      [
        row.taskId,
        row.classId,
        row.subjectId,
        row.date,
        row.scheduleSlotId,
        row.studentId,
        row.rubricTemplateId,
        row.criterionId
      ].join(":")
  );
  for (const row of rows("taskChecklistAssessments")) {
    const taskId = requireString(row, "taskChecklistAssessments", "taskId");
    const classId = requireString(row, "taskChecklistAssessments", "classId");
    const subjectId = requireString(row, "taskChecklistAssessments", "subjectId");
    const date = requireDateString(row, "taskChecklistAssessments", "date");
    const scheduleSlotId = requireString(row, "taskChecklistAssessments", "scheduleSlotId");
    const studentId = requireString(row, "taskChecklistAssessments", "studentId");
    const checklistTemplateId = requireString(row, "taskChecklistAssessments", "checklistTemplateId");
    const itemId = requireString(row, "taskChecklistAssessments", "itemId");
    requireReference(taskId, taskIds, "taskChecklistAssessments", "taskId");
    requireReference(classId, classIds, "taskChecklistAssessments", "classId");
    requireReference(subjectId, subjectIds, "taskChecklistAssessments", "subjectId");
    requireReference(studentId, studentIds, "taskChecklistAssessments", "studentId");
    requireReference(checklistTemplateId, checklistTemplateIds, "taskChecklistAssessments", "checklistTemplateId");
    if (!hasExceptionalDailyRecord(classId, subjectId, date, scheduleSlotId)) {
      requireReference(scheduleSlotId, scheduleSlotIds, "taskChecklistAssessments", "scheduleSlotId");
    }
    requireBoolean(row, "taskChecklistAssessments", "checked");
    if (studentClassById.get(studentId) !== classId) {
      throw new Error("La tabla 'taskChecklistAssessments' evalua a un alumno fuera del curso indicado.");
    }
    if (!subjectStudentKeys.has(`${subjectId}:${studentId}`)) {
      throw new Error("La tabla 'taskChecklistAssessments' evalua a un alumno no matriculado en la asignatura.");
    }
    if (!subjectCourseKeys.has(`${subjectId}:${classId}`)) {
      throw new Error("La tabla 'taskChecklistAssessments' usa una asignatura no asociada al curso.");
    }
    if (!taskSubjectKeys.has(`${taskId}:${subjectId}`)) {
      throw new Error("La tabla 'taskChecklistAssessments' usa una tarea no vinculada a la asignatura.");
    }
    const template = checklistTemplateById.get(checklistTemplateId);
    if (template?.taskId && template.taskId !== taskId) {
      throw new Error("La tabla 'taskChecklistAssessments' usa una lista de otra tarea.");
    }
    const items = Array.isArray(template?.items) ? template.items : [];
    if (!items.some((item) => isPlainObject(item) && item.id === itemId)) {
      throw new Error("La tabla 'taskChecklistAssessments' contiene un item inexistente.");
    }
  }
  requireUniqueLogicalRows(
    rows("taskChecklistAssessments"),
    "taskChecklistAssessments",
    "taskId+classId+subjectId+date+scheduleSlotId+studentId+checklistTemplateId+itemId",
    (row) =>
      [
        row.taskId,
        row.classId,
        row.subjectId,
        row.date,
        row.scheduleSlotId,
        row.studentId,
        row.checklistTemplateId,
        row.itemId
      ].join(":")
  );
  for (const row of rows("taskDirectGrades")) {
    const taskId = requireString(row, "taskDirectGrades", "taskId");
    const subjectId = requireString(row, "taskDirectGrades", "subjectId");
    const classId = requireString(row, "taskDirectGrades", "classId");
    const studentId = requireString(row, "taskDirectGrades", "studentId");
    requireReference(taskId, taskIds, "taskDirectGrades", "taskId");
    requireReference(subjectId, subjectIds, "taskDirectGrades", "subjectId");
    requireReference(classId, classIds, "taskDirectGrades", "classId");
    requireReference(studentId, studentIds, "taskDirectGrades", "studentId");
    if (!subjectCourseKeys.has(`${subjectId}:${classId}`)) {
      throw new Error("La tabla 'taskDirectGrades' usa una asignatura no asociada al curso.");
    }
    if (!taskSubjectKeys.has(`${taskId}:${subjectId}`)) {
      throw new Error("La tabla 'taskDirectGrades' usa una tarea no vinculada a la asignatura.");
    }
    if (studentClassById.get(studentId) !== classId) {
      throw new Error("La tabla 'taskDirectGrades' tiene una nota de un alumno que no pertenece al curso.");
    }
    if (!subjectStudentKeys.has(`${subjectId}:${studentId}`)) {
      throw new Error("La tabla 'taskDirectGrades' tiene una nota de un alumno no matriculado en la asignatura.");
    }
    requireNumber(row, "taskDirectGrades", "score");
    const score = Number(row.score);
    if (score < 0 || score > 10) {
      throw new Error("La tabla 'taskDirectGrades' contiene notas fuera del rango 0-10.");
    }
  }
  requireUniqueLogicalRows(
    rows("taskDirectGrades"),
    "taskDirectGrades",
    "taskId+subjectId+classId+studentId",
    (row) => `${row.taskId as string}:${row.subjectId as string}:${row.classId as string}:${row.studentId as string}`
  );
  for (const row of rows("studentFollowUps")) {
    const studentId = requireString(row, "studentFollowUps", "studentId");
    const classId = requireString(row, "studentFollowUps", "classId");
    requireReference(studentId, studentIds, "studentFollowUps", "studentId");
    requireReference(classId, classIds, "studentFollowUps", "classId");
    if (studentClassById.get(studentId) !== classId) {
      throw new Error("La tabla 'studentFollowUps' contiene seguimiento de un alumno fuera del curso indicado.");
    }
    requireDateString(row, "studentFollowUps", "date");
    if (!["incident", "family", "tutorial", "agreement", "adaptation", "wellbeing"].includes(requireString(row, "studentFollowUps", "kind"))) {
      throw new Error("La tabla 'studentFollowUps' contiene 'kind' no válido.");
    }
    requireText(row, "studentFollowUps", "title");
    requireText(row, "studentFollowUps", "notes");
    optionalString(row, "studentFollowUps", "nextStep");
    if (optionalString(row, "studentFollowUps", "dueDate")) {
      requireDateString(row, "studentFollowUps", "dueDate");
    }
    optionalString(row, "studentFollowUps", "responsiblePerson");
    const priority = optionalString(row, "studentFollowUps", "priority");
    if (priority && !["low", "normal", "high"].includes(priority)) {
      throw new Error("La tabla 'studentFollowUps' contiene 'priority' no válido.");
    }
    const status = optionalString(row, "studentFollowUps", "status");
    if (status && !["open", "inProgress", "done"].includes(status)) {
      throw new Error("La tabla 'studentFollowUps' contiene 'status' no válido.");
    }
    if (row.createdAt !== undefined) requireIsoDateTimeString(row.createdAt, "studentFollowUps.createdAt");
    if (row.updatedAt !== undefined) requireIsoDateTimeString(row.updatedAt, "studentFollowUps.updatedAt");
    requireBoolean(row, "studentFollowUps", "resolved");
  }
  for (const row of rows("behaviorMarks")) {
    const studentId = requireString(row, "behaviorMarks", "studentId");
    const classId = requireString(row, "behaviorMarks", "classId");
    requireReference(studentId, studentIds, "behaviorMarks", "studentId");
    requireReference(classId, classIds, "behaviorMarks", "classId");
    if (studentClassById.get(studentId) !== classId) {
      throw new Error("La tabla 'behaviorMarks' contiene un registro de un alumno fuera del curso indicado.");
    }
    const subjectId = optionalString(row, "behaviorMarks", "subjectId");
    if (subjectId) {
      requireReference(subjectId, subjectIds, "behaviorMarks", "subjectId");
      if (!subjectCourseKeys.has(`${subjectId}:${classId}`)) {
        throw new Error("La tabla 'behaviorMarks' usa una asignatura no asociada al curso.");
      }
    }
    requireDateString(row, "behaviorMarks", "date");
    if (!["positive", "negative"].includes(requireString(row, "behaviorMarks", "kind"))) {
      throw new Error("La tabla 'behaviorMarks' contiene 'kind' no válido.");
    }
    optionalString(row, "behaviorMarks", "note");
    requireIsoDateTimeString(row.createdAt, "behaviorMarks.createdAt");
  }
  for (const row of rows("familyContacts")) {
    const studentId = requireString(row, "familyContacts", "studentId");
    const classId = requireString(row, "familyContacts", "classId");
    requireReference(studentId, studentIds, "familyContacts", "studentId");
    requireReference(classId, classIds, "familyContacts", "classId");
    if (studentClassById.get(studentId) !== classId) {
      throw new Error("La tabla 'familyContacts' contiene un contacto fuera del curso del alumno.");
    }
    requireDateString(row, "familyContacts", "date");
    if (!["phone", "email", "meeting", "message", "other"].includes(requireString(row, "familyContacts", "channel"))) {
      throw new Error("La tabla 'familyContacts' contiene 'channel' no válido.");
    }
    requireString(row, "familyContacts", "contactName");
    requireString(row, "familyContacts", "relationship");
    requireString(row, "familyContacts", "summary");
    optionalString(row, "familyContacts", "agreements");
    optionalString(row, "familyContacts", "nextStep");
    optionalString(row, "familyContacts", "responsiblePerson");
    if (optionalString(row, "familyContacts", "dueDate")) {
      requireDateString(row, "familyContacts", "dueDate");
    }
    requireIsoDateTimeString(row.createdAt, "familyContacts.createdAt");
    requireIsoDateTimeString(row.updatedAt, "familyContacts.updatedAt");
  }
  const supportGroupIds = ids("supportGroups");
  for (const row of rows("supportGroups")) {
    requireString(row, "supportGroups", "name");
    requireString(row, "supportGroups", "responsiblePerson");
    optionalString(row, "supportGroups", "focus");
    requireIsoDateTimeString(row.createdAt, "supportGroups.createdAt");
    requireIsoDateTimeString(row.updatedAt, "supportGroups.updatedAt");
  }
  for (const row of rows("supportGroupMembers")) {
    requireReference(
      requireString(row, "supportGroupMembers", "supportGroupId"),
      supportGroupIds,
      "supportGroupMembers",
      "supportGroupId"
    );
    requireReference(
      requireString(row, "supportGroupMembers", "studentId"),
      studentIds,
      "supportGroupMembers",
      "studentId"
    );
    requireIsoDateTimeString(row.createdAt, "supportGroupMembers.createdAt");
  }
  requireUniqueLogicalRows(
    rows("supportGroupMembers"),
    "supportGroupMembers",
    "supportGroupId+studentId",
    (row) => `${row.supportGroupId as string}:${row.studentId as string}`
  );
  let totalResourceBytes = 0;
  for (const row of rows("resourceAttachments")) {
    const ownerType = requireString(row, "resourceAttachments", "ownerType");
    const ownerId = requireString(row, "resourceAttachments", "ownerId");
    if (ownerType === "student") {
      requireReference(ownerId, studentIds, "resourceAttachments", "ownerId");
    } else if (ownerType === "task") {
      requireReference(ownerId, taskIds, "resourceAttachments", "ownerId");
    } else if (ownerType === "journalEntry") {
      const owner = parseJournalEntryOwnerId(ownerId);
      if (!owner) {
        throw new Error("La tabla 'resourceAttachments' contiene un 'ownerId' de diario no válido.");
      }
      requireReference(owner.classId, classIds, "resourceAttachments", "ownerId");
      requireReference(owner.subjectId, subjectIds, "resourceAttachments", "ownerId");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(owner.date)) {
        throw new Error("La tabla 'resourceAttachments' contiene una fecha de diario no válida.");
      }
      if (!hasExceptionalDailyRecord(owner.classId, owner.subjectId, owner.date, owner.scheduleSlotId)) {
        requireReference(owner.scheduleSlotId, scheduleSlotIds, "resourceAttachments", "ownerId");
      }
      if (owner.taskId) {
        requireReference(owner.taskId, taskIds, "resourceAttachments", "ownerId");
      }
    } else {
      throw new Error("La tabla 'resourceAttachments' contiene 'ownerType' no válido.");
    }

    const title = requireString(row, "resourceAttachments", "title");
    if (title.length < 2 || title.length > MAX_RESOURCE_TITLE_LENGTH) {
      throw new Error("La tabla 'resourceAttachments' contiene un título no válido.");
    }
    requireIsoDateTimeString(row.createdAt, "resourceAttachments.createdAt");
    requireIsoDateTimeString(row.updatedAt, "resourceAttachments.updatedAt");

    const kind = requireString(row, "resourceAttachments", "kind");
    if (kind === "link") {
      const url = requireString(row, "resourceAttachments", "url");
      if (url.length > MAX_RESOURCE_URL_LENGTH) {
        throw new Error("La tabla 'resourceAttachments' contiene una URL demasiado larga.");
      }
      normalizeHttpUrl(url);
      if (row.fileName !== undefined || row.mimeType !== undefined || row.sizeBytes !== undefined || row.dataBase64 !== undefined) {
        throw new Error("La tabla 'resourceAttachments' mezcla datos de enlace y archivo.");
      }
      continue;
    }
    if (kind !== "file") {
      throw new Error("La tabla 'resourceAttachments' contiene 'kind' no válido.");
    }
    if (row.url !== undefined) {
      throw new Error("La tabla 'resourceAttachments' mezcla datos de archivo y enlace.");
    }
    const fileName = requireString(row, "resourceAttachments", "fileName");
    if (fileName.length > MAX_RESOURCE_FILE_NAME_LENGTH || /[\u0000-\u001f]/.test(fileName)) {
      throw new Error("La tabla 'resourceAttachments' contiene un nombre de archivo no válido.");
    }
    const mimeType = requireString(row, "resourceAttachments", "mimeType");
    if (!isAllowedResourceMimeType(mimeType)) {
      throw new Error("La tabla 'resourceAttachments' contiene un tipo de archivo no permitido.");
    }
    requireNumber(row, "resourceAttachments", "sizeBytes");
    const sizeBytes = row.sizeBytes as number;
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_RESOURCE_FILE_BYTES) {
      throw new Error("La tabla 'resourceAttachments' contiene un tamaño de archivo no válido.");
    }
    const dataBase64 = requireString(row, "resourceAttachments", "dataBase64");
    if (base64DecodedByteLength(dataBase64) !== sizeBytes) {
      throw new Error("La tabla 'resourceAttachments' contiene datos de archivo dañados.");
    }
    totalResourceBytes += sizeBytes;
  }
  if (totalResourceBytes > MAX_TOTAL_RESOURCE_BYTES) {
    throw new Error("La tabla 'resourceAttachments' supera el límite total de almacenamiento.");
  }
  const moodleConnectionIds = ids("moodleConnections");
  for (const row of rows("moodleConnections")) {
    requireOnlyFields(row, "moodleConnections", ["id", "server", "userId", "siteName", "userName", "functions", "createdAt", "updatedAt"]);
    const server = requireString(row, "moodleConnections", "server");
    let serverUrl: URL;
    try {
      serverUrl = new URL(server);
    } catch {
      throw new Error("La tabla 'moodleConnections' contiene una dirección no válida.");
    }
    const normalizedServer = serverUrl.toString().replace(/\/$/, "");
    if (serverUrl.protocol !== "https:" || serverUrl.username || serverUrl.password || serverUrl.search || serverUrl.hash ||
        server !== normalizedServer) {
      throw new Error("La tabla 'moodleConnections' contiene una dirección no segura o no normalizada.");
    }
    requireNumber(row, "moodleConnections", "userId");
    if (!Number.isSafeInteger(row.userId) || (row.userId as number) <= 0) {
      throw new Error("La tabla 'moodleConnections' contiene un userId no válido.");
    }
    requireString(row, "moodleConnections", "siteName");
    requireString(row, "moodleConnections", "userName");
    if (!Array.isArray(row.functions) || row.functions.some((value) => typeof value !== "string" || !value.trim())) {
      throw new Error("La tabla 'moodleConnections' contiene capacidades no válidas.");
    }
    requireIsoDateTimeString(row.createdAt, "moodleConnections.createdAt");
    requireIsoDateTimeString(row.updatedAt, "moodleConnections.updatedAt");
  }
  requireUniqueLogicalRows(rows("moodleConnections"), "moodleConnections", "server+userId", (row) => `${row.server}:${row.userId}`);

  for (const row of rows("moodleBindings")) {
    requireOnlyFields(row, "moodleBindings", ["id", "connectionId", "courseId", "remoteGroupId", "classId", "subjectId", "kind", "remoteId", "localId", "remoteLabel", "localBaseline", "remoteBaseline", "updatedAt"]);
    const connectionId = requireString(row, "moodleBindings", "connectionId");
    requireReference(connectionId, moodleConnectionIds, "moodleBindings", "connectionId");
    requireNumber(row, "moodleBindings", "courseId");
    requireNumber(row, "moodleBindings", "remoteId");
    if (!Number.isSafeInteger(row.courseId) || (row.courseId as number) <= 0 ||
        !Number.isSafeInteger(row.remoteId) || (row.remoteId as number) <= 0) {
      throw new Error("La tabla 'moodleBindings' contiene identificadores remotos no válidos.");
    }
    if (row.remoteGroupId !== undefined) {
      requireNumber(row, "moodleBindings", "remoteGroupId");
      if (!Number.isSafeInteger(row.remoteGroupId) || (row.remoteGroupId as number) <= 0) {
        throw new Error("La tabla 'moodleBindings' contiene un remoteGroupId no válido.");
      }
    }
    requireString(row, "moodleBindings", "classId");
    requireString(row, "moodleBindings", "subjectId");
    requireString(row, "moodleBindings", "localId");
    const kind = row.kind;
    if (kind !== "course" && kind !== "student" && kind !== "activity") {
      throw new Error("La tabla 'moodleBindings' contiene un tipo de asociación no válido.");
    }
    if (kind === "course" && row.remoteId !== row.courseId) {
      throw new Error("La tabla 'moodleBindings' contiene una asociación de curso incoherente.");
    }
    requireString(row, "moodleBindings", "remoteLabel");
    requireBaseline(row, "moodleBindings", "localBaseline");
    requireBaseline(row, "moodleBindings", "remoteBaseline");
    const localAllowed = kind === "student" ? ["firstName", "lastName", "fullName", "email"] : kind === "activity" ? ["title"] : [];
    const remoteAllowed = kind === "student" ? ["firstName", "lastName", "fullName", "email"] : kind === "activity" ? ["title", "url", "dueDate"] : ["fullName", "shortName"];
    requireOnlyFields(row.localBaseline as Record<string, unknown>, "moodleBindings.localBaseline", localAllowed);
    requireOnlyFields(row.remoteBaseline as Record<string, unknown>, "moodleBindings.remoteBaseline", remoteAllowed);
    if (kind === "activity" && (row.remoteBaseline as Record<string, unknown>).url !== undefined) {
      requireSecretFreeMoodleUrl((row.remoteBaseline as Record<string, unknown>).url);
    }
    requireIsoDateTimeString(row.updatedAt, "moodleBindings.updatedAt");
  }
  const moodleScopeKey = (row: Record<string, unknown>) =>
    `${row.connectionId}:${row.courseId}:${row.remoteGroupId ?? "all"}:${row.classId}:${row.subjectId}`;
  requireUniqueLogicalRows(rows("moodleBindings"), "moodleBindings", "scope+kind+remoteId", (row) => `${moodleScopeKey(row)}:${row.kind}:${row.remoteId}`);
  requireUniqueLogicalRows(rows("moodleBindings").filter((row) => row.kind !== "course"), "moodleBindings", "scope+kind+localId", (row) => `${moodleScopeKey(row)}:${row.kind}:${row.localId}`);

  for (const row of rows("moodleOperations")) {
    requireOnlyFields(row, "moodleOperations", ["id", "connectionId", "createdAt", "kind", "summary", "count"]);
    const connectionId = requireString(row, "moodleOperations", "connectionId");
    requireReference(connectionId, moodleConnectionIds, "moodleOperations", "connectionId");
    if (row.kind !== "link" && row.kind !== "update" && row.kind !== "grades") {
      throw new Error("La tabla 'moodleOperations' contiene un tipo de operación no válido.");
    }
    requireString(row, "moodleOperations", "summary");
    requireNumber(row, "moodleOperations", "count");
    if (!Number.isSafeInteger(row.count) || (row.count as number) < 0) {
      throw new Error("La tabla 'moodleOperations' contiene un recuento no válido.");
    }
    requireIsoDateTimeString(row.createdAt, "moodleOperations.createdAt");
  }
  for (const row of rows("scheduleSettings")) {
    if (row.id !== "default") {
      throw new Error("La tabla 'scheduleSettings' contiene un id no válido.");
    }
    requireNumber(row, "scheduleSettings", "defaultBlockDurationMinutes");
    const duration = row.defaultBlockDurationMinutes as number;
    if (duration < 15 || duration > 240) {
      throw new Error("La tabla 'scheduleSettings' contiene una duración de bloque fuera del rango 15-240.");
    }
  }
  for (const row of rows("appPreferences")) {
    if (row.id !== "default") {
      throw new Error("La tabla 'appPreferences' contiene un id no válido.");
    }
    const studentSortBy = row.studentSortBy;
    const studentNameFormat = row.studentNameFormat;
    const weekStartsOn = row.weekStartsOn;
    const notSubmittedGradePolicy = row.notSubmittedGradePolicy;
    if (studentSortBy !== "lastName" && studentSortBy !== "firstName") {
      throw new Error("La tabla 'appPreferences' contiene 'studentSortBy' no válido.");
    }
    if (studentNameFormat !== "firstLast" && studentNameFormat !== "lastFirst") {
      throw new Error("La tabla 'appPreferences' contiene 'studentNameFormat' no válido.");
    }
    if (weekStartsOn !== "monday" && weekStartsOn !== "sunday") {
      throw new Error("La tabla 'appPreferences' contiene 'weekStartsOn' no válido.");
    }
    if (
      notSubmittedGradePolicy !== undefined &&
      notSubmittedGradePolicy !== "exclude" &&
      notSubmittedGradePolicy !== "zero"
    ) {
      throw new Error("La tabla 'appPreferences' contiene 'notSubmittedGradePolicy' no válido.");
    }
  }
  return validatedTables;
}

export async function buildCurrentPayload(): Promise<DatabaseExportPayload> {
  return db.transaction("r", db.tables, async () => {
    const tables: Record<string, unknown[]> = {};
    for (const table of db.tables) {
      const rows = await table.toArray();
      tables[table.name] = table.name === "tasks" ? rows.map((row) => isPlainObject(row) ? {
        ...row,
        sessionCount: typeof row.sessionCount === "number" && Number.isFinite(row.sessionCount)
          ? Math.max(1, Math.round(row.sessionCount)) : 1
      } : row) : rows;
    }
    return { app: PRODUCT_NAME, schemaVersion: DATABASE_SCHEMA_VERSION, exportedAt: new Date().toISOString(), tables };
  });
}

function pruneStaleMoodleBindings(tablesData: Record<string, unknown[]>): void {
  const tableRows = (name: string) => (tablesData[name] ?? []) as Record<string, unknown>[];
  const classIds = new Set(tableRows("classGroups").map((row) => row.id as string));
  const subjectIds = new Set(tableRows("subjects").map((row) => row.id as string));
  const taskIds = new Set(tableRows("tasks").map((row) => row.id as string));
  const studentClassById = new Map(tableRows("students").map((row) => [row.id as string, row.classId as string]));
  const subjectCourseKeys = new Set(tableRows("subjectCourseLinks").map((row) => `${row.subjectId}:${row.classId}`));
  const taskSubjectKeys = new Set(tableRows("taskSubjectLinks").map((row) => `${row.taskId}:${row.subjectId}`));
  const original = tableRows("moodleBindings");
  const retained = original.filter((row) => {
    const kind = row.kind;
    const classId = row.classId as string;
    const subjectId = row.subjectId as string;
    const localId = row.localId as string;
    if (!classIds.has(classId) || !subjectIds.has(subjectId) || !subjectCourseKeys.has(`${subjectId}:${classId}`)) return false;
    if (kind === "course") return localId === classId;
    if (kind === "student") return studentClassById.get(localId) === classId;
    return kind === "activity" && taskIds.has(localId) && taskSubjectKeys.has(`${localId}:${subjectId}`);
  });
  tablesData.moodleBindings = retained;
  const removedByConnection = new Map<string, number>();
  for (const row of original) {
    if (retained.includes(row)) continue;
    const connectionId = row.connectionId as string;
    removedByConnection.set(connectionId, (removedByConnection.get(connectionId) ?? 0) + 1);
  }
  const timestamp = new Date().toISOString();
  const operations = tableRows("moodleOperations");
  for (const [connectionId, count] of removedByConnection) {
    operations.push({ id: crypto.randomUUID(), connectionId, createdAt: timestamp, kind: "link",
      summary: "Asociaciones obsoletas omitidas al restaurar la copia", count });
  }
  tablesData.moodleOperations = operations;
}

export async function restoreDatabasePayload(
  payload: unknown,
  expectedCurrentTables?: Record<string, unknown[]>,
  signal?: AbortSignal
): Promise<void> {
  const tablesData = validateDatabasePayload(payload);
  pruneStaleMoodleBindings(tablesData);
  signal?.throwIfAborted();
  await db.transaction("rw", db.tables, async (transaction) => {
    const abort = () => transaction.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      signal?.throwIfAborted();
      if (expectedCurrentTables) {
        await assertCurrentDatabase(expectedCurrentTables);
      }
      for (const table of db.tables) await table.clear();
      for (const table of db.tables) {
        const rows = tablesData[table.name];
        if (rows.length) await table.bulkPut(rows as object[]);
      }
      signal?.throwIfAborted();
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  });
  clearLocalDrafts();
}

async function assertCurrentDatabase(expectedCurrentTables: Record<string, unknown[]>): Promise<void> {
  const current = await buildCurrentPayload();
  if (JSON.stringify(current.tables) !== JSON.stringify(expectedCurrentTables)) {
    throw new Error("Los datos locales cambiaron mientras se creaba la copia preventiva. Cierra otras pestañas de Edunoza y vuelve a intentarlo. No se ha sustituido ningún dato.");
  }
}

export async function clearDatabase(expectedCurrentTables: Record<string, unknown[]>): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    await assertCurrentDatabase(expectedCurrentTables);
    for (const table of db.tables) await table.clear();
  });
  clearLocalDrafts();
}
