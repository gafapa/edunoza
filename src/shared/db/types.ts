export type Subject = {
  id: string;
  name: string;
  teachingHours?: string;
  scheduleSlotIds: string[];
};

export type UnitBlock = {
  id: string;
  subjectId: string;
  name: string;
  description: string;
  sessionCount: number;
  position: number;
};


export type ScheduleBlock = {
  id: string;
  startTime: string;
  endTime: string;
  isBreak?: boolean;
};

export type ScheduleDay = {
  id: string;
  dayOfWeek: number;
  dayName: string;
  enabled: boolean;
  blocks: ScheduleBlock[];
};

export type ScheduleSettings = {
  id: string;
  defaultBlockDurationMinutes: number;
};

export type AppPreferences = {
  id: string;
  studentSortBy: "lastName" | "firstName";
  studentNameFormat: "firstLast" | "lastFirst";
  weekStartsOn: "monday" | "sunday";
  notSubmittedGradePolicy?: "exclude" | "zero";
};

export type ClassGroup = {
  id: string;
  name: string;
  level: string;
  schoolYear: string;
  comments?: string;
};

export type Student = {
  id: string;
  personId?: string;
  classId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  comments?: string;
  photoDataUrl?: string;
  email?: string;
  hasAcs?: boolean;
  hasReinforcement?: boolean;
};

export type Assessment = {
  id: string;
  classId: string;
  subjectId: string;
  academicPeriodId?: string;
  assessmentDate?: string;
  title: string;
  weight: number;
  period: string;
  groupId?: string;
  competency?: string;
};

export type GradeEntry = {
  id: string;
  classId: string;
  assessmentId: string;
  studentId: string;
  numericValue?: number;
  textValue?: string;
  colorTag?: string;
  iconTag?: string;
  comment?: string;
  status?: "graded" | "pending" | "notSubmitted" | "exempt";
};

export type AttendanceEntry = {
  id: string;
  classId: string;
  subjectId: string;
  studentId: string;
  date: string;
  scheduleSlotId: string;
  startTime?: string;
  endTime?: string;
  status: "present" | "late" | "absent";
  absenceJustified?: boolean;
  lateMinutes?: number;
  earlyDepartureMinutes?: number;
  note?: string;
  createdAt: string;
  updatedAt: string;
};

