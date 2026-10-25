import { describe, expect, it } from "vitest";
import {
  buildHandoffMergePreview,
  createStudentHandoffPayload,
  parseStudentHandoffPayload,
  selectHandoffRowsToCreate,
  type HandoffTables
} from "./handoff";

const exportedAt = "2026-07-29T10:00:00.000Z";

function sourceTables(): HandoffTables {
  return {
    classGroups: [
      { id: "class-a", name: "3 A", level: "3", schoolYear: "2026-2027" },
      { id: "class-b", name: "4 B", level: "4", schoolYear: "2026-2027" }
    ],
    students: [
      {
        id: "student-a",
        classId: "class-a",
        firstName: "Ana",
        lastName: "Díaz",
        fullName: "Ana Díaz"
      },
      {
        id: "student-b",
        classId: "class-b",
        firstName: "Leo",
        lastName: "Sanz",
        fullName: "Leo Sanz"
      }
    ],
    studentFollowUps: [
      {
        id: "follow-a",
        studentId: "student-a",
        classId: "class-a",
        date: "2026-07-20",
        kind: "tutorial",
        title: "Reading plan",
        notes: "Weekly review",
        resolved: false
      }
    ],
    familyContacts: [
      {
        id: "contact-a",
        studentId: "student-a",
        classId: "class-a",
        date: "2026-07-21",
        channel: "phone",
        contactName: "María Díaz",
        relationship: "Mother",
        summary: "Agreed on reading routine",
        createdAt: exportedAt,
        updatedAt: exportedAt
      }
    ],
    supportGroups: [
      {
        id: "support-a",
        name: "Reading support",
        responsiblePerson: "PT",
        createdAt: exportedAt,
        updatedAt: exportedAt
      }
    ],
    supportGroupMembers: [
      {
        id: "member-a",
        supportGroupId: "support-a",
        studentId: "student-a",
        createdAt: exportedAt
      },
      {
        id: "member-b",
        supportGroupId: "support-a",
        studentId: "student-b",
        createdAt: exportedAt
      }
    ]
  };
}

describe("student handoff packages", () => {
  it.each([undefined, "open", "inProgress", "done"] as const)("preserves family contact status %s", (status) => {
    const source = sourceTables();
    source.familyContacts[0].status = status;
    const payload = createStudentHandoffPayload(source, ["student-a"], exportedAt);
    expect(parseStudentHandoffPayload(payload).tables.familyContacts[0].status).toBe(status);
  });

  it("rejects an invalid family contact status", () => {
    const payload = createStudentHandoffPayload(sourceTables(), ["student-a"], exportedAt);
    Object.assign(payload.tables.familyContacts[0], { status: "invalid" });
    expect(() => parseStudentHandoffPayload(payload)).toThrow();
  });

  it("exports only selected students and their required references", () => {
    const payload = createStudentHandoffPayload(sourceTables(), ["student-a"], exportedAt);

    expect(payload.app).toBe("Edunoza");
    expect(payload.scope.studentIds).toEqual(["student-a"]);
    expect(payload.tables.classGroups.map((row) => row.id)).toEqual(["class-a"]);
    expect(payload.tables.students.map((row) => row.id)).toEqual(["student-a"]);
    expect(payload.tables.studentFollowUps).toHaveLength(1);
    expect(payload.tables.familyContacts).toHaveLength(1);
    expect(payload.tables.supportGroups.map((row) => row.id)).toEqual(["support-a"]);
    expect(payload.tables.supportGroupMembers.map((row) => row.id)).toEqual(["member-a"]);
    expect(parseStudentHandoffPayload(payload)).toEqual(payload);
  });

  it("keeps legacy ProfePlus handoff packages readable", () => {
    const payload = createStudentHandoffPayload(sourceTables(), ["student-a"], exportedAt);
    const legacyPayload = { ...payload, app: "ProfePlus" as const };

    expect(parseStudentHandoffPayload(legacyPayload)).toEqual(legacyPayload);
  });

  it("previews creates, identical rows, and blocking conflicts without overwriting", () => {
    const payload = createStudentHandoffPayload(sourceTables(), ["student-a"], exportedAt);
    const current = sourceTables();
    current.students = [
      payload.tables.students[0],
      {
        id: "unrelated",
        classId: "class-b",
        firstName: "Sam",
        lastName: "Gil",
        fullName: "Sam Gil"
      }
    ];
    current.classGroups = [{ ...payload.tables.classGroups[0], name: "Conflicting class" }];
    current.studentFollowUps = [];
    current.familyContacts = [];
    current.supportGroups = [];
    current.supportGroupMembers = [];

    const preview = buildHandoffMergePreview(payload.tables, current);
    expect(preview.tables.students.unchangedIds).toEqual(["student-a"]);
    expect(preview.tables.classGroups.conflictIds).toEqual(["class-a"]);
    expect(preview.tables.studentFollowUps.createIds).toEqual(["follow-a"]);

    const rows = selectHandoffRowsToCreate(payload.tables, preview);
    expect(rows.students).toEqual([]);
    expect(rows.classGroups).toEqual([]);
    expect(rows.studentFollowUps.map((row) => row.id)).toEqual(["follow-a"]);
  });

  it("rejects packages with broken references", () => {
    const payload = createStudentHandoffPayload(sourceTables(), ["student-a"], exportedAt);
    payload.tables.classGroups = [];

    expect(() => parseStudentHandoffPayload(payload)).toThrow(/curso de referencia/);
  });

  it("rejects impossible dates and unsupported enum values", () => {
    const payload = createStudentHandoffPayload(sourceTables(), ["student-a"], exportedAt);
    payload.tables.studentFollowUps[0] = {
      ...payload.tables.studentFollowUps[0],
      date: "2026-99-99",
      kind: "invalid" as "tutorial"
    };

    expect(() => parseStudentHandoffPayload(payload)).toThrow(/datos no válidos/);
  });

  it("rejects records scoped to a different course than their student", () => {
    const payload = createStudentHandoffPayload(sourceTables(), ["student-a", "student-b"], exportedAt);
    payload.tables.studentFollowUps[0] = {
      ...payload.tables.studentFollowUps[0],
      classId: "class-b"
    };

    expect(() => parseStudentHandoffPayload(payload)).toThrow(/curso distinto/);
  });

  it("rejects scope metadata that does not match the packaged rows", () => {
    const payload = createStudentHandoffPayload(sourceTables(), ["student-a"], exportedAt);
    payload.scope.studentIds = ["student-a", "student-b"];

    expect(() => parseStudentHandoffPayload(payload)).toThrow(/alcance declarado/);
  });
});
