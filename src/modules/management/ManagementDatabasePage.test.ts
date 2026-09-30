import { describe, expect, it } from "vitest";
import { db } from "../../shared/db/database";
import { DATABASE_SCHEMA_VERSION, validateDatabasePayload } from "../../shared/backup/database";

function emptyTables(): Record<string, unknown[]> {
  return Object.fromEntries(db.tables.map((table) => [table.name, []]));
}

it("accepts older backups without the optional AI history table", () => {
  const payload = validPayload();
  delete (payload.tables as Record<string, unknown[]>).aiReports;
  expect(() => validateDatabasePayload(payload)).not.toThrow();
});

it("accepts backups created before optional classroom behavior records were added", () => {
  const payload = validPayload();
  delete (payload.tables as Record<string, unknown[]>).behaviorMarks;
  expect(validateDatabasePayload(payload).behaviorMarks).toEqual([]);
});

it("rejects malformed archived AI reports", () => {
  expect(() => validateDatabasePayload(validPayload({ aiReports: [{ id: "broken", text: 42 }] }))).toThrow(/aiReports/);
});

it("accepts schema 6 backups without Moodle metadata", () => {
  const payload = validPayload();
  payload.schemaVersion = 6;
  const tables = payload.tables as Record<string, unknown[]>;
  delete tables.moodleConnections;
  delete tables.moodleBindings;
  delete tables.moodleOperations;
  expect(validateDatabasePayload(payload).moodleBindings).toEqual([]);
});

it("accepts secret-free and internally consistent Moodle metadata", () => {
  const connection = {
    id: "moodle-connection-1", server: "https://moodle.example.org", userId: 42,
    siteName: "School Moodle", userName: "Teacher", functions: ["core_webservice_get_site_info"],
    createdAt: "2026-05-22T00:00:00.000Z", updatedAt: "2026-05-22T00:00:00.000Z"
  };
  const common = {
    connectionId: connection.id, courseId: 12, classId: "class-1", subjectId: "subject-1",
    updatedAt: "2026-05-22T00:00:00.000Z"
  };
  const payload = validPayload({
    moodleConnections: [connection],
    moodleBindings: [
      { id: "course-binding", ...common, kind: "course", remoteId: 12, localId: "class-1", remoteLabel: "Maths",
        localBaseline: {}, remoteBaseline: { fullName: "Maths", shortName: "MATH" } },
      { id: "student-binding", ...common, kind: "student", remoteId: 88, localId: "student-1", remoteLabel: "Ana Lopez",
        localBaseline: { fullName: "Ana Lopez" }, remoteBaseline: { fullName: "Ana Lopez" } },
      { id: "activity-binding", ...common, kind: "activity", remoteId: 99, localId: "task-1", remoteLabel: "Quiz",
        localBaseline: { title: "Tarea" }, remoteBaseline: { title: "Quiz", url: "https://moodle.example.org/mod/assign/view.php?id=99", dueDate: 1770000000 } }
    ],
    moodleOperations: [{ id: "operation-1", connectionId: connection.id, createdAt: "2026-05-22T00:00:00.000Z", kind: "grades", summary: "Imported", count: 1 }]
  });
  expect(() => validateDatabasePayload(payload)).not.toThrow();
});

it.each([
  { table: "moodleConnections", field: "token" },
  { table: "moodleConnections", field: "password" }
])("rejects $field in persisted Moodle metadata", ({ table, field }) => {
  const payload = validPayload({
    [table]: [{ id: "connection-1", server: "https://moodle.example.org", userId: 42, siteName: "School",
      userName: "Teacher", functions: [], createdAt: "2026-05-22T00:00:00.000Z", updatedAt: "2026-05-22T00:00:00.000Z", [field]: "secret" }]
  });
  expect(() => validateDatabasePayload(payload)).toThrow(/campos no permitidos/);
});

it("rejects outbound Moodle operation metadata", () => {
  const payload = validPayload({
    moodleConnections: [{ id: "connection-1", server: "https://moodle.example.org", userId: 42, siteName: "School",
      userName: "Teacher", functions: [], createdAt: "2026-05-22T00:00:00.000Z", updatedAt: "2026-05-22T00:00:00.000Z" }],
    moodleOperations: [{ id: "operation-1", connectionId: "connection-1", createdAt: "2026-05-22T00:00:00.000Z", kind: "publish", summary: "Sent", count: 1 }]
  });
  expect(() => validateDatabasePayload(payload)).toThrow(/tipo de operación/);
});

it("rejects credentials hidden in Moodle activity-link metadata", () => {
  const connection = { id: "connection-1", server: "https://moodle.example.org", userId: 42, siteName: "School",
    userName: "Teacher", functions: [], createdAt: "2026-05-22T00:00:00.000Z", updatedAt: "2026-05-22T00:00:00.000Z" };
  const payload = validPayload({
    moodleConnections: [connection],
    moodleBindings: [{ id: "binding-1", connectionId: connection.id, courseId: 12, classId: "class-1", subjectId: "subject-1",
      kind: "activity", remoteId: 99, localId: "task-1", remoteLabel: "Quiz", localBaseline: { title: "Tarea" },
      remoteBaseline: { title: "Quiz", url: "https://moodle.example.org/mod/assign/view.php?id=99&wstoken=secret", dueDate: null },
      updatedAt: "2026-05-22T00:00:00.000Z" }]
  });
  expect(() => validateDatabasePayload(payload)).toThrow(/sensibles/);
});

