import type {
  ClassGroup,
  FamilyContact,
  Student,
  StudentFollowUp,
  SupportGroup,
  SupportGroupMember
} from "../db/types";
import {
  PRODUCT_NAME,
  isCompatibleProductName,
  type CompatibleProductName
} from "../brand";

export const HANDOFF_TABLE_NAMES = [
  "classGroups",
  "students",
  "studentFollowUps",
  "familyContacts",
  "supportGroups",
  "supportGroupMembers"
] as const;

export type HandoffTableName = (typeof HANDOFF_TABLE_NAMES)[number];

export type HandoffTables = {
  classGroups: ClassGroup[];
  students: Student[];
  studentFollowUps: StudentFollowUp[];
  familyContacts: FamilyContact[];
  supportGroups: SupportGroup[];
  supportGroupMembers: SupportGroupMember[];
};

export type StudentHandoffPayload = {
  app: CompatibleProductName;
  format: "student-handoff";
  version: 1;
  exportedAt: string;
  scope: {
    studentIds: string[];
    supportGroupIds: string[];
  };
  tables: HandoffTables;
};

export type HandoffTablePreview = {
  createIds: string[];
  unchangedIds: string[];
  conflictIds: string[];
};

export type HandoffMergePreview = {
  tables: Record<HandoffTableName, HandoffTablePreview>;
  createCount: number;
  unchangedCount: number;
  conflictCount: number;
};

type HandoffSource = HandoffTables;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasString(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === "string" && record[key].trim().length > 0;
}

function hasOptionalString(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || typeof record[key] === "string";
}

function isIsoDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function isIsoDateTime(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function hasOptionalIsoDate(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || isIsoDate(record[key]);
}

function hasOptionalIsoDateTime(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || isIsoDateTime(record[key]);
}

function hasOptionalBoolean(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || typeof record[key] === "boolean";
}

function hasAllowedValue(
  record: Record<string, unknown>,
  key: string,
  allowedValues: readonly string[]
): boolean {
  return typeof record[key] === "string" && allowedValues.includes(record[key]);
}

function hasOptionalAllowedValue(
  record: Record<string, unknown>,
  key: string,
  allowedValues: readonly string[]
): boolean {
  return record[key] === undefined || hasAllowedValue(record, key, allowedValues);
}

function requireUniqueIds(rows: Array<{ id: string }>, tableName: HandoffTableName): void {
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) {
      throw new Error(`El paquete de relevo contiene IDs duplicados en '${tableName}'.`);
    }
    ids.add(row.id);
  }
}

function validateClassGroup(value: unknown): value is ClassGroup {
  return (
    isRecord(value) &&
    hasString(value, "id") &&
    hasString(value, "name") &&
    hasString(value, "level") &&
    hasString(value, "schoolYear") &&
    hasOptionalString(value, "comments")
  );
}

function validateStudent(value: unknown): value is Student {
  return (
    isRecord(value) &&
    hasString(value, "id") &&
    hasString(value, "classId") &&
    hasString(value, "firstName") &&
    hasString(value, "lastName") &&
    hasString(value, "fullName") &&
    hasOptionalString(value, "personId") &&
    hasOptionalString(value, "comments") &&
    hasOptionalString(value, "photoDataUrl") &&
    hasOptionalString(value, "email") &&
    hasOptionalBoolean(value, "hasAcs") &&
    hasOptionalBoolean(value, "hasReinforcement")
  );
}

function validateFollowUp(value: unknown): value is StudentFollowUp {
  return (
    isRecord(value) &&
    hasString(value, "id") &&
    hasString(value, "studentId") &&
    hasString(value, "classId") &&
    isIsoDate(value.date) &&
    hasAllowedValue(value, "kind", ["incident", "family", "tutorial", "agreement", "adaptation", "wellbeing"]) &&
    hasString(value, "title") &&
    hasString(value, "notes") &&
    typeof value.resolved === "boolean" &&
    hasOptionalString(value, "nextStep") &&
    hasOptionalIsoDate(value, "dueDate") &&
    hasOptionalString(value, "responsiblePerson") &&
    hasOptionalAllowedValue(value, "priority", ["low", "normal", "high"]) &&
    hasOptionalAllowedValue(value, "status", ["open", "inProgress", "done"]) &&
    hasOptionalIsoDateTime(value, "createdAt") &&
    hasOptionalIsoDateTime(value, "updatedAt")
  );
}

