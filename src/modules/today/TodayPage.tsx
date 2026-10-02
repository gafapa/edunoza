import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useSearchParams } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { setSelectedClass } from "../../app/store";
import { db } from "../../shared/db/database";
import type {
  AttendanceEntry,
  BehaviorMark,
  ClassGroup,
  DailyClassRecord,
  ScheduleDay,
  Student,
  Subject,
  SubjectCourseLink,
  SubjectStudentLink,
  Task,
  TaskDailyEvaluationSetting,
  TaskSession,
  TaskStudentComment
} from "../../shared/db/types";
import {
  matchesAttendanceScope,
  normalizeAttendanceDetails,
  normalizeAttendanceNote,
  resolveAttendanceNoteForSave,
  type AttendanceDetailsDraft
} from "../../shared/attendance/attendance";
import { matchesTaskScope } from "../../shared/gradebook/calculations";
import { FeedbackCommentPicker } from "../../shared/feedback/FeedbackCommentPicker";
import { useStudentDisplay } from "../../shared/hooks/useStudentDisplay";
import { useUnsavedChangesGuard } from "../../shared/hooks/useUnsavedChangesGuard";
import { Modal } from "../../shared/ui/Modal";
import { ClassGroupSelect } from "../../shared/ui/ClassGroupSelect";
import { useUnsavedChangesDialog } from "../../shared/ui/UnsavedChangesDialog";
import { buildTodaySlots, type TodaySlot } from "./todaySlots";
import { trackAnalyticsEvent } from "../../shared/analytics/analytics";
import { buildAllPresentDraft } from "./todayAttendance";
import { isTodayDraft, type TodayDraft } from "./todayDraft";
import { useRecoverableDraft } from "../../shared/hooks/useRecoverableDraft";
import { DraftRecoveryNotice } from "../../shared/ui/DraftRecoveryNotice";
import { ResourceManager } from "../../shared/resources/ResourceManager";
import { journalEntryOwnerId } from "../../shared/resources/resources";
import { BehaviorControls } from "./BehaviorControls";

const STATUS_LABELS: Record<AttendanceEntry["status"], string> = {
  present: "Presente",
  late: "Retraso",
  absent: "Ausente"
};

const STATUS_SHORT_LABELS: Record<AttendanceEntry["status"], string> = {
  present: "P",
  late: "R",
  absent: "A"
};

const SESSION_STATUS_LABELS: Record<NonNullable<TaskSession["status"]>, string> = {
  planned: "Planificada",
  done: "Hecha",
  moved: "Movida",
  cancelled: "Cancelada"
};

const DATE_LABEL_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  weekday: "long",
  day: "numeric",
  month: "long"
});

type ExceptionalSessionDraft = {
  classId: string;
  subjectId: string;
  date: string;
  startTime: string;
  endTime: string;
  title: string;
};

function toIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftIsoDate(value: string, deltaDays: number): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + deltaDays);
  return toIsoDate(date);
}

function formatDateLabel(value: string): string {
  return DATE_LABEL_FORMATTER.format(new Date(`${value}T12:00:00`));
}

function toMinutes(value: string): number {
  const [hourRaw, minuteRaw] = value.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : 0;
}

function closestSlotKey(slots: TodaySlot[], date: string): string {
  if (slots.length === 0) return "";
  if (date !== toIsoDate(new Date())) return slots[0].key;

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const activeSlot = slots.find((slot) => toMinutes(slot.startTime) <= nowMinutes && nowMinutes <= toMinutes(slot.endTime));
  if (activeSlot) return activeSlot.key;
  const upcomingSlot = slots.find((slot) => toMinutes(slot.startTime) >= nowMinutes);
  if (upcomingSlot) return upcomingSlot.key;

  return slots.reduce((best, slot) => {
    const bestDistance = Math.abs(toMinutes(best.startTime) - nowMinutes);
    const currentDistance = Math.abs(toMinutes(slot.startTime) - nowMinutes);
    return currentDistance < bestDistance ? slot : best;
  }, slots[0]).key;
}