function validPayload(overrides: Record<string, unknown[]> = {}) {
  const classId = "class-1";
  const studentId = "student-1";
  const subjectId = "subject-1";
  const taskId = "task-1";
  const slotId = "slot-1";
  const rubricTemplateId = "rubric-1";
  const checklistTemplateId = "checklist-1";

  return {
    app: "Edunoza",
    schemaVersion: DATABASE_SCHEMA_VERSION,
    exportedAt: "2026-05-22T00:00:00.000Z",
    tables: {
      ...emptyTables(),
      classGroups: [{ id: classId, name: "1 ESO A", level: "ESO", schoolYear: "2025-2026" }],
      students: [
        {
          id: studentId,
          classId,
          firstName: "Ana",
          lastName: "Lopez",
          fullName: "Ana Lopez"
        }
      ],
      subjects: [{ id: subjectId, name: "Matematicas", scheduleSlotIds: [slotId] }],
      subjectCourseLinks: [{ id: "subject-course-1", subjectId, classId }],
      subjectStudentLinks: [{ id: "subject-student-1", subjectId, studentId }],
      scheduleDays: [
        {
          id: "day-1",
          dayOfWeek: 5,
          dayName: "Viernes",
          enabled: true,
          blocks: [{ id: slotId, startTime: "09:00", endTime: "10:00" }]
        }
      ],
      tasks: [{ id: taskId, title: "Tarea", description: "", sessionCount: 1, sendToGradebook: true }],
      taskSubjectLinks: [{ id: "task-subject-1", taskId, subjectId }],
      taskSessions: [
        {
          id: "session-1",
          taskId,
          subjectId,
          classId,
          date: "2026-05-22",
          scheduleSlotId: slotId,
          status: "planned"
        }
      ],
      rubricTemplates: [
        {
          id: rubricTemplateId,
          classId,
          taskId,
          name: "Rubrica",
          criteria: [
            {
              id: "criterion-1",
              name: "Criterio",
              levels: [
                { id: "level-1", name: "Nivel alto", score: 2 },
                { id: "level-2", name: "Nivel bajo", score: 1 }
              ]
            }
          ]
        }
      ],
      checklistTemplates: [
        {
          id: checklistTemplateId,
          classId,
          taskId,
          name: "Lista",
          items: [{ id: "item-1", text: "Item" }]
        }
      ],
      ...overrides
    }
  };
}

