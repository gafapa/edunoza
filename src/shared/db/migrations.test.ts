import "fake-indexeddb/auto";
import Dexie from "dexie";
import { expect, it } from "vitest";
import { EdunozaDB } from "./database";

it("upgrades legacy assessments and identities without losing grades or attendance", async () => {
  const name = `migration-test-${crypto.randomUUID()}`;
  const latest = new EdunozaDB(name);
  const legacy = new Dexie(name);
  legacy.version(1).stores({
    classGroups: "id,name,schoolYear", students: "id,classId,fullName",
    assessments: "id,classId,subjectId,title,period,groupId,[classId+groupId],[classId+subjectId]",
    gradeEntries: "id,classId,assessmentId,studentId,[classId+studentId]",
    attendanceEntries: "id,classId,subjectId,studentId,date,status,scheduleSlotId,[classId+date],[classId+date+scheduleSlotId],[classId+subjectId+date]"
  });
  try {
    await legacy.table("classGroups").put({ id: "course", name: "Synthetic", level: "ESO", schoolYear: "2024-2025" });
    await legacy.table("students").put({ id: "student", classId: "course", fullName: "Synthetic Student" });
    await legacy.table("assessments").bulkPut([
      { id: "a", classId: "course", subjectId: "subject", title: "Exam", weight: 1, period: "Term 1" },
      { id: "b", classId: "course", subjectId: "subject", title: "Exam", weight: 1, period: "Term 2" }
    ]);
    const grade = { id: "grade", classId: "course", assessmentId: "a", studentId: "student", numericValue: 8 };
    const attendance = { id: "attendance", classId: "course", studentId: "student", date: "2024-10-01", status: "present" };
    await legacy.table("gradeEntries").put(grade);
    await legacy.table("attendanceEntries").put(attendance);
    legacy.close();
    await latest.open();
    expect(await latest.gradeEntries.get("grade")).toEqual(grade);
    expect(await latest.attendanceEntries.get("attendance")).toEqual(attendance);
    expect((await latest.students.get("student"))?.personId).toBe("student");
    const periods = await latest.academicPeriods.toArray();
    periods.sort((a, b) => a.startDate.localeCompare(b.startDate));
    expect(periods).toHaveLength(2);
    expect(periods[0].endDate < periods[1].startDate).toBe(true);
    expect(periods[0].startDate).toBe("2024-09-01");
    expect(periods[1].endDate).toBe("2025-06-30");
    for (const assessment of await latest.assessments.toArray()) {
      const period = periods.find(row => row.id === assessment.academicPeriodId)!;
      expect(assessment.assessmentDate).toBe(period.endDate);
    }
  } finally { legacy.close(); latest.close(); await Dexie.delete(name); }
});
