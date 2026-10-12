import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { NavLink, useSearchParams } from "react-router-dom";
import { db } from "../../shared/db/database";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { setSelectedClass, setSelectedSubject } from "../../app/store";
import type {
  ChecklistTemplate,
  ClassGroup,
  RubricTemplate,
  ScheduleDay,
  Student,
  Subject,
  SubjectCourseLink,
  SubjectStudentLink,
  Task,
  TaskChecklistAssessment,
  TaskDailyEvaluationSetting,
  TaskDirectGrade,
  TaskGradebookConfig,
  TaskRubricAssessment,
  TaskSession,
  TaskStudentComment,
  TaskSubjectLink,
  UnitBlock
} from "../../shared/db/types";
import { matchesTaskScope } from "../../shared/gradebook/calculations";
import { useStudentDisplay } from "../../shared/hooks/useStudentDisplay";
import { useUnsavedChangesGuard } from "../../shared/hooks/useUnsavedChangesGuard";
import { ClassGroupSelect } from "../../shared/ui/ClassGroupSelect";
import { SubnavActions } from "../../shared/ui/SubnavActions";
import { toLocalIsoDate } from "../../shared/utils/date";
import {
  filterTaskSessionsByAcademicContext,
  filterTaskSessionsForEvaluation,
  selectTaskSessionByDateAndSlot
} from "./taskSessionScope";

function rubricDraftKey(studentId: string, criterionId: string): string {
  return `${studentId}:${criterionId}`;
}

function checklistDraftKey(studentId: string, itemId: string): string {
  return `${studentId}:${itemId}`;
}