describe("database payload validation", () => {
  it.each(["direct", "rubric", "checklist", "none"])("accepts the %s grading method without requiring other instruments", (method) => {
    const payload = validPayload({
      taskGradebookConfigs: [{
        id: "config-1", classId: "class-1", subjectId: "subject-1", taskId: "task-1", gradebookWeight: 100,
        directGradeEnabled: method === "direct",
        ...(method === "rubric" ? { rubricTemplateId: "rubric-1" } : {}),
        ...(method === "checklist" ? { checklistTemplateId: "checklist-1" } : {})
      }]
    });
    expect(() => validateDatabasePayload(payload)).not.toThrow();
  });

  it("still rejects an instrument owned by another task", () => {
    const payload = validPayload({
      tasks: [
        { id: "task-1", title: "Task", description: "", sessionCount: 1, sendToGradebook: true },
        { id: "other-task", title: "Other", description: "", sessionCount: 1, sendToGradebook: true }
      ],
      taskGradebookConfigs: [{ id: "config-1", classId: "class-1", subjectId: "subject-1", taskId: "task-1", gradebookWeight: 100, rubricTemplateId: "rubric-1" }]
    });
    payload.tables.rubricTemplates[0].taskId = "other-task";
    expect(() => validateDatabasePayload(payload)).toThrow(/rubrica incompatible/);
  });

  it("defines only the current clean database tables", () => {
    expect(db.name).toBe("profeplus-db");
    expect(db.verno).toBe(10);
    expect(db.tables.map((table) => table.name).sort()).toEqual([
      "academicPeriods",
      "aiReports",
      "appPreferences",
      "assessments",
      "attendanceEntries",
      "behaviorMarks",
      "checklistTemplates",
      "classGroups",
      "classroomLayouts",
      "dailyClassRecords",
      "familyContacts",
      "feedbackComments",
      "gradeEntries",
      "gradebookGroups",
      "gradebookPeriodSnapshots",
      "moodleBindings",
      "moodleConnections",
      "moodleOperations",
      "resourceAttachments",
      "rubricTemplates",
      "scheduleDays",
      "scheduleSettings",
      "studentFollowUps",
      "students",
      "subjectCourseLinks",
      "subjectStudentLinks",
      "subjects",
      "supportGroupMembers",
      "supportGroups",
      "taskChecklistAssessments",
      "taskDailyEvaluationSettings",
      "taskDirectGrades",
      "taskGradebookConfigs",
      "taskRubricAssessments",
      "taskSessions",
      "taskStudentComments",
      "taskSubjectLinks",
      "tasks",
      "unitBlocks"
    ]);
  });

  it("accepts period assignments, assessment dates, and immutable snapshots", () => {
    const payload = validPayload({
      academicPeriods: [
        {
          id: "period-1",
          classId: "class-1",
          name: "First term",
          startDate: "2025-09-01",
          endDate: "2025-12-20",
          position: 0,
          status: "closed",
          createdAt: "2025-08-01T00:00:00.000Z",
          updatedAt: "2025-12-21T00:00:00.000Z",
          closedAt: "2025-12-21T00:00:00.000Z",
          currentSnapshotId: "snapshot-1",
          closureVersion: 1
        }
      ],
      assessments: [
        {
          id: "assessment-1",
          classId: "class-1",
          subjectId: "subject-1",
          academicPeriodId: "period-1",
          assessmentDate: "2025-11-15",
          title: "Exam",
          weight: 1,
          period: "First term"
        }
      ],
      gradebookPeriodSnapshots: [
        {
          id: "snapshot-1",
          academicPeriodId: "period-1",
          classId: "class-1",
          version: 1,
          createdAt: "2025-12-21T00:00:00.000Z",
          data: {
            classGroup: {
              id: "class-1",
              name: "1 ESO A",
              level: "ESO",
              schoolYear: "2025-2026"
            },
            students: [],
            subjects: [],
            subjectCourseLinks: [],
            subjectStudentLinks: [],
            assessments: [],
            gradeEntries: [],
            gradebookGroups: [],
            taskGradebookConfigs: [],
            tasks: [],
            taskSubjectLinks: [],
            taskSessions: [],
            taskDailyEvaluationSettings: [],
            taskRubricAssessments: [],
            taskChecklistAssessments: [],
            taskDirectGrades: [],
            rubricTemplates: [],
            checklistTemplates: []
          }
        }
      ]
    });

    expect(validateDatabasePayload(payload).gradebookPeriodSnapshots).toHaveLength(1);
  });

  it("rejects assessment dates outside their assigned academic period", () => {
    const payload = validPayload({
      academicPeriods: [
        {
          id: "period-1",
          classId: "class-1",
          name: "First term",
          startDate: "2025-09-01",
          endDate: "2025-12-20",
          position: 0,
          status: "open",
          createdAt: "2025-08-01T00:00:00.000Z",
          updatedAt: "2025-08-01T00:00:00.000Z",
          closureVersion: 0
        }
      ],
      assessments: [
        {
          id: "assessment-1",
          classId: "class-1",
          subjectId: "subject-1",
          academicPeriodId: "period-1",
          assessmentDate: "2026-01-10",
          title: "Exam",
          weight: 1,
          period: "First term"
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/fuera de su periodo/);
  });

  it("accepts structured tutor, family contact, and cross-class support data", () => {
    const timestamp = "2026-05-22T09:00:00.000Z";
    const payload = validPayload({
      studentFollowUps: [
        {
          id: "follow-up-1",
          studentId: "student-1",
          classId: "class-1",
          date: "2026-05-22",
          kind: "tutorial",
          title: "Review reading plan",
          notes: "Coordinate the next intervention.",
          dueDate: "2026-05-29",
          responsiblePerson: "PT",
          priority: "high",
          status: "open",
          resolved: false,
          createdAt: timestamp,
          updatedAt: timestamp
        }
      ],
      familyContacts: [
        {
          id: "contact-1",
          studentId: "student-1",
          classId: "class-1",
          date: "2026-05-22",
          channel: "phone",
          contactName: "Family contact",
          relationship: "Mother",
          summary: "Agreed on the next review.",
          createdAt: timestamp,
          updatedAt: timestamp
        }
      ],
      supportGroups: [
        {
          id: "support-1",
          name: "Reading support",
          responsiblePerson: "PT",
          createdAt: timestamp,
          updatedAt: timestamp
        }
      ],
      supportGroupMembers: [
        {
          id: "support-member-1",
          supportGroupId: "support-1",
          studentId: "student-1",
          createdAt: timestamp
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).not.toThrow();
  });

  it("accepts validated student evidence and task links", () => {
    const timestamp = "2026-08-12T09:00:00.000Z";
    const payload = validPayload({
      resourceAttachments: [
        {
          id: "resource-file-1",
          ownerType: "student",
          ownerId: "student-1",
          kind: "file",
          title: "Project evidence",
          fileName: "evidence.pdf",
          mimeType: "application/pdf",
          sizeBytes: 3,
          dataBase64: "AQID",
          createdAt: timestamp,
          updatedAt: timestamp
        },
        {
          id: "resource-link-1",
          ownerType: "task",
          ownerId: "task-1",
          kind: "link",
          title: "Reference material",
          url: "https://example.org/material",
          createdAt: timestamp,
          updatedAt: timestamp
        }
      ]
    });

    expect(validateDatabasePayload(payload).resourceAttachments).toHaveLength(2);
  });

  it("accepts journal-entry attachments scoped to a valid class/subject/date/slot, with or without a task", () => {
    const timestamp = "2026-08-12T09:00:00.000Z";
    const payload = validPayload({
      resourceAttachments: [
        {
          id: "resource-journal-task",
          ownerType: "journalEntry",
          ownerId: "class-1:subject-1:2026-05-22:slot-1:task-1",
          kind: "link",
          title: "Foto del trabajo en clase",
          url: "https://example.org/photo",
          createdAt: timestamp,
          updatedAt: timestamp
        },
        {
          id: "resource-journal-free",
          ownerType: "journalEntry",
          ownerId: "class-1:subject-1:2026-05-22:slot-1:",
          kind: "link",
          title: "Registro libre",
          url: "https://example.org/note",
          createdAt: timestamp,
          updatedAt: timestamp
        }
      ]
    });

    expect(validateDatabasePayload(payload).resourceAttachments).toHaveLength(2);
  });

  it("rejects journal-entry attachments with a malformed or dangling ownerId", () => {
    const timestamp = "2026-08-12T09:00:00.000Z";
    const malformed = validPayload({
      resourceAttachments: [{
        id: "resource-journal-bad",
        ownerType: "journalEntry",
        ownerId: "not-enough-parts",
        kind: "link",
        title: "Registro",
        url: "https://example.org/note",
        createdAt: timestamp,
        updatedAt: timestamp
      }]
    });
    expect(() => validateDatabasePayload(malformed)).toThrow(/ownerId.*diario/);

    const unknownTask = validPayload({
      resourceAttachments: [{
        id: "resource-journal-unknown-task",
        ownerType: "journalEntry",
        ownerId: "class-1:subject-1:2026-05-22:slot-1:task-missing",
        kind: "link",
        title: "Registro",
        url: "https://example.org/note",
        createdAt: timestamp,
        updatedAt: timestamp
      }]
    });
    expect(() => validateDatabasePayload(unknownTask)).toThrow(/ownerId/);
  });

  it("accepts a valid classroom layout and rejects cross-class or duplicate seats", () => {
    const timestamp = "2026-08-12T09:00:00.000Z";
    const validLayout = {
      id: "class-1",
      classId: "class-1",
      rows: 2,
      columns: 2,
      assignments: { "student-1": 0 },
      createdAt: timestamp,
      updatedAt: timestamp
    };
    expect(validateDatabasePayload(validPayload({ classroomLayouts: [validLayout] })).classroomLayouts).toHaveLength(1);

    const duplicatedSeats = validPayload({
      students: [
        { id: "student-1", classId: "class-1", firstName: "Ana", lastName: "Lopez", fullName: "Ana Lopez" },
        { id: "student-2", classId: "class-1", firstName: "Luis", lastName: "Perez", fullName: "Luis Perez" }
      ],
      subjectStudentLinks: [{ id: "subject-student-1", subjectId: "subject-1", studentId: "student-1" }],
      classroomLayouts: [{ ...validLayout, assignments: { "student-1": 0, "student-2": 0 } }]
    });
    expect(() => validateDatabasePayload(duplicatedSeats)).toThrow(/asientos duplicados/);
  });

  it("accepts normalized reusable feedback and rejects logical duplicates", () => {
    const timestamp = "2026-08-12T09:00:00.000Z";
    const comment = {
      id: "feedback-1",
      category: "work",
      text: "Participa de forma activa.",
      createdAt: timestamp,
      updatedAt: timestamp
    };
    expect(validateDatabasePayload(validPayload({ feedbackComments: [comment] })).feedbackComments).toHaveLength(1);
    expect(() => validateDatabasePayload(validPayload({
      feedbackComments: [comment, { ...comment, id: "feedback-2", text: "participa de forma activa." }]
    }))).toThrow(/category\+text/);
  });

  it("rejects unsafe or corrupted resource attachments", () => {
    const timestamp = "2026-08-12T09:00:00.000Z";
    const unsafeLink = validPayload({
      resourceAttachments: [{
        id: "resource-1",
        ownerType: "task",
        ownerId: "task-1",
        kind: "link",
        title: "Unsafe link",
        url: "javascript:alert(1)",
        createdAt: timestamp,
        updatedAt: timestamp
      }]
    });
    const corruptedFile = validPayload({
      resourceAttachments: [{
        id: "resource-2",
        ownerType: "student",
        ownerId: "student-1",
        kind: "file",
        title: "Corrupted evidence",
        fileName: "evidence.pdf",
        mimeType: "application/pdf",
        sizeBytes: 4,
        dataBase64: "AQID",
        createdAt: timestamp,
        updatedAt: timestamp
      }]
    });

    expect(() => validateDatabasePayload(unsafeLink)).toThrow(/https/);
    expect(() => validateDatabasePayload(corruptedFile)).toThrow(/dañados/);
  });

  it("rejects duplicated support-group memberships", () => {
    const timestamp = "2026-05-22T09:00:00.000Z";
    const payload = validPayload({
      supportGroups: [
        {
          id: "support-1",
          name: "Reading support",
          responsiblePerson: "PT",
          createdAt: timestamp,
          updatedAt: timestamp
        }
      ],
      supportGroupMembers: [
        {
          id: "member-1",
          supportGroupId: "support-1",
          studentId: "student-1",
          createdAt: timestamp
        },
        {
          id: "member-2",
          supportGroupId: "support-1",
          studentId: "student-1",
          createdAt: timestamp
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/supportGroupId\+studentId/);
  });

  it("accepts a completely empty current database", () => {
    expect(() => validateDatabasePayload({
      app: "Edunoza",
      schemaVersion: DATABASE_SCHEMA_VERSION,
      exportedAt: "2026-07-13T00:00:00.000Z",
      tables: emptyTables()
    })).not.toThrow();
  });

  it("accepts a legacy ProfePlus backup", () => {
    expect(() => validateDatabasePayload({
      app: "ProfePlus",
      schemaVersion: DATABASE_SCHEMA_VERSION,
      exportedAt: "2026-07-13T00:00:00.000Z",
      tables: emptyTables()
    })).not.toThrow();
  });

  it("accepts a scoped free class record", () => {
    const payload = validPayload({
      dailyClassRecords: [
        {
          id: "daily-1",
          classId: "class-1",
          subjectId: "subject-1",
          date: "2026-05-22",
          scheduleSlotId: "slot-1",
          generalComment: "Repaso y ejercicios.",
          studentComments: { "student-1": "Participa bien." },
          createdAt: "2026-05-22T09:00:00.000Z",
          updatedAt: "2026-05-22T10:00:00.000Z"
        }
      ]
    });

    expect(validateDatabasePayload(payload).dailyClassRecords).toHaveLength(1);
  });

  it("accepts an exceptional session and its scoped attendance and task data", () => {
    const exceptionalId = "daily-exception";
    const scheduleSlotId = `exception-${exceptionalId}`;
    const payload = validPayload({
      dailyClassRecords: [
        {
          id: exceptionalId,
          classId: "class-1",
          subjectId: "subject-1",
          date: "2026-05-23",
          scheduleSlotId,
          sessionKind: "rescheduled",
          sessionTitle: "Recovered lesson",
          startTime: "10:15",
          endTime: "11:10",
          originalDate: "2026-05-22",
          originalScheduleSlotId: "slot-1",
          generalComment: "",
          studentComments: {},
          createdAt: "2026-05-22T09:00:00.000Z",
          updatedAt: "2026-05-22T09:00:00.000Z"
        }
      ],
      attendanceEntries: [
        {
          id: "attendance-exception",
          classId: "class-1",
          subjectId: "subject-1",
          studentId: "student-1",
          date: "2026-05-23",
          scheduleSlotId,
          status: "late",
          lateMinutes: 5,
          createdAt: "2026-05-23T10:15:00.000Z",
          updatedAt: "2026-05-23T10:15:00.000Z"
        }
      ],
      taskSessions: [
        {
          id: "session-1",
          taskId: "task-1",
          subjectId: "subject-1",
          classId: "class-1",
          date: "2026-05-23",
          scheduleSlotId,
          status: "moved"
        }
      ]
    });

    expect(validateDatabasePayload(payload).dailyClassRecords).toHaveLength(1);
  });

  it("rejects a synthetic attendance slot without its exceptional daily record", () => {
    const payload = validPayload({
      attendanceEntries: [
        {
          id: "attendance-exception",
          classId: "class-1",
          subjectId: "subject-1",
          studentId: "student-1",
          date: "2026-05-23",
          scheduleSlotId: "exception-missing",
          status: "present",
          createdAt: "2026-05-23T10:15:00.000Z",
          updatedAt: "2026-05-23T10:15:00.000Z"
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/scheduleSlotId/);
  });

  it("rejects free class records with students outside the database", () => {
    const payload = validPayload({
      dailyClassRecords: [
        {
          id: "daily-1",
          classId: "class-1",
          subjectId: "subject-1",
          date: "2026-05-22",
          scheduleSlotId: "slot-1",
          generalComment: "",
          studentComments: { missing: "Comentario" },
          createdAt: "2026-05-22T09:00:00.000Z",
          updatedAt: "2026-05-22T10:00:00.000Z"
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/studentComments/);
  });

  it("rejects backup metadata without a valid export timestamp", () => {
    const payload = validPayload();
    payload.exportedAt = "not-a-date";

    expect(() => validateDatabasePayload(payload)).toThrow(/exportedAt/);
  });

  it("rejects backup metadata with impossible export dates", () => {
    const payload = validPayload();
    payload.exportedAt = "2026-02-31T00:00:00.000Z";

    expect(() => validateDatabasePayload(payload)).toThrow(/fecha inexistente/i);
  });

  it("rejects cycles in gradebook folder trees", () => {
    const payload = validPayload({
      gradebookGroups: [
        {
          id: "group-1",
          classId: "class-1",
          subjectId: "subject-1",
          name: "A",
          parentId: "group-2",
          position: 1
        },
        {
          id: "group-2",
          classId: "class-1",
          subjectId: "subject-1",
          name: "B",
          parentId: "group-1",
          position: 2
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/ciclo de carpetas/i);
  });

  it("rejects rubric assessment rows with unknown criteria", () => {
    const payload = validPayload({
      taskRubricAssessments: [
        {
          id: "rubric-row-1",
          taskId: "task-1",
          classId: "class-1",
          subjectId: "subject-1",
          date: "2026-05-22",
          scheduleSlotId: "slot-1",
          studentId: "student-1",
          rubricTemplateId: "rubric-1",
          criterionId: "missing-criterion",
          levelId: "level-1",
          score: 1
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/criterio o nivel inexistente/i);
  });

  it("rejects negative rubric assessment scores", () => {
    const payload = validPayload({
      taskRubricAssessments: [
        {
          id: "rubric-row-1",
          taskId: "task-1",
          subjectId: "subject-1",
          classId: "class-1",
          date: "2026-05-22",
          scheduleSlotId: "slot-1",
          studentId: "student-1",
          rubricTemplateId: "rubric-1",
          criterionId: "criterion-1",
          levelId: "level-1",
          score: -1
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/score.*0/i);
  });

  it("rejects backups from any other schema version", () => {
    const payload = validPayload();
    payload.schemaVersion = DATABASE_SCHEMA_VERSION + 1;

    expect(() => validateDatabasePayload(payload)).toThrow(/esquema actual/i);
  });

  it("rejects backups missing any current table", () => {
    const payload = validPayload();
    delete (payload.tables as Record<string, unknown[]>).studentFollowUps;

    expect(() => validateDatabasePayload(payload)).toThrow(/studentFollowUps/);
  });

  it("rejects task sessions without an explicit status", () => {
    const payload = validPayload();
    delete ((payload.tables as Record<string, unknown[]>).taskSessions[0] as Record<string, unknown>).status;

    expect(() => validateDatabasePayload(payload)).toThrow(/status/);
  });

  it("rejects records assigned to a schedule slot from another weekday", () => {
    const payload = validPayload({
      taskSessions: [
        {
          id: "session-1",
          taskId: "task-1",
          subjectId: "subject-1",
          classId: "class-1",
          date: "2026-05-21",
          scheduleSlotId: "slot-1",
          status: "planned"
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/no corresponde al día/i);
  });

  it("rejects attendance timestamps that move backwards", () => {
    const payload = validPayload({
      attendanceEntries: [
        {
          id: "attendance-1",
          classId: "class-1",
          subjectId: "subject-1",
          studentId: "student-1",
          date: "2026-05-22",
          scheduleSlotId: "slot-1",
          status: "present",
          createdAt: "2026-05-22T10:00:00.000Z",
          updatedAt: "2026-05-22T09:00:00.000Z"
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/anterior a su creación/i);
  });

  it("rejects subjects assigned to break blocks", () => {
    const payload = validPayload({
      scheduleDays: [
        {
          id: "day-1",
          dayOfWeek: 5,
          dayName: "Viernes",
          enabled: true,
          blocks: [{ id: "slot-1", startTime: "09:00", endTime: "10:00", isBreak: true }]
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/scheduleSlotIds/);
  });

  it("rejects subjects without exactly one course association", () => {
    const payload = validPayload({ subjectCourseLinks: [] });

    expect(() => validateDatabasePayload(payload)).toThrow(/asignatura sin curso asociado/i);
  });

  it("rejects attendance for a student not enrolled in the subject", () => {
    const payload = validPayload({
      subjectStudentLinks: [],
      attendanceEntries: [
        {
          id: "attendance-1",
          classId: "class-1",
          subjectId: "subject-1",
          studentId: "student-1",
          date: "2026-05-22",
          scheduleSlotId: "slot-1",
          status: "present",
          createdAt: "2026-05-22T08:00:00.000Z",
          updatedAt: "2026-05-22T08:00:00.000Z"
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/no matriculado/i);
  });

  it("rejects student follow-up rows for another class", () => {
    const payload = validPayload({
      classGroups: [
        { id: "class-1", name: "1 ESO A", level: "ESO", schoolYear: "2025-2026" },
        { id: "class-2", name: "1 ESO B", level: "ESO", schoolYear: "2025-2026" }
      ],
      studentFollowUps: [
        {
          id: "follow-up-1",
          studentId: "student-1",
          classId: "class-2",
          date: "2026-05-22",
          kind: "tutorial",
          title: "Meeting",
          notes: "Notes",
          resolved: false
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/fuera del curso/i);
  });

  it("rejects assessment competency values that are not text", () => {
    const payload = validPayload({
      assessments: [
        {
          id: "assessment-1",
          classId: "class-1",
          subjectId: "subject-1",
          title: "Exam",
          weight: 1,
          period: "Term 1",
          competency: 3
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/competency/);
  });

  it("rejects student email values that are not text", () => {
    const payload = validPayload({
      students: [
        {
          id: "student-1",
          classId: "class-1",
          firstName: "Ana",
          lastName: "Lopez",
          fullName: "Ana Lopez",
          email: 123
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/email/);
  });

  it("rejects student photo data URLs that are not supported images", () => {
    const payload = validPayload({
      students: [
        {
          id: "student-1",
          classId: "class-1",
          firstName: "Ana",
          lastName: "Lopez",
          fullName: "Ana Lopez",
          photoDataUrl: "data:text/html;base64,PGgxPk5vPC9oMT4="
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/photoDataUrl/);
  });

  it("rejects oversized student photo data URLs in backups", () => {
    const payload = validPayload({
      students: [
        {
          id: "student-1",
          classId: "class-1",
          firstName: "Ana",
          lastName: "Lopez",
          fullName: "Ana Lopez",
          photoDataUrl: `data:image/jpeg;base64,${"A".repeat(1_500_001)}`
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/demasiado grande/);
  });

  it("rejects attendance rows with invalid status values", () => {
    const payload = validPayload({
      attendanceEntries: [
        {
          id: "attendance-1",
          classId: "class-1",
          subjectId: "subject-1",
          studentId: "student-1",
          date: "2026-05-22",
          scheduleSlotId: "slot-1",
          status: "unknown",
          createdAt: "2026-05-22T08:00:00.000Z",
          updatedAt: "2026-05-22T08:00:00.000Z"
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/status/);
  });

  it("rejects attendance rows with malformed dates", () => {
    const payload = validPayload({
      attendanceEntries: [
        {
          id: "attendance-1",
          classId: "class-1",
          subjectId: "subject-1",
          studentId: "student-1",
          date: "22/05/2026",
          scheduleSlotId: "slot-1",
          status: "present",
          createdAt: "2026-05-22T08:00:00.000Z",
          updatedAt: "2026-05-22T08:00:00.000Z"
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/fecha/i);
  });

  it("rejects attendance rows that reference unknown schedule slots", () => {
    const payload = validPayload({
      attendanceEntries: [
        {
          id: "attendance-1",
          classId: "class-1",
          subjectId: "subject-1",
          studentId: "student-1",
          date: "2026-05-22",
          scheduleSlotId: "missing-slot",
          status: "present",
          createdAt: "2026-05-22T08:00:00.000Z",
          updatedAt: "2026-05-22T08:00:00.000Z"
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/scheduleSlotId/);
  });

  it("rejects malformed rubric criteria in backup templates", () => {
    const payload = validPayload({
      rubricTemplates: [
        {
          id: "rubric-1",
          classId: "class-1",
          taskId: "task-1",
          name: "Rubrica",
          criteria: [
            {
              id: "criterion-1",
              name: "Criterio",
              levels: [
                { id: "level-1", name: "Nivel alto", score: "alto" },
                { id: "level-2", name: "Nivel bajo", score: 1 }
              ]
            }
          ]
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/score/);
  });

  it("rejects rubric templates with fewer than two levels", () => {
    const payload = validPayload({
      rubricTemplates: [
        {
          id: "rubric-1",
          classId: "class-1",
          taskId: "task-1",
          name: "Rubrica",
          criteria: [
            {
              id: "criterion-1",
              name: "Criterio",
              levels: [{ id: "level-1", name: "Nivel", score: 1 }]
            }
          ]
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/dos niveles/);
  });

  it("rejects malformed checklist items in backup templates", () => {
    const payload = validPayload({
      checklistTemplates: [
        {
          id: "checklist-1",
          classId: "class-1",
          taskId: "task-1",
          name: "Lista",
          items: [{ id: "item-1", text: 3 }]
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/text/);
  });

  it("rejects checklist templates without items", () => {
    const payload = validPayload({
      checklistTemplates: [
        {
          id: "checklist-1",
          classId: "class-1",
          taskId: "task-1",
          name: "Lista",
          items: []
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/sin items/);
  });

  it("rejects task gradebook configs with more than one evaluation method", () => {
    const payload = validPayload({
      taskGradebookConfigs: [
        {
          id: "config-1",
          taskId: "task-1",
          subjectId: "subject-1",
          classId: "class-1",
          gradebookWeight: 1,
          rubricTemplateId: "rubric-1",
          checklistTemplateId: "checklist-1"
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/mas de un metodo/i);
  });

  it("rejects daily evaluation settings with rubric and checklist at once", () => {
    const payload = validPayload({
      taskDailyEvaluationSettings: [
        {
          id: "setting-1",
          taskId: "task-1",
          classId: "class-1",
          subjectId: "subject-1",
          date: "2026-05-22",
          scheduleSlotId: "slot-1",
          rubricTemplateId: "rubric-1",
          checklistTemplateId: "checklist-1"
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/rubrica y lista/i);
  });

  it("rejects subject schedule slots that do not exist in the schedule", () => {
    const payload = validPayload({
      subjects: [{ id: "subject-1", name: "Matematicas", scheduleSlotIds: ["missing-slot"] }]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/scheduleSlotIds/i);
  });

  it("rejects duplicate schedule block ids", () => {
    const payload = validPayload({
      scheduleDays: [
        {
          id: "day-1",
          dayOfWeek: 1,
          dayName: "Lunes",
          enabled: true,
          blocks: [
            { id: "slot-1", startTime: "09:00", endTime: "10:00" },
            { id: "slot-1", startTime: "10:00", endTime: "11:00" }
          ]
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/duplicados/i);
  });

  it("rejects invalid schedule block times", () => {
    const payload = validPayload({
      scheduleDays: [
        {
          id: "day-1",
          dayOfWeek: 1,
          dayName: "Lunes",
          enabled: true,
          blocks: [{ id: "slot-1", startTime: "10:00", endTime: "09:00" }]
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/hora de fin/i);
  });

  it("rejects overlapping schedule blocks in the same day", () => {
    const payload = validPayload({
      scheduleDays: [
        {
          id: "day-1",
          dayOfWeek: 1,
          dayName: "Lunes",
          enabled: true,
          blocks: [
            { id: "slot-1", startTime: "09:00", endTime: "10:00" },
            { id: "slot-2", startTime: "09:30", endTime: "10:30" }
          ]
        }
      ],
      subjects: [{ id: "subject-1", name: "Matematicas", scheduleSlotIds: ["slot-1", "slot-2"] }],
      taskSessions: [
        {
          id: "session-1",
          taskId: "task-1",
          subjectId: "subject-1",
          classId: "class-1",
          date: "2026-05-22",
          scheduleSlotId: "slot-1",
          status: "planned"
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/solapados/i);
  });

  it("rejects duplicated schedule weekdays", () => {
    const payload = validPayload({
      scheduleDays: [
        {
          id: "day-1",
          dayOfWeek: 1,
          dayName: "Lunes",
          enabled: true,
          blocks: [{ id: "slot-1", startTime: "09:00", endTime: "10:00" }]
        },
        {
          id: "day-2",
          dayOfWeek: 1,
          dayName: "Otro lunes",
          enabled: true,
          blocks: []
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/dias de la semana duplicados/i);
  });

  it("rejects schedule days outside the supported weekday range", () => {
    const payload = validPayload({
      scheduleDays: [
        {
          id: "day-1",
          dayOfWeek: 9,
          dayName: "Día inválido",
          enabled: true,
          blocks: [{ id: "slot-1", startTime: "09:00", endTime: "10:00" }]
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/1-7/i);
  });

  it("rejects impossible calendar dates in dated rows", () => {
    const payload = validPayload({
      taskSessions: [
        {
          id: "session-1",
          taskId: "task-1",
          subjectId: "subject-1",
          classId: "class-1",
          date: "2026-02-31",
          scheduleSlotId: "slot-1"
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/fecha inexistente/i);
  });

  it("rejects schedule settings outside the supported block duration range", () => {
    const payload = validPayload({
      scheduleSettings: [
        {
          id: "default",
          defaultBlockDurationMinutes: 5
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/15-240/i);
  });

  it("rejects tasks with fewer than one planned session", () => {
    const payload = validPayload({
      tasks: [{ id: "task-1", title: "Tarea", description: "", sessionCount: 0, sendToGradebook: true }]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/sessionCount.*1/i);
  });

  it("rejects unit blocks with invalid numeric ranges", () => {
    const payload = validPayload({
      unitBlocks: [
        {
          id: "unit-1",
          subjectId: "subject-1",
          name: "Unit",
          description: "",
          sessionCount: -1,
          position: 0
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/sessionCount.*1/i);
  });

  it("rejects negative gradebook weights in backups", () => {
    const payload = validPayload({
      assessments: [
        {
          id: "assessment-1",
          classId: "class-1",
          subjectId: "subject-1",
          title: "Exam",
          weight: -1,
          period: ""
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/weight.*0/i);
  });

  it("rejects task comments for a student outside the session class", () => {
    const payload = validPayload({
      classGroups: [
        { id: "class-1", name: "1 ESO A", level: "ESO", schoolYear: "2025-2026" },
        { id: "class-2", name: "1 ESO B", level: "ESO", schoolYear: "2025-2026" }
      ],
      students: [
        {
          id: "student-1",
          classId: "class-2",
          firstName: "Ana",
          lastName: "Lopez",
          fullName: "Ana Lopez"
        }
      ],
      subjectCourseLinks: [
        { id: "subject-course-1", subjectId: "subject-1", classId: "class-1" }
      ],
      subjectStudentLinks: [],
      taskStudentComments: [
        {
          id: "comment-1",
          taskId: "task-1",
          classId: "class-1",
          subjectId: "subject-1",
          date: "2026-05-22",
          scheduleSlotId: "slot-1",
          studentId: "student-1",
          comment: "Fuera de grupo"
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/fuera del curso/i);
  });

  it("rejects a subject associated with more than one course", () => {
    const payload = validPayload({
      classGroups: [
        { id: "class-1", name: "1 ESO A", level: "ESO", schoolYear: "2025-2026" },
        { id: "class-2", name: "1 ESO B", level: "ESO", schoolYear: "2025-2026" }
      ],
      subjectCourseLinks: [
        { id: "subject-course-1", subjectId: "subject-1", classId: "class-1" },
        { id: "subject-course-2", subjectId: "subject-1", classId: "class-2" }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/subjectId/i);
  });

  it("rejects task student comments that are not text", () => {
    const payload = validPayload({
      taskStudentComments: [
        {
          id: "comment-1",
          taskId: "task-1",
          subjectId: "subject-1",
          classId: "class-1",
          date: "2026-05-22",
          scheduleSlotId: "slot-1",
          studentId: "student-1",
          comment: 3
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/comment/);
  });

  it("rejects daily evaluation general comments that are not text", () => {
    const payload = validPayload({
      taskDailyEvaluationSettings: [
        {
          id: "setting-1",
          taskId: "task-1",
          subjectId: "subject-1",
          classId: "class-1",
          date: "2026-05-22",
          scheduleSlotId: "slot-1",
          generalComment: 3
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/generalComment/);
  });

  it("accepts scoped task session data when the same task shares date and slot in another class", () => {
    const payload = validPayload({
      classGroups: [
        { id: "class-1", name: "1 ESO A", level: "ESO", schoolYear: "2025-2026" },
        { id: "class-2", name: "1 ESO B", level: "ESO", schoolYear: "2025-2026" }
      ],
      students: [
        {
          id: "student-1",
          classId: "class-1",
          firstName: "Ana",
          lastName: "Lopez",
          fullName: "Ana Lopez"
        },
        {
          id: "student-2",
          classId: "class-2",
          firstName: "Luis",
          lastName: "Diaz",
          fullName: "Luis Diaz"
        }
      ],
      subjects: [
        { id: "subject-1", name: "Matematicas", scheduleSlotIds: ["slot-1"] },
        { id: "subject-2", name: "Lengua", scheduleSlotIds: ["slot-1"] }
      ],
      subjectCourseLinks: [
        { id: "subject-course-1", subjectId: "subject-1", classId: "class-1" },
        { id: "subject-course-2", subjectId: "subject-2", classId: "class-2" }
      ],
      subjectStudentLinks: [
        { id: "subject-student-1", subjectId: "subject-1", studentId: "student-1" },
        { id: "subject-student-2", subjectId: "subject-2", studentId: "student-2" }
      ],
      taskSubjectLinks: [
        { id: "task-subject-1", taskId: "task-1", subjectId: "subject-1" },
        { id: "task-subject-2", taskId: "task-1", subjectId: "subject-2" }
      ],
      taskSessions: [
        {
          id: "session-1",
          taskId: "task-1",
          subjectId: "subject-1",
          classId: "class-1",
          date: "2026-05-22",
          scheduleSlotId: "slot-1",
          status: "planned"
        },
        {
          id: "session-2",
          taskId: "task-1",
          subjectId: "subject-2",
          classId: "class-2",
          date: "2026-05-22",
          scheduleSlotId: "slot-1",
          status: "planned"
        }
      ],
      taskDailyEvaluationSettings: [
        {
          id: "setting-1",
          taskId: "task-1",
          subjectId: "subject-2",
          classId: "class-2",
          date: "2026-05-22",
          scheduleSlotId: "slot-1"
        }
      ],
      taskStudentComments: [
        {
          id: "comment-1",
          taskId: "task-1",
          subjectId: "subject-2",
          classId: "class-2",
          date: "2026-05-22",
          scheduleSlotId: "slot-1",
          studentId: "student-2",
          comment: "Comentario correcto"
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).not.toThrow();
  });

  it("rejects scoped task comments that point to a different class session", () => {
    const payload = validPayload({
      taskStudentComments: [
        {
          id: "comment-1",
          taskId: "task-1",
          subjectId: "subject-1",
          classId: "class-missing",
          date: "2026-05-22",
          scheduleSlotId: "slot-1",
          studentId: "student-1",
          comment: "Sesion incorrecta"
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/classId/i);
  });

  it("accepts evaluation data left behind after its planner session was reassigned, moved or removed", () => {
    const payload = validPayload({
      taskSessions: [],
      taskStudentComments: [
        {
          id: "comment-1",
          taskId: "task-1",
          subjectId: "subject-1",
          classId: "class-1",
          date: "2026-05-22",
          scheduleSlotId: "slot-1",
          studentId: "student-1",
          comment: "Comentario de una sesion ya movida"
        }
      ],
      taskDailyEvaluationSettings: [
        {
          id: "setting-1",
          taskId: "task-1",
          subjectId: "subject-1",
          classId: "class-1",
          date: "2026-05-22",
          scheduleSlotId: "slot-1",
          generalComment: "Buen trabajo"
        }
      ],
      taskRubricAssessments: [
        {
          id: "rubric-assessment-1",
          taskId: "task-1",
          subjectId: "subject-1",
          classId: "class-1",
          date: "2026-05-22",
          scheduleSlotId: "slot-1",
          studentId: "student-1",
          rubricTemplateId: "rubric-1",
          criterionId: "criterion-1",
          levelId: "level-1",
          score: 2
        }
      ],
      taskChecklistAssessments: [
        {
          id: "checklist-assessment-1",
          taskId: "task-1",
          subjectId: "subject-1",
          classId: "class-1",
          date: "2026-05-22",
          scheduleSlotId: "slot-1",
          studentId: "student-1",
          checklistTemplateId: "checklist-1",
          itemId: "item-1",
          checked: true
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).not.toThrow();
  });

  it("accepts manual grade observations without numeric grades", () => {
    const payload = validPayload({
      assessments: [
        {
          id: "assessment-1",
          classId: "class-1",
          subjectId: "subject-1",
          title: "Exam",
          weight: 1,
          period: ""
        }
      ],
      gradeEntries: [
        {
          id: "entry-1",
          classId: "class-1",
          assessmentId: "assessment-1",
          studentId: "student-1",
          comment: "Needs review"
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).not.toThrow();
  });

  it("rejects manual grade entries outside the 0 to 10 range", () => {
    const payload = validPayload({
      assessments: [
        {
          id: "assessment-1",
          classId: "class-1",
          subjectId: "subject-1",
          title: "Exam",
          weight: 1,
          period: ""
        }
      ],
      gradeEntries: [
        {
          id: "entry-1",
          classId: "class-1",
          assessmentId: "assessment-1",
          studentId: "student-1",
          numericValue: 12
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/0-10/i);
  });

  it("rejects duplicate manual grade entries for the same assessment and student", () => {
    const payload = validPayload({
      assessments: [
        {
          id: "assessment-1",
          classId: "class-1",
          subjectId: "subject-1",
          title: "Exam",
          weight: 1,
          period: ""
        }
      ],
      gradeEntries: [
        {
          id: "entry-1",
          classId: "class-1",
          assessmentId: "assessment-1",
          studentId: "student-1",
          numericValue: 6
        },
        {
          id: "entry-2",
          classId: "class-1",
          assessmentId: "assessment-1",
          studentId: "student-1",
          numericValue: 8
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/filas duplicadas.*assessmentId\+studentId/i);
  });

  it("rejects duplicate attendance entries for the same student session", () => {
    const payload = validPayload({
      attendanceEntries: [
        {
          id: "attendance-1",
          classId: "class-1",
          subjectId: "subject-1",
          studentId: "student-1",
          date: "2026-05-22",
          scheduleSlotId: "slot-1",
          status: "present",
          createdAt: "2026-05-22T08:00:00.000Z",
          updatedAt: "2026-05-22T08:00:00.000Z"
        },
        {
          id: "attendance-2",
          classId: "class-1",
          subjectId: "subject-1",
          studentId: "student-1",
          date: "2026-05-22",
          scheduleSlotId: "slot-1",
          status: "absent",
          createdAt: "2026-05-22T08:00:00.000Z",
          updatedAt: "2026-05-22T08:00:00.000Z"
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/filas duplicadas.*classId\+subjectId\+studentId\+date\+scheduleSlotId/i);
  });

  it("rejects duplicate direct task grades for the same task subject class and student", () => {
    const payload = validPayload({
      taskDirectGrades: [
        {
          id: "direct-1",
          taskId: "task-1",
          subjectId: "subject-1",
          classId: "class-1",
          studentId: "student-1",
          score: 6
        },
        {
          id: "direct-2",
          taskId: "task-1",
          subjectId: "subject-1",
          classId: "class-1",
          studentId: "student-1",
          score: 9
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/filas duplicadas.*taskId\+subjectId\+classId\+studentId/i);
  });

  it("rejects task sessions that collide in the same class schedule slot", () => {
    const payload = validPayload({
      tasks: [
        { id: "task-1", title: "Tarea 1", description: "", sessionCount: 1, sendToGradebook: true },
        { id: "task-2", title: "Tarea 2", description: "", sessionCount: 1, sendToGradebook: true }
      ],
      taskSubjectLinks: [
        { id: "task-subject-1", taskId: "task-1", subjectId: "subject-1" },
        { id: "task-subject-2", taskId: "task-2", subjectId: "subject-1" }
      ],
      taskSessions: [
        {
          id: "session-1",
          taskId: "task-1",
          subjectId: "subject-1",
          classId: "class-1",
          date: "2026-05-22",
          scheduleSlotId: "slot-1",
          status: "planned"
        },
        {
          id: "session-2",
          taskId: "task-2",
          subjectId: "subject-1",
          classId: "class-1",
          date: "2026-05-22",
          scheduleSlotId: "slot-1",
          status: "planned"
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/filas duplicadas.*classId\+date\+scheduleSlotId/i);
  });

  it("rejects duplicate rubric rows for the same criterion in a task session", () => {
    const payload = validPayload({
      taskRubricAssessments: [
        {
          id: "rubric-row-1",
          taskId: "task-1",
          subjectId: "subject-1",
          classId: "class-1",
          date: "2026-05-22",
          scheduleSlotId: "slot-1",
          studentId: "student-1",
          rubricTemplateId: "rubric-1",
          criterionId: "criterion-1",
          levelId: "level-1",
          score: 2
        },
        {
          id: "rubric-row-2",
          taskId: "task-1",
          subjectId: "subject-1",
          classId: "class-1",
          date: "2026-05-22",
          scheduleSlotId: "slot-1",
          studentId: "student-1",
          rubricTemplateId: "rubric-1",
          criterionId: "criterion-1",
          levelId: "level-2",
          score: 1
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/filas duplicadas.*criterionId/i);
  });

  it("rejects direct grades outside the 0 to 10 range", () => {
    const payload = validPayload({
      taskDirectGrades: [
        {
          id: "direct-1",
          taskId: "task-1",
          subjectId: "subject-1",
          classId: "class-1",
          studentId: "student-1",
          score: 12
        }
      ]
    });

    expect(() => validateDatabasePayload(payload)).toThrow(/0-10/i);
  });
});
