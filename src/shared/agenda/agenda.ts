import type {
  AcademicPeriod,
  Assessment,
  ClassGroup,
  DailyClassRecord,
  FamilyContact,
  ScheduleDay,
  Student,
  StudentFollowUp,
  Subject,
  Task,
  TaskSession
} from "../db/types";

export type AgendaItemKind =
  | "followUp"
  | "familyContact"
  | "taskSession"
  | "academicPeriod"
  | "assessment";

export type AgendaUrgency = "overdue" | "today" | "upcoming";

export type AgendaItem = {
  id: string;
  sourceId: string;
  kind: AgendaItemKind;
  date: string;
  startTime?: string;
  endTime?: string;
  urgency: AgendaUrgency;
  title: string;
  detail: string;
  classId: string;
  subjectId?: string;
  route: string;
  priority: number;
};

export type AgendaSource = {
  today: string;
  horizonDays: number;
  classGroups: ClassGroup[];
  students: Student[];
  subjects: Subject[];
  tasks: Task[];
  followUps: StudentFollowUp[];
  familyContacts: FamilyContact[];
  taskSessions: TaskSession[];
  academicPeriods: AcademicPeriod[];
  assessments: Assessment[];
  scheduleDays?: ScheduleDay[];
  dailyClassRecords?: DailyClassRecord[];
};

const KIND_ORDER: Record<AgendaItemKind, number> = {
  followUp: 0,
  familyContact: 1,
  taskSession: 2,
  assessment: 3,
  academicPeriod: 4
};

function shiftIsoDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return value.toISOString().slice(0, 10);
}

function agendaUrgency(date: string, today: string): AgendaUrgency {
  if (date < today) return "overdue";
  if (date === today) return "today";
  return "upcoming";
}

function followUpPriority(value: StudentFollowUp["priority"]): number {
  if (value === "high") return 0;
  if (value === "low") return 2;
  return 1;
}

function queryString(values: Record<string, string | undefined>): string {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) parameters.set(key, value);
  }
  const query = parameters.toString();
  return query ? `?${query}` : "";
}

