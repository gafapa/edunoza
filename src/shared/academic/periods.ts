import type { Table } from "dexie";
import { db } from "../db/database";
import type {
  AcademicPeriod,
  Assessment,
  ChecklistTemplate,
  ClassGroup,
  GradebookGroup,
  GradebookPeriodSnapshot,
  GradebookPeriodSnapshotData,
  RubricTemplate,
  Student,
  Subject,
  SubjectCourseLink,
  SubjectStudentLink,
  Task,
  TaskGradebookConfig,
  TaskSubjectLink,
  UnitBlock
} from "../db/types";

export type AcademicPeriodDraft = {
  name: string;
  startDate: string;
  endDate: string;
};

export type PeriodSnapshotSource = GradebookPeriodSnapshotData & {
  period: AcademicPeriod;
};

export type SchoolYearRolloverSource = {
  classGroup: ClassGroup;
  students: Student[];
  subjects: Subject[];
  subjectCourseLinks: SubjectCourseLink[];
  subjectStudentLinks: SubjectStudentLink[];
  units: UnitBlock[];
  tasks: Task[];
  taskSubjectLinks: TaskSubjectLink[];
  taskGradebookConfigs: TaskGradebookConfig[];
  gradebookGroups: GradebookGroup[];
  assessments: Assessment[];
  rubricTemplates: RubricTemplate[];
  checklistTemplates: ChecklistTemplate[];
  academicPeriods: AcademicPeriod[];
};

export type SchoolYearRolloverRows = Omit<SchoolYearRolloverSource, "classGroup"> & {
  classGroup: ClassGroup;
};

export type SchoolYearRolloverRequest = {
  sourceClassId: string;
  targetClassId?: string;
  targetName: string;
  targetSchoolYear: string;
};