export type DailyClassRecord = {
  id: string;
  classId: string;
  subjectId: string;
  date: string;
  scheduleSlotId: string;
  sessionKind?: "adHoc" | "rescheduled";
  sessionTitle?: string;
  startTime?: string;
  endTime?: string;
  originalDate?: string;
  originalScheduleSlotId?: string;
  generalComment: string;
  studentComments: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

/** Reusable task definition. Subject, unit, and gradebook settings live in related tables. */
export type Task = {
  id: string;
  title: string;
  description: string;
  sessionCount: number;
  sendToGradebook: boolean;
};

/** Links a task to a subject and optionally to a unit. */
export type TaskSubjectLink = {
  id: string;
  taskId: string;
  subjectId: string;
  unitId?: string;
};

export type TaskGradebookConfig = {
  id: string;
  taskId: string;
  subjectId: string;
  classId: string;
  academicPeriodId?: string;
  gradebookWeight: number;
  groupId?: string;
  rubricTemplateId?: string;
  checklistTemplateId?: string;
  directGradeEnabled?: boolean;
};

export type GradebookGroup = {
  id: string;
  classId: string;
  subjectId: string;
  name: string;
  parentId?: string;
  position: number;
  weight?: number;
};

export type AcademicPeriodStatus = "open" | "closed";

export type AcademicPeriod = {
  id: string;
  classId: string;
  name: string;
  startDate: string;
  endDate: string;
  position: number;
  status: AcademicPeriodStatus;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  reopenedAt?: string;
  currentSnapshotId?: string;
  closureVersion: number;
};

export type GradebookPeriodSnapshotData = {
  classGroup: ClassGroup;
  students: Student[];
  subjects: Subject[];
  subjectCourseLinks: SubjectCourseLink[];
  subjectStudentLinks: SubjectStudentLink[];
  assessments: Assessment[];
  gradeEntries: GradeEntry[];
  gradebookGroups: GradebookGroup[];
  taskGradebookConfigs: TaskGradebookConfig[];
  tasks: Task[];
  taskSubjectLinks: TaskSubjectLink[];
  taskSessions: TaskSession[];
  taskDailyEvaluationSettings: TaskDailyEvaluationSetting[];
  taskRubricAssessments: TaskRubricAssessment[];
  taskChecklistAssessments: TaskChecklistAssessment[];
  taskDirectGrades: TaskDirectGrade[];
  rubricTemplates: RubricTemplate[];
  checklistTemplates: ChecklistTemplate[];
};

export type GradebookPeriodSnapshot = {
  id: string;
  academicPeriodId: string;
  classId: string;
  version: number;
  createdAt: string;
  data: GradebookPeriodSnapshotData;
};

export type TaskSession = {
  id: string;
  taskId: string;
  subjectId: string;
  /** Class group for this planned session; the same task may have different sessions per class. */
  classId: string;
  date: string;
  scheduleSlotId: string;
  status: "planned" | "done" | "moved" | "cancelled";
  objectives?: string;
  competencies?: string;
  materials?: string;
  homework?: string;
  teacherNotes?: string;
};

export type TaskStudentComment = {
  id: string;
  taskId: string;
  subjectId: string;
  classId: string;
  date: string;
  scheduleSlotId: string;
  studentId: string;
  comment: string;
};

export type TaskDailyEvaluationSetting = {
  id: string;
  taskId: string;
  subjectId: string;
  classId: string;
  date: string;
  scheduleSlotId: string;
  generalComment?: string;
  rubricTemplateId?: string;
  checklistTemplateId?: string;
};

export type TaskRubricAssessment = {
  id: string;
  taskId: string;
  subjectId: string;
  classId: string;
  date: string;
  scheduleSlotId: string;
  studentId: string;
  rubricTemplateId: string;
  criterionId: string;
  levelId: string;
  score: number;
};

export type TaskChecklistAssessment = {
  id: string;
  taskId: string;
  subjectId: string;
  classId: string;
  date: string;
  scheduleSlotId: string;
  studentId: string;
  checklistTemplateId: string;
  itemId: string;
  checked: boolean;
};

export type TaskDirectGrade = {
  id: string;
  taskId: string;
  subjectId: string;
  classId: string;
  studentId: string;
  score: number;
};

export type RubricTemplate = {
  id: string;
  classId: string;
  taskId?: string;
  name: string;
  description?: string;
  criteria?: RubricCriterion[];
  levels?: RubricLevel[];
  criteriaCount?: number;
  levelCount?: number;
};

export type RubricCriterion = {
  id: string;
  name: string;
  description?: string;
  levels?: RubricLevel[];
};

export type RubricLevel = {
  id: string;
  name: string;
  score: number;
};

export type ChecklistTemplate = {
  id: string;
  classId: string;
  taskId?: string;
  name: string;
  description?: string;
  items?: ChecklistItem[];
};

export type ChecklistItem = {
  id: string;
  text: string;
};

export type SubjectCourseLink = {
  id: string;
  subjectId: string;
  classId: string;
};

export type SubjectStudentLink = {
  id: string;
  subjectId: string;
  studentId: string;
};

export type StudentFollowUpKind = "incident" | "family" | "tutorial" | "agreement" | "adaptation" | "wellbeing";
export type FollowUpPriority = "low" | "normal" | "high";
export type FollowUpStatus = "open" | "inProgress" | "done";

export type StudentFollowUp = {
  id: string;
  studentId: string;
  classId: string;
  date: string;
  kind: StudentFollowUpKind;
  title: string;
  notes: string;
  nextStep?: string;
  dueDate?: string;
  responsiblePerson?: string;
  priority?: FollowUpPriority;
  status?: FollowUpStatus;
  resolved: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type BehaviorMarkKind = "positive" | "negative";

/** A single quick tap logging in-class behavior - lighter weight than a StudentFollowUp. */
export type BehaviorMark = {
  id: string;
  studentId: string;
  classId: string;
  subjectId?: string;
  date: string;
  kind: BehaviorMarkKind;
  note?: string;
  createdAt: string;
};

export type FamilyContactChannel = "phone" | "email" | "meeting" | "message" | "other";

export type FamilyContact = {
  id: string;
  studentId: string;
  classId: string;
  date: string;
  channel: FamilyContactChannel;
  contactName: string;
  relationship: string;
  summary: string;
  agreements?: string;
  nextStep?: string;
  dueDate?: string;
  responsiblePerson?: string;
  createdAt: string;
  updatedAt: string;
};

export type SupportGroup = {
  id: string;
  name: string;
  responsiblePerson: string;
  focus?: string;
  createdAt: string;
  updatedAt: string;
};

export type SupportGroupMember = {
  id: string;
  supportGroupId: string;
  studentId: string;
  createdAt: string;
};

export type ResourceOwnerType = "student" | "task" | "journalEntry";
export type ResourceKind = "file" | "link";

/** A local file or web link attached to a student profile or reusable task. */
export type ResourceAttachment = {
  id: string;
  ownerType: ResourceOwnerType;
  ownerId: string;
  kind: ResourceKind;
  title: string;
  url?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  dataBase64?: string;
  createdAt: string;
  updatedAt: string;
};

/** One persistent seating layout for a class group. */
export type ClassroomLayout = {
  id: string;
  classId: string;
  rows: number;
  columns: number;
  assignments: Record<string, number>;
  createdAt: string;
  updatedAt: string;
};

export type FeedbackCommentCategory = "attendance" | "work" | "gradebook" | "general";

/** Reusable teacher-authored feedback; never applied automatically. */
export type FeedbackComment = {
  id: string;
  category: FeedbackCommentCategory;
  text: string;
  createdAt: string;
  updatedAt: string;
};