export function buildAgendaItems(source: AgendaSource): AgendaItem[] {
  const horizonEnd = shiftIsoDate(source.today, Math.max(1, source.horizonDays));
  const recentSessionStart = shiftIsoDate(source.today, -14);
  const classNameById = new Map(source.classGroups.map((item) => [item.id, item.name]));
  const studentNameById = new Map(
    source.students.map((item) => [item.id, item.fullName || `${item.firstName} ${item.lastName}`.trim()])
  );
  const subjectNameById = new Map(source.subjects.map((item) => [item.id, item.name]));
  const taskNameById = new Map(source.tasks.map((item) => [item.id, item.title]));
  const slotById = new Map((source.scheduleDays ?? []).flatMap((day) => day.blocks.map((block) => [block.id, block] as const)));
  const items: AgendaItem[] = [];

  for (const followUp of source.followUps) {
    const isDone = followUp.status === "done" || followUp.resolved;
    if (isDone || !followUp.dueDate || followUp.dueDate > horizonEnd) continue;
    const studentName = studentNameById.get(followUp.studentId) ?? "Alumno sin identificar";
    const owner = followUp.responsiblePerson?.trim();
    items.push({
      id: `follow-up:${followUp.id}`,
      sourceId: followUp.id,
      kind: "followUp",
      date: followUp.dueDate,
      urgency: agendaUrgency(followUp.dueDate, source.today),
      title: `Seguimiento: ${followUp.title}`,
      detail: [studentName, owner ? `Responsable: ${owner}` : ""].filter(Boolean).join(" · "),
      classId: followUp.classId,
      route: "/management/tutor",
      priority: followUpPriority(followUp.priority)
    });
  }

  const latestContactDateByStudent = new Map<string, string>();
  for (const contact of source.familyContacts) {
    const currentDate = latestContactDateByStudent.get(contact.studentId);
    if (!currentDate || contact.date > currentDate) {
      latestContactDateByStudent.set(contact.studentId, contact.date);
    }
  }

  for (const contact of source.familyContacts) {
    if (contact.status === "done" || !contact.dueDate || !contact.nextStep?.trim() || contact.dueDate > horizonEnd) continue;
    if (contact.date !== latestContactDateByStudent.get(contact.studentId)) continue;
    const studentName = studentNameById.get(contact.studentId) ?? "Alumno sin identificar";
    items.push({
      id: `family-contact:${contact.id}`,
      sourceId: contact.id,
      kind: "familyContact",
      date: contact.dueDate,
      urgency: agendaUrgency(contact.dueDate, source.today),
      title: `Próximo contacto: ${studentName}`,
      detail: contact.nextStep.trim(),
      classId: contact.classId,
      route: "/management/tutor",
      priority: 1
    });
  }

  for (const session of source.taskSessions) {
    if (
      session.status !== "planned" ||
      session.date < recentSessionStart ||
      session.date > horizonEnd
    ) {
      continue;
    }
    const taskName = taskNameById.get(session.taskId) ?? "Tarea sin título";
    const subjectName = subjectNameById.get(session.subjectId) ?? "Asignatura sin identificar";
    const className = classNameById.get(session.classId) ?? "Curso sin identificar";
    const slot = slotById.get(session.scheduleSlotId);
    const record = source.dailyClassRecords?.find((item) => item.classId === session.classId && item.subjectId === session.subjectId && item.date === session.date && item.scheduleSlotId === session.scheduleSlotId);
    items.push({
      id: `task-session:${session.id}`,
      sourceId: session.id,
      kind: "taskSession",
      date: session.date,
      startTime: record?.startTime ?? slot?.startTime,
      endTime: record?.endTime ?? slot?.endTime,
      urgency: agendaUrgency(session.date, source.today),
      title: `Clase: ${taskName}`,
      detail: `${subjectName} · ${className}`,
      classId: session.classId,
      subjectId: session.subjectId,
      route: `/planner${queryString({
        classId: session.classId,
        subjectId: session.subjectId,
        date: session.date,
        slotId: session.scheduleSlotId
      })}`,
      priority: 1
    });
  }

  for (const assessment of source.assessments) {
    if (
      !assessment.assessmentDate ||
      assessment.assessmentDate < source.today ||
      assessment.assessmentDate > horizonEnd
    ) {
      continue;
    }
    const subjectName = subjectNameById.get(assessment.subjectId) ?? "Asignatura sin identificar";
    const className = classNameById.get(assessment.classId) ?? "Curso sin identificar";
    items.push({
      id: `assessment:${assessment.id}`,
      sourceId: assessment.id,
      kind: "assessment",
      date: assessment.assessmentDate,
      urgency: agendaUrgency(assessment.assessmentDate, source.today),
      title: `Prueba: ${assessment.title}`,
      detail: `${subjectName} · ${className}`,
      classId: assessment.classId,
      subjectId: assessment.subjectId,
      route: "/gradebook",
      priority: 1
    });
  }

  for (const period of source.academicPeriods) {
    if (period.status !== "open" || period.endDate > horizonEnd) continue;
    const className = classNameById.get(period.classId) ?? "Curso sin identificar";
    items.push({
      id: `academic-period:${period.id}`,
      sourceId: period.id,
      kind: "academicPeriod",
      date: period.endDate,
      urgency: agendaUrgency(period.endDate, source.today),
      title: `Revisar cierre: ${period.name}`,
      detail: className,
      classId: period.classId,
      route: "/management/periods",
      priority: 1
    });
  }

  return items.sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.priority - right.priority ||
      KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
      left.title.localeCompare(right.title, "es")
  );
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function compactIcsDate(value: string): string {
  return value.replace(/-/g, "");
}

function compactIcsTimestamp(value: Date): string {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let currentBytes = 0;

  for (const character of line) {
    const characterBytes = encoder.encode(character).length;
    if (current && currentBytes + characterBytes > 75) {
      parts.push(current);
      current = ` ${character}`;
      currentBytes = 1 + characterBytes;
    } else {
      current += character;
      currentBytes += characterBytes;
    }
  }
  parts.push(current);
  return parts.join("\r\n");
}

export function buildAgendaIcs(items: AgendaItem[], generatedAt = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Edunoza//Agenda//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH"
  ];
  const timestamp = compactIcsTimestamp(generatedAt);

  for (const item of items) {
    const hasTime = /^\d{2}:\d{2}$/.test(item.startTime ?? "") && /^\d{2}:\d{2}$/.test(item.endTime ?? "");
    // The app stores local wall-clock times. Resolve each dated occurrence in
    // the exporting browser's time zone and emit fixed UTC instants (RFC 5545).
    const start = hasTime ? new Date(`${item.date}T${item.startTime}:00`) : null;
    const endDate = hasTime && item.endTime! <= item.startTime! ? shiftIsoDate(item.date, 1) : item.date;
    const end = hasTime ? new Date(`${endDate}T${item.endTime}:00`) : null;
    const timed = start !== null && end !== null && Number.isFinite(start.getTime()) && Number.isFinite(end.getTime());
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(item.id)}@edunoza.com`,
      `DTSTAMP:${timestamp}`,
      timed ? `DTSTART:${compactIcsTimestamp(start)}` : `DTSTART;VALUE=DATE:${compactIcsDate(item.date)}`,
      timed ? `DTEND:${compactIcsTimestamp(end)}` : `DTEND;VALUE=DATE:${compactIcsDate(shiftIsoDate(item.date, 1))}`,
      `SUMMARY:${escapeIcsText(item.title)}`,
      `DESCRIPTION:${escapeIcsText(item.detail)}`,
      `CATEGORIES:${item.kind}`,
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}