export type PeriodClosureRecords = {
  period: AcademicPeriod;
  snapshot: GradebookPeriodSnapshot;
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function requireIsoDate(value: string, fieldName: string): void {
  if (!ISO_DATE_PATTERN.test(value)) {
    throw new Error(`${fieldName} must use YYYY-MM-DD format.`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`${fieldName} is not a valid calendar date.`);
  }
}

export function validateAcademicPeriodDraft(
  draft: AcademicPeriodDraft,
  existingPeriods: AcademicPeriod[],
  excludedPeriodId?: string
): void {
  const name = draft.name.trim();
  if (name.length < 2) {
    throw new Error("The period name must contain at least two characters.");
  }
  requireIsoDate(draft.startDate, "startDate");
  requireIsoDate(draft.endDate, "endDate");
  if (draft.startDate > draft.endDate) {
    throw new Error("The period start date must not be after its end date.");
  }
  const overlaps = existingPeriods.some(
    (period) =>
      period.id !== excludedPeriodId &&
      draft.startDate <= period.endDate &&
      draft.endDate >= period.startDate
  );
  if (overlaps) {
    throw new Error("Academic periods in the same class must not overlap.");
  }
}

function shiftIsoDateByYear(value: string): string {
  requireIsoDate(value, "date");
  const [year, month, day] = value.split("-").map(Number);
  const targetYear = year + 1;
  const targetMonthLastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  return `${targetYear}-${String(month).padStart(2, "0")}-${String(Math.min(day, targetMonthLastDay)).padStart(2, "0")}`;
}

function cloneWithId<T extends { id: string }>(
  row: T,
  createId: () => string
): T {
  return { ...row, id: createId() };
}

export function buildSchoolYearRolloverRows(
  source: SchoolYearRolloverSource,
  targetClass: ClassGroup,
  createId: () => string,
  timestamp: string
): SchoolYearRolloverRows {
  const studentIdMap = new Map(source.students.map((student) => [student.id, createId()]));
  const subjectIdMap = new Map(source.subjects.map((subject) => [subject.id, createId()]));
  const unitIdMap = new Map(source.units.map((unit) => [unit.id, createId()]));
  const taskIdMap = new Map(source.tasks.map((task) => [task.id, createId()]));
  const groupIdMap = new Map(source.gradebookGroups.map((group) => [group.id, createId()]));
  const rubricIdMap = new Map(source.rubricTemplates.map((template) => [template.id, createId()]));
  const checklistIdMap = new Map(source.checklistTemplates.map((template) => [template.id, createId()]));
  const periodIdMap = new Map(source.academicPeriods.map((period) => [period.id, createId()]));

  const students = source.students.map((student) => ({
    ...cloneWithId(student, () => studentIdMap.get(student.id) as string),
    personId: student.personId ?? student.id,
    classId: targetClass.id
  }));
  const subjects = source.subjects.map((subject) =>
    cloneWithId(subject, () => subjectIdMap.get(subject.id) as string)
  );
  const subjectCourseLinks = source.subjectCourseLinks.map((link) => ({
    id: createId(),
    classId: targetClass.id,
    subjectId: subjectIdMap.get(link.subjectId) as string
  }));
  const subjectStudentLinks = source.subjectStudentLinks.flatMap((link) => {
    const subjectId = subjectIdMap.get(link.subjectId);
    const studentId = studentIdMap.get(link.studentId);
    return subjectId && studentId ? [{ id: createId(), subjectId, studentId }] : [];
  });
  const units = source.units.map((unit) => ({
    ...cloneWithId(unit, () => unitIdMap.get(unit.id) as string),
    subjectId: subjectIdMap.get(unit.subjectId) as string
  }));
  const tasks = source.tasks.map((task) => cloneWithId(task, () => taskIdMap.get(task.id) as string));
  const taskSubjectLinks = source.taskSubjectLinks.map((link) => ({
    ...cloneWithId(link, createId),
    taskId: taskIdMap.get(link.taskId) as string,
    subjectId: subjectIdMap.get(link.subjectId) as string,
    unitId: link.unitId ? unitIdMap.get(link.unitId) : undefined
  }));
  const gradebookGroups = source.gradebookGroups.map((group) => ({
    ...cloneWithId(group, () => groupIdMap.get(group.id) as string),
    classId: targetClass.id,
    subjectId: subjectIdMap.get(group.subjectId) as string,
    parentId: group.parentId ? groupIdMap.get(group.parentId) : undefined
  }));
  const academicPeriods = source.academicPeriods.map((period) => ({
    ...cloneWithId(period, () => periodIdMap.get(period.id) as string),
    classId: targetClass.id,
    startDate: shiftIsoDateByYear(period.startDate),
    endDate: shiftIsoDateByYear(period.endDate),
    status: "open" as const,
    createdAt: timestamp,
    updatedAt: timestamp,
    closedAt: undefined,
    reopenedAt: undefined,
    currentSnapshotId: undefined,
    closureVersion: 0
  }));
  const rubricTemplates = source.rubricTemplates.map((template) => ({
    ...cloneWithId(template, () => rubricIdMap.get(template.id) as string),
    classId: targetClass.id,
    taskId: template.taskId ? taskIdMap.get(template.taskId) : undefined
  }));
  const checklistTemplates = source.checklistTemplates.map((template) => ({
    ...cloneWithId(template, () => checklistIdMap.get(template.id) as string),
    classId: targetClass.id,
    taskId: template.taskId ? taskIdMap.get(template.taskId) : undefined
  }));
  const taskGradebookConfigs = source.taskGradebookConfigs.map((config) => ({
    ...cloneWithId(config, createId),
    taskId: taskIdMap.get(config.taskId) as string,
    subjectId: subjectIdMap.get(config.subjectId) as string,
    classId: targetClass.id,
    academicPeriodId: config.academicPeriodId
      ? periodIdMap.get(config.academicPeriodId)
      : undefined,
    groupId: config.groupId ? groupIdMap.get(config.groupId) : undefined,
    rubricTemplateId: config.rubricTemplateId
      ? rubricIdMap.get(config.rubricTemplateId)
      : undefined,
    checklistTemplateId: config.checklistTemplateId
      ? checklistIdMap.get(config.checklistTemplateId)
      : undefined
  }));
  const assessments = source.assessments.map((assessment) => ({
    ...cloneWithId(assessment, createId),
    classId: targetClass.id,
    subjectId: subjectIdMap.get(assessment.subjectId) as string,
    assessmentDate: assessment.assessmentDate
      ? shiftIsoDateByYear(assessment.assessmentDate)
      : undefined,
    academicPeriodId: assessment.academicPeriodId
      ? periodIdMap.get(assessment.academicPeriodId)
      : undefined,
    groupId: assessment.groupId ? groupIdMap.get(assessment.groupId) : undefined
  }));

  return {
    classGroup: targetClass,
    students,
    subjects,
    subjectCourseLinks,
    subjectStudentLinks,
    units,
    tasks,
    taskSubjectLinks,
    taskGradebookConfigs,
    gradebookGroups,
    assessments,
    rubricTemplates,
    checklistTemplates,
    academicPeriods
  };
}

export function buildPeriodClosureRecords(
  period: AcademicPeriod,
  snapshotData: GradebookPeriodSnapshotData,
  snapshotId: string,
  timestamp: string
): PeriodClosureRecords {
  if (period.status === "closed") {
    throw new Error("The academic period is already closed.");
  }
  const version = period.closureVersion + 1;
  const snapshot: GradebookPeriodSnapshot = {
    id: snapshotId,
    academicPeriodId: period.id,
    classId: period.classId,
    version,
    createdAt: timestamp,
    data: structuredClone(snapshotData)
  };
  return {
    snapshot,
    period: {
      ...period,
      status: "closed",
      closedAt: timestamp,
      reopenedAt: undefined,
      currentSnapshotId: snapshot.id,
      closureVersion: version,
      updatedAt: timestamp
    }
  };
}

export function buildReopenedAcademicPeriod(
  period: AcademicPeriod,
  timestamp: string
): AcademicPeriod {
  return {
    ...period,
    status: "open",
    reopenedAt: timestamp,
    updatedAt: timestamp
  };
}

export async function createAcademicPeriod(
  classId: string,
  draft: AcademicPeriodDraft
): Promise<AcademicPeriod> {
  return db.transaction("rw", [db.academicPeriods, db.classGroups], async () => {
    if (!(await db.classGroups.get(classId))) {
      throw new Error("The academic period class no longer exists.");
    }
    const existingPeriods = await db.academicPeriods.where("classId").equals(classId).toArray();
    validateAcademicPeriodDraft(draft, existingPeriods);
    const now = new Date().toISOString();
    const period: AcademicPeriod = {
      id: crypto.randomUUID(),
      classId,
      name: draft.name.trim(),
      startDate: draft.startDate,
      endDate: draft.endDate,
      position: existingPeriods.length,
      status: "open",
      createdAt: now,
      updatedAt: now,
      closureVersion: 0
    };
    await db.academicPeriods.add(period);
    return period;
  });
}

export async function updateAcademicPeriod(
  periodId: string,
  draft: AcademicPeriodDraft
): Promise<void> {
  await db.transaction("rw", [db.academicPeriods, db.assessments], async () => {
    const period = await db.academicPeriods.get(periodId);
    if (!period) {
      throw new Error("Academic period not found.");
    }
    if (period.status === "closed") {
      throw new Error("Closed academic periods must be reopened before editing.");
    }
    const existingPeriods = await db.academicPeriods.where("classId").equals(period.classId).toArray();
    validateAcademicPeriodDraft(draft, existingPeriods, periodId);
    const assessments = await db.assessments.where("[classId+academicPeriodId]")
      .equals([period.classId, periodId]).toArray();
    if (assessments.some(assessment => assessment.assessmentDate &&
        (assessment.assessmentDate < draft.startDate || assessment.assessmentDate > draft.endDate))) {
      throw new Error("The academic period must include the dates of its assigned assessments.");
    }
    await db.academicPeriods.put({
      ...period,
      name: draft.name.trim(),
      startDate: draft.startDate,
      endDate: draft.endDate,
      updatedAt: new Date().toISOString()
    });
  });
}

async function requireOpenAssignmentPeriods(
  currentPeriodId: string | undefined,
  targetPeriodId: string | undefined,
  classId: string
): Promise<void> {
  const periodIds = Array.from(new Set([currentPeriodId, targetPeriodId].filter(Boolean))) as string[];
  const periods = periodIds.length > 0 ? await db.academicPeriods.where("id").anyOf(periodIds).toArray() : [];
  for (const period of periods) {
    if (period.classId !== classId) {
      throw new Error("The selected academic period belongs to another class.");
    }
    if (period.status === "closed") {
      throw new Error("Reopen the academic period before changing its assignments.");
    }
  }
  if (periodIds.some(id => !periods.some(period => period.id === id))) {
    throw new Error("Academic period not found.");
  }
}

export async function assignAssessmentToAcademicPeriod(
  assessmentId: string,
  academicPeriodId?: string
): Promise<void> {
  await db.transaction("rw", [db.assessments, db.academicPeriods], async () => {
    const assessment = await db.assessments.get(assessmentId);
    if (!assessment) {
      throw new Error("Assessment not found.");
    }
    await requireOpenAssignmentPeriods(
      assessment.academicPeriodId,
      academicPeriodId,
      assessment.classId
    );
    const targetPeriod = academicPeriodId
      ? await db.academicPeriods.get(academicPeriodId)
      : undefined;
    const assessmentDate =
      targetPeriod &&
      (!assessment.assessmentDate ||
        assessment.assessmentDate < targetPeriod.startDate ||
        assessment.assessmentDate > targetPeriod.endDate)
        ? targetPeriod.endDate
        : assessment.assessmentDate;
    await db.assessments.put({
      ...assessment,
      academicPeriodId,
      assessmentDate,
      period: targetPeriod?.name ?? assessment.period
    });
  });
}

export async function updateManualAssessmentDate(
  assessmentId: string,
  assessmentDate: string
): Promise<void> {
  await db.transaction("rw", [db.assessments, db.academicPeriods], async () => {
    const assessment = await db.assessments.get(assessmentId);
    if (!assessment) {
      throw new Error("Assessment not found.");
    }
    requireIsoDate(assessmentDate, "assessmentDate");
    const period = assessment.academicPeriodId
      ? await db.academicPeriods.get(assessment.academicPeriodId)
      : undefined;
    if (assessment.academicPeriodId && (!period || period.classId !== assessment.classId)) {
      throw new Error("The assessment's academic period no longer exists or belongs to another class.");
    }
    if (period?.status === "closed") {
      throw new Error("Reopen the academic period before changing an assessment date.");
    }
    if (period && (assessmentDate < period.startDate || assessmentDate > period.endDate)) {
      throw new Error("The assessment date must fall inside its academic period.");
    }
    await db.assessments.put({ ...assessment, assessmentDate });
  });
}

export async function assignTaskConfigToAcademicPeriod(
  configId: string,
  academicPeriodId?: string
): Promise<void> {
  await db.transaction("rw", [db.taskGradebookConfigs, db.academicPeriods], async () => {
    const config = await db.taskGradebookConfigs.get(configId);
    if (!config) {
      throw new Error("Task gradebook configuration not found.");
    }
    await requireOpenAssignmentPeriods(config.academicPeriodId, academicPeriodId, config.classId);
    await db.taskGradebookConfigs.put({ ...config, academicPeriodId });
  });
}

async function buildPeriodSnapshotData(period: AcademicPeriod): Promise<GradebookPeriodSnapshotData> {
  const classGroup = await db.classGroups.get(period.classId);
  if (!classGroup) {
    throw new Error("The academic period class no longer exists.");
  }
  const [
    students,
    subjectCourseLinks,
    assessments,
    taskGradebookConfigs,
    gradebookGroups
  ] = await Promise.all([
    db.students.where("classId").equals(period.classId).toArray(),
    db.subjectCourseLinks.where("classId").equals(period.classId).toArray(),
    db.assessments.where("[classId+academicPeriodId]").equals([period.classId, period.id]).toArray(),
    db.taskGradebookConfigs.where("[classId+academicPeriodId]").equals([period.classId, period.id]).toArray(),
    db.gradebookGroups.where("classId").equals(period.classId).toArray()
  ]);
  const studentIds = new Set(students.map((student) => student.id));
  const subjectIds = new Set(subjectCourseLinks.map((link) => link.subjectId));
  const taskIds = new Set(taskGradebookConfigs.map((config) => config.taskId));
  const assessmentIds = new Set(assessments.map((assessment) => assessment.id));
  const rubricIds = new Set(
    taskGradebookConfigs.flatMap((config) => config.rubricTemplateId ? [config.rubricTemplateId] : [])
  );
  const checklistIds = new Set(
    taskGradebookConfigs.flatMap((config) => config.checklistTemplateId ? [config.checklistTemplateId] : [])
  );
  const [
    subjects,
    subjectStudentLinks,
    gradeEntries,
    tasks,
    taskSubjectLinks,
    taskSessions,
    taskDailyEvaluationSettings,
    taskRubricAssessments,
    taskChecklistAssessments,
    taskDirectGrades,
    rubricTemplates,
    checklistTemplates
  ] = await Promise.all([
    db.subjects.where("id").anyOf(Array.from(subjectIds)).toArray(),
    db.subjectStudentLinks.filter(
      (link) => subjectIds.has(link.subjectId) && studentIds.has(link.studentId)
    ).toArray(),
    db.gradeEntries.filter((entry) => assessmentIds.has(entry.assessmentId)).toArray(),
    db.tasks.filter((task) => taskIds.has(task.id)).toArray(),
    db.taskSubjectLinks.filter(
      (link) => taskIds.has(link.taskId) && subjectIds.has(link.subjectId)
    ).toArray(),
    db.taskSessions.filter(
      (session) =>
        session.classId === period.classId &&
        taskIds.has(session.taskId) &&
        session.date >= period.startDate &&
        session.date <= period.endDate
    ).toArray(),
    db.taskDailyEvaluationSettings.filter(
      (setting) =>
        setting.classId === period.classId &&
        taskIds.has(setting.taskId) &&
        setting.date >= period.startDate &&
        setting.date <= period.endDate
    ).toArray(),
    db.taskRubricAssessments.filter(
      (row) =>
        row.classId === period.classId &&
        taskIds.has(row.taskId) &&
        row.date >= period.startDate &&
        row.date <= period.endDate
    ).toArray(),
    db.taskChecklistAssessments.filter(
      (row) =>
        row.classId === period.classId &&
        taskIds.has(row.taskId) &&
        row.date >= period.startDate &&
        row.date <= period.endDate
    ).toArray(),
    db.taskDirectGrades.filter(
      (row) => row.classId === period.classId && taskIds.has(row.taskId)
    ).toArray(),
    db.rubricTemplates.filter((template) => rubricIds.has(template.id)).toArray(),
    db.checklistTemplates.filter((template) => checklistIds.has(template.id)).toArray()
  ]);

  return {
    classGroup,
    students,
    subjects,
    subjectCourseLinks,
    subjectStudentLinks,
    assessments,
    gradeEntries,
    gradebookGroups: gradebookGroups.filter((group) => subjectIds.has(group.subjectId)),
    taskGradebookConfigs,
    tasks,
    taskSubjectLinks,
    taskSessions,
    taskDailyEvaluationSettings,
    taskRubricAssessments,
    taskChecklistAssessments,
    taskDirectGrades,
    rubricTemplates,
    checklistTemplates
  };
}

export async function closeAcademicPeriod(periodId: string): Promise<GradebookPeriodSnapshot> {
  return db.transaction("rw", db.tables, async () => {
    const period = await db.academicPeriods.get(periodId);
    if (!period) {
      throw new Error("Academic period not found.");
    }
    if (period.status === "closed") {
      throw new Error("The academic period is already closed.");
    }
    const snapshotData = await buildPeriodSnapshotData(period);
    const closure = buildPeriodClosureRecords(
      period,
      snapshotData,
      crypto.randomUUID(),
      new Date().toISOString()
    );
    await db.gradebookPeriodSnapshots.add(closure.snapshot);
    await db.academicPeriods.put(closure.period);
    return closure.snapshot;
  });
}

export async function reopenAcademicPeriod(periodId: string): Promise<void> {
  await db.transaction("rw", db.academicPeriods, async () => {
    const period = await db.academicPeriods.get(periodId);
    if (!period) {
      throw new Error("Academic period not found.");
    }
    if (period.status === "open") {
      return;
    }
    await db.academicPeriods.put(buildReopenedAcademicPeriod(period, new Date().toISOString()));
  });
}

async function loadRolloverSource(classId: string): Promise<SchoolYearRolloverSource> {
  const classGroup = await db.classGroups.get(classId);
  if (!classGroup) {
    throw new Error("Source class not found.");
  }
  const [students, subjectCourseLinks, gradebookGroups, assessments, rubricTemplates, checklistTemplates, academicPeriods] =
    await Promise.all([
      db.students.where("classId").equals(classId).toArray(),
      db.subjectCourseLinks.where("classId").equals(classId).toArray(),
      db.gradebookGroups.where("classId").equals(classId).toArray(),
      db.assessments.where("classId").equals(classId).toArray(),
      db.rubricTemplates.where("classId").equals(classId).toArray(),
      db.checklistTemplates.where("classId").equals(classId).toArray(),
      db.academicPeriods.where("classId").equals(classId).toArray()
    ]);
  const subjectIds = new Set(subjectCourseLinks.map((link) => link.subjectId));
  const studentIds = new Set(students.map((student) => student.id));
  const [subjects, subjectStudentLinks, units, taskSubjectLinks, taskGradebookConfigs] = await Promise.all([
    db.subjects.filter((subject) => subjectIds.has(subject.id)).toArray(),
    db.subjectStudentLinks.filter(
      (link) => subjectIds.has(link.subjectId) && studentIds.has(link.studentId)
    ).toArray(),
    db.unitBlocks.filter((unit) => subjectIds.has(unit.subjectId)).toArray(),
    db.taskSubjectLinks.filter((link) => subjectIds.has(link.subjectId)).toArray(),
    db.taskGradebookConfigs.where("classId").equals(classId).toArray()
  ]);
  const taskIds = new Set(taskSubjectLinks.map((link) => link.taskId));
  const tasks = await db.tasks.filter((task) => taskIds.has(task.id)).toArray();
  return {
    classGroup,
    students,
    subjects,
    subjectCourseLinks,
    subjectStudentLinks,
    units,
    tasks,
    taskSubjectLinks,
    taskGradebookConfigs,
    gradebookGroups,
    assessments,
    rubricTemplates,
    checklistTemplates,
    academicPeriods
  };
}

async function requireEmptyRolloverTarget(classId: string): Promise<ClassGroup> {
  const targetClass = await db.classGroups.get(classId);
  if (!targetClass) {
    throw new Error("Target class not found.");
  }
  const dependencyCounts = await Promise.all([
    db.students.where("classId").equals(classId).count(),
    db.subjectCourseLinks.where("classId").equals(classId).count(),
    db.assessments.where("classId").equals(classId).count(),
    db.gradebookGroups.where("classId").equals(classId).count(),
    db.gradeEntries.where("classId").equals(classId).count(),
    db.attendanceEntries.where("classId").equals(classId).count(),
    db.dailyClassRecords.where("classId").equals(classId).count(),
    db.taskGradebookConfigs.where("classId").equals(classId).count(),
    db.taskSessions.where("classId").equals(classId).count(),
    db.taskStudentComments.where("classId").equals(classId).count(),
    db.taskDailyEvaluationSettings.where("classId").equals(classId).count(),
    db.taskRubricAssessments.where("classId").equals(classId).count(),
    db.taskChecklistAssessments.where("classId").equals(classId).count(),
    db.taskDirectGrades.where("classId").equals(classId).count(),
    db.rubricTemplates.where("classId").equals(classId).count(),
    db.checklistTemplates.where("classId").equals(classId).count(),
    db.studentFollowUps.where("classId").equals(classId).count(),
    db.familyContacts.where("classId").equals(classId).count(),
    db.academicPeriods.where("classId").equals(classId).count(),
    db.gradebookPeriodSnapshots.where("classId").equals(classId).count()
  ]);
  if (dependencyCounts.some((count) => count > 0)) {
    throw new Error("The rollover target must be an empty class.");
  }
  return targetClass;
}

async function bulkAddIfAny<T>(
  table: Table<T, string>,
  rows: T[]
): Promise<void> {
  if (rows.length > 0) {
    await table.bulkAdd(rows);
  }
}

export async function rolloverSchoolYear(request: SchoolYearRolloverRequest): Promise<ClassGroup> {
  if (request.targetClassId === request.sourceClassId) {
    throw new Error("Source and target classes must be different.");
  }
  return db.transaction("rw", db.tables, async () => {
    const source = await loadRolloverSource(request.sourceClassId);
    const now = new Date().toISOString();
    const targetClass = request.targetClassId
      ? await requireEmptyRolloverTarget(request.targetClassId)
      : {
          id: crypto.randomUUID(),
          name: request.targetName.trim(),
          level: source.classGroup.level,
          schoolYear: request.targetSchoolYear.trim(),
          comments: source.classGroup.comments
        };
    if (!targetClass.name || !targetClass.schoolYear) {
      throw new Error("The target class requires a name and school year.");
    }
    const rows = buildSchoolYearRolloverRows(source, targetClass, () => crypto.randomUUID(), now);

    if (!request.targetClassId) {
      await db.classGroups.add(rows.classGroup);
    }
    await bulkAddIfAny(db.students, rows.students);
    await bulkAddIfAny(db.subjects, rows.subjects);
    await bulkAddIfAny(db.subjectCourseLinks, rows.subjectCourseLinks);
    await bulkAddIfAny(db.subjectStudentLinks, rows.subjectStudentLinks);
    await bulkAddIfAny(db.unitBlocks, rows.units);
    await bulkAddIfAny(db.tasks, rows.tasks);
    await bulkAddIfAny(db.taskSubjectLinks, rows.taskSubjectLinks);
    await bulkAddIfAny(db.gradebookGroups, rows.gradebookGroups);
    await bulkAddIfAny(db.academicPeriods, rows.academicPeriods);
    await bulkAddIfAny(db.rubricTemplates, rows.rubricTemplates);
    await bulkAddIfAny(db.checklistTemplates, rows.checklistTemplates);
    await bulkAddIfAny(db.taskGradebookConfigs, rows.taskGradebookConfigs);
    await bulkAddIfAny(db.assessments, rows.assessments);
    return rows.classGroup;
  });
}