export function TodayPage() {
  const dispatch = useAppDispatch();
  const selectedClassId = useAppSelector((state) => state.app.selectedClassId);
  const { formatName, compareFn } = useStudentDisplay();
  const unsavedChangesDialog = useUnsavedChangesDialog();
  const [searchParams] = useSearchParams();
  const requestedDate = searchParams.get("date") ?? "";
  const [selectedDate, setSelectedDate] = useState(() =>
    /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : toIsoDate(new Date())
  );
  const [selectedSlotKey, setSelectedSlotKey] = useState("");
  const [loadedAttendanceKey, setLoadedAttendanceKey] = useState("");
  const deepLinkAppliedRef = useRef(false);
  const appliedClassLinkRef = useRef("");
  const [classGroups, setClassGroups] = useState<ClassGroup[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectCourseLinks, setSubjectCourseLinks] = useState<SubjectCourseLink[]>([]);
  const [scheduleDays, setScheduleDays] = useState<ScheduleDay[]>([]);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [subjectStudentLinks, setSubjectStudentLinks] = useState<SubjectStudentLink[]>([]);
  const [attendanceEntries, setAttendanceEntries] = useState<AttendanceEntry[]>([]);
  const [dailyClassRecords, setDailyClassRecords] = useState<DailyClassRecord[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskSessions, setTaskSessions] = useState<TaskSession[]>([]);
  const [taskDailySettings, setTaskDailySettings] = useState<TaskDailyEvaluationSetting[]>([]);
  const [taskStudentComments, setTaskStudentComments] = useState<TaskStudentComment[]>([]);
  const [behaviorMarks, setBehaviorMarks] = useState<BehaviorMark[]>([]);
  const [isSavingBehavior, setIsSavingBehavior] = useState(false);
  const behaviorWritePending = useRef(false);
  const [statusDraft, setStatusDraft] = useState<Map<string, AttendanceEntry["status"]>>(new Map());
  const [noteDraft, setNoteDraft] = useState<Map<string, string>>(new Map());
  const [attendanceDetailsDraft, setAttendanceDetailsDraft] = useState<Map<string, AttendanceDetailsDraft>>(new Map());
  const [generalCommentDraft, setGeneralCommentDraft] = useState("");
  const [studentCommentDraft, setStudentCommentDraft] = useState<Map<string, string>>(new Map());
  const [editingStudentDetailsId, setEditingStudentDetailsId] = useState("");
  const [bulkAttendanceUndo, setBulkAttendanceUndo] = useState<Map<string, AttendanceEntry["status"]> | null>(null);
  const [notice, setNotice] = useState("");
  const [isSavingAttendance, setIsSavingAttendance] = useState(false);
  const [isSavingWork, setIsSavingWork] = useState(false);
  const [exceptionalSessionMode, setExceptionalSessionMode] = useState<"adHoc" | "rescheduled" | null>(null);
  const [isCreatingExceptionalSession, setIsCreatingExceptionalSession] = useState(false);
  const [exceptionalSessionDraft, setExceptionalSessionDraft] = useState<ExceptionalSessionDraft>({
    classId: "",
    subjectId: "",
    date: toIsoDate(new Date()),
    startTime: "09:00",
    endTime: "09:50",
    title: ""
  });

  const loadMetadata = async (): Promise<void> => {
    const [
      classGroupsData,
      subjectsData,
      subjectCourseLinksData,
      scheduleDaysData,
      studentsData,
      subjectStudentLinksData,
      tasksData,
      taskSessionsData,
      taskDailySettingsData,
      taskStudentCommentsData,
      dailyClassRecordsData,
      behaviorMarksData
    ] = await Promise.all([
      db.classGroups.orderBy("name").toArray(),
      db.subjects.orderBy("name").toArray(),
      db.subjectCourseLinks.toArray(),
      db.scheduleDays.orderBy("dayOfWeek").toArray(),
      db.students.toArray(),
      db.subjectStudentLinks.toArray(),
      db.tasks.toArray(),
      db.taskSessions.toArray(),
      db.taskDailyEvaluationSettings.toArray(),
      db.taskStudentComments.toArray(),
      db.dailyClassRecords.toArray(),
      db.behaviorMarks.toArray()
    ]);

    setClassGroups(classGroupsData);
    setSubjects(subjectsData);
    setSubjectCourseLinks(subjectCourseLinksData);
    setScheduleDays(scheduleDaysData);
    setAllStudents(studentsData.sort(compareFn));
    setSubjectStudentLinks(subjectStudentLinksData);
    setTasks(tasksData.sort((a, b) => a.title.localeCompare(b.title)));
    setTaskSessions(taskSessionsData);
    setTaskDailySettings(taskDailySettingsData);
    setTaskStudentComments(taskStudentCommentsData);
    setDailyClassRecords(dailyClassRecordsData);
    setBehaviorMarks(behaviorMarksData);
  };

  useEffect(() => {
    void loadMetadata();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const allTodaySlots = useMemo(
    () =>
      buildTodaySlots({
        selectedDate,
        classGroups,
        subjects,
        subjectCourseLinks,
        scheduleDays,
        taskSessions,
        tasks,
        dailyClassRecords
      }),
    [classGroups, dailyClassRecords, scheduleDays, selectedDate, subjectCourseLinks, subjects, taskSessions, tasks]
  );

  const todaySlots = useMemo(
    () => selectedClassId ? allTodaySlots.filter((slot) => slot.classId === selectedClassId) : [],
    [allTodaySlots, selectedClassId]
  );

  useEffect(() => {
    if (classGroups.length === 0) return;
    if (selectedClassId && classGroups.some((group) => group.id === selectedClassId)) return;
    const requestedClassId = searchParams.get("classId") ?? "";
    if (requestedClassId && classGroups.some((group) => group.id === requestedClassId)) return;
    dispatch(setSelectedClass(classGroups[0].id));
  }, [classGroups, dispatch, searchParams, selectedClassId]);

  useEffect(() => {
    const requestedClassId = searchParams.get("classId") ?? "";
    if (
      requestedClassId &&
      appliedClassLinkRef.current !== requestedClassId &&
      classGroups.some((group) => group.id === requestedClassId)
    ) {
      appliedClassLinkRef.current = requestedClassId;
      dispatch(setSelectedClass(requestedClassId));
    }
  }, [classGroups, dispatch, searchParams, selectedClassId]);

  useEffect(() => {
    if (todaySlots.length === 0) {
      setSelectedSlotKey("");
      return;
    }
    if (!deepLinkAppliedRef.current) {
      const requestedClassId = searchParams.get("classId") ?? "";
      if (requestedClassId && requestedClassId !== selectedClassId && classGroups.some((group) => group.id === requestedClassId)) return;
      const requestedSubjectId = searchParams.get("subjectId") ?? "";
      const requestedSlotId = searchParams.get("slotId") ?? "";
      const requestedSlot = todaySlots.find(
        (slot) =>
          (!requestedClassId || slot.classId === requestedClassId) &&
          (!requestedSubjectId || slot.subjectId === requestedSubjectId) &&
          (!requestedSlotId || slot.slotId === requestedSlotId)
      );
      deepLinkAppliedRef.current = true;
      if (requestedSlot) {
        setSelectedSlotKey(requestedSlot.key);
        return;
      }
    }
    if (!todaySlots.some((slot) => slot.key === selectedSlotKey)) {
      setSelectedSlotKey(closestSlotKey(todaySlots, selectedDate));
    }
  }, [classGroups, searchParams, selectedClassId, selectedDate, selectedSlotKey, todaySlots]);

  const selectedSlot = useMemo(
    () => todaySlots.find((slot) => slot.key === selectedSlotKey) ?? null,
    [selectedSlotKey, todaySlots]
  );

  const students = useMemo(() => {
    if (!selectedSlot) return [];
    const linkedStudentIds = new Set(
      subjectStudentLinks
        .filter((link) => link.subjectId === selectedSlot.subjectId)
        .map((link) => link.studentId)
    );
    return allStudents
      .filter((student) => student.classId === selectedSlot.classId && linkedStudentIds.has(student.id))
      .sort(compareFn);
  }, [allStudents, compareFn, selectedSlot, subjectStudentLinks]);

  const selectedSession = useMemo(() => {
    if (!selectedSlot) return null;
    return (
      taskSessions.find(
        (session) =>
          session.classId === selectedSlot.classId &&
          session.subjectId === selectedSlot.subjectId &&
          session.date === selectedDate &&
          session.scheduleSlotId === selectedSlot.slotId &&
          session.status !== "cancelled" &&
          (!selectedSlot.taskId || session.taskId === selectedSlot.taskId)
      ) ?? null
    );
  }, [selectedDate, selectedSlot, taskSessions]);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedSession?.taskId) ?? null,
    [selectedSession?.taskId, tasks]
  );
  const editingStudentDetails = useMemo(
    () => students.find((student) => student.id === editingStudentDetailsId) ?? null,
    [editingStudentDetailsId, students]
  );

  const attendanceByStudent = useMemo(
    () => new Map(attendanceEntries.map((entry) => [entry.studentId, entry])),
    [attendanceEntries]
  );

  const baseStatusByStudent = useMemo(() => {
    const map = new Map<string, AttendanceEntry["status"]>();
    for (const student of students) {
      map.set(student.id, attendanceByStudent.get(student.id)?.status ?? "present");
    }
    return map;
  }, [attendanceByStudent, students]);

  const behaviorCountsByStudent = useMemo(() => {
    const map = new Map<string, { positive: number; negative: number }>();
    if (!selectedSlot) return map;
    for (const mark of behaviorMarks) {
      if (mark.date !== selectedDate || mark.classId !== selectedSlot.classId) continue;
      const counts = map.get(mark.studentId) ?? { positive: 0, negative: 0 };
      counts[mark.kind] += 1;
      map.set(mark.studentId, counts);
    }
    return map;
  }, [behaviorMarks, selectedDate, selectedSlot]);

  const changeBehaviorMark = async (studentId: string, kind: BehaviorMark["kind"], action: "add" | "remove"): Promise<void> => {
    if (!selectedSlot || behaviorWritePending.current) return;
    behaviorWritePending.current = true;
    setIsSavingBehavior(true);
    try {
      if (action === "add") {
        const mark: BehaviorMark = {
          id: crypto.randomUUID(), studentId, classId: selectedSlot.classId,
          subjectId: selectedSlot.subjectId, date: selectedDate, kind,
          createdAt: new Date().toISOString()
        };
        await db.behaviorMarks.add(mark);
      } else {
        await db.transaction("rw", db.behaviorMarks, async () => {
          const marks = await db.behaviorMarks.where("[studentId+date]").equals([studentId, selectedDate])
            .filter(mark => mark.classId === selectedSlot.classId && mark.kind === kind).sortBy("createdAt");
          const latest = marks[marks.length - 1];
          if (latest) await db.behaviorMarks.delete(latest.id);
        });
      }
      setBehaviorMarks(await db.behaviorMarks.toArray());
      const label = kind === "positive" ? "Positivo" : "Negativo";
      setNotice(`${label} ${action === "add" ? "añadido" : "retirado"}.`);
    } catch {
      setNotice("No se pudo actualizar la conducta. Inténtalo de nuevo.");
    } finally {
      behaviorWritePending.current = false;
      setIsSavingBehavior(false);
    }
  };

  const changeSessionStatus = async (session: TaskSession, status: TaskSession["status"]): Promise<void> => {
    if (status === session.status) return;
    await db.taskSessions.put({ ...session, status });
    setTaskSessions(await db.taskSessions.toArray());
    setNotice(`Sesión marcada como "${SESSION_STATUS_LABELS[status]}".`);
  };

  const attendanceSummary = useMemo(() => {
    const summary = { present: 0, late: 0, absent: 0 };
    for (const student of students) {
      const status = statusDraft.get(student.id) ?? baseStatusByStudent.get(student.id) ?? "present";
      summary[status] += 1;
    }
    return summary;
  }, [baseStatusByStudent, statusDraft, students]);

  const scopedTaskSetting = useMemo(() => {
    if (!selectedSlot || !selectedTask || !selectedSession) return null;
    return (
      taskDailySettings.find(
        (setting) =>
          setting.taskId === selectedTask.id &&
          setting.date === selectedSession.date &&
          setting.scheduleSlotId === selectedSession.scheduleSlotId &&
          matchesTaskScope(setting, selectedSlot.classId, selectedSlot.subjectId)
      ) ?? null
    );
  }, [selectedSession, selectedSlot, selectedTask, taskDailySettings]);

  const scopedStudentComments = useMemo(() => {
    const comments = new Map<string, string>();
    if (!selectedSlot || !selectedTask || !selectedSession) return comments;
    for (const comment of taskStudentComments) {
      if (
        comment.taskId === selectedTask.id &&
        comment.date === selectedSession.date &&
        comment.scheduleSlotId === selectedSession.scheduleSlotId &&
        matchesTaskScope(comment, selectedSlot.classId, selectedSlot.subjectId)
      ) {
        comments.set(comment.studentId, comment.comment);
      }
    }
    return comments;
  }, [selectedSession, selectedSlot, selectedTask, taskStudentComments]);

  const scopedDailyClassRecord = useMemo(() => {
    if (!selectedSlot || selectedSession) return null;
    return (
      dailyClassRecords.find(
        (record) =>
          record.classId === selectedSlot.classId &&
          record.subjectId === selectedSlot.subjectId &&
          record.date === selectedDate &&
          record.scheduleSlotId === selectedSlot.slotId
      ) ?? null
    );
  }, [dailyClassRecords, selectedDate, selectedSession, selectedSlot]);

  useEffect(() => {
    let active = true;
    const loadAttendance = async (): Promise<void> => {
      if (!selectedSlot) {
        setAttendanceEntries([]);
        return;
      }
      const rows = await db.attendanceEntries
        .where("[classId+date+scheduleSlotId]")
        .equals([selectedSlot.classId, selectedDate, selectedSlot.slotId])
        .toArray();
      if (!active) return;
      setAttendanceEntries(rows);
      setLoadedAttendanceKey(`${selectedDate}:${selectedSlot.key}`);
      setStatusDraft(new Map());
      setBulkAttendanceUndo(null);
      setNoteDraft(new Map());
      setAttendanceDetailsDraft(new Map());
      setNotice("");
    };

    void loadAttendance().catch((error: unknown) => {
      if (!active) return;
      const message = error instanceof Error ? error.message : "Error desconocido";
      setNotice(`No se pudo cargar la asistencia: ${message}`);
    });
    return () => {
      active = false;
    };
  }, [selectedDate, selectedSlot]);

  useEffect(() => {
    if (!selectedSlot) {
      setGeneralCommentDraft("");
      setStudentCommentDraft(new Map());
      return;
    }
    if (selectedTask && selectedSession) {
      setGeneralCommentDraft(scopedTaskSetting?.generalComment ?? "");
      setStudentCommentDraft(new Map(scopedStudentComments));
      return;
    }
    setGeneralCommentDraft(scopedDailyClassRecord?.generalComment ?? "");
    setStudentCommentDraft(new Map(Object.entries(scopedDailyClassRecord?.studentComments ?? {})));
  }, [scopedDailyClassRecord, scopedStudentComments, scopedTaskSetting, selectedSession, selectedSlot, selectedTask]);

  const setStudentStatus = (studentId: string, status: AttendanceEntry["status"]): void => {
    setBulkAttendanceUndo(null);
    const baseStatus = baseStatusByStudent.get(studentId) ?? "present";
    setStatusDraft((current) => {
      const next = new Map(current);
      if (status === baseStatus) {
        next.delete(studentId);
      } else {
        next.set(studentId, status);
      }
      return next;
    });
  };

  const markAllStudentsPresent = (): void => {
    setBulkAttendanceUndo(new Map(statusDraft));
    setStatusDraft(buildAllPresentDraft(students.map((student) => student.id), baseStatusByStudent));
    setNotice("Todo el grupo está marcado como presente. Puedes deshacer este cambio.");
  };

  const undoBulkAttendanceChange = (): void => {
    if (!bulkAttendanceUndo) return;
    setStatusDraft(new Map(bulkAttendanceUndo));
    setBulkAttendanceUndo(null);
    setNotice("Se ha restaurado la asistencia anterior.");
  };

  const setStudentNote = (studentId: string, note: string): void => {
    const existingNote = normalizeAttendanceNote(attendanceByStudent.get(studentId)?.note) ?? "";
    const normalizedNote = normalizeAttendanceNote(note) ?? "";
    setNoteDraft((current) => {
      const next = new Map(current);
      if (normalizedNote === existingNote) {
        next.delete(studentId);
      } else {
        next.set(studentId, note);
      }
      return next;
    });
  };

  const setStudentAttendanceDetails = (
    studentId: string,
    patch: Partial<AttendanceDetailsDraft>
  ): void => {
    const existing = attendanceByStudent.get(studentId);
    setAttendanceDetailsDraft((current) => {
      const next = new Map(current);
      const existingDraft: AttendanceDetailsDraft = {
        absenceJustified: Boolean(existing?.absenceJustified),
        lateMinutes: existing?.lateMinutes ? String(existing.lateMinutes) : "",
        earlyDepartureMinutes: existing?.earlyDepartureMinutes
          ? String(existing.earlyDepartureMinutes)
          : ""
      };
      const nextDraft = { ...(next.get(studentId) ?? existingDraft), ...patch };
      if (
        nextDraft.absenceJustified === existingDraft.absenceJustified &&
        nextDraft.lateMinutes === existingDraft.lateMinutes &&
        nextDraft.earlyDepartureMinutes === existingDraft.earlyDepartureMinutes
      ) {
        next.delete(studentId);
      } else {
        next.set(studentId, nextDraft);
      }
      return next;
    });
  };

  const setStudentWorkComment = (studentId: string, comment: string): void => {
    setStudentCommentDraft((current) => {
      const next = new Map(current);
      if (comment.trim()) {
        next.set(studentId, comment);
      } else {
        next.delete(studentId);
      }
      return next;
    });
  };

  const saveClassSession = async (): Promise<boolean> => {
    if (!selectedSlot || students.length === 0) return false;
    setIsSavingAttendance(true);
    setIsSavingWork(true);
    const savedSelectionContext = { selectedSlotKey, selectedDate };
    try {
      const now = new Date().toISOString();
      const attendanceRows: AttendanceEntry[] = students.map((student) => {
        const candidate = attendanceByStudent.get(student.id);
        const existing = matchesAttendanceScope(candidate, {
          classId: selectedSlot.classId,
          subjectId: selectedSlot.subjectId,
          date: selectedDate,
          scheduleSlotId: selectedSlot.slotId
        }) ? candidate : undefined;
        const status = statusDraft.get(student.id) ?? existing?.status ?? "present";
        const detailsDraft = attendanceDetailsDraft.get(student.id) ?? {
          absenceJustified: Boolean(existing?.absenceJustified),
          lateMinutes: existing?.lateMinutes ? String(existing.lateMinutes) : "",
          earlyDepartureMinutes: existing?.earlyDepartureMinutes
            ? String(existing.earlyDepartureMinutes)
            : ""
        };
        const attendanceDetails = normalizeAttendanceDetails(status, detailsDraft);
        return {
          id: existing?.id ?? `att-${selectedSlot.subjectId}-${student.id}-${selectedDate}-${selectedSlot.slotId}`,
          classId: selectedSlot.classId,
          subjectId: selectedSlot.subjectId,
          studentId: student.id,
          date: selectedDate,
          scheduleSlotId: selectedSlot.slotId,
          startTime: selectedSlot.startTime,
          endTime: selectedSlot.endTime,
          status,
          ...attendanceDetails,
          note: resolveAttendanceNoteForSave(student.id, noteDraft, existing?.note),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now
        };
      });
      const workComments = Object.fromEntries(
        students
          .map((student) => [student.id, (studentCommentDraft.get(student.id) ?? "").trim()] as const)
          .filter(([, comment]) => comment.length > 0)
      );

      await db.transaction(
        "rw",
        db.attendanceEntries,
        db.dailyClassRecords,
        db.taskDailyEvaluationSettings,
        db.taskStudentComments,
        db.taskSessions,
        async () => {
          await db.attendanceEntries.bulkPut(attendanceRows);
          if (selectedTask && selectedSession) {
            const settingIds = (await db.taskDailyEvaluationSettings
              .where("[taskId+classId+subjectId+date+scheduleSlotId]")
              .equals([selectedTask.id, selectedSlot.classId, selectedSlot.subjectId, selectedSession.date, selectedSession.scheduleSlotId])
              .primaryKeys()) as string[];
            await db.taskDailyEvaluationSettings.bulkDelete(settingIds);
            if (generalCommentDraft.trim()) {
              await db.taskDailyEvaluationSettings.put({
                id: `task-eval-${selectedTask.id}-${selectedSlot.subjectId}-${selectedSlot.classId}-${selectedSession.date}-${selectedSession.scheduleSlotId}`,
                taskId: selectedTask.id,
                subjectId: selectedSlot.subjectId,
                classId: selectedSlot.classId,
                date: selectedSession.date,
                scheduleSlotId: selectedSession.scheduleSlotId,
                generalComment: generalCommentDraft.trim()
              });
            }
            const commentIds = (await db.taskStudentComments
              .where("[taskId+classId+subjectId+date+scheduleSlotId]")
              .equals([selectedTask.id, selectedSlot.classId, selectedSlot.subjectId, selectedSession.date, selectedSession.scheduleSlotId])
              .primaryKeys()) as string[];
            await db.taskStudentComments.bulkDelete(commentIds);
            const comments = Object.entries(workComments).map(([studentId, comment]) => ({
              id: crypto.randomUUID(),
              taskId: selectedTask.id,
              subjectId: selectedSlot.subjectId,
              classId: selectedSlot.classId,
              date: selectedSession.date,
              scheduleSlotId: selectedSession.scheduleSlotId,
              studentId,
              comment
            }));
            if (comments.length > 0) await db.taskStudentComments.bulkAdd(comments);
            await db.taskSessions.put({ ...selectedSession, status: "done" });
          } else {
            const recordId = scopedDailyClassRecord?.id ?? `daily-${selectedSlot.classId}-${selectedSlot.subjectId}-${selectedDate}-${selectedSlot.slotId}`;
            if (
              generalCommentDraft.trim() ||
              Object.keys(workComments).length > 0 ||
              scopedDailyClassRecord?.sessionKind
            ) {
              await db.dailyClassRecords.put({
                ...scopedDailyClassRecord,
                id: recordId,
                classId: selectedSlot.classId,
                subjectId: selectedSlot.subjectId,
                date: selectedDate,
                scheduleSlotId: selectedSlot.slotId,
                generalComment: generalCommentDraft.trim(),
                studentComments: workComments,
                createdAt: scopedDailyClassRecord?.createdAt ?? now,
                updatedAt: now
              });
            } else if (scopedDailyClassRecord) {
              await db.dailyClassRecords.delete(scopedDailyClassRecord.id);
            }
          }
        }
      );

      const [savedAttendance, settings, savedComments, savedDailyRecords, savedSessions] = await Promise.all([
        db.attendanceEntries
          .where("[classId+date+scheduleSlotId]")
          .equals([selectedSlot.classId, selectedDate, selectedSlot.slotId])
          .toArray(),
        db.taskDailyEvaluationSettings.toArray(),
        db.taskStudentComments.toArray(),
        db.dailyClassRecords.toArray(),
        db.taskSessions.toArray()
      ]);
      const currentContext = selectionContextRef.current;
      if (
        currentContext.selectedSlotKey !== savedSelectionContext.selectedSlotKey ||
        currentContext.selectedDate !== savedSelectionContext.selectedDate
      ) {
        return true;
      }
      setAttendanceEntries(savedAttendance);
      setTaskDailySettings(settings);
      setTaskStudentComments(savedComments);
      setDailyClassRecords(savedDailyRecords);
      setTaskSessions(savedSessions);
      setStatusDraft(new Map());
      setBulkAttendanceUndo(null);
      setNoteDraft(new Map());
      setAttendanceDetailsDraft(new Map());
      setNotice("Clase guardada: asistencia y registro están al día.");
      classDraftRecovery.discard();
      trackAnalyticsEvent("class_saved");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo completar el guardado";
      setNotice(`No se ha guardado la clase: ${message}.`);
      return false;
    } finally {
      setIsSavingAttendance(false);
      setIsSavingWork(false);
    }
  };

  const hasAttendanceChanges =
    statusDraft.size > 0 || noteDraft.size > 0 || attendanceDetailsDraft.size > 0;
  const savedWorkComments = useMemo(
    () =>
      selectedTask && selectedSession
        ? scopedStudentComments
        : new Map(Object.entries(scopedDailyClassRecord?.studentComments ?? {})),
    [scopedDailyClassRecord, scopedStudentComments, selectedSession, selectedTask]
  );
  const hasStudentCommentChanges = useMemo(() => {
    if (studentCommentDraft.size !== savedWorkComments.size) return true;
    for (const [studentId, comment] of studentCommentDraft) {
      if (comment.trim() !== (savedWorkComments.get(studentId) ?? "")) {
        return true;
      }
    }
    return false;
  }, [savedWorkComments, studentCommentDraft]);
  const savedGeneralComment = selectedTask && selectedSession
    ? scopedTaskSetting?.generalComment ?? ""
    : scopedDailyClassRecord?.generalComment ?? "";
  const hasWorkChanges = (
    generalCommentDraft.trim() !== savedGeneralComment ||
    hasStudentCommentChanges
  );
  const hasUnsavedChanges = hasAttendanceChanges || hasWorkChanges;
  const classDraftRecovery = useRecoverableDraft<TodayDraft>(
    selectedSlot && loadedAttendanceKey === `${selectedDate}:${selectedSlot.key}`
      ? `class:${selectedDate}:${selectedSlot.key}:${selectedSession?.id ?? "daily"}` : null,
    { statuses: [...statusDraft], notes: [...noteDraft], details: [...attendanceDetailsDraft], generalComment: generalCommentDraft, studentComments: [...studentCommentDraft] },
    hasUnsavedChanges, isTodayDraft,
    (saved) => {
      const validIds = new Set(students.map((student) => student.id));
      setStatusDraft(new Map(saved.statuses.filter(([id]) => validIds.has(id))));
      setNoteDraft(new Map(saved.notes.filter(([id]) => validIds.has(id))));
      setAttendanceDetailsDraft(new Map(saved.details.filter(([id]) => validIds.has(id))));
      setGeneralCommentDraft(saved.generalComment);
      setStudentCommentDraft(new Map(saved.studentComments.filter(([id]) => validIds.has(id))));
      setNotice("Borrador recuperado. Revisa y guarda la clase para confirmarlo.");
    }
  );
  useUnsavedChangesGuard(hasUnsavedChanges, "Hay cambios de asistencia o registro sin guardar en esta clase.");

  const isSaving = isSavingAttendance || isSavingWork;
  const selectionContextRef = useRef({ selectedSlotKey, selectedDate });
  useEffect(() => {
    selectionContextRef.current = { selectedSlotKey, selectedDate };
  }, [selectedDate, selectedSlotKey]);

  const runWithContextGuard = async (action: () => void): Promise<void> => {
    if (!hasUnsavedChanges) {
      action();
      return;
    }
    const shouldDiscard = unsavedChangesDialog
      ? await unsavedChangesDialog.confirmLeave("Hay cambios sin guardar en esta clase. ¿Quieres descartarlos?")
      : window.confirm("Hay cambios sin guardar en esta clase. ¿Quieres descartarlos?");
    if (shouldDiscard) action();
  };
  const exceptionalSubjects = subjects.filter((subject) =>
    subjectCourseLinks.some(
      (link) =>
        link.classId === exceptionalSessionDraft.classId && link.subjectId === subject.id
    )
  );

  const openAdHocSessionModal = (): void => {
    const classId = selectedSlot?.classId ?? selectedClassId ?? classGroups[0]?.id ?? "";
    const subjectId =
      selectedSlot?.subjectId ??
      subjectCourseLinks.find((link) => link.classId === classId)?.subjectId ??
      "";
    setExceptionalSessionDraft({
      classId,
      subjectId,
      date: selectedDate,
      startTime: selectedSlot?.startTime ?? "09:00",
      endTime: selectedSlot?.endTime ?? "09:50",
      title: ""
    });
    setExceptionalSessionMode("adHoc");
  };

  const openRescheduleSessionModal = (): void => {
    if (!selectedSlot) return;
    setExceptionalSessionDraft({
      classId: selectedSlot.classId,
      subjectId: selectedSlot.subjectId,
      date: shiftIsoDate(selectedDate, 1),
      startTime: selectedSlot.startTime,
      endTime: selectedSlot.endTime,
      title: selectedSlot.title ?? selectedTask?.title ?? "Clase reprogramada"
    });
    setExceptionalSessionMode("rescheduled");
  };

  const createExceptionalSession = async (): Promise<void> => {
    if (!exceptionalSessionMode || isCreatingExceptionalSession) return;
    if (
      !exceptionalSessionDraft.classId ||
      !exceptionalSessionDraft.subjectId ||
      !/^\d{4}-\d{2}-\d{2}$/.test(exceptionalSessionDraft.date) ||
      exceptionalSessionDraft.endTime <= exceptionalSessionDraft.startTime
    ) {
      setNotice("Revisa el grupo, la asignatura, la fecha y las horas de la sesión.");
      return;
    }
    setIsCreatingExceptionalSession(true);
    try {
      const now = new Date().toISOString();
      const recordId = crypto.randomUUID();
      const scheduleSlotId = `exception-${recordId}`;
      const record: DailyClassRecord = {
        id: recordId,
        classId: exceptionalSessionDraft.classId,
        subjectId: exceptionalSessionDraft.subjectId,
        date: exceptionalSessionDraft.date,
        scheduleSlotId,
        sessionKind: exceptionalSessionMode,
        sessionTitle:
          exceptionalSessionDraft.title.trim() ||
          (exceptionalSessionMode === "adHoc" ? "Sesión puntual" : "Clase reprogramada"),
        startTime: exceptionalSessionDraft.startTime,
        endTime: exceptionalSessionDraft.endTime,
        originalDate:
          exceptionalSessionMode === "rescheduled" ? selectedDate : undefined,
        originalScheduleSlotId:
          exceptionalSessionMode === "rescheduled" ? selectedSlot?.slotId : undefined,
        generalComment: "",
        studentComments: {},
        createdAt: now,
        updatedAt: now
      };

      await db.transaction("rw", db.dailyClassRecords, db.taskSessions, async () => {
        await db.dailyClassRecords.add(record);
        if (exceptionalSessionMode === "rescheduled" && selectedSession) {
          await db.taskSessions.put({
            ...selectedSession,
            date: record.date,
            scheduleSlotId: record.scheduleSlotId,
            status: "moved"
          });
        }
      });
      const [savedRecords, savedSessions] = await Promise.all([
        db.dailyClassRecords.toArray(),
        db.taskSessions.toArray()
      ]);
      setDailyClassRecords(savedRecords);
      setTaskSessions(savedSessions);
      setExceptionalSessionMode(null);
      setSelectedDate(record.date);
      setSelectedSlotKey(
        `${record.classId}:${record.subjectId}:${record.scheduleSlotId}`
      );
      setNotice(
        exceptionalSessionMode === "adHoc"
          ? "Sesión puntual creada."
          : "Esta clase se ha reprogramado solo para la fecha elegida."
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido";
      setNotice(`No se pudo crear la sesión: ${message}`);
    } finally {
      setIsCreatingExceptionalSession(false);
    }
  };

  const planDetails = [
    { label: "Objetivos", value: selectedSession?.objectives },
    { label: "Competencias", value: selectedSession?.competencies },
    { label: "Materiales", value: selectedSession?.materials },
    { label: "Deberes", value: selectedSession?.homework },
    { label: "Notas", value: selectedSession?.teacherNotes }
  ].filter((item): item is { label: string; value: string } => Boolean(item.value?.trim()));
  const studentWorkCommentCount = Array.from(studentCommentDraft.values()).filter((comment) => comment.trim()).length;
  const generalRecordLength = generalCommentDraft.trim().length;
  const sessionStatus = selectedSession?.status ?? "planned";
  const editingNoteValue = editingStudentDetails
    ? noteDraft.get(editingStudentDetails.id) ?? attendanceByStudent.get(editingStudentDetails.id)?.note ?? ""
    : "";
  const editingAttendanceEntry = editingStudentDetails
    ? attendanceByStudent.get(editingStudentDetails.id)
    : undefined;
  const editingAttendanceStatus = editingStudentDetails
    ? statusDraft.get(editingStudentDetails.id) ?? editingAttendanceEntry?.status ?? "present"
    : "present";
  const editingAttendanceDetails = editingStudentDetails
    ? attendanceDetailsDraft.get(editingStudentDetails.id) ?? {
        absenceJustified: Boolean(editingAttendanceEntry?.absenceJustified),
        lateMinutes: editingAttendanceEntry?.lateMinutes
          ? String(editingAttendanceEntry.lateMinutes)
          : "",
        earlyDepartureMinutes: editingAttendanceEntry?.earlyDepartureMinutes
          ? String(editingAttendanceEntry.earlyDepartureMinutes)
          : ""
      }
    : { absenceJustified: false, lateMinutes: "", earlyDepartureMinutes: "" };
  const editingWorkValue = editingStudentDetails ? studentCommentDraft.get(editingStudentDetails.id) ?? "" : "";
  const selectedSessionLabel = selectedSlot ? `${selectedSlot.className} · ${selectedSlot.subjectName}` : "";
  const todayDate = toIsoDate(new Date());
  const selectedDateLabel = formatDateLabel(selectedDate);
  const attendanceHistoryLink = selectedSlot
    ? `/journal/attendance?month=${selectedDate.slice(0, 7)}&classId=${encodeURIComponent(selectedSlot.classId)}&subjectId=${encodeURIComponent(selectedSlot.subjectId)}`
    : "/journal/attendance";
  const evaluationLink = selectedSlot && selectedTask && selectedSession
    ? `/journal/work?classId=${encodeURIComponent(selectedSlot.classId)}&subjectId=${encodeURIComponent(selectedSlot.subjectId)}&taskId=${encodeURIComponent(selectedTask.id)}&date=${selectedDate}&slotId=${encodeURIComponent(selectedSession.scheduleSlotId)}`
    : "/journal/work";
  const plannerLink = selectedSlot
    ? `/planner?date=${selectedDate}&classId=${encodeURIComponent(selectedSlot.classId)}&subjectId=${encodeURIComponent(selectedSlot.subjectId)}&slotId=${encodeURIComponent(selectedSlot.slotId)}`
    : "/planner";
  const journalOwnerId = selectedSlot
    ? journalEntryOwnerId(selectedSlot.classId, selectedSlot.subjectId, selectedDate, selectedSlot.slotId, selectedTask?.id)
    : null;
  const isAttendanceSaved =
    students.length > 0 &&
    attendanceEntries.length === students.length &&
    !hasAttendanceChanges;
  const isClassSessionSaved =
    isAttendanceSaved &&
    !hasWorkChanges &&
    (!selectedSession || selectedSession.status === "done");

  return (
    <section className="module-card today-page" aria-labelledby="today-title">
      <DraftRecoveryNotice {...classDraftRecovery} />
      <header className="today-header">
        <div>
          <h1 id="today-title">Hoy</h1>
          <p>Agenda, asistencia y registro rápido.</p>
        </div>
      </header>

      <div className="today-layout">
        <aside className="courses-list-panel today-slot-rail" aria-label="Clases del día">
        <div className="today-header-controls">
          <div className="today-date-navigation" role="group" aria-label="Navegación por fecha">
            <button
              type="button"
              className="icon-btn today-date-step"
              aria-label="Día anterior"
              disabled={isSaving}
              onClick={() => void runWithContextGuard(() => setSelectedDate((current) => shiftIsoDate(current, -1)))}
            >
              {"<"}
            </button>
            <label className="today-date-picker">
              <span aria-live="polite">{selectedDateLabel}</span>
              <input
                className="input"
                type="date"
                aria-label="Seleccionar fecha"
                value={selectedDate}
                disabled={isSaving}
                onChange={(event) => void runWithContextGuard(() => setSelectedDate(event.target.value))}
              />
            </label>
            <button
              type="button"
              className="icon-btn today-date-step"
              aria-label="Día siguiente"
              disabled={isSaving}
              onClick={() => void runWithContextGuard(() => setSelectedDate((current) => shiftIsoDate(current, 1)))}
            >
              {">"}
            </button>
            <button
              type="button"
              className="btn secondary today-date-today"
              disabled={selectedDate === todayDate || isSaving}
              onClick={() => void runWithContextGuard(() => setSelectedDate(todayDate))}
            >
              Hoy
            </button>
          </div>
        </div>
          <ClassGroupSelect
            groups={classGroups}
            value={selectedClassId}
            disabled={isSaving}
            onChange={(classId) => runWithContextGuard(() => {
              deepLinkAppliedRef.current = true;
              dispatch(setSelectedClass(classId));
            })}
          />
          <div className="context-sidebar-separator" aria-hidden="true" />
          <div className="courses-list-header today-slot-header">
            <div className="today-slot-heading">
              <strong>Clases del día</strong>
              <span
                className="today-slot-count"
                aria-label={`${todaySlots.length} ${todaySlots.length === 1 ? "clase" : "clases"}`}
              >
                {todaySlots.length}
              </span>
            </div>
            <button
              type="button"
              className="btn secondary compact-link today-add-session"
              disabled={classGroups.length === 0 || subjectCourseLinks.length === 0 || isSaving}
              onClick={() => void runWithContextGuard(openAdHocSessionModal)}
            >
              Añadir clase puntual
            </button>
          </div>
          {todaySlots.length > 0 ? (
            <div className="courses-list section-tabs today-slot-list" role="group" aria-label="Clases del día">
              {todaySlots.map((slot) => (
                <button
                  key={slot.key}
                  type="button"
                  className={`section-tab ${slot.key === selectedSlotKey ? "active" : ""}`}
                  aria-pressed={slot.key === selectedSlotKey}
                  disabled={isSaving}
                  onClick={() => void runWithContextGuard(() => setSelectedSlotKey(slot.key))}
                >
                  <span className="today-slot-meta">
                    <span className="today-slot-time">
                      {slot.startTime}<span aria-hidden="true">–</span>{slot.endTime}
                    </span>
                    {slot.kind !== "recurring" ? (
                      <small className="today-slot-kind">
                        {slot.kind === "adHoc" ? "Puntual" : "Reprogramada"}
                      </small>
                    ) : null}
                  </span>
                  <span className="today-slot-subject">{slot.subjectName}</span>
                  <small className="today-slot-class">{slot.className}</small>
                  {slot.taskTitle ? <small className="today-slot-task">{slot.taskTitle}</small> : null}
                </button>
              ))}
            </div>
          ) : (
            <p className="hint">No hay clases programadas para este día.</p>
          )}
        </aside>

        <div className="today-main">
          {selectedSlot ? (
            <>
              <section className="today-session-card" aria-label="Resumen de la clase seleccionada">
                <div>
                  <span className="eyebrow">{selectedSlot.startTime} - {selectedSlot.endTime}</span>
                  <h2>{selectedSlot.className} · {selectedSlot.subjectName}</h2>
                  <p>{selectedTask?.title ?? selectedSlot.title ?? "Sin sesión planificada"}</p>
                </div>
                <div className="today-session-actions">
                  <a className="btn primary today-mobile-primary" href="#today-students">
                    Pasar lista
                  </a>
                  <NavLink className="btn secondary" to={attendanceHistoryLink}>Ver asistencia</NavLink>
                  {selectedTask && selectedSession ? (
                    <NavLink className="btn secondary" to={evaluationLink}>Evaluar tarea</NavLink>
                  ) : null}
                  <NavLink className="btn secondary" to={plannerLink}>Abrir Planificador</NavLink>
                  {selectedSlot.kind === "recurring" ? (
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => void runWithContextGuard(openRescheduleSessionModal)}
                    >
                      Reprogramar este día
                    </button>
                  ) : null}
                </div>
              </section>

              <section className="today-grid">
                <div className="today-panel work-panel">
                  <div className="today-panel-heading">
                    <div>
                      <h2>Plan y registro</h2>
                      <p>{selectedTask ? "Plan previsto y registro real de la sesión" : "Sin tarea planificada"}</p>
                    </div>
                    {selectedTask && selectedSession ? (
                      <NavLink className="btn secondary compact-link" to={plannerLink}>Editar plan</NavLink>
                    ) : null}
                  </div>

                  <div className="today-plan-register">
                    <div className="today-plan-overview">
                      <div className="today-plan-title">
                        {selectedTask && selectedSession ? (
                          <select
                            className={`today-plan-status ${sessionStatus}`}
                            aria-label="Estado de la sesión"
                            value={sessionStatus}
                            onChange={(event) => void changeSessionStatus(selectedSession, event.target.value as TaskSession["status"])}
                          >
                            {(Object.keys(SESSION_STATUS_LABELS) as TaskSession["status"][]).map((status) => (
                              <option key={status} value={status}>{SESSION_STATUS_LABELS[status]}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="today-plan-status free">Registro libre</span>
                        )}
                        <strong>{selectedTask?.title ?? "Clase sin planificación previa"}</strong>
                      </div>
                      <div className="today-plan-metrics" aria-label="Resumen del plan y registro">
                        <span>{planDetails.length} detalles de plan</span>
                        <span>{generalRecordLength > 0 ? "Registro iniciado" : "Registro vacío"}</span>
                        <span>{studentWorkCommentCount}/{students.length} con comentario</span>
                      </div>
                    </div>

                    <div className="today-plan-detail-grid" aria-label="Detalle planificado">
                      {planDetails.length > 0 ? (
                        planDetails.map((detail) => (
                          <div key={detail.label} className="today-plan-detail">
                            <span>{detail.label}</span>
                            <p>{detail.value}</p>
                          </div>
                        ))
                      ) : (
                        <div className="today-plan-detail muted">
                          <span>{selectedSession ? "Plan" : "Sin plan previo"}</span>
                          <p>{selectedSession
                            ? "La sesión está asignada, pero aún no tiene objetivos, materiales, deberes ni notas."
                            : "Puedes registrar lo realizado ahora y planificar otras sesiones cuando lo necesites."}</p>
                        </div>
                      )}
                    </div>

                    <label className="today-record-field">
                      <span>
                        Registro real
                        {hasWorkChanges ? <em>Sin guardar</em> : <em>Al día</em>}
                      </span>
                      <textarea
                        className="input textarea"
                        aria-label="Registro real de la sesión"
                        value={generalCommentDraft}
                        onChange={(event) => setGeneralCommentDraft(event.target.value)}
                        placeholder="Qué se ha hecho realmente, ajustes, deberes o incidencias generales."
                      />
                      <small>{generalRecordLength} caracteres · se guarda con la clase</small>
                    </label>
                    {!selectedSession ? (
                      <div className="today-free-record-actions">
                        <span>Este registro no necesita una tarea del Planificador.</span>
                        <NavLink className="btn secondary compact-link" to={plannerLink}>Planificar esta clase</NavLink>
                      </div>
                    ) : null}
                    {journalOwnerId ? (
                      <ResourceManager
                        ownerType="journalEntry"
                        ownerId={journalOwnerId}
                        heading="Adjuntos de esta sesión"
                      />
                    ) : null}
                  </div>
                </div>

                <div id="today-students" className="today-panel students-panel">
                  <div className="today-panel-heading">
                    <div>
                      <h2>Alumnado en clase</h2>
                      <p>{students.length} alumnos · registra solo retrasos y ausencias</p>
                    </div>
                    <div className="today-attendance-summary" aria-label="Resumen de asistencia">
                      <span>{attendanceSummary.present} presentes</span>
                      <span>{attendanceSummary.late} retrasos</span>
                      <span>{attendanceSummary.absent} ausentes</span>
                    </div>
                  </div>
                  <div className="today-attendance-toolbar">
                    <p>Todo el grupo parte como presente. Marca únicamente las excepciones.</p>
                    <div>
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={students.length === 0 || attendanceSummary.present === students.length}
                        onClick={markAllStudentsPresent}
                      >
                        Marcar todos presentes
                      </button>
                      {bulkAttendanceUndo ? (
                        <button type="button" className="btn secondary" onClick={undoBulkAttendanceChange}>
                          Deshacer
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="today-student-list">
                    {students.length > 0 ? (
                      <div className="today-student-row today-student-row-header exception-flow" aria-hidden="true">
                        <span>Alumno</span>
                        <span>Asistencia</span>
                        <span>Detalles</span>
                      </div>
                    ) : null}
                    {students.map((student) => {
                      const currentStatus = statusDraft.get(student.id) ?? baseStatusByStudent.get(student.id) ?? "present";
                      const currentNote = noteDraft.get(student.id) ?? attendanceByStudent.get(student.id)?.note ?? "";
                      const currentWorkComment = studentCommentDraft.get(student.id) ?? "";
                      const currentEntry = attendanceByStudent.get(student.id);
                      const currentDetails = attendanceDetailsDraft.get(student.id) ?? {
                        absenceJustified: Boolean(currentEntry?.absenceJustified),
                        lateMinutes: currentEntry?.lateMinutes ? String(currentEntry.lateMinutes) : "",
                        earlyDepartureMinutes: currentEntry?.earlyDepartureMinutes
                          ? String(currentEntry.earlyDepartureMinutes)
                          : ""
                      };
                      const hasAttendanceDetail =
                        (currentStatus === "absent" && currentDetails.absenceJustified) ||
                        (currentStatus === "late" && Boolean(currentDetails.lateMinutes)) ||
                         Boolean(currentDetails.earlyDepartureMinutes);
                      const hasStudentDetails = Boolean(
                        currentNote.trim() || currentWorkComment.trim() || hasAttendanceDetail
                      );
                      const availableStatuses: AttendanceEntry["status"][] = currentStatus === "present"
                        ? ["late", "absent"]
                        : ["present", "late", "absent"];
                      const behaviorCounts = behaviorCountsByStudent.get(student.id);
                      return (
                        <div key={student.id} className="today-student-row exception-flow">
                          <div className="today-exception-primary">
                            <div className="today-student-name-cell">
                              <strong>{formatName(student)}</strong>
                            </div>
                            <div className="today-exception-control">
                              <span className={`today-current-status ${currentStatus}`}>
                                {STATUS_LABELS[currentStatus]}
                              </span>
                              <div className="today-status-control" aria-label={`Cambiar asistencia de ${formatName(student)}`}>
                                {availableStatuses.map((status) => (
                                <button
                                  key={status}
                                  type="button"
                                  className={`today-status-option ${status} ${currentStatus === status ? "active" : ""}`}
                                  aria-label={`${STATUS_LABELS[status]} para ${formatName(student)}`}
                                  aria-pressed={currentStatus === status}
                                  onClick={() => setStudentStatus(student.id, status)}
                                >
                                  <span aria-hidden="true">{STATUS_SHORT_LABELS[status]}</span>
                                </button>
                                ))}
                              </div>
                            </div>
                            <button
                              type="button"
                              className={`today-note-button details ${hasStudentDetails ? "filled" : ""}`}
                              aria-label={`Editar detalles de asistencia y trabajo de ${formatName(student)}`}
                              onClick={() => setEditingStudentDetailsId(student.id)}
                            >
                              <span>{hasStudentDetails ? "Con detalles" : "Añadir detalles"}</span>
                            </button>
                          </div>
                          <BehaviorControls studentName={formatName(student)} counts={behaviorCounts ?? { positive: 0, negative: 0 }}
                            busy={isSavingBehavior} onChange={(kind, action) => void changeBehaviorMark(student.id, kind, action)} />
                        </div>
                      );
                    })}
                    {students.length === 0 ? <p className="empty-state">No hay alumnos vinculados a esta asignatura.</p> : null}
                  </div>

                  <div className="today-panel-actions">
                    <button
                      className="btn primary today-close-session"
                      type="button"
                      disabled={students.length === 0 || isClassSessionSaved || isSavingAttendance || isSavingWork}
                      onClick={() => void saveClassSession()}
                    >
                      {isSavingAttendance || isSavingWork
                        ? "Guardando clase..."
                        : isClassSessionSaved
                          ? "Clase guardada"
                          : isAttendanceSaved
                            ? "Guardar registro de esta tarea"
                            : attendanceEntries.length === 0
                              ? "Confirmar y cerrar clase"
                              : "Guardar cambios de la clase"}
                    </button>
                    <span className="today-save-scope">
                      {isAttendanceSaved && !isClassSessionSaved
                        ? "La asistencia de esta hora ya está guardada. Esto guarda el registro de esta tarea."
                        : "Incluye asistencia, observaciones y trabajo."}
                    </span>
                  </div>
                </div>
              </section>
            </>
          ) : (
            <p className="empty-state">Selecciona una fecha con clases para empezar.</p>
          )}
        </div>
      </div>

      <div className="today-status-line" role="status" aria-live="polite">
        {notice}
      </div>

      <Modal
        open={Boolean(exceptionalSessionMode)}
        title={
          exceptionalSessionMode === "rescheduled"
            ? "Reprogramar solo esta clase"
            : "Añadir sesión puntual"
        }
        subtitle={
          exceptionalSessionMode === "rescheduled"
            ? "La fecha semanal seguirá intacta para el resto del curso."
            : "Útil para sustituciones, apoyos o clases no previstas."
        }
        onClose={() => setExceptionalSessionMode(null)}
      >
        <div className="detail-grid">
          <label className="detail-field compact-field">
            <span>Grupo</span>
            <select
              className="input"
              disabled={exceptionalSessionMode === "rescheduled"}
              value={exceptionalSessionDraft.classId}
              onChange={(event) => {
                const classId = event.target.value;
                const subjectId =
                  subjectCourseLinks.find((link) => link.classId === classId)?.subjectId ?? "";
                setExceptionalSessionDraft((current) => ({
                  ...current,
                  classId,
                  subjectId
                }));
              }}
            >
              <option value="">Selecciona un grupo</option>
              {classGroups.map((classGroup) => (
                <option key={classGroup.id} value={classGroup.id}>
                  {classGroup.name}
                </option>
              ))}
            </select>
          </label>
          <label className="detail-field compact-field">
            <span>Asignatura</span>
            <select
              className="input"
              disabled={exceptionalSessionMode === "rescheduled"}
              value={exceptionalSessionDraft.subjectId}
              onChange={(event) =>
                setExceptionalSessionDraft((current) => ({
                  ...current,
                  subjectId: event.target.value
                }))
              }
            >
              <option value="">Selecciona una asignatura</option>
              {exceptionalSubjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
          </label>
          <label className="detail-field compact-field">
            <span>Fecha</span>
            <input
              className="input"
              type="date"
              value={exceptionalSessionDraft.date}
              onChange={(event) =>
                setExceptionalSessionDraft((current) => ({
                  ...current,
                  date: event.target.value
                }))
              }
            />
          </label>
          <label className="detail-field compact-field">
            <span>Descripción</span>
            <input
              className="input"
              value={exceptionalSessionDraft.title}
              placeholder="Ej. Sustitución de Ciencias"
              onChange={(event) =>
                setExceptionalSessionDraft((current) => ({
                  ...current,
                  title: event.target.value
                }))
              }
            />
          </label>
          <label className="detail-field compact-field">
            <span>Inicio</span>
            <input
              className="input"
              type="time"
              value={exceptionalSessionDraft.startTime}
              onChange={(event) =>
                setExceptionalSessionDraft((current) => ({
                  ...current,
                  startTime: event.target.value
                }))
              }
            />
          </label>
          <label className="detail-field compact-field">
            <span>Fin</span>
            <input
              className="input"
              type="time"
              min={exceptionalSessionDraft.startTime}
              value={exceptionalSessionDraft.endTime}
              onChange={(event) =>
                setExceptionalSessionDraft((current) => ({
                  ...current,
                  endTime: event.target.value
                }))
              }
            />
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={() => setExceptionalSessionMode(null)}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={
              isCreatingExceptionalSession ||
              !exceptionalSessionDraft.classId ||
              !exceptionalSessionDraft.subjectId ||
              !exceptionalSessionDraft.date ||
              exceptionalSessionDraft.endTime <= exceptionalSessionDraft.startTime
            }
            onClick={() => void createExceptionalSession()}
          >
            {exceptionalSessionMode === "rescheduled"
              ? "Confirmar reprogramación"
              : "Crear sesión"}
          </button>
        </div>
      </Modal>

      <Modal
        open={Boolean(editingStudentDetails)}
        title={editingStudentDetails ? `Detalles · ${formatName(editingStudentDetails)}` : "Detalles del alumno"}
        subtitle={selectedTask ? `${selectedSessionLabel} · ${selectedTask.title}` : selectedSessionLabel}
        onClose={() => setEditingStudentDetailsId("")}
      >
        {editingStudentDetails ? (
          <div className="today-note-modal">
            <section className="today-detail-group" aria-labelledby="today-attendance-detail-title">
              <div className="today-note-modal-summary">
                <h3 id="today-attendance-detail-title">Asistencia</h3>
                <span>{STATUS_LABELS[editingAttendanceStatus]}</span>
              </div>
              {editingAttendanceStatus === "absent" ? (
                <label className="chip-toggle">
                  <input
                    type="checkbox"
                    checked={editingAttendanceDetails.absenceJustified}
                    onChange={(event) =>
                      setStudentAttendanceDetails(editingStudentDetails.id, {
                        absenceJustified: event.target.checked
                      })
                    }
                  />
                  <span>Ausencia justificada</span>
                </label>
              ) : null}
              {editingAttendanceStatus === "late" ? (
                <label className="field compact-field">
                  <span>Minutos de retraso</span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={720}
                    inputMode="numeric"
                    value={editingAttendanceDetails.lateMinutes}
                    onChange={(event) =>
                      setStudentAttendanceDetails(editingStudentDetails.id, {
                        lateMinutes: event.target.value
                      })
                    }
                  />
                </label>
              ) : null}
              {editingAttendanceStatus !== "absent" ? (
                <label className="field compact-field">
                  <span>Salida anticipada (minutos)</span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={720}
                    inputMode="numeric"
                    placeholder="Dejar vacío si no salió antes"
                    value={editingAttendanceDetails.earlyDepartureMinutes}
                    onChange={(event) =>
                      setStudentAttendanceDetails(editingStudentDetails.id, {
                        earlyDepartureMinutes: event.target.value
                      })
                    }
                  />
                </label>
              ) : null}
              <label className="field">
                <span>Observación de asistencia</span>
                <textarea
                  className="input textarea"
                  value={editingNoteValue}
                  onChange={(event) => setStudentNote(editingStudentDetails.id, event.target.value)}
                  placeholder="Retraso justificado, salida anticipada o comentario breve..."
                />
              </label>
              <FeedbackCommentPicker
                category="attendance"
                value={editingNoteValue}
                onChange={(value) => setStudentNote(editingStudentDetails.id, value)}
              />
            </section>

            <section className="today-detail-group" aria-labelledby="today-work-detail-title">
              <div className="today-note-modal-summary">
                <h3 id="today-work-detail-title">Trabajo en clase</h3>
                <span>{editingWorkValue.trim() ? "Con comentario" : "Sin comentario"}</span>
              </div>
              <label className="field">
                <span>Comentario de trabajo</span>
                <textarea
                  className="input textarea"
                  value={editingWorkValue}
                  onChange={(event) => setStudentWorkComment(editingStudentDetails.id, event.target.value)}
                  placeholder="Participación, apoyo necesario o entrega pendiente..."
                />
              </label>
              <FeedbackCommentPicker
                category="work"
                value={editingWorkValue}
                onChange={(value) => setStudentWorkComment(editingStudentDetails.id, value)}
              />
            </section>
            <div className="today-note-modal-meta">
              <span>{editingNoteValue.trim().length + editingWorkValue.trim().length} caracteres</span>
              <span>Quedará pendiente hasta guardar la clase.</span>
            </div>
            <div className="today-modal-actions">
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  setStudentNote(editingStudentDetails.id, "");
                  setStudentWorkComment(editingStudentDetails.id, "");
                  setStudentAttendanceDetails(editingStudentDetails.id, {
                    absenceJustified: false,
                    lateMinutes: "",
                    earlyDepartureMinutes: ""
                  });
                }}
              >
                Limpiar detalles
              </button>
              <button type="button" className="btn primary" onClick={() => setEditingStudentDetailsId("")}>
                Aplicar al borrador
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
