import Dexie, { type Table } from "dexie";
import type { SavedAiReport } from "../reports/aiReportArchive";
import type { MoodleBinding, MoodleConnection, MoodleOperation } from "../moodle/types";
import type {
  AcademicPeriod,
  Assessment,
  AppPreferences,
  AttendanceEntry,
  ChecklistTemplate,
  ClassGroup,
  ClassroomLayout,
  DailyClassRecord,
  FamilyContact,
  FeedbackComment,
  GradebookGroup,
  GradebookPeriodSnapshot,
  GradeEntry,
  Task,
  TaskChecklistAssessment,
  TaskDailyEvaluationSetting,
  TaskRubricAssessment,
  TaskSession,
  TaskStudentComment,
  TaskSubjectLink,
  TaskGradebookConfig,
  TaskDirectGrade,
  RubricTemplate,
  ResourceAttachment,
  BehaviorMark,
  ScheduleDay,
  ScheduleSettings,
  UnitBlock,
  SubjectCourseLink,
  SubjectStudentLink,
  Subject,
  Student,
  StudentFollowUp,
  SupportGroup,
  SupportGroupMember
} from "./types";

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

function academicYearBounds(schoolYear: string): { start: Date; end: Date } {
  const match = schoolYear.match(/^(\d{4})-(\d{4})$/);
  const startYear = match ? Number(match[1]) : new Date().getFullYear();
  const endYear = match ? Number(match[2]) : startYear + 1;
  return {
    start: new Date(Date.UTC(startYear, 8, 1)),
    end: new Date(Date.UTC(endYear, 5, 30))
  };
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

class EdunozaDB extends Dexie {
  aiReports!: Table<SavedAiReport, string>;
  moodleConnections!: Table<MoodleConnection, string>;
  moodleBindings!: Table<MoodleBinding, string>;
  moodleOperations!: Table<MoodleOperation, string>;
  subjects!: Table<Subject, string>;
  classGroups!: Table<ClassGroup, string>;
  students!: Table<Student, string>;
  assessments!: Table<Assessment, string>;
  gradebookGroups!: Table<GradebookGroup, string>;
  gradeEntries!: Table<GradeEntry, string>;
  attendanceEntries!: Table<AttendanceEntry, string>;
  dailyClassRecords!: Table<DailyClassRecord, string>;
  rubricTemplates!: Table<RubricTemplate, string>;
  checklistTemplates!: Table<ChecklistTemplate, string>;
  subjectCourseLinks!: Table<SubjectCourseLink, string>;
  subjectStudentLinks!: Table<SubjectStudentLink, string>;
  scheduleDays!: Table<ScheduleDay, string>;
  scheduleSettings!: Table<ScheduleSettings, string>;
  unitBlocks!: Table<UnitBlock, string>;
  tasks!: Table<Task, string>;
  taskSubjectLinks!: Table<TaskSubjectLink, string>;
  taskGradebookConfigs!: Table<TaskGradebookConfig, string>;
  taskSessions!: Table<TaskSession, string>;
  taskStudentComments!: Table<TaskStudentComment, string>;
  taskDailyEvaluationSettings!: Table<TaskDailyEvaluationSetting, string>;
  taskRubricAssessments!: Table<TaskRubricAssessment, string>;
  taskChecklistAssessments!: Table<TaskChecklistAssessment, string>;
  taskDirectGrades!: Table<TaskDirectGrade, string>;
  appPreferences!: Table<AppPreferences, string>;
  studentFollowUps!: Table<StudentFollowUp, string>;
  academicPeriods!: Table<AcademicPeriod, string>;
  gradebookPeriodSnapshots!: Table<GradebookPeriodSnapshot, string>;
  familyContacts!: Table<FamilyContact, string>;
  supportGroups!: Table<SupportGroup, string>;
  supportGroupMembers!: Table<SupportGroupMember, string>;
  resourceAttachments!: Table<ResourceAttachment, string>;
  classroomLayouts!: Table<ClassroomLayout, string>;
  feedbackComments!: Table<FeedbackComment, string>;
  behaviorMarks!: Table<BehaviorMark, string>;

  constructor() {
    // Keep the legacy database name so same-origin upgrades retain existing records.
    super("profeplus-db");
    this.version(1).stores({
      subjects: "id,name",
      classGroups: "id,name,schoolYear",
      students: "id,classId,fullName",
      assessments:
        "id,classId,subjectId,title,period,groupId,[classId+groupId],[classId+subjectId]",
      gradebookGroups:
        "id,classId,subjectId,parentId,position,[classId+parentId],[classId+subjectId],[classId+subjectId+parentId]",
      gradeEntries: "id,classId,assessmentId,studentId,[classId+studentId]",
      attendanceEntries:
        "id,classId,subjectId,studentId,date,status,scheduleSlotId,[classId+date],[classId+date+scheduleSlotId],[classId+subjectId+date]",
      dailyClassRecords:
        "id,classId,subjectId,date,scheduleSlotId,[classId+date],[classId+subjectId+date],[classId+subjectId+date+scheduleSlotId]",
      unitBlocks: "id,subjectId,position,name,[subjectId+position]",
      tasks: "id,sendToGradebook",
      taskSubjectLinks: "id,taskId,subjectId,unitId,[taskId+subjectId],[subjectId+taskId]",
      taskGradebookConfigs:
        "id,taskId,subjectId,classId,gradebookWeight,groupId,rubricTemplateId,checklistTemplateId,directGradeEnabled,[classId+subjectId],[taskId+subjectId+classId],[taskId+classId]",
      taskSessions:
        "id,taskId,subjectId,classId,date,scheduleSlotId,[taskId+date],[subjectId+date],[subjectId+classId],[taskId+classId],[subjectId+date+scheduleSlotId]",
      taskStudentComments:
        "id,taskId,subjectId,classId,date,scheduleSlotId,studentId,[taskId+studentId],[taskId+classId+subjectId],[taskId+classId+subjectId+date+scheduleSlotId],[taskId+classId+subjectId+date+scheduleSlotId+studentId]",
      taskDailyEvaluationSettings:
        "id,taskId,subjectId,classId,date,scheduleSlotId,rubricTemplateId,checklistTemplateId,[taskId+date],[taskId+date+scheduleSlotId],[taskId+classId+subjectId+date+scheduleSlotId]",
      taskRubricAssessments:
        "id,taskId,subjectId,classId,date,scheduleSlotId,studentId,rubricTemplateId,criterionId,levelId,[taskId+date],[taskId+date+scheduleSlotId],[taskId+date+studentId],[taskId+date+scheduleSlotId+studentId],[taskId+date+scheduleSlotId+studentId+criterionId],[taskId+classId+subjectId+date+scheduleSlotId]",
      taskChecklistAssessments:
        "id,taskId,subjectId,classId,date,scheduleSlotId,studentId,checklistTemplateId,itemId,checked,[taskId+date],[taskId+date+scheduleSlotId],[taskId+date+studentId],[taskId+date+scheduleSlotId+studentId],[taskId+date+scheduleSlotId+studentId+itemId],[taskId+classId+subjectId+date+scheduleSlotId]",
      taskDirectGrades:
        "id,taskId,subjectId,classId,studentId,[taskId+studentId],[taskId+subjectId+classId],[classId+studentId]",
      rubricTemplates: "id,classId,taskId,name,[classId+taskId]",
      checklistTemplates: "id,classId,taskId,name,[classId+taskId]",
      subjectCourseLinks: "id,subjectId,classId,[subjectId+classId]",
      subjectStudentLinks: "id,subjectId,studentId,[subjectId+studentId]",
      scheduleDays: "id,dayOfWeek,enabled",
      scheduleSettings: "id",
      appPreferences: "id",
      studentFollowUps: "id,studentId,classId,date,kind,resolved,[studentId+date],[classId+date]"
    });
    this.version(2).stores({
      subjects: "id,name",
      classGroups: "id,name,schoolYear",
      students: "id,classId,fullName",
      assessments:
        "id,classId,subjectId,academicPeriodId,assessmentDate,title,period,groupId,[classId+groupId],[classId+subjectId],[classId+academicPeriodId],[classId+assessmentDate]",
      gradebookGroups:
        "id,classId,subjectId,parentId,position,[classId+parentId],[classId+subjectId],[classId+subjectId+parentId]",
      gradeEntries: "id,classId,assessmentId,studentId,[classId+studentId]",
      attendanceEntries:
        "id,classId,subjectId,studentId,date,status,scheduleSlotId,[classId+date],[classId+date+scheduleSlotId],[classId+subjectId+date]",
      dailyClassRecords:
        "id,classId,subjectId,date,scheduleSlotId,[classId+date],[classId+subjectId+date],[classId+subjectId+date+scheduleSlotId]",
      unitBlocks: "id,subjectId,position,name,[subjectId+position]",
      tasks: "id,sendToGradebook",
      taskSubjectLinks: "id,taskId,subjectId,unitId,[taskId+subjectId],[subjectId+taskId]",
      taskGradebookConfigs:
        "id,taskId,subjectId,classId,academicPeriodId,gradebookWeight,groupId,rubricTemplateId,checklistTemplateId,directGradeEnabled,[classId+subjectId],[classId+academicPeriodId],[taskId+subjectId+classId],[taskId+classId]",
      taskSessions:
        "id,taskId,subjectId,classId,date,scheduleSlotId,[taskId+date],[subjectId+date],[subjectId+classId],[taskId+classId],[subjectId+date+scheduleSlotId]",
      taskStudentComments:
        "id,taskId,subjectId,classId,date,scheduleSlotId,studentId,[taskId+studentId],[taskId+classId+subjectId],[taskId+classId+subjectId+date+scheduleSlotId],[taskId+classId+subjectId+date+scheduleSlotId+studentId]",
      taskDailyEvaluationSettings:
        "id,taskId,subjectId,classId,date,scheduleSlotId,rubricTemplateId,checklistTemplateId,[taskId+date],[taskId+date+scheduleSlotId],[taskId+classId+subjectId+date+scheduleSlotId]",
      taskRubricAssessments:
        "id,taskId,subjectId,classId,date,scheduleSlotId,studentId,rubricTemplateId,criterionId,levelId,[taskId+date],[taskId+date+scheduleSlotId],[taskId+date+studentId],[taskId+date+scheduleSlotId+studentId],[taskId+date+scheduleSlotId+studentId+criterionId],[taskId+classId+subjectId+date+scheduleSlotId]",
      taskChecklistAssessments:
        "id,taskId,subjectId,classId,date,scheduleSlotId,studentId,checklistTemplateId,itemId,checked,[taskId+date],[taskId+date+scheduleSlotId],[taskId+date+studentId],[taskId+date+scheduleSlotId+studentId],[taskId+date+scheduleSlotId+studentId+itemId],[taskId+classId+subjectId+date+scheduleSlotId]",
      taskDirectGrades:
        "id,taskId,subjectId,classId,studentId,[taskId+studentId],[taskId+subjectId+classId],[classId+studentId]",
      rubricTemplates: "id,classId,taskId,name,[classId+taskId]",
      checklistTemplates: "id,classId,taskId,name,[classId+taskId]",
      subjectCourseLinks: "id,subjectId,classId,[subjectId+classId]",
      subjectStudentLinks: "id,subjectId,studentId,[subjectId+studentId]",
      scheduleDays: "id,dayOfWeek,enabled",
      scheduleSettings: "id",
      appPreferences: "id",
      studentFollowUps: "id,studentId,classId,date,kind,resolved,[studentId+date],[classId+date]",
      academicPeriods: "id,classId,status,position,[classId+position],[classId+status]",
      gradebookPeriodSnapshots:
        "id,academicPeriodId,classId,version,createdAt,[academicPeriodId+version],[classId+createdAt]"
    }).upgrade(async (transaction) => {
      const classGroups = await transaction.table<ClassGroup, string>("classGroups").toArray();
      const assessments = await transaction.table<Assessment, string>("assessments").toArray();
      const periodsToCreate: AcademicPeriod[] = [];
      const assessmentsToUpdate: Assessment[] = [];
      const now = new Date().toISOString();

      for (const classGroup of classGroups) {
        const classAssessments = assessments.filter((assessment) => assessment.classId === classGroup.id);
        if (classAssessments.length === 0) continue;
        const labels = Array.from(
          new Set(classAssessments.map((assessment) => assessment.period.trim() || "Imported assessments"))
        ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const bounds = academicYearBounds(classGroup.schoolYear);
        const totalDays = Math.floor((bounds.end.getTime() - bounds.start.getTime()) / DAY_IN_MILLISECONDS) + 1;
        const periodIdByLabel = new Map<string, string>();
        const periodEndByLabel = new Map<string, string>();

        labels.forEach((label, index) => {
          const startOffset = Math.floor((index * totalDays) / labels.length);
          const endOffset = Math.floor(((index + 1) * totalDays) / labels.length) - 1;
          const startDate = new Date(bounds.start.getTime() + startOffset * DAY_IN_MILLISECONDS);
          const endDate = new Date(bounds.start.getTime() + endOffset * DAY_IN_MILLISECONDS);
          const id = crypto.randomUUID();
          periodIdByLabel.set(label, id);
          periodEndByLabel.set(label, toIsoDate(endDate));
          periodsToCreate.push({
            id,
            classId: classGroup.id,
            name: label,
            startDate: toIsoDate(startDate),
            endDate: toIsoDate(endDate),
            position: index,
            status: "open",
            createdAt: now,
            updatedAt: now,
            closureVersion: 0
          });
        });

        for (const assessment of classAssessments) {
          const label = assessment.period.trim() || "Imported assessments";
          assessmentsToUpdate.push({
            ...assessment,
            academicPeriodId: periodIdByLabel.get(label),
            assessmentDate: periodEndByLabel.get(label)
          });
        }
      }

      if (periodsToCreate.length > 0) {
        await transaction.table<AcademicPeriod, string>("academicPeriods").bulkAdd(periodsToCreate);
      }
      if (assessmentsToUpdate.length > 0) {
        await transaction.table<Assessment, string>("assessments").bulkPut(assessmentsToUpdate);
      }
    });
    this.version(3).stores({
      students: "id,personId,classId,fullName",
      studentFollowUps:
        "id,studentId,classId,date,kind,resolved,status,dueDate,priority,responsiblePerson,[studentId+date],[classId+date],[status+dueDate]",
      familyContacts:
        "id,studentId,classId,date,channel,dueDate,responsiblePerson,[studentId+date],[classId+date]",
      supportGroups: "id,name,responsiblePerson",
      supportGroupMembers:
        "id,supportGroupId,studentId,[supportGroupId+studentId],[studentId+supportGroupId]"
    }).upgrade(async (transaction) => {
      const studentsTable = transaction.table("students");
      const rows = (await studentsTable.toArray()) as Student[];
      await studentsTable.bulkPut(
        rows.map((student) => ({
          ...student,
          personId: student.personId ?? student.id
        }))
      );
    });
    this.version(4).stores({
      resourceAttachments:
        "id,ownerType,ownerId,kind,createdAt,[ownerType+ownerId]"
    });
    this.version(5).stores({
      classroomLayouts: "id,&classId,updatedAt"
    });
    this.version(6).stores({
      feedbackComments: "id,category,updatedAt"
    });
    this.version(7).stores({ aiReports: "id,reportId,classId,createdAt" });
    this.version(8).stores({
      moodleConnections: "id,&[server+userId],updatedAt",
      moodleBindings:
        "id,connectionId,courseId,remoteGroupId,classId,subjectId,kind,remoteId,localId,[connectionId+courseId],[connectionId+courseId+kind+remoteId],[connectionId+courseId+classId+subjectId]",
      moodleOperations: "id,connectionId,createdAt,kind,[connectionId+createdAt]"
    });
    this.version(9).stores({
      behaviorMarks: "id,studentId,classId,subjectId,date,kind,createdAt,[studentId+date],[classId+date]"
    });
    this.version(10).stores({
      resourceAttachments: "id,ownerType,ownerId,kind,createdAt,[ownerType+ownerId],[kind+sizeBytes]"
    });
  }
}

export const db = new EdunozaDB();