function validateFamilyContact(value: unknown): value is FamilyContact {
  return (
    isRecord(value) &&
    hasString(value, "id") &&
    hasString(value, "studentId") &&
    hasString(value, "classId") &&
    isIsoDate(value.date) &&
    hasAllowedValue(value, "channel", ["phone", "email", "meeting", "message", "other"]) &&
    hasString(value, "contactName") &&
    hasString(value, "relationship") &&
    hasString(value, "summary") &&
    (value.status === undefined || hasAllowedValue(value, "status", ["open", "inProgress", "done"])) &&
    hasOptionalString(value, "agreements") &&
    hasOptionalString(value, "nextStep") &&
    hasOptionalIsoDate(value, "dueDate") &&
    hasOptionalString(value, "responsiblePerson") &&
    isIsoDateTime(value.createdAt) &&
    isIsoDateTime(value.updatedAt)
  );
}

function validateSupportGroup(value: unknown): value is SupportGroup {
  return (
    isRecord(value) &&
    hasString(value, "id") &&
    hasString(value, "name") &&
    hasString(value, "responsiblePerson") &&
    hasOptionalString(value, "focus") &&
    isIsoDateTime(value.createdAt) &&
    isIsoDateTime(value.updatedAt)
  );
}

function validateSupportGroupMember(value: unknown): value is SupportGroupMember {
  return (
    isRecord(value) &&
    hasString(value, "id") &&
    hasString(value, "supportGroupId") &&
    hasString(value, "studentId") &&
    isIsoDateTime(value.createdAt)
  );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function validateReferences(tables: HandoffTables): void {
  const classIds = new Set(tables.classGroups.map((row) => row.id));
  const studentIds = new Set(tables.students.map((row) => row.id));
  const supportGroupIds = new Set(tables.supportGroups.map((row) => row.id));

  for (const student of tables.students) {
    if (!classIds.has(student.classId)) {
      throw new Error("El paquete contiene un alumno sin su curso de referencia.");
    }
  }
  for (const row of [...tables.studentFollowUps, ...tables.familyContacts]) {
    if (!studentIds.has(row.studentId) || !classIds.has(row.classId)) {
      throw new Error("El paquete contiene seguimiento sin alumno o curso de referencia.");
    }
    const student = tables.students.find((candidate) => candidate.id === row.studentId);
    if (student?.classId !== row.classId) {
      throw new Error("El paquete contiene seguimiento asignado a un curso distinto del alumno.");
    }
  }
  const membershipKeys = new Set<string>();
  for (const member of tables.supportGroupMembers) {
    if (!supportGroupIds.has(member.supportGroupId) || !studentIds.has(member.studentId)) {
      throw new Error("El paquete contiene una pertenencia de apoyo sin referencias válidas.");
    }
    const key = `${member.supportGroupId}\0${member.studentId}`;
    if (membershipKeys.has(key)) {
      throw new Error("El paquete contiene pertenencias de apoyo duplicadas.");
    }
    membershipKeys.add(key);
  }
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length && left.every((item) => right.includes(item));
}

export function createStudentHandoffPayload(
  source: HandoffSource,
  selectedStudentIds: Iterable<string>,
  exportedAt = new Date().toISOString()
): StudentHandoffPayload {
  const studentIds = new Set(selectedStudentIds);
  const students = source.students
    .filter((student) => studentIds.has(student.id))
    .map((student) => ({ ...student, personId: student.personId ?? student.id }));
  const includedStudentIds = new Set(students.map((student) => student.id));
  const classIds = new Set(students.map((student) => student.classId));
  const supportGroupMembers = source.supportGroupMembers.filter((member) =>
    includedStudentIds.has(member.studentId)
  );
  const supportGroupIds = new Set(supportGroupMembers.map((member) => member.supportGroupId));

  return {
    app: PRODUCT_NAME,
    format: "student-handoff",
    version: 1,
    exportedAt,
    scope: {
      studentIds: [...includedStudentIds].sort(),
      supportGroupIds: [...supportGroupIds].sort()
    },
    tables: {
      classGroups: source.classGroups.filter((group) => classIds.has(group.id)),
      students,
      studentFollowUps: source.studentFollowUps.filter((row) => includedStudentIds.has(row.studentId)),
      familyContacts: source.familyContacts.filter((row) => includedStudentIds.has(row.studentId)),
      supportGroups: source.supportGroups.filter((group) => supportGroupIds.has(group.id)),
      supportGroupMembers
    }
  };
}

export function parseStudentHandoffPayload(value: unknown): StudentHandoffPayload {
  if (
    !isRecord(value) ||
    !isCompatibleProductName(value.app) ||
    value.format !== "student-handoff" ||
    value.version !== 1 ||
    !isIsoDateTime(value.exportedAt) ||
    !isRecord(value.scope) ||
    !Array.isArray(value.scope.studentIds) ||
    !value.scope.studentIds.every((id) => typeof id === "string") ||
    !Array.isArray(value.scope.supportGroupIds) ||
    !value.scope.supportGroupIds.every((id) => typeof id === "string") ||
    !isRecord(value.tables)
  ) {
    throw new Error("El archivo no es un paquete de relevo compatible.");
  }

  const rawTables = value.tables;
  const tableNames = Object.keys(rawTables);
  if (
    tableNames.length !== HANDOFF_TABLE_NAMES.length ||
    tableNames.some((tableName) => !HANDOFF_TABLE_NAMES.includes(tableName as HandoffTableName))
  ) {
    throw new Error("El paquete de relevo no contiene exactamente las tablas esperadas.");
  }
  const validators: Record<HandoffTableName, (row: unknown) => boolean> = {
    classGroups: validateClassGroup,
    students: validateStudent,
    studentFollowUps: validateFollowUp,
    familyContacts: validateFamilyContact,
    supportGroups: validateSupportGroup,
    supportGroupMembers: validateSupportGroupMember
  };
  const tables = {} as HandoffTables;

  for (const tableName of HANDOFF_TABLE_NAMES) {
    const rows = rawTables[tableName];
    if (!Array.isArray(rows) || !rows.every(validators[tableName])) {
      throw new Error(`El paquete contiene datos no válidos en '${tableName}'.`);
    }
    Object.assign(tables, { [tableName]: rows });
    requireUniqueIds(rows as Array<{ id: string }>, tableName);
  }

  validateReferences(tables);
  if (
    !sameStringSet(value.scope.studentIds, tables.students.map((student) => student.id)) ||
    !sameStringSet(value.scope.supportGroupIds, tables.supportGroups.map((group) => group.id))
  ) {
    throw new Error("El alcance declarado del paquete no coincide con sus datos.");
  }
  return value as StudentHandoffPayload;
}

export function buildHandoffMergePreview(
  incoming: HandoffTables,
  current: HandoffTables
): HandoffMergePreview {
  const tables = {} as Record<HandoffTableName, HandoffTablePreview>;
  let createCount = 0;
  let unchangedCount = 0;
  let conflictCount = 0;

  for (const tableName of HANDOFF_TABLE_NAMES) {
    const existingById = new Map(
      (current[tableName] as Array<{ id: string }>).map((row) => [row.id, row])
    );
    const preview: HandoffTablePreview = {
      createIds: [],
      unchangedIds: [],
      conflictIds: []
    };
    for (const row of incoming[tableName] as Array<{ id: string }>) {
      const existing = existingById.get(row.id);
      if (!existing) {
        preview.createIds.push(row.id);
      } else if (canonicalJson(existing) === canonicalJson(row)) {
        preview.unchangedIds.push(row.id);
      } else {
        preview.conflictIds.push(row.id);
      }
    }
    tables[tableName] = preview;
    createCount += preview.createIds.length;
    unchangedCount += preview.unchangedIds.length;
    conflictCount += preview.conflictIds.length;
  }

  return { tables, createCount, unchangedCount, conflictCount };
}

export function selectHandoffRowsToCreate(
  incoming: HandoffTables,
  preview: HandoffMergePreview
): HandoffTables {
  const output = {} as HandoffTables;
  for (const tableName of HANDOFF_TABLE_NAMES) {
    const createIds = new Set(preview.tables[tableName].createIds);
    Object.assign(output, {
      [tableName]: (incoming[tableName] as Array<{ id: string }>).filter((row) =>
        createIds.has(row.id)
      )
    });
  }
  return output;
}
