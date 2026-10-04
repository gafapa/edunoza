import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { db } from "../../shared/db/database";
import type {
  ClassGroup,
  ScheduleDay,
  ScheduleSettings,
  Student,
  Subject,
  UnitBlock,
  SubjectCourseLink,
  SubjectStudentLink,
  TaskGradebookConfig,
  TaskSubjectLink,
  Task
} from "../../shared/db/types";
import { compareStudentsByField } from "../../shared/utils/student";
import { completeScheduleDays, defaultScheduleDays } from "../../shared/schedule/weekDays";
import { removedActiveScheduleSlotIds, validateScheduleDay } from "../../shared/schedule/validation";
import { useAppSelector } from "../../app/hooks";

export type EnrollmentRow = {
  student: Student;
  courseName: string;
  derivedIncluded: boolean;
  effectiveIncluded: boolean;
};

type ManagementContextValue = {
  courses: ClassGroup[];
  students: Student[];
  subjects: Subject[];
  units: UnitBlock[];
  scheduleDays: ScheduleDay[];
  scheduleSettings: ScheduleSettings;
  subjectCourseLinks: SubjectCourseLink[];
  taskSubjectLinks: TaskSubjectLink[];
  allTasks: Task[];
  notice: string;
  isBusy: boolean;
  isReady: boolean;
  setNotice: (value: string) => void;
  refreshAll: () => Promise<void>;
  createCourse: (name: string, schoolYear: string, comments?: string, level?: string) => Promise<void>;
  createEmptyCourse: () => Promise<string | null>;
  updateCourse: (courseId: string, name: string, schoolYear: string, comments?: string) => Promise<boolean>;
  deleteCourse: (courseId: string) => Promise<void>;
  createEmptyStudent: (courseId?: string) => Promise<string | null>;
  updateStudent: (
    studentId: string,
    firstName: string,
    lastName: string,
    courseId: string,
    photoDataUrl?: string,
    comments?: string,
    email?: string,
    hasAcs?: boolean,
    hasReinforcement?: boolean
  ) => Promise<boolean>;
  addStudentToCourse: (studentId: string, courseId: string) => Promise<void>;
  deleteStudent: (studentId: string) => Promise<void>;
  createEmptySubject: (courseId?: string) => Promise<string | null>;
  updateSubject: (
    subjectId: string,
    name: string,
    teachingHours: string,
    scheduleSlotIds: string[],
    courseId: string
  ) => Promise<boolean>;
  deleteSubject: (subjectId: string) => Promise<void>;
  setStudentEnrollment: (subjectId: string, studentId: string, included: boolean) => Promise<void>;
  bulkAssignGroupStudentsToSubject: (courseId: string, subjectId: string) => Promise<void>;
  getEnrollmentRows: (subjectId: string) => EnrollmentRow[];
  updateScheduleDay: (day: ScheduleDay) => Promise<boolean>;
  updateScheduleSettings: (settings: ScheduleSettings) => Promise<boolean>;
  createEmptyUnit: (subjectId: string) => Promise<string | null>;
  updateUnit: (unitId: string, name: string, description: string, sessionCount: number) => Promise<boolean>;
  deleteUnit: (unitId: string) => Promise<void>;
  createEmptyTask: () => Promise<string | null>;
  updateTask: (
    taskId: string,
    title: string,
    description: string,
    sessionCount: number,
    sendToGradebook: boolean
  ) => Promise<boolean>;
  deleteTask: (taskId: string) => Promise<void>;
  addTaskSubjectLink: (taskId: string, subjectId: string, unitId?: string) => Promise<void>;
  updateTaskSubjectLink: (linkId: string, unitId: string | undefined) => Promise<boolean>;
};

const ManagementContext = createContext<ManagementContextValue | null>(null);

