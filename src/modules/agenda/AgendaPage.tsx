import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { setSelectedClass, setSelectedSubject } from "../../app/store";
import {
  buildAgendaIcs,
  buildAgendaItems,
  type AgendaItem,
  type AgendaItemKind,
  type AgendaUrgency
} from "../../shared/agenda/agenda";
import { db } from "../../shared/db/database";
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
} from "../../shared/db/types";
import { toLocalIsoDate } from "../../shared/utils/date";
import { trackAnalyticsEvent } from "../../shared/analytics/analytics";
import { downloadBlob } from "../../shared/utils/download";

type AgendaData = {
  classGroups: ClassGroup[];
  students: Student[];
  subjects: Subject[];
  tasks: Task[];
  followUps: StudentFollowUp[];
  familyContacts: FamilyContact[];
  taskSessions: TaskSession[];
  academicPeriods: AcademicPeriod[];
  assessments: Assessment[];
  scheduleDays: ScheduleDay[];
  dailyClassRecords: DailyClassRecord[];
};

const EMPTY_DATA: AgendaData = {
  classGroups: [],
  students: [],
  subjects: [],
  tasks: [],
  followUps: [],
  familyContacts: [],
  taskSessions: [],
  academicPeriods: [],
  assessments: [],
  scheduleDays: [],
  dailyClassRecords: []
};

const KIND_LABELS: Record<AgendaItemKind, string> = {
  followUp: "Seguimiento",
  familyContact: "Familia",
  taskSession: "Clase",
  academicPeriod: "Periodo",
  assessment: "Prueba"
};

const URGENCY_LABELS: Record<AgendaUrgency, string> = {
  overdue: "Vencido",
  today: "Hoy",
  upcoming: "Próximo"
};

function formatAgendaDate(date: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(`${date}T12:00:00`));
}

function downloadCalendar(items: AgendaItem[], today: string): void {
  const blob = new Blob([buildAgendaIcs(items)], { type: "text/calendar;charset=utf-8" });
  downloadBlob(`edunoza-agenda-${today}.ics`, blob);
}

