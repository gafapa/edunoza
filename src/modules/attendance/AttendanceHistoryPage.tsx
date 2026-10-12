import { useEffect, useMemo, useState } from "react";
import { NavLink, useSearchParams } from "react-router-dom";
import { db } from "../../shared/db/database";
import type {
  AttendanceEntry,
  ClassGroup,
  ScheduleDay,
  Student,
  Subject,
  SubjectCourseLink
} from "../../shared/db/types";
import { useStudentDisplay } from "../../shared/hooks/useStudentDisplay";
import { SubnavActions } from "../../shared/ui/SubnavActions";

const STATUS_LABELS: Record<AttendanceEntry["status"], string> = {
  present: "Presente",
  late: "Retraso",
  absent: "Ausente"
};

export function formatAttendanceStatus(entry: AttendanceEntry): string {
  if (entry.status === "absent" && entry.absenceJustified) return "Ausencia justificada";
  if (entry.status === "late" && entry.lateMinutes) return `Retraso · ${entry.lateMinutes} min`;
  return STATUS_LABELS[entry.status];
}

export function formatAttendanceDetails(entry: AttendanceEntry): string {
  const details = [
    entry.earlyDepartureMinutes
      ? `Salida anticipada: ${entry.earlyDepartureMinutes} min`
      : "",
    entry.note?.trim() ?? ""
  ].filter(Boolean);
  return details.join(" · ") || "-";
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonth(value: string): string {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(
    new Date(year, month - 1, 1)
  );
}

export function buildTodayLink(
  entry: AttendanceEntry
): string {
  const params = new URLSearchParams({
    date: entry.date,
    classId: entry.classId
  });
  params.set("slotId", entry.scheduleSlotId);
  params.set("subjectId", entry.subjectId);
  return `/today?${params.toString()}`;
}

export function AttendanceHistoryPage() {
  const { formatName } = useStudentDisplay();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedMonth = searchParams.get("month") ?? "";
  const requestedClassId = searchParams.get("classId") ?? "all";
  const requestedSubjectId = searchParams.get("subjectId") ?? "all";
  const [selectedMonth, setSelectedMonth] = useState(/^\d{4}-\d{2}$/.test(requestedMonth) ? requestedMonth : currentMonth());
  const [selectedClassId, setSelectedClassId] = useState(requestedClassId);
  const [selectedSubjectId, setSelectedSubjectId] = useState(requestedSubjectId);
  const [statusFilter, setStatusFilter] = useState<"all" | AttendanceEntry["status"]>("all");
  const [studentQuery, setStudentQuery] = useState("");
  const [classGroups, setClassGroups] = useState<ClassGroup[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectCourseLinks, setSubjectCourseLinks] = useState<SubjectCourseLink[]>([]);
  const [scheduleDays, setScheduleDays] = useState<ScheduleDay[]>([]);
  const [attendanceEntries, setAttendanceEntries] = useState<AttendanceEntry[]>([]);

  useEffect(() => {
    const load = async (): Promise<void> => {
      const [groups, studentRows, subjectRows, courseLinks, days, entries] = await Promise.all([
        db.classGroups.orderBy("name").toArray(),
        db.students.toArray(),
        db.subjects.orderBy("name").toArray(),
        db.subjectCourseLinks.toArray(),
        db.scheduleDays.orderBy("dayOfWeek").toArray(),
        db.attendanceEntries.toArray()
      ]);
      setClassGroups(groups);
      setStudents(studentRows);
      setSubjects(subjectRows);
      setSubjectCourseLinks(courseLinks);
      setScheduleDays(days);
      setAttendanceEntries(entries);
    };
    void load();
  }, []);

  useEffect(() => {
    if (selectedClassId !== "all" && !classGroups.some((group) => group.id === selectedClassId)) {
      setSelectedClassId("all");
    }
  }, [classGroups, selectedClassId]);

  useEffect(() => {
    const next = new URLSearchParams();
    next.set("month", selectedMonth);
    if (selectedClassId !== "all") next.set("classId", selectedClassId);
    if (selectedSubjectId !== "all") next.set("subjectId", selectedSubjectId);
    setSearchParams(next, { replace: true });
  }, [selectedClassId, selectedMonth, selectedSubjectId, setSearchParams]);

  const classById = useMemo(() => new Map(classGroups.map((group) => [group.id, group])), [classGroups]);
  const studentById = useMemo(() => new Map(students.map((student) => [student.id, student])), [students]);
  const slotTimeById = useMemo(() => {
    const map = new Map<string, string>();
    for (const day of scheduleDays) {
      for (const block of day.blocks) {
        map.set(block.id, `${block.startTime} - ${block.endTime}`);
      }
    }
    return map;
  }, [scheduleDays]);
  const subjectById = useMemo(() => new Map(subjects.map((subject) => [subject.id, subject])), [subjects]);
  const subjectsForFilter = useMemo(() => {
    if (selectedClassId === "all") return subjects;
    const linkedIds = new Set(
      subjectCourseLinks.filter((link) => link.classId === selectedClassId).map((link) => link.subjectId)
    );
    return subjects.filter((subject) => linkedIds.has(subject.id));
  }, [selectedClassId, subjectCourseLinks, subjects]);

  useEffect(() => {
    if (selectedSubjectId !== "all" && !subjectsForFilter.some((subject) => subject.id === selectedSubjectId)) {
      setSelectedSubjectId("all");
    }
  }, [selectedSubjectId, subjectsForFilter]);

  const filteredEntries = useMemo(
    () =>
      attendanceEntries
        .filter((entry) => entry.date.startsWith(selectedMonth))
        .filter((entry) => selectedClassId === "all" || entry.classId === selectedClassId)
        .filter((entry) => {
          return selectedSubjectId === "all" || entry.subjectId === selectedSubjectId;
        })
        .filter((entry) => statusFilter === "all" || entry.status === statusFilter)
        .filter((entry) => {
          const query = studentQuery.trim().toLocaleLowerCase("es");
          if (!query) return true;
          const student = studentById.get(entry.studentId);
          return Boolean(student && formatName(student).toLocaleLowerCase("es").includes(query));
        })
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            (a.startTime ?? slotTimeById.get(a.scheduleSlotId) ?? "").localeCompare(
              b.startTime ?? slotTimeById.get(b.scheduleSlotId) ?? ""
            ) ||
            (studentById.get(a.studentId)?.fullName ?? "").localeCompare(
              studentById.get(b.studentId)?.fullName ?? ""
            )
        ),
    [attendanceEntries, formatName, selectedClassId, selectedMonth, selectedSubjectId, slotTimeById, statusFilter, studentById, studentQuery]
  );

  const summary = useMemo(() => {
    const present = filteredEntries.filter((entry) => entry.status === "present").length;
    const late = filteredEntries.filter((entry) => entry.status === "late").length;
    const absent = filteredEntries.filter((entry) => entry.status === "absent").length;
    const sessions = new Set(
      filteredEntries.map((entry) => `${entry.classId}:${entry.date}:${entry.scheduleSlotId}`)
    ).size;
    return { present, late, absent, sessions };
  }, [filteredEntries]);

  const studentIncidents = useMemo(() => {
    const rows = new Map<string, { student: Student; absent: number; late: number; lastDate: string }>();
    for (const entry of filteredEntries) {
      if (entry.status === "present") continue;
      const student = studentById.get(entry.studentId);
      if (!student) continue;
      const current = rows.get(student.id) ?? { student, absent: 0, late: 0, lastDate: "" };
      if (entry.status === "absent") current.absent += 1;
      if (entry.status === "late") current.late += 1;
      if (entry.date > current.lastDate) current.lastDate = entry.date;
      rows.set(student.id, current);
    }
    return Array.from(rows.values()).sort(
      (a, b) => b.absent - a.absent || b.late - a.late || formatName(a.student).localeCompare(formatName(b.student))
    );
  }, [filteredEntries, formatName, studentById]);

  return (
    <section className="module-card attendance-history-page" aria-labelledby="attendance-history-title">
      <div className="courses-layout attendance-history-layout">
        <aside className="courses-list-panel attendance-history-sidebar">
          <label className="detail-field full compact-field" htmlFor="attendance-history-month">
            <span>Mes</span>
            <input
              id="attendance-history-month"
              className="input"
              type="month"
              value={selectedMonth}
              onChange={(event) => setSelectedMonth(event.target.value)}
            />
          </label>
          <div className="context-sidebar-separator" aria-hidden="true" />
          <strong>Grupo</strong>
          <div className="courses-list section-tabs context-sidebar-list" role="group" aria-label="Filtrar por curso">
            <button
              type="button"
              aria-pressed={selectedClassId === "all"}
              className={`section-tab ${selectedClassId === "all" ? "active" : ""}`}
              onClick={() => setSelectedClassId("all")}
            >
              <span>Todos los cursos</span>
            </button>
            {classGroups.map((group) => (
              <button
                key={group.id}
                type="button"
                aria-pressed={selectedClassId === group.id}
                className={`section-tab ${selectedClassId === group.id ? "active" : ""}`}
                onClick={() => setSelectedClassId(group.id)}
              >
                <span>{group.name}</span>
                <small>{group.schoolYear}</small>
              </button>
            ))}
          </div>
          <div className="context-sidebar-separator" aria-hidden="true" />
          <label className="detail-field full compact-field">
            <span>Asignatura</span>
            <select className="input" value={selectedSubjectId} onChange={(event) => setSelectedSubjectId(event.target.value)}>
              <option value="all">Todas</option>
              {subjectsForFilter.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </select>
          </label>
          <label className="detail-field full compact-field">
            <span>Estado</span>
            <select
              className="input"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "all" | AttendanceEntry["status"])}
            >
              <option value="all">Todos</option>
              <option value="present">Presente</option>
              <option value="late">Retraso</option>
              <option value="absent">Ausente</option>
            </select>
          </label>
          <label className="detail-field full compact-field">
            <span>Alumno</span>
            <input
              className="input"
              type="search"
              value={studentQuery}
              onChange={(event) => setStudentQuery(event.target.value)}
              placeholder="Buscar por nombre"
            />
          </label>
        </aside>

        <div className="course-detail-panel attendance-history-main">
          <header className="attendance-history-header">
            <div>
              <h1 id="attendance-history-title">Historial de asistencia</h1>
              <p>{formatMonth(selectedMonth)}</p>
            </div>
          </header>
          <SubnavActions>
            <NavLink className="subnav-link" to="/today">Registrar en Hoy</NavLink>
          </SubnavActions>

          <section className="metric-grid compact" aria-label="Resumen mensual de asistencia">
            <article className="metric-item"><strong>Sesiones</strong><div>{summary.sessions}</div></article>
            <article className="metric-item"><strong>Presentes</strong><div>{summary.present}</div></article>
            <article className="metric-item"><strong>Retrasos</strong><div>{summary.late}</div></article>
            <article className="metric-item"><strong>Ausencias</strong><div>{summary.absent}</div></article>
          </section>

          <section className="detail-section">
            <h2>Incidencias por alumno</h2>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Alumno o alumna</th><th>Grupo</th><th>Ausencias</th><th>Retrasos</th><th>Última</th></tr></thead>
                <tbody>
                  {studentIncidents.map((row) => (
                    <tr key={row.student.id}>
                      <td>{formatName(row.student)}</td>
                      <td>{classById.get(row.student.classId)?.name ?? "-"}</td>
                      <td>{row.absent}</td>
                      <td>{row.late}</td>
                      <td>{row.lastDate}</td>
                    </tr>
                  ))}
                  {studentIncidents.length === 0 ? <tr><td colSpan={5}>No hay incidencias en este periodo.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="detail-section">
            <h2>Registros del mes</h2>
            <div className="table-scroll attendance-history-records">
              <table>
                <thead>
                  <tr><th>Fecha</th><th>Hora</th><th>Grupo</th><th>Asignatura</th><th>Alumno o alumna</th><th>Estado</th><th>Observación</th><th>Acción</th></tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry) => {
                    const student = studentById.get(entry.studentId);
                    return (
                      <tr key={entry.id}>
                        <td>{entry.date}</td>
                        <td>
                          {entry.startTime && entry.endTime
                            ? `${entry.startTime} - ${entry.endTime}`
                            : slotTimeById.get(entry.scheduleSlotId) ?? "-"}
                        </td>
                        <td>{classById.get(entry.classId)?.name ?? "-"}</td>
                        <td>{subjectById.get(entry.subjectId)?.name ?? "-"}</td>
                        <td>{student ? formatName(student) : "Alumno no disponible"}</td>
                        <td><span className={`attendance-history-status ${entry.status}`}>{formatAttendanceStatus(entry)}</span></td>
                        <td>{formatAttendanceDetails(entry)}</td>
                        <td><NavLink className="btn secondary compact-link" to={buildTodayLink(entry)}>Revisar clase</NavLink></td>
                      </tr>
                    );
                  })}
                  {filteredEntries.length === 0 ? <tr><td colSpan={8}>No hay registros para estos filtros.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