export function ManagementProvider({ children }: { children: ReactNode }) {
  const studentSortBy = useAppSelector((state) => state.app.studentSortBy);
  const [courses, setCourses] = useState<ClassGroup[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [units, setUnits] = useState<UnitBlock[]>([]);
  const [scheduleDays, setScheduleDays] = useState<ScheduleDay[]>([]);
  const [scheduleSettings, setScheduleSettings] = useState<ScheduleSettings>({
    id: "default",
    defaultBlockDurationMinutes: 50
  });
  const [subjectCourseLinks, setSubjectCourseLinks] = useState<SubjectCourseLink[]>([]);
  const [subjectStudentLinks, setSubjectStudentLinks] = useState<SubjectStudentLink[]>([]);
  const [taskSubjectLinks, setTaskSubjectLinks] = useState<TaskSubjectLink[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [notice, setNotice] = useState("");
  const [pendingActions, setPendingActions] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const isBusy = pendingActions > 0;

  const runWithProgress = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    setPendingActions((current) => current + 1);
    try {
      return await action();
    } finally {
      setPendingActions((current) => Math.max(0, current - 1));
    }
  }, []);

  const runSaveWithProgress = useCallback(async (action: () => Promise<boolean>): Promise<boolean> => {
    try {
      return await runWithProgress(action);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido";
      setNotice(`No se pudieron guardar los cambios: ${message}.`);
      return false;
    }
  }, [runWithProgress]);

  const formatDependencies = (items: Array<[string, number]>): string[] =>
    items.filter(([, count]) => count > 0).map(([label, count]) => `${label}:${count}`);

  const isMeaningfulTaskGradebookConfig = (config: TaskGradebookConfig): boolean =>
    Number(config.gradebookWeight ?? 0) > 0 ||
    Boolean(config.groupId) ||
    Boolean(config.rubricTemplateId) ||
    Boolean(config.checklistTemplateId) ||
    Boolean(config.directGradeEnabled);

  const countStudentRecordedData = async (studentId: string): Promise<Array<[string, number]>> => {
    const [
      gradesCount,
      attendanceCount,
      taskCommentsCount,
      rubricAssessmentsCount,
      checklistAssessmentsCount,
      directGradesCount,
      followUpsCount,
      familyContactsCount,
      supportGroupMembershipsCount,
      dailyClassCommentsCount
    ] = await Promise.all([
      db.gradeEntries.where("studentId").equals(studentId).count(),
      db.attendanceEntries.where("studentId").equals(studentId).count(),
      db.taskStudentComments.where("studentId").equals(studentId).count(),
      db.taskRubricAssessments.where("studentId").equals(studentId).count(),
      db.taskChecklistAssessments.where("studentId").equals(studentId).count(),
      db.taskDirectGrades.where("studentId").equals(studentId).count(),
      db.studentFollowUps.where("studentId").equals(studentId).count(),
      db.familyContacts.where("studentId").equals(studentId).count(),
      db.supportGroupMembers.where("studentId").equals(studentId).count(),
      db.dailyClassRecords.filter((record) => Boolean(record.studentComments[studentId]?.trim())).count()
    ]);

    return [
      ["notas", gradesCount],
      ["asistencia", attendanceCount],
      ["comentarios_tareas", taskCommentsCount],
      ["evaluaciones_rubrica", rubricAssessmentsCount],
      ["evaluaciones_checklist", checklistAssessmentsCount],
      ["notas_directas_tareas", directGradesCount],
      ["seguimiento_tutorial", followUpsCount],
      ["contactos_familiares", familyContactsCount],
      ["grupos_apoyo", supportGroupMembershipsCount],
      ["comentarios_registro_diario", dailyClassCommentsCount]
    ];
  };

  const countStudentSubjectRecordedData = async (
    studentId: string,
    subjectId: string
  ): Promise<Array<[string, number]>> => {
    const [subjectAssessments, subjectTaskLinks] = await Promise.all([
      db.assessments.where("subjectId").equals(subjectId).toArray(),
      db.taskSubjectLinks.where("subjectId").equals(subjectId).toArray()
    ]);
    const assessmentIds = new Set(subjectAssessments.map((assessment) => assessment.id));
    const taskIds = new Set(subjectTaskLinks.map((link) => link.taskId));

    const [
      grades,
      attendance,
      taskComments,
      rubricAssessments,
      checklistAssessments,
      directGrades,
      dailyClassComments
    ] = await Promise.all([
      db.gradeEntries
        .where("studentId")
        .equals(studentId)
        .filter((entry) => assessmentIds.has(entry.assessmentId))
        .count(),
      db.attendanceEntries
        .where("studentId")
        .equals(studentId)
        .filter((entry) => entry.subjectId === subjectId)
        .count(),
      db.taskStudentComments
        .where("studentId")
        .equals(studentId)
        .filter((row) => taskIds.has(row.taskId))
        .count(),
      db.taskRubricAssessments
        .where("studentId")
        .equals(studentId)
        .filter((row) => taskIds.has(row.taskId))
        .count(),
      db.taskChecklistAssessments
        .where("studentId")
        .equals(studentId)
        .filter((row) => taskIds.has(row.taskId))
        .count(),
      db.taskDirectGrades
        .where("studentId")
        .equals(studentId)
        .filter((row) => taskIds.has(row.taskId))
        .count(),
      db.dailyClassRecords
        .where("subjectId")
        .equals(subjectId)
        .filter((record) => Boolean(record.studentComments[studentId]?.trim()))
        .count()
    ]);

    return [
      ["notas", grades],
      ["asistencia", attendance],
      ["comentarios_tareas", taskComments],
      ["evaluaciones_rubrica", rubricAssessments],
      ["evaluaciones_checklist", checklistAssessments],
      ["notas_directas_tareas", directGrades],
      ["comentarios_registro_diario", dailyClassComments]
    ];
  };

  const countTaskSubjectUsage = async (
    taskId: string,
    subjectId: string
  ): Promise<Array<[string, number]>> => {
    const [sessionsCount, gradebookConfigs, directGradesCount] = await Promise.all([
      db.taskSessions
        .where("taskId")
        .equals(taskId)
        .filter((session) => session.subjectId === subjectId)
        .count(),
      db.taskGradebookConfigs
        .where("taskId")
        .equals(taskId)
        .filter((config) => config.subjectId === subjectId)
        .toArray(),
      db.taskDirectGrades
        .where("taskId")
        .equals(taskId)
        .filter((grade) => grade.subjectId === subjectId)
        .count()
    ]);
    const gradebookConfigsCount = gradebookConfigs.filter(isMeaningfulTaskGradebookConfig).length;

    return [
      ["sesiones", sessionsCount],
      ["config_tareas_cuaderno", gradebookConfigsCount],
      ["notas_directas_tareas", directGradesCount]
    ];
  };

  const loadAll = useCallback(async (): Promise<void> => {
    const existingScheduleDays = await db.scheduleDays.orderBy("dayOfWeek").toArray();
    const completedScheduleDays =
      existingScheduleDays.length === 0 ? defaultScheduleDays() : completeScheduleDays(existingScheduleDays);
    if (completedScheduleDays.length !== existingScheduleDays.length) {
      await db.scheduleDays.bulkPut(completedScheduleDays);
    }
    if (!(await db.scheduleSettings.get("default"))) {
      await db.scheduleSettings.put({ id: "default", defaultBlockDurationMinutes: 50 });
    }

    const [
      coursesData,
      studentsData,
      subjectsData,
      unitsData,
      linksData,
      studentLinksData,
      scheduleDaysData,
      scheduleSettingsData,
      taskSubjectLinksData,
      allTasksData
    ] = await Promise.all([
      db.classGroups.orderBy("name").toArray(),
      db.students.toArray(),
      db.subjects.orderBy("name").toArray(),
      db.unitBlocks.orderBy("[subjectId+position]").toArray(),
      db.subjectCourseLinks.toArray(),
      db.subjectStudentLinks.toArray(),
      Promise.resolve(completedScheduleDays),
      db.scheduleSettings.get("default"),
      db.taskSubjectLinks.toArray(),
      db.tasks.toArray()
    ]);

    setCourses(coursesData);
    setStudents(studentsData.sort(compareStudentsByField(studentSortBy)));
    setSubjects(subjectsData);
    setUnits(unitsData);
    setScheduleDays(scheduleDaysData);
    setScheduleSettings(
      scheduleSettingsData ?? {
        id: "default",
        defaultBlockDurationMinutes: 50
      }
    );
    setSubjectCourseLinks(linksData);
    setSubjectStudentLinks(studentLinksData);
    setTaskSubjectLinks(taskSubjectLinksData);
    setAllTasks(allTasksData);
  }, [studentSortBy]);

  useEffect(() => {
    void runWithProgress(loadAll)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Error desconocido";
        setNotice(`No se pudieron cargar los datos: ${message}.`);
      })
      .finally(() => setIsReady(true));
  }, [loadAll, runWithProgress]);

  // Reorder students in memory when the preference changes without reloading IndexedDB.
  useEffect(() => {
    setStudents((prev) => [...prev].sort(compareStudentsByField(studentSortBy)));
  }, [studentSortBy]);

  const courseMap = useMemo(() => new Map(courses.map((item) => [item.id, item])), [courses]);
  const linksBySubject = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const link of subjectCourseLinks) {
      if (!map.has(link.subjectId)) {
        map.set(link.subjectId, new Set<string>());
      }
      map.get(link.subjectId)?.add(link.classId);
    }
    return map;
  }, [subjectCourseLinks]);
  const studentLinksBySubject = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const link of subjectStudentLinks) {
      if (!map.has(link.subjectId)) {
        map.set(link.subjectId, new Set<string>());
      }
      map.get(link.subjectId)?.add(link.studentId);
    }
    return map;
  }, [subjectStudentLinks]);

  const createCourse = async (
    nameValue: string,
    schoolYearValue: string,
    commentsValue?: string,
    levelValue?: string
  ): Promise<void> => {
    const name = nameValue.trim();
    const schoolYear = schoolYearValue.trim();
    if (name.length < 3 || schoolYear.length < 4) {
      setNotice("El curso necesita nombre y año.");
      return;
    }

    const id = crypto.randomUUID();
    await db.classGroups.add({
      id,
      name,
      level: levelValue?.trim() || "Sin nivel",
      schoolYear,
      comments: commentsValue?.trim() || undefined
    });
    setNotice("Curso creado.");
    await loadAll();
  };

  const createEmptyCourse = async (): Promise<string | null> => {
    const year = new Date().getFullYear();
    const schoolYear = `${year}-${year + 1}`;
    const id = crypto.randomUUID();
    await db.classGroups.add({
      id,
      name: "Nuevo curso",
      level: "ESO",
      schoolYear
    });
    setNotice("Curso creado. Completa sus datos.");
    await loadAll();
    return id;
  };

  const updateCourse = async (
    courseId: string,
    nameValue: string,
    schoolYearValue: string,
    commentsValue?: string
  ): Promise<boolean> => {
    const name = nameValue.trim();
    const schoolYear = schoolYearValue.trim();
    if (name.length < 3 || schoolYear.length < 4) {
      setNotice("Datos inválidos para editar el curso.");
      return false;
    }
    const current = courses.find((course) => course.id === courseId);
    if (!current) {
      return false;
    }
    await db.classGroups.put({
      ...current,
      name,
      schoolYear,
      comments: commentsValue?.trim() || undefined
    });
    setNotice("Curso actualizado.");
    await loadAll();
    return true;
  };

  const deleteCourse = async (courseId: string): Promise<void> => {
    const studentRows = await db.students.where("classId").equals(courseId).toArray();
    const studentIds = studentRows.map((item) => item.id);
    const [
      assessmentsCount,
      gradesByClassCount,
      attendanceByClassCount,
      rubricsCount,
      checklistsCount,
      linksCount,
      taskGradebookConfigsCount,
      taskSessionsCount,
      directGradesByClassCount,
      followUpsByClassCount,
      dailyClassRecordsCount,
      academicPeriodsCount,
      gradebookSnapshotsCount,
      gradebookGroupsCount
    ] = await Promise.all([
      db.assessments.where("classId").equals(courseId).count(),
      db.gradeEntries.where("classId").equals(courseId).count(),
      db.attendanceEntries.where("classId").equals(courseId).count(),
      db.rubricTemplates.where("classId").equals(courseId).count(),
      db.checklistTemplates.where("classId").equals(courseId).count(),
      db.subjectCourseLinks.where("classId").equals(courseId).count(),
      db.taskGradebookConfigs.where("classId").equals(courseId).count(),
      db.taskSessions.where("classId").equals(courseId).count(),
      db.taskDirectGrades.where("classId").equals(courseId).count(),
      db.studentFollowUps.where("classId").equals(courseId).count(),
      db.dailyClassRecords.where("classId").equals(courseId).count(),
      db.academicPeriods.where("classId").equals(courseId).count(),
      db.gradebookPeriodSnapshots.where("classId").equals(courseId).count(),
      db.gradebookGroups.where("classId").equals(courseId).count()
    ]);

    let subjectAssignmentsCount = 0;
    let taskCommentsCount = 0;
    if (studentIds.length > 0) {
      subjectAssignmentsCount = await db.subjectStudentLinks.where("studentId").anyOf(studentIds).count();
      taskCommentsCount = await db.taskStudentComments.where("studentId").anyOf(studentIds).count();
    }

    const dependencies = [
      `alumnos:${studentRows.length}`,
      `evaluaciones:${assessmentsCount}`,
      `notas:${gradesByClassCount}`,
      `asistencia:${attendanceByClassCount}`,
      `rúbricas:${rubricsCount}`,
      `listas_cotejo:${checklistsCount}`,
      `vinculos_asignatura:${linksCount}`,
      `config_tareas_cuaderno:${taskGradebookConfigsCount}`,
      `sesiones_tareas:${taskSessionsCount}`,
      `notas_directas_tareas:${directGradesByClassCount}`,
      `seguimiento_tutorial:${followUpsByClassCount}`,
      `registros_diarios:${dailyClassRecordsCount}`,
      `asignaciones_asignatura:${subjectAssignmentsCount}`,
      `comentarios_tareas:${taskCommentsCount}`,
      `periodos_academicos:${academicPeriodsCount}`,
      `instantaneas_cuaderno:${gradebookSnapshotsCount}`,
      `grupos_cuaderno:${gradebookGroupsCount}`
    ].filter((item) => Number(item.split(":")[1]) > 0);

    if (dependencies.length > 0) {
      setNotice(
        `No se puede eliminar el curso porque tiene dependencias (${dependencies.join(", ")}).`
      );
      return;
    }

    await db.transaction("rw", db.classGroups, db.classroomLayouts, async () => {
      await db.classroomLayouts.where("classId").equals(courseId).delete();
      await db.classGroups.delete(courseId);
    });
    setNotice("Curso eliminado.");
    await loadAll();
  };

  const createEmptyStudent = async (courseId?: string): Promise<string | null> => {
    const fallbackCourseId = courseId || courses[0]?.id;
    if (!fallbackCourseId) {
      setNotice("Crea al menos un curso antes de añadir alumnos.");
      return null;
    }

    const id = crypto.randomUUID();
    await db.students.add({
      id,
      personId: id,
      classId: fallbackCourseId,
      firstName: "Nuevo",
      lastName: "Alumno",
      fullName: "Nuevo Alumno",
      hasAcs: false,
      hasReinforcement: false
    });
    setNotice("Alumno creado. Completa sus datos.");
    await loadAll();
    return id;
  };

  const getSubjectLinksToDeleteForStudentCourse = async (
    studentId: string,
    courseId: string
  ): Promise<string[]> => {
    const [courseLinks, studentSubjectLinks] = await Promise.all([
      db.subjectCourseLinks.where("classId").equals(courseId).toArray(),
      db.subjectStudentLinks.where("studentId").equals(studentId).toArray()
    ]);
    const allowedSubjectIds = new Set(courseLinks.map((link) => link.subjectId));
    return studentSubjectLinks
      .filter((link) => !allowedSubjectIds.has(link.subjectId))
      .map((link) => link.id);
  };

  const addStudentToCourse = async (studentId: string, courseId: string): Promise<void> => {
    const student = students.find((item) => item.id === studentId);
    if (!student) {
      return;
    }
    if (student.classId === courseId) {
      setNotice("El alumno ya pertenece a ese curso.");
      return;
    }
    const dependencies = formatDependencies(await countStudentRecordedData(studentId));
    if (dependencies.length > 0) {
      setNotice(`No se puede mover el alumno porque tiene datos registrados (${dependencies.join(", ")}).`);
      return;
    }
    const linksToDelete = await getSubjectLinksToDeleteForStudentCourse(studentId, courseId);
    await db.transaction("rw", db.students, db.subjectStudentLinks, async () => {
      await db.students.put({ ...student, classId: courseId });
      if (linksToDelete.length > 0) {
        await db.subjectStudentLinks.bulkDelete(linksToDelete);
      }
    });
    setNotice("Alumno movido de curso.");
    await loadAll();
  };

  const updateStudent = async (
    studentId: string,
    firstNameValue: string,
    lastNameValue: string,
    courseIdValue: string,
    photoDataUrl?: string,
    commentsValue?: string,
    emailValue?: string,
    hasAcs = false,
    hasReinforcement = false
  ): Promise<boolean> => {
    const firstName = firstNameValue.trim();
    const lastName = lastNameValue.trim();
    const fullName = `${firstName} ${lastName}`.trim();
    const courseId = courseIdValue.trim();
    const comments = commentsValue?.trim() || undefined;
    const email = emailValue?.trim() || undefined;
    if (!firstName || !lastName || !courseId) {
      setNotice("Datos incompletos: nombre, apellidos y al menos un curso.");
      return false;
    }
    const current = students.find((student) => student.id === studentId);
    if (!current) {
      return false;
    }
    if (current.classId !== courseId) {
      const dependencies = formatDependencies(await countStudentRecordedData(studentId));
      if (dependencies.length > 0) {
        setNotice(`No se puede cambiar el curso del alumno porque tiene datos registrados (${dependencies.join(", ")}).`);
        return false;
      }
    }
    const linksToDelete = await getSubjectLinksToDeleteForStudentCourse(studentId, courseId);
    await db.transaction("rw", db.students, db.subjectStudentLinks, async () => {
      await db.students.put({
        ...current,
        classId: courseId,
        firstName,
        lastName,
        fullName,
        comments,
        email,
        photoDataUrl,
        hasAcs,
        hasReinforcement
      });
      if (linksToDelete.length > 0) {
        await db.subjectStudentLinks.bulkDelete(linksToDelete);
      }
    });
    setNotice("Alumno actualizado.");
    await loadAll();
    return true;
  };

  const deleteStudent = async (studentId: string): Promise<void> => {
    const student = students.find((item) => item.id === studentId);
    if (!student) return;
    const recordedData = await countStudentRecordedData(studentId);
    const subjectAssignmentsCount = await db.subjectStudentLinks.where("studentId").equals(studentId).count();
    const dependencies = formatDependencies([
      ...recordedData,
      ["asignaciones_asignatura", subjectAssignmentsCount]
    ]);

    if (dependencies.length > 0) {
      setNotice(
        `No se puede eliminar el alumno porque tiene dependencias (${dependencies.join(", ")}).`
      );
      return;
    }

    await db.transaction("rw", db.students, db.resourceAttachments, db.classroomLayouts, async () => {
      await db.resourceAttachments.where("[ownerType+ownerId]").equals(["student", studentId]).delete();
      const layout = await db.classroomLayouts.where("classId").equals(student.classId).first();
      if (layout?.assignments[studentId] !== undefined) {
        const assignments = { ...layout.assignments };
        delete assignments[studentId];
        await db.classroomLayouts.put({ ...layout, assignments, updatedAt: new Date().toISOString() });
      }
      await db.students.delete(studentId);
    });
    setNotice("Alumno eliminado.");
    await loadAll();
  };

  const createEmptySubject = async (courseId?: string): Promise<string | null> => {
    const effectiveCourseId = courseId || courses[0]?.id || "";
    if (!effectiveCourseId) {
      setNotice("Crea al menos un grupo antes de añadir asignaturas.");
      return null;
    }

    const subjectId = crypto.randomUUID();
    await db.transaction("rw", db.subjects, db.subjectCourseLinks, async () => {
      await db.subjects.add({
        id: subjectId,
        name: "Nueva asignatura",
        scheduleSlotIds: []
      });
      await db.subjectCourseLinks.add({
        id: crypto.randomUUID(),
        subjectId,
        classId: effectiveCourseId
      });
    });

    setNotice("Asignatura creada. Completa sus datos.");
    await loadAll();
    return subjectId;
  };

  const updateSubject = async (
    subjectId: string,
    nameValue: string,
    teachingHoursValue: string,
    scheduleSlotIdsValue: string[],
    courseId: string
  ): Promise<boolean> => {
    const name = nameValue.trim();
    const teachingHours = teachingHoursValue.trim();
    const scheduleSlotIds = Array.from(new Set(scheduleSlotIdsValue.filter(Boolean)));
    if (name.length < 2) {
      setNotice("La asignatura necesita al menos 2 caracteres.");
      return false;
    }
    const conflicting = subjects.find(
      (subject) =>
        subject.id !== subjectId &&
        (subject.scheduleSlotIds ?? []).some((slotId) => scheduleSlotIds.includes(slotId))
    );
    if (conflicting) {
      setNotice(`No se puede guardar: el horario ya está ocupado por ${conflicting.name}.`);
      return false;
    }
    if (!courseId || !courses.some((course) => course.id === courseId)) {
      setNotice("Selecciona el grupo de la asignatura.");
      return false;
    }
    const currentSubject = await db.subjects.get(subjectId);
    const removedSlotIds = (currentSubject?.scheduleSlotIds ?? []).filter((slotId) => !scheduleSlotIds.includes(slotId));
    if (removedSlotIds.length > 0) {
      const [sessions, attendance, dailyRecords] = await Promise.all([
        db.taskSessions.where("subjectId").equals(subjectId).filter((row) => removedSlotIds.includes(row.scheduleSlotId)).count(),
        db.attendanceEntries.where("subjectId").equals(subjectId).filter((row) => removedSlotIds.includes(row.scheduleSlotId)).count(),
        db.dailyClassRecords.where("subjectId").equals(subjectId).filter((row) => removedSlotIds.includes(row.scheduleSlotId)).count()
      ]);
      const dependencies = formatDependencies([
        ["sesiones", sessions],
        ["asistencia", attendance],
        ["registros_diarios", dailyRecords]
      ]);
      if (dependencies.length > 0) {
        setNotice(`No se pueden quitar esas horas porque ya tienen datos (${dependencies.join(", ")}).`);
        return false;
      }
    }
    const currentSubjectLinks = await db.subjectCourseLinks.where("subjectId").equals(subjectId).toArray();

    await db.transaction(
      "rw",
      db.subjects,
      db.subjectCourseLinks,
      async () => {
      const subject = await db.subjects.get(subjectId);
      if (!subject) {
        return;
      }
      await db.subjects.put({
        ...subject,
        name,
        teachingHours: teachingHours || undefined,
        scheduleSlotIds
      });

      // This save path only edits the subject's own fields; it must never drop
      // links to other courses the subject is also taught in.
      if (!currentSubjectLinks.some((link) => link.classId === courseId)) {
        await db.subjectCourseLinks.add({
          id: crypto.randomUUID(),
          subjectId,
          classId: courseId
        });
      }
      }
    );

    setNotice("Asignatura actualizada.");
    await loadAll();
    return true;
  };

  const deleteSubject = async (subjectId: string): Promise<void> => {
    const [unitsCount, tasksCount, gradebookGroupsCount, taskConfigs, assessmentsCount, taskSessionsCount, directGradesCount, attendanceCount, dailyClassRecordsCount] = await Promise.all([
      db.unitBlocks.where("subjectId").equals(subjectId).count(),
      db.taskSubjectLinks.where("subjectId").equals(subjectId).count(),
      db.gradebookGroups.where("subjectId").equals(subjectId).count(),
      db.taskGradebookConfigs.where("subjectId").equals(subjectId).toArray(),
      db.assessments.where("subjectId").equals(subjectId).count(),
      db.taskSessions.where("subjectId").equals(subjectId).count(),
      db.taskDirectGrades.where("subjectId").equals(subjectId).count(),
      db.attendanceEntries.where("subjectId").equals(subjectId).count(),
      db.dailyClassRecords.where("subjectId").equals(subjectId).count()
    ]);
    const taskConfigsCount = taskConfigs.filter(isMeaningfulTaskGradebookConfig).length;

    const blocking = formatDependencies([
      ["unidades", unitsCount],
      ["tareas", tasksCount],
      ["carpetas_cuaderno", gradebookGroupsCount],
      ["config_tareas_cuaderno", taskConfigsCount],
      ["evaluaciones", assessmentsCount],
      ["sesiones_tareas", taskSessionsCount],
      ["notas_directas_tareas", directGradesCount],
      ["asistencia", attendanceCount],
      ["registros_diarios", dailyClassRecordsCount]
    ]);

    if (blocking.length > 0) {
      setNotice(`No se puede eliminar la asignatura porque tiene dependencias (${blocking.join(", ")}).`);
      return;
    }

    const emptyConfigIds = taskConfigs.filter((config) => !isMeaningfulTaskGradebookConfig(config)).map((config) => config.id);
    await db.transaction("rw", db.subjects, db.subjectCourseLinks, db.subjectStudentLinks, db.taskGradebookConfigs, async () => {
      if (emptyConfigIds.length > 0) {
        await db.taskGradebookConfigs.bulkDelete(emptyConfigIds);
      }
      await db.subjectCourseLinks.where("subjectId").equals(subjectId).delete();
      await db.subjectStudentLinks.where("subjectId").equals(subjectId).delete();
      await db.subjects.delete(subjectId);
    });
    setNotice("Asignatura eliminada.");
    await loadAll();
  };

  const setStudentEnrollment = async (
    subjectId: string,
    studentId: string,
    included: boolean
  ): Promise<void> => {
    const existing = subjectStudentLinks.find(
      (item) => item.subjectId === subjectId && item.studentId === studentId
    );

    if (included) {
      const student = students.find((item) => item.id === studentId);
      const subjectCourseId = subjectCourseLinks.find((item) => item.subjectId === subjectId)?.classId;
      if (!student || !subjectCourseId || student.classId !== subjectCourseId) {
        setNotice("El alumno debe pertenecer al grupo de la asignatura.");
        return;
      }
      if (!existing) {
        await db.subjectStudentLinks.add({
          id: crypto.randomUUID(),
          subjectId,
          studentId
        });
      }
    } else if (existing) {
      const dependencies = formatDependencies(await countStudentSubjectRecordedData(studentId, subjectId));
      if (dependencies.length > 0) {
        setNotice(`No se puede quitar al alumno de la asignatura porque tiene datos (${dependencies.join(", ")}).`);
        return;
      }
      await db.subjectStudentLinks.delete(existing.id);
    }

    await loadAll();
  };

  const bulkAssignGroupStudentsToSubject = async (
    courseId: string,
    subjectId: string
  ): Promise<void> => {
    if (!courseId || !subjectId) {
      setNotice("Selecciona grupo y asignatura.");
      return;
    }
    const subjectCourseId = subjectCourseLinks.find((item) => item.subjectId === subjectId)?.classId;
    if (subjectCourseId !== courseId) {
      setNotice("La asignatura solo puede recibir alumnos de su grupo.");
      return;
    }

    const courseStudents = await db.students.where("classId").equals(courseId).toArray();
    const assignedSet = new Set(
      (studentLinksBySubject.get(subjectId) ?? new Set<string>()).values()
    );

    const itemsToAdd: SubjectStudentLink[] = [];
    for (const student of courseStudents) {
      if (!assignedSet.has(student.id)) {
        itemsToAdd.push({
          id: crypto.randomUUID(),
          subjectId,
          studentId: student.id
        });
      }
    }

    if (itemsToAdd.length > 0) {
      await db.subjectStudentLinks.bulkAdd(itemsToAdd);
    }
    setNotice(
      itemsToAdd.length > 0
        ? `Se asignaron ${itemsToAdd.length} fichas del grupo a la asignatura.`
        : "No había alumnos nuevos para asignar."
    );
    await loadAll();
  };

  const getEnrollmentRows = (subjectId: string): EnrollmentRow[] => {
    if (!subjectId) {
      return [];
    }
    const linkedCourses = linksBySubject.get(subjectId) ?? new Set<string>();
    const assignedStudents = studentLinksBySubject.get(subjectId) ?? new Set<string>();

    return students.map((student) => ({
      student,
      courseName: courseMap.get(student.classId)?.name ?? "-",
      derivedIncluded: linkedCourses.has(student.classId),
      effectiveIncluded: assignedStudents.has(student.id)
    }));
  };

  const updateScheduleDay = async (day: ScheduleDay): Promise<boolean> => {
    const validationError = validateScheduleDay(day);
    if (validationError) {
      setNotice(validationError);
      return false;
    }

    const previousDay = await db.scheduleDays.get(day.id);
    if (previousDay) {
      const removedActiveBlockIds = removedActiveScheduleSlotIds(previousDay, day);
      if (removedActiveBlockIds.length > 0) {
        const [sessions, attendance, dailyRecords, comments, settings, rubricRows, checklistRows] = await Promise.all([
          db.taskSessions.where("scheduleSlotId").anyOf(removedActiveBlockIds).count(),
          db.attendanceEntries.where("scheduleSlotId").anyOf(removedActiveBlockIds).count(),
          db.dailyClassRecords.where("scheduleSlotId").anyOf(removedActiveBlockIds).count(),
          db.taskStudentComments.where("scheduleSlotId").anyOf(removedActiveBlockIds).count(),
          db.taskDailyEvaluationSettings.where("scheduleSlotId").anyOf(removedActiveBlockIds).count(),
          db.taskRubricAssessments.where("scheduleSlotId").anyOf(removedActiveBlockIds).count(),
          db.taskChecklistAssessments.where("scheduleSlotId").anyOf(removedActiveBlockIds).count()
        ]);
        const dependencies = formatDependencies([
          ["sesiones", sessions],
          ["asistencia", attendance],
          ["registros_diarios", dailyRecords],
          ["comentarios_tareas", comments],
          ["config_evaluacion", settings],
          ["evaluaciones_rubrica", rubricRows],
          ["evaluaciones_checklist", checklistRows]
        ]);
        if (dependencies.length > 0) {
          setNotice(`No se pueden eliminar o convertir en descanso esos bloques porque tienen datos (${dependencies.join(", ")}).`);
          return false;
        }
      }
    }

    await db.transaction("rw", db.scheduleDays, db.subjects, async () => {
      const previous = await db.scheduleDays.get(day.id);
      await db.scheduleDays.put(day);

      if (!previous) {
        return;
      }

      const previousBlocks = previous.blocks ?? [];
      if (previousBlocks.length === 0) {
        return;
      }

      const nextBlocks = day.blocks ?? [];
      const previousIds = new Set(previousBlocks.map((block) => block.id));
      const nextBreakIds = new Set(nextBlocks.filter((block) => block.isBreak).map((block) => block.id));
      const remap = new Map<string, string>();
      const usedNextIds = new Set<string>();

      // Keep explicit IDs whenever a block survives with the same ID.
      for (const block of nextBlocks) {
        if (previousIds.has(block.id)) {
          remap.set(block.id, block.id);
          usedNextIds.add(block.id);
        }
      }

      const unmatchedPrevious = previousBlocks.filter((block) => !remap.has(block.id));
      const unmatchedNext = nextBlocks.filter((block) => !usedNextIds.has(block.id));

      // First try to match blocks by identical time range.
      const nextIdsByTime = new Map<string, string[]>();
      for (const block of unmatchedNext) {
        const key = `${block.startTime}|${block.endTime}`;
        const bucket = nextIdsByTime.get(key) ?? [];
        bucket.push(block.id);
        nextIdsByTime.set(key, bucket);
      }

      for (const block of unmatchedPrevious) {
        const key = `${block.startTime}|${block.endTime}`;
        const bucket = nextIdsByTime.get(key);
        const mappedId = bucket?.shift();
        if (!mappedId) {
          continue;
        }
        remap.set(block.id, mappedId);
        usedNextIds.add(mappedId);
      }

      // Fallback: preserve as many assignments as possible by position.
      const stillPrevious = unmatchedPrevious.filter((block) => !remap.has(block.id));
      const stillNext = unmatchedNext.filter((block) => !usedNextIds.has(block.id));
      const fallbackLength = Math.min(stillPrevious.length, stillNext.length);
      for (let index = 0; index < fallbackLength; index += 1) {
        const fromId = stillPrevious[index].id;
        const toId = stillNext[index].id;
        remap.set(fromId, toId);
        usedNextIds.add(toId);
      }

      if (remap.size === 0) {
        return;
      }

      const subjectsData = await db.subjects.toArray();
      for (const subject of subjectsData) {
        const currentSlotIds = subject.scheduleSlotIds ?? [];
        if (!currentSlotIds.some((slotId) => previousIds.has(slotId))) {
          continue;
        }

        const nextSlotIds: string[] = [];
        let changed = false;

        for (const slotId of currentSlotIds) {
          if (nextBreakIds.has(slotId)) {
            changed = true;
            continue;
          }

          if (!previousIds.has(slotId)) {
            nextSlotIds.push(slotId);
            continue;
          }

          const mappedId = remap.get(slotId);
          if (!mappedId || nextBreakIds.has(mappedId)) {
            changed = true;
            continue;
          }
          if (mappedId !== slotId) {
            changed = true;
          }
          nextSlotIds.push(mappedId);
        }

        if (!changed) {
          continue;
        }

        const deduped = Array.from(new Set(nextSlotIds));
        await db.subjects.put({
          ...subject,
          scheduleSlotIds: deduped
        });
      }
    });
    await loadAll();
    setNotice("Horario actualizado.");
    return true;
  };

  const updateScheduleSettings = async (settings: ScheduleSettings): Promise<boolean> => {
    await db.scheduleSettings.put(settings);
    await loadAll();
    return true;
  };

  const createEmptyUnit = async (subjectId: string): Promise<string | null> => {
    if (!subjectId) {
      setNotice("Selecciona una asignatura para crear la unidad.");
      return null;
    }
    const currentUnits = await db.unitBlocks.where("subjectId").equals(subjectId).toArray();
    const maxPosition = currentUnits.reduce((max, item) => Math.max(max, item.position), 0);
    const id = crypto.randomUUID();
    await db.unitBlocks.add({
      id,
      subjectId,
      name: "Nueva unidad",
      description: "",
      sessionCount: 1,
      position: maxPosition + 1
    });

    setNotice("Unidad creada. Completa sus datos.");
    await loadAll();
    return id;
  };

  const updateUnit = async (
    unitId: string,
    nameValue: string,
    descriptionValue: string,
    sessionCountValue: number
  ): Promise<boolean> => {
    const name = nameValue.trim();
    const description = descriptionValue.trim();
    const sessionCount = Math.max(1, Math.round(sessionCountValue));
    if (name.length < 2) {
      setNotice("La unidad necesita nombre.");
      return false;
    }
    const current = units.find((item) => item.id === unitId);
    if (!current) {
      return false;
    }
    await db.unitBlocks.put({
      ...current,
      name,
      description,
      sessionCount
    });
    setNotice("Unidad actualizada.");
    await loadAll();
    return true;
  };

  const deleteUnit = async (unitId: string): Promise<void> => {
    const tasksCount = await db.taskSubjectLinks.where("unitId").equals(unitId).count();
    if (tasksCount > 0) {
      setNotice(`No se puede eliminar la unidad porque tiene dependencias (tareas:${tasksCount}).`);
      return;
    }
    await db.unitBlocks.delete(unitId);
    setNotice("Unidad eliminada.");
    await loadAll();
  };


  const createEmptyTask = async (): Promise<string | null> => {
    const id = crypto.randomUUID();
    await db.tasks.add({
      id,
      title: "Nueva tarea",
      description: "",
      sessionCount: 1,
      sendToGradebook: false
    });
    setNotice("Tarea creada. Completa sus datos.");
    await loadAll();
    return id;
  };

  const updateTask = async (
    taskId: string,
    titleValue: string,
    descriptionValue: string,
    sessionCountValue: number,
    sendToGradebook: boolean
  ): Promise<boolean> => {
    const title = titleValue.trim();
    const description = descriptionValue.trim();
    const sessionCount = Math.max(1, Math.round(sessionCountValue));
    if (title.length < 2) {
      setNotice("La tarea necesita un título (mínimo 2 caracteres).");
      return false;
    }
    const current = allTasks.find((t) => t.id === taskId);
    if (!current) return false;
    await db.tasks.put({
      ...current,
      title,
      description,
      sessionCount,
      sendToGradebook
    });
    setNotice("Tarea actualizada.");
    await loadAll();
    return true;
  };

  const deleteTask = async (taskId: string): Promise<void> => {
    const [
      subjectLinkIds,
      gradebookConfigs,
      sessionsCount,
      commentsCount,
      dailySettingsCount,
      rubricAssessmentsCount,
      checklistAssessmentsCount,
      directGradesCount,
      rubricsCount,
      checklistsCount
    ] = await Promise.all([
      db.taskSubjectLinks.where("taskId").equals(taskId).primaryKeys(),
      db.taskGradebookConfigs.where("taskId").equals(taskId).toArray(),
      db.taskSessions.where("taskId").equals(taskId).count(),
      db.taskStudentComments.where("taskId").equals(taskId).count(),
      db.taskDailyEvaluationSettings.where("taskId").equals(taskId).count(),
      db.taskRubricAssessments.where("taskId").equals(taskId).count(),
      db.taskChecklistAssessments.where("taskId").equals(taskId).count(),
      db.taskDirectGrades.where("taskId").equals(taskId).count(),
      db.rubricTemplates.where("taskId").equals(taskId).count(),
      db.checklistTemplates.where("taskId").equals(taskId).count()
    ]);
    const gradebookConfigsCount = gradebookConfigs.filter(isMeaningfulTaskGradebookConfig).length;
    // Subject links themselves are not data to protect: deleting the task removes
    // them atomically below rather than requiring a separate unlink step first.
    const dependencies = formatDependencies([
      ["config_tareas_cuaderno", gradebookConfigsCount],
      ["sesiones", sessionsCount],
      ["comentarios", commentsCount],
      ["ajustes_evaluacion", dailySettingsCount],
      ["evaluaciones_rubrica", rubricAssessmentsCount],
      ["evaluaciones_checklist", checklistAssessmentsCount],
      ["notas_directas_tareas", directGradesCount],
      ["rubricas", rubricsCount],
      ["listas_cotejo", checklistsCount]
    ]);
    if (dependencies.length > 0) {
      setNotice(`No se puede eliminar la tarea porque tiene dependencias (${dependencies.join(", ")}).`);
      return;
    }

    const emptyConfigIds = gradebookConfigs.filter((config) => !isMeaningfulTaskGradebookConfig(config)).map((config) => config.id);
    await db.transaction("rw", db.tasks, db.taskSubjectLinks, db.taskGradebookConfigs, db.resourceAttachments, async () => {
      if (emptyConfigIds.length > 0) {
        await db.taskGradebookConfigs.bulkDelete(emptyConfigIds);
      }
      if (subjectLinkIds.length > 0) {
        await db.taskSubjectLinks.bulkDelete(subjectLinkIds);
      }
      await db.resourceAttachments.where("[ownerType+ownerId]").equals(["task", taskId]).delete();
      await db.tasks.delete(taskId);
    });
    setNotice("Tarea eliminada.");
    await loadAll();
  };

  const addTaskSubjectLink = async (
    taskId: string,
    subjectId: string,
    unitId?: string
  ): Promise<void> => {
    const existing = taskSubjectLinks.find(
      (l) => l.taskId === taskId && l.subjectId === subjectId && (l.unitId ?? "") === (unitId ?? "")
    );
    if (existing) {
      setNotice("La tarea ya está vinculada a esa asignatura/unidad.");
      return;
    }
    await db.taskSubjectLinks.add({
      id: crypto.randomUUID(),
      taskId,
      subjectId,
      unitId: unitId || undefined
    });
    setNotice("Tarea vinculada.");
    await loadAll();
  };

  const updateTaskSubjectLink = async (
    linkId: string,
    unitId: string | undefined
  ): Promise<boolean> => {
    const existing = await db.taskSubjectLinks.get(linkId);
    if (!existing) return false;
    if ((existing.unitId ?? "") !== (unitId ?? "")) {
      const dependencies = formatDependencies(await countTaskSubjectUsage(existing.taskId, existing.subjectId));
      if (dependencies.length > 0) {
        setNotice(`No se puede cambiar la unidad del vínculo porque ya tiene datos (${dependencies.join(", ")}).`);
        return false;
      }
    }
    await db.taskSubjectLinks.put({ ...existing, unitId: unitId || undefined });
    await loadAll();
    return true;
  };

  const value: ManagementContextValue = {
    courses,
    students,
    subjects,
    units,
    scheduleDays,
    scheduleSettings,
    subjectCourseLinks,
    taskSubjectLinks,
    allTasks,
    notice,
    isBusy,
    isReady,
    setNotice,
    refreshAll: () => runWithProgress(() => loadAll()),
    createCourse: (...args) => runWithProgress(() => createCourse(...args)),
    createEmptyCourse: () => runWithProgress(() => createEmptyCourse()),
    updateCourse: (...args) => runSaveWithProgress(() => updateCourse(...args)),
    deleteCourse: (...args) => runWithProgress(() => deleteCourse(...args)),
    createEmptyStudent: (...args) => runWithProgress(() => createEmptyStudent(...args)),
    updateStudent: (...args) => runSaveWithProgress(() => updateStudent(...args)),
    addStudentToCourse: (...args) => runWithProgress(() => addStudentToCourse(...args)),
    deleteStudent: (...args) => runWithProgress(() => deleteStudent(...args)),
    createEmptySubject: (...args) => runWithProgress(() => createEmptySubject(...args)),
    updateSubject: (...args) => runSaveWithProgress(() => updateSubject(...args)),
    deleteSubject: (...args) => runWithProgress(() => deleteSubject(...args)),
    setStudentEnrollment: (...args) => runWithProgress(() => setStudentEnrollment(...args)),
    bulkAssignGroupStudentsToSubject: (...args) =>
      runWithProgress(() => bulkAssignGroupStudentsToSubject(...args)),
    getEnrollmentRows,
    updateScheduleDay: (...args) => runSaveWithProgress(() => updateScheduleDay(...args)),
    updateScheduleSettings: (...args) => runSaveWithProgress(() => updateScheduleSettings(...args)),
    createEmptyUnit: (...args) => runWithProgress(() => createEmptyUnit(...args)),
    updateUnit: (...args) => runSaveWithProgress(() => updateUnit(...args)),
    deleteUnit: (...args) => runWithProgress(() => deleteUnit(...args)),
    createEmptyTask: () => runWithProgress(() => createEmptyTask()),
    updateTask: (...args) => runSaveWithProgress(() => updateTask(...args)),
    deleteTask: (...args) => runWithProgress(() => deleteTask(...args)),
    addTaskSubjectLink: (...args) => runWithProgress(() => addTaskSubjectLink(...args)),
    updateTaskSubjectLink: (...args) => runSaveWithProgress(() => updateTaskSubjectLink(...args))
  };

  return <ManagementContext.Provider value={value}>{children}</ManagementContext.Provider>;
}

export function useManagement() {
  const context = useContext(ManagementContext);
  if (!context) {
    throw new Error("useManagement must be used within ManagementProvider");
  }
  return context;
}