export function AgendaPage() {
  const dispatch = useAppDispatch();
  const today = toLocalIsoDate();
  const [data, setData] = useState<AgendaData>(EMPTY_DATA);
  const selectedClassId = useAppSelector((state) => state.app.selectedClassId);
  const classFilter = selectedClassId || "all";
  const [kindFilter, setKindFilter] = useState<AgendaItemKind | "all">("all");
  const [urgencyFilter, setUrgencyFilter] = useState<AgendaUrgency | "all">("all");
  const [horizonDays, setHorizonDays] = useState(30);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      const [
        classGroups,
        students,
        subjects,
        tasks,
        followUps,
        familyContacts,
        taskSessions,
        academicPeriods,
        assessments,
        scheduleDays,
        dailyClassRecords
      ] = await Promise.all([
        db.classGroups.orderBy("name").toArray(),
        db.students.toArray(),
        db.subjects.toArray(),
        db.tasks.toArray(),
        db.studentFollowUps.toArray(),
        db.familyContacts.toArray(),
        db.taskSessions.toArray(),
        db.academicPeriods.toArray(),
        db.assessments.toArray(),
        db.scheduleDays.toArray(),
        db.dailyClassRecords.toArray()
      ]);
      if (!active) return;
      setData({
        classGroups,
        students,
        subjects,
        tasks,
        followUps,
        familyContacts,
        taskSessions,
        academicPeriods,
        assessments,
        scheduleDays,
        dailyClassRecords
      });
      setIsLoading(false);
    };

    void load().catch((error: unknown) => {
      if (!active) return;
      const message = error instanceof Error ? error.message : "Error desconocido";
      setNotice(`No se pudo cargar la agenda: ${message}.`);
      setIsLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const allItems = useMemo(
    () => buildAgendaItems({ today, horizonDays, ...data }),
    [data, horizonDays, today]
  );
  const classItems = useMemo(
    () => allItems.filter((item) => classFilter === "all" || item.classId === classFilter),
    [allItems, classFilter]
  );
  const visibleItems = useMemo(
    () =>
      classItems.filter(
        (item) =>
          (kindFilter === "all" || item.kind === kindFilter) &&
          (urgencyFilter === "all" || item.urgency === urgencyFilter)
      ),
    [classItems, kindFilter, urgencyFilter]
  );
  const counts = useMemo(
    () => ({
      total: classItems.length,
      overdue: classItems.filter((item) => item.urgency === "overdue").length,
      today: classItems.filter((item) => item.urgency === "today").length,
      upcoming: classItems.filter((item) => item.urgency === "upcoming").length
    }),
    [classItems]
  );

  const selectItemContext = (item: AgendaItem): void => {
    dispatch(setSelectedClass(item.classId));
    if (item.subjectId) dispatch(setSelectedSubject(item.subjectId));
  };

  const exportVisibleItems = (): void => {
    if (visibleItems.length === 0) return;
    downloadCalendar(visibleItems, today);
    trackAnalyticsEvent("calendar_exported");
    setNotice(
      `Calendario descargado con ${visibleItems.length} ${visibleItems.length === 1 ? "elemento" : "elementos"}.`
    );
  };

  return (
    <section className="agenda-page" aria-labelledby="agenda-title">
      <div className="courses-layout agenda-layout">
        <aside className="courses-list-panel agenda-sidebar" aria-label="Opciones de agenda">
      <section className="agenda-filters" aria-labelledby="agenda-filters-title">
        <h2 id="agenda-filters-title" className="sr-only">Filtrar agenda</h2>
        <label className="compact-field">
          <span>Grupo</span>
          <select value={classFilter} onChange={(event) => dispatch(setSelectedClass(event.target.value === "all" ? "" : event.target.value))}>
            <option value="all">Todos los grupos</option>
            {data.classGroups.map((classGroup) => (
              <option key={classGroup.id} value={classGroup.id}>{classGroup.name}</option>
            ))}
          </select>
        </label>
        <label className="compact-field">
          <span>Tipo</span>
          <select
            value={kindFilter}
            onChange={(event) => setKindFilter(event.target.value as AgendaItemKind | "all")}
          >
            <option value="all">Todos los tipos</option>
            {Object.entries(KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="compact-field">
          <span>Estado</span>
          <select
            value={urgencyFilter}
            onChange={(event) => setUrgencyFilter(event.target.value as AgendaUrgency | "all")}
          >
            <option value="all">Todos los estados</option>
            {Object.entries(URGENCY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="compact-field">
          <span>Horizonte</span>
          <select value={horizonDays} onChange={(event) => setHorizonDays(Number(event.target.value))}>
            <option value={7}>7 días</option>
            <option value={30}>30 días</option>
            <option value={60}>60 días</option>
            <option value={90}>90 días</option>
          </select>
        </label>
      </section>

      <div className="inline-form">
        <h1 id="agenda-title" className="sr-only">Agenda</h1>
        <button
          type="button"
          className="btn secondary"
          disabled={visibleItems.length === 0}
          onClick={exportVisibleItems}
        >
          Descargar calendario
        </button>
      </div>

        </aside>
        <div className="course-detail-panel agenda-main">
      <section className="agenda-metrics" aria-label="Resumen de la agenda">
        <article className="agenda-metric overdue">
          <strong>{counts.overdue}</strong>
          <span>Vencidos</span>
        </article>
        <article className="agenda-metric today">
          <strong>{counts.today}</strong>
          <span>Para hoy</span>
        </article>
        <article className="agenda-metric upcoming">
          <strong>{counts.upcoming}</strong>
          <span>Próximos</span>
        </article>
        <article className="agenda-metric total">
          <strong>{counts.total}</strong>
          <span>Total</span>
        </article>
      </section>

      {notice ? (
        <p className="notice" role={notice.startsWith("No se pudo") ? "alert" : "status"}>
          {notice}
        </p>
      ) : null}

      <p className="sr-only" role="status" aria-live="polite">
        {visibleItems.length} {visibleItems.length === 1 ? "elemento visible" : "elementos visibles"}.
      </p>

      <section className="agenda-results" aria-labelledby="agenda-results-title" aria-busy={isLoading}>
        <div className="agenda-results-heading">
          <div>
            <h2 id="agenda-results-title">Próximas acciones</h2>
            <p>Se muestran hasta {horizonDays} días por delante y las acciones vencidas relevantes.</p>
          </div>
          <span>{visibleItems.length}</span>
        </div>

        {isLoading ? (
          <p className="empty-state" role="status">Cargando agenda…</p>
        ) : visibleItems.length === 0 ? (
          <div className="agenda-empty">
            <strong>No hay acciones con estos filtros.</strong>
            <p>Amplía el horizonte o revisa otro curso.</p>
          </div>
        ) : (
          <ol className="agenda-list">
            {visibleItems.map((item) => (
              <li key={item.id} className={`agenda-item ${item.urgency}`}>
                <time dateTime={item.date}>{formatAgendaDate(item.date)}</time>
                <div className="agenda-item-body">
                  <div className="agenda-item-labels">
                    <span className={`agenda-status ${item.urgency}`}>{URGENCY_LABELS[item.urgency]}</span>
                    <span className="agenda-kind">{KIND_LABELS[item.kind]}</span>
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.detail}{item.startTime && item.endTime ? ` · ${item.startTime}–${item.endTime}` : ""}</p>
                </div>
                <NavLink
                  className="btn secondary agenda-item-action"
                  to={item.route}
                  onClick={() => selectItemContext(item)}
                  aria-label={`Abrir ${item.title}`}
                >
                  Abrir
                </NavLink>
              </li>
            ))}
          </ol>
        )}
      </section>
        </div>
      </div>
    </section>
  );
}