export function AttendancePage() {
  const { formatName, compareFn } = useStudentDisplay();
  const [searchParams] = useSearchParams();
  const dispatch = useAppDispatch();
  const selectedClassId = useAppSelector((state) => state.app.selectedClassId);
  const selectedSubjectId = useAppSelector((state) => state.app.selectedSubjectId);
  const [classGroups, setClassGroups] = useState<ClassGroup[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectCourseLinks, setSubjectCourseLinks] = useState<SubjectCourseLink[]>([]);
  const [scheduleDays, setScheduleDays] = useState<ScheduleDay[]>([]);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [subjectStudentLinks, setSubjectStudentLinks] = useState<SubjectStudentLink[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskSubjectLinks, setTaskSubjectLinks] = useState<TaskSubjectLink[]>([]);
  const [unitBlocks, setUnitBlocks] = useState<UnitBlock[]>([]);
  const [taskGradebookConfigs, setTaskGradebookConfigs] = useState<TaskGradebookConfig[]>([]);
  const [taskSessions, setTaskSessions] = useState<TaskSession[]>([]);
  const [taskStudentComments, setTaskStudentComments] = useState<TaskStudentComment[]>([]);
  const [rubricTemplates, setRubricTemplates] = useState<RubricTemplate[]>([]);
  const [checklistTemplates, setChecklistTemplates] = useState<ChecklistTemplate[]>([]);
  const [taskDailyEvaluationSettings, setTaskDailyEvaluationSettings] = useState<TaskDailyEvaluationSetting[]>([]);
  const [taskRubricAssessments, setTaskRubricAssessments] = useState<TaskRubricAssessment[]>([]);
  const [taskChecklistAssessments, setTaskChecklistAssessments] = useState<TaskChecklistAssessment[]>([]);
  const [taskDirectGrades, setTaskDirectGrades] = useState<TaskDirectGrade[]>([]);
  const requestedDate = searchParams.get("date") ?? "";
  const [selectedDate, setSelectedDate] = useState(
    /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : toLocalIsoDate()
  );
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedWorkUnitId, setSelectedWorkUnitId] = useState("");
  const [selectedTaskSessionSlotId, setSelectedTaskSessionSlotId] = useState("");
  const [taskGeneralCommentDraft, setTaskGeneralCommentDraft] = useState("");
  const [taskStudentCommentDraft, setTaskStudentCommentDraft] = useState<Map<string, string>>(new Map());
  const [selectedRubricTemplateId, setSelectedRubricTemplateId] = useState("");
  const [selectedChecklistTemplateId, setSelectedChecklistTemplateId] = useState("");
  const [taskRubricDraft, setTaskRubricDraft] = useState<Map<string, string>>(new Map());
  const [taskChecklistDraft, setTaskChecklistDraft] = useState<Map<string, boolean>>(new Map());
  const [taskDirectGradeDraft, setTaskDirectGradeDraft] = useState<Map<string, string>>(new Map());
  const [taskDirty, setTaskDirty] = useState(false);
  const [isSavingTask, setIsSavingTask] = useState(false);
  const [taskNotice, setTaskNotice] = useState("");
  const taskAutoSaveTimerRef = useRef<number | null>(null);
  const taskEditVersionRef = useRef(0);
  const deepLinkAppliedRef = useRef(false);

  const loadMetadata = async (): Promise<void> => {
    const [
      classGroupsData,
      subjectsData,
      scheduleDaysData,
      studentsData,
      subjectStudentLinksData,
      subjectCourseLinksData,
      tasksData,
      taskSubjectLinksData,
      unitBlocksData,
      taskSessionsData,
      taskStudentCommentsData,
      rubricTemplatesData,
      checklistTemplatesData,
      taskDailyEvaluationSettingsData,
      taskRubricAssessmentsData,
      taskChecklistAssessmentsData,
      taskDirectGradesData,
      taskGradebookConfigsData
    ] = await Promise.all([
      db.classGroups.orderBy("name").toArray(),
      db.subjects.orderBy("name").toArray(),
      db.scheduleDays.orderBy("dayOfWeek").toArray(),
      db.students.toArray(),
      db.subjectStudentLinks.toArray(),
      db.subjectCourseLinks.toArray(),
      db.tasks.toArray(),
      db.taskSubjectLinks.toArray(),
      db.unitBlocks.toArray(),
      db.taskSessions.toArray(),
      db.taskStudentComments.toArray(),
      db.rubricTemplates.toArray(),
      db.checklistTemplates.toArray(),
      db.taskDailyEvaluationSettings.toArray(),
      db.taskRubricAssessments.toArray(),
      db.taskChecklistAssessments.toArray(),
      db.taskDirectGrades.toArray(),
      db.taskGradebookConfigs.toArray()
    ]);

    setClassGroups(classGroupsData);
    setSubjects(subjectsData);
    setSubjectCourseLinks(subjectCourseLinksData);
    setScheduleDays(scheduleDaysData);
    setAllStudents(studentsData.sort(compareFn));
    setSubjectStudentLinks(subjectStudentLinksData);
    setTasks(tasksData);
    setTaskSubjectLinks(taskSubjectLinksData);
    setUnitBlocks(unitBlocksData);
    setTaskGradebookConfigs(taskGradebookConfigsData);
    setTaskSessions(taskSessionsData);
    setTaskStudentComments(taskStudentCommentsData);
    setRubricTemplates(rubricTemplatesData);
    setChecklistTemplates(checklistTemplatesData);
    setTaskDailyEvaluationSettings(taskDailyEvaluationSettingsData);
    setTaskRubricAssessments(taskRubricAssessmentsData);
    setTaskChecklistAssessments(taskChecklistAssessmentsData);
    setTaskDirectGrades(taskDirectGradesData);
  };

  const workSubjects = useMemo(() => {
    if (!selectedClassId) {
      return [];
    }
    const linkedSubjectIds = new Set(
      subjectCourseLinks
        .filter((link) => link.classId === selectedClassId)
        .map((link) => link.subjectId)
    );
    return subjects
      .filter((subject) => linkedSubjectIds.has(subject.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedClassId, subjectCourseLinks, subjects]);
  const workUnits = useMemo(() => {
    if (!selectedSubjectId) {
      return [];
    }
    return unitBlocks
      .filter((unit) => unit.subjectId === selectedSubjectId)
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  }, [selectedSubjectId, unitBlocks]);

  useEffect(() => {
    void loadMetadata();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (deepLinkAppliedRef.current || classGroups.length === 0) return;
    const requestedClassId = searchParams.get("classId") ?? "";
    const requestedSubjectId = searchParams.get("subjectId") ?? "";
    const requestedTaskId = searchParams.get("taskId") ?? "";
    const requestedSlotId = searchParams.get("slotId") ?? "";
    const requestedSessionDate = searchParams.get("date") ?? "";

    if (
      requestedClassId &&
      classGroups.some((group) => group.id === requestedClassId) &&
      selectedClassId !== requestedClassId
    ) {
      dispatch(setSelectedClass(requestedClassId));
      return;
    }
    if (
      requestedSubjectId &&
      workSubjects.some((subject) => subject.id === requestedSubjectId) &&
      selectedSubjectId !== requestedSubjectId
    ) {
      dispatch(setSelectedSubject(requestedSubjectId));
      return;
    }
    const requestedUnitId = requestedTaskId
      ? taskSubjectLinks.find(
        (link) => link.taskId === requestedTaskId && (!requestedSubjectId || link.subjectId === requestedSubjectId)
      )?.unitId ?? ""
      : "";
    if (requestedUnitId && workUnits.some((unit) => unit.id === requestedUnitId) && selectedWorkUnitId !== requestedUnitId) {
      setSelectedWorkUnitId(requestedUnitId);
      return;
    }
    if (requestedTaskId && tasks.some((task) => task.id === requestedTaskId) && selectedTaskId !== requestedTaskId) {
      setSelectedTaskId(requestedTaskId);
      return;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(requestedSessionDate) && selectedDate !== requestedSessionDate) {
      setSelectedDate(requestedSessionDate);
      return;
    }
    if (requestedSlotId && selectedTaskSessionSlotId !== requestedSlotId) {
      setSelectedTaskSessionSlotId(requestedSlotId);
      return;
    }
    deepLinkAppliedRef.current = true;
  }, [
    classGroups,
    dispatch,
    searchParams,
    selectedClassId,
    selectedDate,
    selectedSubjectId,
    selectedTaskId,
    selectedTaskSessionSlotId,
    selectedWorkUnitId,
    taskSubjectLinks,
    tasks,
    workSubjects,
    workUnits
  ]);

  useEffect(() => {
    if (workSubjects.length === 0) {
      if (selectedSubjectId) {
        dispatch(setSelectedSubject(""));
      }
      return;
    }
    if (!workSubjects.some((subject) => subject.id === selectedSubjectId)) {
      dispatch(setSelectedSubject(workSubjects[0].id));
    }
  }, [dispatch, selectedSubjectId, workSubjects]);

  useEffect(() => {
    if (workUnits.length === 0) {
      setSelectedWorkUnitId("");
      return;
    }
    if (!workUnits.some((unit) => unit.id === selectedWorkUnitId)) {
      setSelectedWorkUnitId(workUnits[0].id);
    }
  }, [selectedWorkUnitId, workUnits]);

  // Reorder students when the preference changes without reloading IndexedDB.
  useEffect(() => {
    setAllStudents((prev) => [...prev].sort(compareFn));
  }, [compareFn]);

  // Task id to subject id map (first match per task).
  const slotTimeLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const day of scheduleDays) {
      for (const block of day.blocks) {
        if (block.isBreak) continue;
        map.set(block.id, `${block.startTime} - ${block.endTime}`);
      }
    }
    return map;
  }, [scheduleDays]);
  const slotOrderById = useMemo(() => {
    const map = new Map<string, number>();
    let index = 0;
    const sortedDays = [...scheduleDays].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
    for (const day of sortedDays) {
      const sortedBlocks = [...day.blocks].sort((a, b) => {
        if (a.startTime === b.startTime) {
          return a.endTime.localeCompare(b.endTime);
        }
        return a.startTime.localeCompare(b.startTime);
      });
      for (const block of sortedBlocks) {
        if (block.isBreak) continue;
        if (!map.has(block.id)) {
          map.set(block.id, index);
          index += 1;
        }
      }
    }
    return map;
  }, [scheduleDays]);

  const unitNameByTaskId = useMemo(() => {
    const unitById = new Map(unitBlocks.map((unit) => [unit.id, unit]));
    const map = new Map<string, string>();
    for (const link of taskSubjectLinks) {
      if (selectedSubjectId && link.subjectId !== selectedSubjectId) {
        continue;
      }
      if (!link.unitId || map.has(link.taskId)) {
        continue;
      }
      const unit = unitById.get(link.unitId);
      if (unit) {
        map.set(link.taskId, unit.name);
      }
    }
    return map;
  }, [selectedSubjectId, taskSubjectLinks, unitBlocks]);

  const workTaskOptions = useMemo(() => {
    if (!selectedClassId || !selectedSubjectId || !selectedWorkUnitId) {
      return [];
    }
    const taskIdsForSubject = new Set(
      taskSubjectLinks
        .filter((link) => link.subjectId === selectedSubjectId && (link.unitId ?? "") === selectedWorkUnitId)
        .map((link) => link.taskId)
    );
    const sessionCountByTask = new Map<string, number>();
    const scopedSessions = filterTaskSessionsByAcademicContext(taskSessions, {
      classId: selectedClassId,
      subjectId: selectedSubjectId
    });
    for (const session of scopedSessions) {
      if (!taskIdsForSubject.has(session.taskId)) {
        continue;
      }
      sessionCountByTask.set(session.taskId, (sessionCountByTask.get(session.taskId) ?? 0) + 1);
    }
    return tasks
      .filter((task) => taskIdsForSubject.has(task.id))
      .map((task) => ({
        task,
        unitName: unitNameByTaskId.get(task.id) ?? "Sin unidad",
        sessionCount: sessionCountByTask.get(task.id) ?? 0
      }))
      .sort((a, b) => {
        return a.task.title.localeCompare(b.task.title);
      });
  }, [selectedClassId, selectedSubjectId, selectedWorkUnitId, taskSessions, taskSubjectLinks, tasks, unitNameByTaskId]);

  const selectedTaskForDay = useMemo(
    () => workTaskOptions.find((item) => item.task.id === selectedTaskId)?.task ?? null,
    [selectedTaskId, workTaskOptions]
  );

  const workTaskSessions = useMemo(() => {
    if (!selectedTaskForDay || !selectedClassId || !selectedSubjectId) {
      return [];
    }
    return filterTaskSessionsForEvaluation(taskSessions, {
      taskId: selectedTaskForDay.id,
      classId: selectedClassId,
      subjectId: selectedSubjectId
    })
      .sort((a, b) => {
        const byDate = a.date.localeCompare(b.date);
        if (byDate !== 0) {
          return byDate;
        }
        const orderA = slotOrderById.get(a.scheduleSlotId) ?? Number.MAX_SAFE_INTEGER;
        const orderB = slotOrderById.get(b.scheduleSlotId) ?? Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        return a.scheduleSlotId.localeCompare(b.scheduleSlotId);
      });
  }, [
    selectedClassId,
    selectedSubjectId,
    selectedTaskForDay,
    slotOrderById,
    taskSessions
  ]);

  const selectedTaskSessionForDay = useMemo(
    () => selectTaskSessionByDateAndSlot(workTaskSessions, selectedDate, selectedTaskSessionSlotId),
    [selectedDate, selectedTaskSessionSlotId, workTaskSessions]
  );
  const selectedTaskGradebookConfig = useMemo(() => {
    if (!selectedTaskForDay || !selectedClassId || !selectedSubjectId) {
      return null;
    }
    return (
      taskGradebookConfigs.find(
        (config) =>
          config.taskId === selectedTaskForDay.id &&
          config.subjectId === selectedSubjectId &&
          config.classId === selectedClassId
      ) ?? null
    );
  }, [selectedClassId, selectedSubjectId, selectedTaskForDay, taskGradebookConfigs]);

  const taskStudents = useMemo(() => {
    if (!selectedTaskForDay) {
      return [];
    }
    const studentSet = new Set(
      subjectStudentLinks
        .filter((link) => link.subjectId === selectedSubjectId)
        .map((link) => link.studentId)
    );
    return allStudents
      .filter((student) => studentSet.has(student.id))
      .filter((student) => student.classId === selectedClassId);
  }, [selectedClassId, selectedSubjectId, allStudents, selectedTaskForDay, subjectStudentLinks]);

  const selectedRubricTemplate = useMemo(
    () => rubricTemplates.find((item) => item.id === selectedRubricTemplateId) ?? null,
    [rubricTemplates, selectedRubricTemplateId]
  );
  const selectedChecklistTemplate = useMemo(
    () => checklistTemplates.find((item) => item.id === selectedChecklistTemplateId) ?? null,
    [checklistTemplates, selectedChecklistTemplateId]
  );
  const taskHasDirectGrade = Boolean(selectedTaskGradebookConfig?.directGradeEnabled);
  const taskHasAssignedInstrument = Boolean(
    selectedTaskGradebookConfig?.rubricTemplateId ||
      selectedTaskGradebookConfig?.checklistTemplateId ||
      selectedTaskGradebookConfig?.directGradeEnabled
  );

  useEffect(() => {
    if (workTaskOptions.length === 0) {
      setSelectedTaskId("");
      return;
    }
    if (!workTaskOptions.some((item) => item.task.id === selectedTaskId)) {
      setSelectedTaskId(workTaskOptions[0].task.id);
    }
  }, [selectedTaskId, workTaskOptions]);

  useEffect(() => {
    if (!deepLinkAppliedRef.current && searchParams.has("taskId")) {
      return;
    }
    if (workTaskSessions.length === 0) {
      setSelectedTaskSessionSlotId("");
      return;
    }
    const exists = workTaskSessions.some(
      (item) => item.scheduleSlotId === selectedTaskSessionSlotId && item.date === selectedDate
    );
    if (!exists) {
      const firstSession = workTaskSessions[0];
      setSelectedTaskSessionSlotId(firstSession.scheduleSlotId);
      if (selectedDate !== firstSession.date) {
        setSelectedDate(firstSession.date);
      }
    }
  }, [searchParams, selectedDate, selectedTaskSessionSlotId, workTaskSessions]);

  useEffect(() => {
    if (!selectedTaskForDay || !selectedTaskSessionForDay || !selectedClassId || !selectedSubjectId) {
      setTaskGeneralCommentDraft("");
      setTaskStudentCommentDraft(new Map());
      setSelectedRubricTemplateId("");
      setSelectedChecklistTemplateId("");
      setTaskRubricDraft(new Map());
      setTaskChecklistDraft(new Map());
      setTaskDirectGradeDraft(new Map());
      setTaskNotice("");
      setTaskDirty(false);
      return;
    }
    const diaryDate = selectedTaskSessionForDay.date;
    const slotId = selectedTaskSessionForDay.scheduleSlotId;
    const setting =
      taskDailyEvaluationSettings.find(
        (item) =>
          item.taskId === selectedTaskForDay.id &&
          item.date === diaryDate &&
          item.scheduleSlotId === slotId &&
          matchesTaskScope(item, selectedClassId, selectedSubjectId)
      ) ?? null;
    setTaskGeneralCommentDraft(setting?.generalComment ?? "");
    const commentsMap = new Map<string, string>();
    for (const row of taskStudentComments) {
      if (
        row.taskId === selectedTaskForDay.id &&
        row.date === diaryDate &&
        row.scheduleSlotId === slotId &&
        matchesTaskScope(row, selectedClassId, selectedSubjectId)
      ) {
        commentsMap.set(row.studentId, row.comment);
      }
    }
    setTaskStudentCommentDraft(commentsMap);

    const taskRubricId = selectedTaskGradebookConfig?.rubricTemplateId ?? "";
    const taskChecklistId = selectedTaskGradebookConfig?.checklistTemplateId ?? "";
    if (taskRubricId) {
      setSelectedRubricTemplateId(taskRubricId);
      setSelectedChecklistTemplateId("");
    } else if (taskChecklistId) {
      setSelectedRubricTemplateId("");
      setSelectedChecklistTemplateId(taskChecklistId);
    } else {
      setSelectedRubricTemplateId("");
      setSelectedChecklistTemplateId("");
    }

    const rubricMap = new Map<string, string>();
    for (const row of taskRubricAssessments) {
      if (
        row.taskId !== selectedTaskForDay.id ||
        row.date !== diaryDate ||
        row.scheduleSlotId !== slotId ||
        !matchesTaskScope(row, selectedClassId, selectedSubjectId)
      ) {
        continue;
      }
      rubricMap.set(rubricDraftKey(row.studentId, row.criterionId), row.levelId);
    }
    setTaskRubricDraft(rubricMap);

    const checklistMap = new Map<string, boolean>();
    for (const row of taskChecklistAssessments) {
      if (
        row.taskId !== selectedTaskForDay.id ||
        row.date !== diaryDate ||
        row.scheduleSlotId !== slotId ||
        !matchesTaskScope(row, selectedClassId, selectedSubjectId)
      ) {
        continue;
      }
      checklistMap.set(checklistDraftKey(row.studentId, row.itemId), row.checked);
    }
    setTaskChecklistDraft(checklistMap);

    const directGradeMap = new Map<string, string>();
    for (const row of taskDirectGrades) {
      if (
        row.taskId !== selectedTaskForDay.id ||
        row.classId !== selectedClassId ||
        row.subjectId !== selectedSubjectId
      ) {
        continue;
      }
      directGradeMap.set(row.studentId, String(row.score));
    }
    setTaskDirectGradeDraft(directGradeMap);
    setTaskNotice("");
    setTaskDirty(false);
  }, [
    selectedClassId,
    selectedSubjectId,
    selectedDate,
    selectedTaskGradebookConfig,
    selectedTaskForDay,
    selectedTaskSessionForDay,
    taskChecklistAssessments,
    taskDailyEvaluationSettings,
    taskDirectGrades,
    taskRubricAssessments,
    taskStudentComments
  ]);

  const markTaskDirty = (): void => {
    taskEditVersionRef.current += 1;
    setTaskDirty(true);
  };

  const saveTaskDiary = async (): Promise<boolean> => {
    if (!selectedTaskForDay || !selectedClassId || !selectedSubjectId || !selectedTaskSessionForDay) {
      return false;
    }
    if (taskAutoSaveTimerRef.current !== null) {
      window.clearTimeout(taskAutoSaveTimerRef.current);
      taskAutoSaveTimerRef.current = null;
    }

    const saveVersion = taskEditVersionRef.current;
    const taskId = selectedTaskForDay.id;
    const diaryDate = selectedTaskSessionForDay.date;
    const scheduleSlotId = selectedTaskSessionForDay.scheduleSlotId;
    const normalizedGeneralComment = taskGeneralCommentDraft.trim();
    const effectiveRubricTemplateId = selectedTaskGradebookConfig?.rubricTemplateId ?? "";
    const effectiveChecklistTemplateId = effectiveRubricTemplateId
      ? ""
      : (selectedTaskGradebookConfig?.checklistTemplateId ?? "");
    if (selectedTaskGradebookConfig?.academicPeriodId) {
      const academicPeriod = await db.academicPeriods.get(selectedTaskGradebookConfig.academicPeriodId);
      if (academicPeriod?.status === "closed") {
        setTaskNotice("Reabre el periodo académico para modificar esta evaluación.");
        return false;
      }
    }
    const usesDirectGrade = Boolean(selectedTaskGradebookConfig?.directGradeEnabled);
    const normalizedDirectGrades: TaskDirectGrade[] = [];
    if (usesDirectGrade) {
      for (const student of taskStudents) {
        const rawValue = taskDirectGradeDraft.get(student.id)?.trim() ?? "";
        if (!rawValue) {
          continue;
        }
        const score = Number(rawValue.replace(",", "."));
        if (!Number.isFinite(score) || score < 0 || score > 10) {
          setTaskNotice("La nota directa debe estar entre 0 y 10.");
          return false;
        }
        normalizedDirectGrades.push({
          id: `task-direct-${taskId}-${selectedSubjectId}-${selectedClassId}-${student.id}`,
          taskId,
          subjectId: selectedSubjectId,
          classId: selectedClassId,
          studentId: student.id,
          score: Number(score.toFixed(2))
        });
      }
    }
    const normalizedComments = taskStudents
      .map((student) => ({
        id: crypto.randomUUID(),
        taskId,
        subjectId: selectedSubjectId,
        classId: selectedClassId,
        date: diaryDate,
        scheduleSlotId,
        studentId: student.id,
        comment: (taskStudentCommentDraft.get(student.id) ?? "").trim()
      }))
      .filter((row) => row.comment.length > 0);

    setIsSavingTask(true);
    try {
      await db.transaction(
        "rw",
        db.taskStudentComments,
        db.taskDailyEvaluationSettings,
        db.taskRubricAssessments,
        db.taskChecklistAssessments,
        db.taskDirectGrades,
        async () => {
          const commentIds = (await db.taskStudentComments
            .where("[taskId+classId+subjectId+date+scheduleSlotId]")
            .equals([taskId, selectedClassId, selectedSubjectId, diaryDate, scheduleSlotId])
            .primaryKeys()) as string[];
          await db.taskStudentComments.bulkDelete(commentIds);
          if (normalizedComments.length > 0) {
            await db.taskStudentComments.bulkAdd(normalizedComments);
          }

          const settingIds = (await db.taskDailyEvaluationSettings
            .where("[taskId+classId+subjectId+date+scheduleSlotId]")
            .equals([taskId, selectedClassId, selectedSubjectId, diaryDate, scheduleSlotId])
            .primaryKeys()) as string[];
          await db.taskDailyEvaluationSettings.bulkDelete(settingIds);
          if (normalizedGeneralComment || effectiveRubricTemplateId || effectiveChecklistTemplateId) {
            await db.taskDailyEvaluationSettings.add({
              id: `task-eval-${taskId}-${selectedSubjectId}-${selectedClassId}-${diaryDate}-${scheduleSlotId}`,
              taskId,
              subjectId: selectedSubjectId,
              classId: selectedClassId,
              date: diaryDate,
              scheduleSlotId,
              generalComment: normalizedGeneralComment || undefined,
              rubricTemplateId: effectiveRubricTemplateId || undefined,
              checklistTemplateId: effectiveChecklistTemplateId || undefined
            });
          }

          const rubricIds = (await db.taskRubricAssessments
            .where("[taskId+classId+subjectId+date+scheduleSlotId]")
            .equals([taskId, selectedClassId, selectedSubjectId, diaryDate, scheduleSlotId])
            .primaryKeys()) as string[];
          await db.taskRubricAssessments.bulkDelete(rubricIds);
          if (effectiveRubricTemplateId && selectedRubricTemplate) {
            const rubricRows: TaskRubricAssessment[] = [];
            for (const student of taskStudents) {
              for (const criterion of selectedRubricTemplate.criteria ?? []) {
                const criterionId = criterion.id;
                const levelId = taskRubricDraft.get(rubricDraftKey(student.id, criterionId));
                const level = (criterion.levels ?? []).find((item) => item.id === levelId);
                if (!level) {
                  continue;
                }
                rubricRows.push({
                  id: crypto.randomUUID(),
                  taskId,
                  subjectId: selectedSubjectId,
                  classId: selectedClassId,
                  date: diaryDate,
                  scheduleSlotId,
                  studentId: student.id,
                  rubricTemplateId: selectedRubricTemplate.id,
                  criterionId,
                  levelId: level.id,
                  score: Number(level.score) || 0
                });
              }
            }
            if (rubricRows.length > 0) {
              await db.taskRubricAssessments.bulkAdd(rubricRows);
            }
          }

          const checklistIds = (await db.taskChecklistAssessments
            .where("[taskId+classId+subjectId+date+scheduleSlotId]")
            .equals([taskId, selectedClassId, selectedSubjectId, diaryDate, scheduleSlotId])
            .primaryKeys()) as string[];
          await db.taskChecklistAssessments.bulkDelete(checklistIds);
          if (effectiveChecklistTemplateId && selectedChecklistTemplate) {
            const checklistRows: TaskChecklistAssessment[] = [];
            for (const student of taskStudents) {
              for (const item of selectedChecklistTemplate.items ?? []) {
                if (!taskChecklistDraft.get(checklistDraftKey(student.id, item.id))) {
                  continue;
                }
                checklistRows.push({
                  id: crypto.randomUUID(),
                  taskId,
                  subjectId: selectedSubjectId,
                  classId: selectedClassId,
                  date: diaryDate,
                  scheduleSlotId,
                  studentId: student.id,
                  checklistTemplateId: selectedChecklistTemplate.id,
                  itemId: item.id,
                  checked: true
                });
              }
            }
            if (checklistRows.length > 0) {
              await db.taskChecklistAssessments.bulkAdd(checklistRows);
            }
          }

          if (usesDirectGrade) {
            await db.taskDirectGrades
              .where("[taskId+subjectId+classId]")
              .equals([taskId, selectedSubjectId, selectedClassId])
              .delete();
            if (normalizedDirectGrades.length > 0) {
              await db.taskDirectGrades.bulkAdd(normalizedDirectGrades);
            }
          }
        }
      );

      if (taskEditVersionRef.current === saveVersion) {
        setTaskDirty(false);
        setTaskNotice("Registro de tarea guardado automaticamente.");
        await loadMetadata();
      }
      return true;
    } finally {
      setIsSavingTask(false);
    }
  };

  const saveTaskDiaryForEffect = useEffectEvent(saveTaskDiary);

  const hasUnsavedChanges = taskDirty;

  const runWithContextGuard = (action: () => void): void => {
    if (!hasUnsavedChanges) {
      action();
      return;
    }
    void (async () => {
      const taskSaved = await saveTaskDiary();
      if (!taskSaved) {
        return;
      }
      action();
    })();
  };

  useEffect(() => {
    if (!taskDirty || !selectedTaskForDay || !selectedTaskSessionForDay || isSavingTask) {
      return;
    }
    if (taskAutoSaveTimerRef.current !== null) {
      window.clearTimeout(taskAutoSaveTimerRef.current);
    }
    taskAutoSaveTimerRef.current = window.setTimeout(() => {
      taskAutoSaveTimerRef.current = null;
      void saveTaskDiaryForEffect();
    }, 700);
    return () => {
      if (taskAutoSaveTimerRef.current !== null) {
        window.clearTimeout(taskAutoSaveTimerRef.current);
        taskAutoSaveTimerRef.current = null;
      }
    };
  }, [
    isSavingTask,
    selectedDate,
    selectedTaskForDay,
    selectedTaskSessionForDay,
    taskDirectGradeDraft,
    taskChecklistDraft,
    taskDirty,
    taskGeneralCommentDraft,
    taskRubricDraft,
    taskStudentCommentDraft
  ]);

  const renderDirectGradeInput = (student: Student) => (
    <input
      className="input"
      type="number"
      min={0}
      max={10}
      step={0.1}
      value={taskDirectGradeDraft.get(student.id) ?? ""}
      placeholder="0-10"
      onChange={(event) => {
        const value = event.target.value;
        setTaskDirectGradeDraft((current) => {
          const next = new Map(current);
          if (value.trim().length === 0) {
            next.delete(student.id);
          } else {
            next.set(student.id, value);
          }
          return next;
        });
        setTaskNotice("");
        markTaskDirty();
      }}
    />
  );
  const savePendingWorkChanges = async (): Promise<boolean> => {
    if (taskDirty && !(await saveTaskDiary())) return false;
    return true;
  };
  useUnsavedChangesGuard(hasUnsavedChanges, "Hay cambios de evaluación sin guardar.", savePendingWorkChanges);

  const selectWorkTaskSession = async (session: TaskSession): Promise<void> => {
    if (taskDirty) {
      const saved = await saveTaskDiary();
      if (!saved) {
        return;
      }
    }
    setSelectedTaskSessionSlotId(session.scheduleSlotId);
    if (selectedDate !== session.date) {
      setSelectedDate(session.date);
    }
  };

  const selectedWorkTodayLink = selectedTaskSessionForDay && selectedClassId && selectedSubjectId
    ? `/today?date=${selectedTaskSessionForDay.date}&classId=${encodeURIComponent(selectedClassId)}&subjectId=${encodeURIComponent(selectedSubjectId)}&slotId=${encodeURIComponent(selectedTaskSessionForDay.scheduleSlotId)}`
    : "/today";
  const selectedWorkClassName = classGroups.find((group) => group.id === selectedClassId)?.name ?? "";
  const selectedWorkSubjectName = subjects.find((subject) => subject.id === selectedSubjectId)?.name ?? "";

  return (
    <section className="module-card">
      <div className="courses-layout">
        <aside className="courses-list-panel">
          <div className="context-sidebar-tabs">
            <div className="context-sidebar-group">
              <ClassGroupSelect
                groups={classGroups}
                value={selectedClassId}
                onChange={async (classId) => {
                  if (!(await savePendingWorkChanges())) return;
                  dispatch(setSelectedClass(classId));
                }}
              />
            </div>

            {selectedClassId ? (
              <>
                <div className="context-sidebar-separator" aria-hidden="true" />
                <div className="context-sidebar-group">
                  <strong>Asignatura</strong>
                  {workSubjects.length > 0 ? (
                    <div className="courses-list section-tabs context-sidebar-list" role="group" aria-label="Asignatura">
                      {workSubjects.map((subject) => (
                        <button
                          key={subject.id}
                          type="button"
                          aria-pressed={selectedSubjectId === subject.id}
                          className={`section-tab ${selectedSubjectId === subject.id ? "active" : ""}`}
                          onClick={async () => {
                            if (!(await savePendingWorkChanges())) return;
                            dispatch(setSelectedSubject(subject.id));
                          }}
                        >
                          <span>{subject.name || "Asignatura sin nombre"}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="hint">No hay asignaturas asociadas a este curso.</p>
                  )}
                </div>
              </>
            ) : null}
          </div>
          {selectedSubjectId ? (
            <div className="context-sidebar-tabs">
              <div className="context-sidebar-separator" aria-hidden="true" />
              <div className="context-sidebar-group">
                <strong>Unidades</strong>
                {workUnits.length > 0 ? (
                  <div className="courses-list section-tabs context-sidebar-list" role="group" aria-label="Unidades">
                    {workUnits.map((unit) => (
                      <button
                        key={unit.id}
                        type="button"
                        aria-pressed={selectedWorkUnitId === unit.id}
                        className={`section-tab ${selectedWorkUnitId === unit.id ? "active" : ""}`}
                        onClick={async () => {
                          if (!(await savePendingWorkChanges())) return;
                          setSelectedWorkUnitId(unit.id);
                        }}
                      >
                        <span>{unit.name || "Unidad sin nombre"}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="hint">No hay unidades creadas para esta asignatura.</p>
                )}
              </div>
            </div>
          ) : null}
          <div className="courses-list-header">
            <strong>Tareas</strong>
          </div>
          <div className="courses-list section-tabs" role="group" aria-label="Listado de tareas">
            {workTaskOptions.map(({ task, unitName, sessionCount }) => (
              <div key={task.id} className="courses-list-row">
                <button
                  type="button"
                  aria-pressed={selectedTaskId === task.id}
                  className={`section-tab ${selectedTaskId === task.id ? "active" : ""}`}
                  onClick={() => {
                    runWithContextGuard(() => setSelectedTaskId(task.id));
                  }}
                >
                  <span>{task.title || "Tarea sin título"}</span>
                  <small>{unitName}</small>
                  <small>{sessionCount} sesiones</small>
                </button>
              </div>
            ))}
            {workTaskOptions.length === 0 ? (
              <p className="hint">
                {selectedWorkUnitId ? "No hay tareas en esta unidad." : "Selecciona una unidad."}
              </p>
            ) : null}
          </div>
        </aside>

        <section className="course-detail-panel">
          <header className="evaluation-page-header">
            <div>
              <h1>Evaluar tareas</h1>
              <p>{[selectedWorkClassName, selectedWorkSubjectName].filter(Boolean).join(" · ") || "Selecciona un contexto"}</p>
            </div>
          </header>
          <SubnavActions>
            {isSavingTask ? (
              <span className="subnav-status" role="status" aria-live="polite">Guardando registro de tarea...</span>
            ) : null}
            {selectedTaskSessionForDay ? (
              <NavLink className="subnav-link" to={selectedWorkTodayLink}>Abrir clase en Hoy</NavLink>
            ) : null}
          </SubnavActions>
          {!selectedClassId || !selectedSubjectId ? (
            <p className="hint">Selecciona curso y asignatura para revisar el trabajo.</p>
          ) : null}

          {selectedClassId && selectedSubjectId && selectedTaskForDay ? (
            <>
              {taskNotice ? (
                <p className="hint" role="status" aria-live="polite">
                  {taskNotice}
                </p>
              ) : null}

              <section className="detail-section">
                <h5>Horas de la tarea</h5>
                {workTaskSessions.length > 0 ? (
                  <div className="task-hour-chips" role="group" aria-label="Horas de la tarea">
                    {workTaskSessions.map((session) => {
                      const isSelected = selectedTaskSessionForDay?.id === session.id;
                      return (
                        <button
                          key={session.id}
                          type="button"
                          className={`task-hour-chip${isSelected ? " active" : ""}`}
                          onClick={() => void selectWorkTaskSession(session)}
                          aria-pressed={isSelected}
                        >
                          <span>{session.date}</span>
                          <span>{slotTimeLabelById.get(session.scheduleSlotId) ?? session.scheduleSlotId}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="hint">No hay horas registradas para esta tarea.</p>
                )}
              </section>

              {taskHasDirectGrade ? (
                <section className="detail-section">
                  <h5>Nota directa</h5>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Alumno</th>
                          <th>Nota</th>
                        </tr>
                      </thead>
                      <tbody>
                        {taskStudents.map((student) => (
                          <tr key={student.id}>
                            <td>{formatName(student)}</td>
                            <td>{renderDirectGradeInput(student)}</td>
                          </tr>
                        ))}
                        {taskStudents.length === 0 ? (
                          <tr>
                            <td colSpan={2}>No hay alumnos asociados a esta tarea.</td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : !selectedRubricTemplate && !selectedChecklistTemplate ? (
                <section className="detail-section evaluation-empty-instrument">
                  <h5>Sin instrumento de evaluación</h5>
                  <div className="evaluation-empty-actions">
                    <NavLink className="btn secondary" to={selectedWorkTodayLink}>Registrar comentario en Hoy</NavLink>
                    <NavLink className="btn" to={`/management/tasks?taskId=${encodeURIComponent(selectedTaskForDay.id)}`}>Ir a Tareas</NavLink>
                  </div>
                </section>
              ) : null}

              {selectedRubricTemplate ? (
                <section className="detail-section">
                  <h5>Rúbrica</h5>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Alumno</th>
                          {(selectedRubricTemplate.criteria ?? []).map((criterion) => (
                            <th key={criterion.id}>{criterion.name}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {taskStudents.map((student) => (
                          <tr key={student.id}>
                            <td>{formatName(student)}</td>
                            {(selectedRubricTemplate.criteria ?? []).map((criterion) => (
                              <td key={`${student.id}:${criterion.id}`}>
                                <select
                                  className="input"
                                  value={taskRubricDraft.get(rubricDraftKey(student.id, criterion.id)) ?? ""}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    setTaskRubricDraft((current) => {
                                      const next = new Map(current);
                                      if (value) {
                                        next.set(rubricDraftKey(student.id, criterion.id), value);
                                      } else {
                                        next.delete(rubricDraftKey(student.id, criterion.id));
                                      }
                                      return next;
                                    });
                                    setTaskNotice("");
                                    markTaskDirty();
                                  }}
                                >
                                  <option value="">-</option>
                                  {(criterion.levels ?? []).map((level) => (
                                    <option key={level.id} value={level.id}>
                                      {level.name} · {level.score} puntos
                                    </option>
                                  ))}
                                </select>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              {selectedChecklistTemplate ? (
                <section className="detail-section">
                  <h5>Lista de cotejo</h5>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Alumno</th>
                          {(selectedChecklistTemplate.items ?? []).map((item) => (
                            <th key={item.id}>{item.text}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {taskStudents.map((student) => (
                          <tr key={student.id}>
                            <td>{formatName(student)}</td>
                            {(selectedChecklistTemplate.items ?? []).map((item) => (
                              <td key={`${student.id}:${item.id}`}>
                                <input
                                  type="checkbox"
                                  checked={Boolean(taskChecklistDraft.get(checklistDraftKey(student.id, item.id)))}
                                  onChange={(event) => {
                                    const checked = event.target.checked;
                                    setTaskChecklistDraft((current) => {
                                      const next = new Map(current);
                                      if (checked) {
                                        next.set(checklistDraftKey(student.id, item.id), true);
                                      } else {
                                        next.delete(checklistDraftKey(student.id, item.id));
                                      }
                                      return next;
                                    });
                                    setTaskNotice("");
                                    markTaskDirty();
                                  }}
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              {!taskHasAssignedInstrument ? (
                <p className="hint">
                  Esta tarea no tiene rúbrica ni lista de cotejo asignada. Asigna el instrumento en Tareas.
                </p>
              ) : null}
            </>
          ) : (
            <p>Selecciona una tarea para registrar comentarios y evaluación.</p>
          )}
        </section>
      </div>
    </section>
  );
}
