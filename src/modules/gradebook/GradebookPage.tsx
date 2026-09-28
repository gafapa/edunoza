import { type DragEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { useAppSelector } from "../../app/hooks";
import { db } from "../../shared/db/database";
import type {
  Assessment,
  ChecklistTemplate,
  FeedbackComment,
  GradeEntry,
  GradebookGroup,
  RubricTemplate,
  Student,
  Subject,
  Task,
  TaskChecklistAssessment,
  TaskDailyEvaluationSetting,
  TaskDirectGrade,
  TaskGradebookConfig,
  TaskRubricAssessment,
  TaskSession,
  UnitBlock
} from "../../shared/db/types";
import { appendFeedbackComment } from "../../shared/feedback/comments";
import {
  calculateGradebookContributions,
  calculateTaskScoresByStudent,
  gradeCellKey,
  matchesTaskScope,
  taskStudentKey,
  taskSubjectKey
} from "../../shared/gradebook/calculations";
import {
  buildManualGradeEntry,
  normalizeManualAssessmentDraft,
  parseManualGradeValue,
  resolveGradeEntryScore,
  resolveGradeEntryStatus,
  type GradeEntryStatus,
  type ManualAssessmentDraft
} from "../../shared/gradebook/manualAssessments";
import { useStudentDisplay } from "../../shared/hooks/useStudentDisplay";
import { ContextSidebarTabs } from "../../shared/ui/ContextSidebarTabs";
import { useUnsavedChangesGuard } from "../../shared/hooks/useUnsavedChangesGuard";
import { parsePastedGradeGrid } from "../../shared/gradebook/bulkGrades";
import { toLocalIsoDate } from "../../shared/utils/date";

type IncludedTaskRow = {
  configKey: string;
  taskId: string;
  subjectId: string;
  title: string;
  subjectName: string;
  unitName: string;
  sessionsCount: number;
  plannedSessionsCount: number;
  weight: number;
  instrument: string;
  groupId?: string;
};

type OrderedGroupRow = {
  id: string;
  name: string;
  depth: number;
  pathLabel: string;
  treeLabel: string;
};

type GradebookTableColumn = {
  key: string;
  title: string;
  meta: string;
  kind: "group" | "assessment" | "task" | "final";
  sourceId: string;
};

type GradebookMatrixHeaderCell = {
  key: string;
  title: string;
  kind: "root" | "group" | "assessment" | "task" | "final" | "empty";
  colSpan: number;
  rowSpan?: number;
};

function taskConfigKey(taskId: string, subjectId: string): string {
  return taskSubjectKey(taskId, subjectId);
}

function defaultTaskGradebookConfigId(taskId: string, subjectId: string, classId: string): string {
  return `task-config-${taskId}-${subjectId}-${classId}`;
}

function studentGroupKey(studentId: string, groupId: string): string {
  return `${studentId}:${groupId}`;
}

function formatWeightDraft(value: number): string {
  return Number(value ?? 0).toString();
}

function parseWeight(rawValue: string): number | null {
  const normalized = rawValue.replace(",", ".").trim();
  if (normalized.length === 0) {
    return 0;
  }
  const parsed = Number(normalized);
  if (Number.isNaN(parsed) || parsed < 0) {
    return null;
  }
  return Number(parsed.toFixed(2));
}

function formatContribution(share: number): string {
  return `${(Math.max(0, share) * 100).toFixed(2)}%`;
}

function formatGradeValue(value: number | null | undefined): string {
  return typeof value === "number" ? value.toFixed(2) : "";
}

function assessmentDraftFromRow(assessment: Assessment): ManualAssessmentDraft {
  return {
    title: assessment.title,
    weight: formatWeightDraft(Number(assessment.weight ?? 0)),
    period: assessment.period ?? "",
    competency: assessment.competency ?? "",
    groupId: assessment.groupId ?? ""
  };
}

function isMeaningfulTaskGradebookConfig(config: TaskGradebookConfig): boolean {
  return (
    Number(config.gradebookWeight ?? 0) > 0 ||
    Boolean(config.groupId) ||
    Boolean(config.rubricTemplateId) ||
    Boolean(config.checklistTemplateId) ||
    Boolean(config.directGradeEnabled)
  );
}

function buildOrderedGroupRows(groups: GradebookGroup[]): OrderedGroupRow[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const childrenByParent = new Map<string, GradebookGroup[]>();

  for (const group of groups) {
    const parentId = group.parentId && byId.has(group.parentId) ? group.parentId : "";
    if (!childrenByParent.has(parentId)) {
      childrenByParent.set(parentId, []);
    }
    childrenByParent.get(parentId)?.push(group);
  }

  for (const rows of childrenByParent.values()) {
    rows.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  }

  const ordered: OrderedGroupRow[] = [];
  const visit = (parentId: string, depth: number, parentPath: string): void => {
    const children = childrenByParent.get(parentId) ?? [];
    for (const child of children) {
      const pathLabel = parentPath ? `${parentPath} / ${child.name}` : child.name;
      ordered.push({
        id: child.id,
        name: child.name,
        depth,
        pathLabel,
        treeLabel: `${"  ".repeat(depth)}${child.name}`
      });
      visit(child.id, depth + 1, pathLabel);
    }
  };

  visit("", 0, "");
  return ordered;
}

function IconChevronRight() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function IconChevronDown() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function IconFolder() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

function IconTask() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

function IconAssessment() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 4h12v16H6z" />
      <path d="M9 9h6M9 13h6M9 17h3" />
    </svg>
  );
}

function IconFolderPlus() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      <path d="M12 10v6" />
      <path d="M9 13h6" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

export function GradebookPage() {
  const { formatName, compareFn } = useStudentDisplay();
  const selectedClassId = useAppSelector((state) => state.app.selectedClassId);
  const selectedSubjectId = useAppSelector((state) => state.app.selectedSubjectId);
  const [students, setStudents] = useState<Student[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [entries, setEntries] = useState<GradeEntry[]>([]);
  const [includedTaskConfigs, setIncludedTaskConfigs] = useState<TaskGradebookConfig[]>([]);
  const [taskDailyEvaluationSettings, setTaskDailyEvaluationSettings] = useState<TaskDailyEvaluationSetting[]>([]);
  const [taskRubricAssessments, setTaskRubricAssessments] = useState<TaskRubricAssessment[]>([]);
  const [taskChecklistAssessments, setTaskChecklistAssessments] = useState<TaskChecklistAssessment[]>([]);
  const [taskDirectGrades, setTaskDirectGrades] = useState<TaskDirectGrade[]>([]);
  const [rubricTemplates, setRubricTemplates] = useState<RubricTemplate[]>([]);
  const [checklistTemplates, setChecklistTemplates] = useState<ChecklistTemplate[]>([]);
  const [gradebookGroups, setGradebookGroups] = useState<GradebookGroup[]>([]);
  const [gradebookRootName, setGradebookRootName] = useState("Asignatura");
  const [feedbackComments, setFeedbackComments] = useState<FeedbackComment[]>([]);

  const [pendingTaskWeightKeys, setPendingTaskWeightKeys] = useState<Set<string>>(new Set());
  const [pendingGroupWeightKeys, setPendingGroupWeightKeys] = useState<Set<string>>(new Set());
  const [persistedTaskConfigKeys, setPersistedTaskConfigKeys] = useState<Set<string>>(new Set());
  const [taskWeightDrafts, setTaskWeightDrafts] = useState<Record<string, string>>({});
  const [groupWeightDrafts, setGroupWeightDrafts] = useState<Record<string, string>>({});
  const [assessmentDrafts, setAssessmentDrafts] = useState<Record<string, ManualAssessmentDraft>>({});
  const [gradeDrafts, setGradeDrafts] = useState<Record<string, string>>({});
  const [gradeCommentDrafts, setGradeCommentDrafts] = useState<Record<string, string>>({});
  const [gradeStatusDrafts, setGradeStatusDrafts] = useState<Record<string, GradeEntryStatus>>({});
  const [studentGradeFilter, setStudentGradeFilter] = useState("");
  const [bulkGradeDraft, setBulkGradeDraft] = useState("");
  const [bulkGradeStatus, setBulkGradeStatus] = useState<GradeEntryStatus>("graded");
  const [bulkAssessmentId, setBulkAssessmentId] = useState("");
  const [pastedGradeDraft, setPastedGradeDraft] = useState("");
  const notSubmittedGradePolicy = useAppSelector((state) => state.app.notSubmittedGradePolicy);

  const [activeGradebookTab, setActiveGradebookTab] = useState<"tree" | "grades" | "table">("tree");
  const [gradebookNotice, setGradebookNotice] = useState("");
  const [isSavingGradebookWeights, setIsSavingGradebookWeights] = useState(false);
  const [includedTasks, setIncludedTasks] = useState<IncludedTaskRow[]>([]);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());
  const [newGroupDraftByParent, setNewGroupDraftByParent] = useState<Record<string, string>>({});
  const [draggedTaskKey, setDraggedTaskKey] = useState<string | null>(null);
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const [dropTargetGroupId, setDropTargetGroupId] = useState<string>("");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [isStudentGradeTreeCollapsed, setIsStudentGradeTreeCollapsed] = useState(false);
  const [collapsedGradeGroupIds, setCollapsedGradeGroupIds] = useState<Set<string>>(new Set());
  const gradebookAutoSaveTimerRef = useRef<number | null>(null);
  const loadDataVersionRef = useRef(0);

  const loadData = async (): Promise<void> => {
    const loadVersion = loadDataVersionRef.current + 1;
    loadDataVersionRef.current = loadVersion;
    const classId = selectedClassId;
    const subjectId = selectedSubjectId;

    if (!classId) {
      setStudents([]);
      setAssessments([]);
      setEntries([]);
      setIncludedTaskConfigs([]);
      setTaskDailyEvaluationSettings([]);
      setTaskRubricAssessments([]);
      setTaskChecklistAssessments([]);
      setTaskDirectGrades([]);
      setRubricTemplates([]);
      setChecklistTemplates([]);
      setGradebookGroups([]);
      setGradebookRootName("Asignatura");
      setFeedbackComments([]);
      setIncludedTasks([]);
      setPendingTaskWeightKeys(new Set());
      setPendingGroupWeightKeys(new Set());
      setPersistedTaskConfigKeys(new Set());
      setTaskWeightDrafts({});
      setGroupWeightDrafts({});
      setAssessmentDrafts({});
      setGradeDrafts({});
      setGradeCommentDrafts({});
      setGradeStatusDrafts({});
      setExpandedGroupIds(new Set());
      setNewGroupDraftByParent({});
      setDraggedTaskKey(null);
      setDraggedGroupId(null);
      setDropTargetGroupId("");
      setSelectedStudentId("");
      setIsStudentGradeTreeCollapsed(false);
      setCollapsedGradeGroupIds(new Set());
      return;
    }

    const [studentsData, assessmentsData, gradeEntriesData, feedbackCommentsData] = await Promise.all([
      db.students.where("classId").equals(classId).toArray(),
      db.assessments.where("classId").equals(classId).toArray(),
      db.gradeEntries.where("classId").equals(classId).toArray(),
      db.feedbackComments.toArray()
    ]);

    const [
      linksData,
      tasksData,
      sessionsData,
      subjectsData,
      unitsData,
      taskSubjectLinksData,
      taskDailySettingsData,
      taskRubricAssessmentsData,
      taskChecklistAssessmentsData,
      taskDirectGradesData,
      rubricTemplatesData,
      checklistTemplatesData,
      gradebookGroupsData,
      taskGradebookConfigsData
    ] = await Promise.all([
      db.subjectCourseLinks.where("classId").equals(classId).toArray(),
      db.tasks.filter((task) => Boolean(task.sendToGradebook)).toArray(),
      db.taskSessions.where("classId").equals(classId).toArray(),
      db.subjects.toArray(),
      db.unitBlocks.toArray(),
      db.taskSubjectLinks.toArray(),
      db.taskDailyEvaluationSettings.toArray(),
      db.taskRubricAssessments.toArray(),
      db.taskChecklistAssessments.toArray(),
      db.taskDirectGrades.where("classId").equals(classId).toArray(),
      db.rubricTemplates.where("classId").equals(classId).toArray(),
      db.checklistTemplates.where("classId").equals(classId).toArray(),
      subjectId
        ? db.gradebookGroups.where("[classId+subjectId]").equals([classId, subjectId]).toArray()
        : Promise.resolve([]),
      subjectId
        ? db.taskGradebookConfigs.where("[classId+subjectId]").equals([classId, subjectId]).toArray()
        : Promise.resolve([])
    ]);

    if (loadVersion !== loadDataVersionRef.current) {
      return;
    }

    const allowedSubjectIds = new Set(linksData.map((item) => item.subjectId));
    const subjectsById = new Map<string, Subject>(subjectsData.map((item) => [item.id, item]));
    const selectedSubjectName = subjectId ? (subjectsById.get(subjectId)?.name ?? "Asignatura") : "Asignatura";
    const unitsById = new Map<string, UnitBlock>(unitsData.map((item) => [item.id, item]));
    const sessionsByTaskSubject = new Map<string, TaskSession[]>();
    for (const session of sessionsData) {
      const sessionKey = taskConfigKey(session.taskId, session.subjectId);
      if (!sessionsByTaskSubject.has(sessionKey)) {
        sessionsByTaskSubject.set(sessionKey, []);
      }
      sessionsByTaskSubject.get(sessionKey)?.push(session);
    }

    const taskById = new Map<string, Task>(tasksData.map((task) => [task.id, task]));
    const taskLinkInfoById = new Map<string, { subjectId: string; unitId?: string }>();
    for (const link of taskSubjectLinksData) {
      if (!taskById.has(link.taskId)) continue;
      if (!allowedSubjectIds.has(link.subjectId)) continue;
      if (subjectId && link.subjectId !== subjectId) continue;
      if (!taskLinkInfoById.has(link.taskId)) {
        taskLinkInfoById.set(link.taskId, { subjectId: link.subjectId, unitId: link.unitId });
      }
    }

    const configsByTaskSubject = new Map(
      taskGradebookConfigsData.map((config) => [taskConfigKey(config.taskId, config.subjectId), config])
    );
    for (const [taskId, info] of taskLinkInfoById) {
      const key = taskConfigKey(taskId, info.subjectId);
      if (!configsByTaskSubject.has(key)) {
        const config: TaskGradebookConfig = {
          id: defaultTaskGradebookConfigId(taskId, info.subjectId, classId),
          taskId,
          subjectId: info.subjectId,
          classId,
          gradebookWeight: 0
        };
        configsByTaskSubject.set(key, config);
      }
    }

    if (loadVersion !== loadDataVersionRef.current) {
      return;
    }

    const visibleTasks = tasksData
      .filter((task: Task) => {
        const info = taskLinkInfoById.get(task.id);
        return Boolean(info);
      })
      .map((task: Task) => {
        const info = taskLinkInfoById.get(task.id);
        const subjectId = info?.subjectId ?? "";
        const unitId = info?.unitId;
        const configKey = taskConfigKey(task.id, subjectId);
        const config = configsByTaskSubject.get(configKey);
        return {
          configKey,
          taskId: task.id,
          subjectId,
          title: task.title || "Tarea sin titulo",
          subjectName: subjectsById.get(subjectId)?.name ?? "-",
          unitName: unitId ? (unitsById.get(unitId)?.name ?? "-") : "-",
          sessionsCount: sessionsByTaskSubject.get(taskConfigKey(task.id, subjectId))?.length ?? 0,
          plannedSessionsCount: task.sessionCount ?? 1,
          weight: Number(config?.gradebookWeight ?? 0),
          instrument: config?.directGradeEnabled
            ? "Nota directa"
            : config?.rubricTemplateId
              ? "Rúbrica"
              : config?.checklistTemplateId
                ? "Lista de cotejo"
                : "-",
          groupId: config?.groupId
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));

    const visibleTaskIds = new Set(visibleTasks.map((item) => item.taskId));
    const visibleTaskConfigKeys = new Set(visibleTasks.map((item) => item.configKey));

    setStudents(studentsData.sort(compareFn));
    setAssessments(assessmentsData);
    setEntries(gradeEntriesData);
    setIncludedTaskConfigs(
      Array.from(configsByTaskSubject.values()).filter((config) =>
        visibleTaskConfigKeys.has(taskConfigKey(config.taskId, config.subjectId))
      )
    );
    setTaskDailyEvaluationSettings(
      taskDailySettingsData.filter(
        (item) => visibleTaskIds.has(item.taskId) && matchesTaskScope(item, classId, subjectId)
      )
    );
    setTaskRubricAssessments(
      taskRubricAssessmentsData.filter(
        (item) => visibleTaskIds.has(item.taskId) && matchesTaskScope(item, classId, subjectId)
      )
    );
    setTaskChecklistAssessments(
      taskChecklistAssessmentsData.filter(
        (item) => visibleTaskIds.has(item.taskId) && matchesTaskScope(item, classId, subjectId)
      )
    );
    setTaskDirectGrades(taskDirectGradesData.filter((item) => visibleTaskIds.has(item.taskId)));
    setRubricTemplates(rubricTemplatesData);
    setChecklistTemplates(checklistTemplatesData);
    setGradebookGroups(gradebookGroupsData);
    setGradebookRootName(selectedSubjectName);
    setFeedbackComments(
      feedbackCommentsData
        .filter((comment) => comment.category === "general" || comment.category === "gradebook")
        .sort((left, right) => left.text.localeCompare(right.text))
    );
    setIncludedTasks(visibleTasks);
    setTaskWeightDrafts(
      Object.fromEntries(visibleTasks.map((task) => [task.configKey, formatWeightDraft(task.weight)]))
    );
    setGroupWeightDrafts(
      Object.fromEntries(
        gradebookGroupsData.map((group) => [group.id, formatWeightDraft(Number(group.weight ?? 0))])
      )
    );
    setAssessmentDrafts(Object.fromEntries(assessmentsData.map((assessment) => [assessment.id, assessmentDraftFromRow(assessment)])));
    setGradeDrafts(
      Object.fromEntries(
        gradeEntriesData
          .filter((entry) => typeof entry.numericValue === "number")
          .map((entry) => [gradeCellKey(entry.studentId, entry.assessmentId), formatGradeValue(entry.numericValue)])
      )
    );
    setGradeCommentDrafts(
      Object.fromEntries(
        gradeEntriesData
          .filter((entry) => typeof entry.comment === "string" && entry.comment.trim().length > 0)
          .map((entry) => [gradeCellKey(entry.studentId, entry.assessmentId), entry.comment ?? ""])
      )
    );
    setGradeStatusDrafts(
      Object.fromEntries(
        gradeEntriesData.map((entry) => [
          gradeCellKey(entry.studentId, entry.assessmentId),
          resolveGradeEntryStatus(entry)
        ])
      )
    );

    setPendingTaskWeightKeys(new Set());
    setPendingGroupWeightKeys(new Set());
    setPersistedTaskConfigKeys(new Set(taskGradebookConfigsData.map((config) => taskConfigKey(config.taskId, config.subjectId))));
  };

  useEffect(() => {
    void loadData();
  }, [selectedClassId, selectedSubjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setActiveGradebookTab("tree");
  }, [selectedClassId, selectedSubjectId]);

  useEffect(() => {
    setStudents((prev) => [...prev].sort(compareFn));
  }, [compareFn]);

  useEffect(() => {
    setSelectedStudentId((current) => {
      if (students.some((student) => student.id === current)) {
        return current;
      }
      return students[0]?.id ?? "";
    });
  }, [students]);

  const orderedGroupRows = useMemo(() => buildOrderedGroupRows(gradebookGroups), [gradebookGroups]);

  useEffect(() => {
    setExpandedGroupIds((current) => {
      const validIds = new Set(orderedGroupRows.map((row) => row.id));
      const next = new Set<string>();

      for (const id of current) {
        if (validIds.has(id)) {
          next.add(id);
        }
      }

      if (next.size === 0 && orderedGroupRows.length > 0) {
        for (const row of orderedGroupRows) {
          next.add(row.id);
        }
      }

      return next;
    });
  }, [orderedGroupRows]);

  const groupChildrenByParent = useMemo(() => {
    const byId = new Set(gradebookGroups.map((group) => group.id));
    const map = new Map<string, string[]>();
    for (const group of gradebookGroups) {
      const parentKey = group.parentId && byId.has(group.parentId) ? group.parentId : "";
      if (!map.has(parentKey)) {
        map.set(parentKey, []);
      }
      map.get(parentKey)?.push(group.id);
    }
    return map;
  }, [gradebookGroups]);

  const groupSubtreeById = useMemo(() => {
    const memo = new Map<string, Set<string>>();

    const visit = (groupId: string): Set<string> => {
      const cached = memo.get(groupId);
      if (cached) {
        return cached;
      }
      const set = new Set<string>([groupId]);
      const children = groupChildrenByParent.get(groupId) ?? [];
      for (const childId of children) {
        const childSet = visit(childId);
        for (const item of childSet) {
          set.add(item);
        }
      }
      memo.set(groupId, set);
      return set;
    };

    for (const row of orderedGroupRows) {
      visit(row.id);
    }

    return memo;
  }, [groupChildrenByParent, orderedGroupRows]);

  const gradebookGroupById = useMemo(() => new Map(gradebookGroups.map((group) => [group.id, group])), [gradebookGroups]);

  const orderedGroupIdsByParent = useMemo(() => {
    const byId = new Set(gradebookGroups.map((group) => group.id));
    const rowsByParent = new Map<string, GradebookGroup[]>();
    for (const group of gradebookGroups) {
      const parentKey = group.parentId && byId.has(group.parentId) ? group.parentId : "";
      if (!rowsByParent.has(parentKey)) {
        rowsByParent.set(parentKey, []);
      }
      rowsByParent.get(parentKey)?.push(group);
    }

    const map = new Map<string, string[]>();
    for (const [parentId, rows] of rowsByParent.entries()) {
      rows.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
      map.set(
        parentId,
        rows.map((group) => group.id)
      );
    }

    return map;
  }, [gradebookGroups]);

  const filteredIncludedTasks = useMemo(
    () =>
      selectedSubjectId
        ? includedTasks.filter((task) => task.subjectId === selectedSubjectId)
        : [],
    [includedTasks, selectedSubjectId]
  );

  const filteredIncludedTaskConfigs = useMemo(
    () =>
      selectedSubjectId
        ? includedTaskConfigs.filter((task) => task.subjectId === selectedSubjectId)
        : [],
    [includedTaskConfigs, selectedSubjectId]
  );

  const filteredAssessments = useMemo(
    () =>
      selectedSubjectId
        ? assessments.filter((assessment) => assessment.subjectId === selectedSubjectId)
        : [],
    [assessments, selectedSubjectId]
  );

  const tasksByGroupId = useMemo(() => {
    const byId = new Set(gradebookGroups.map((group) => group.id));
    const map = new Map<string, IncludedTaskRow[]>();

    for (const task of filteredIncludedTasks) {
      const groupKey = task.groupId && byId.has(task.groupId) ? task.groupId : "";
      if (!map.has(groupKey)) {
        map.set(groupKey, []);
      }
      map.get(groupKey)?.push(task);
    }

    for (const rows of map.values()) {
      rows.sort((a, b) => a.title.localeCompare(b.title));
    }

    return map;
  }, [filteredIncludedTasks, gradebookGroups]);

  const assessmentsByGroupId = useMemo(() => {
    const byId = new Set(gradebookGroups.map((group) => group.id));
    const map = new Map<string, Assessment[]>();

    for (const assessment of filteredAssessments) {
      const groupKey = assessment.groupId && byId.has(assessment.groupId) ? assessment.groupId : "";
      if (!map.has(groupKey)) {
        map.set(groupKey, []);
      }
      map.get(groupKey)?.push(assessment);
    }

    for (const rows of map.values()) {
      rows.sort((a, b) => a.title.localeCompare(b.title));
    }

    return map;
  }, [filteredAssessments, gradebookGroups]);

  const contributionData = useMemo(
    () => calculateGradebookContributions(filteredAssessments, filteredIncludedTaskConfigs, gradebookGroups),
    [filteredAssessments, filteredIncludedTaskConfigs, gradebookGroups]
  );

  const entriesByKey = useMemo(() => {
    const map = new Map<string, GradeEntry>();
    for (const entry of entries) {
      map.set(gradeCellKey(entry.studentId, entry.assessmentId), entry);
    }
    return map;
  }, [entries]);

  const includedTaskConfigById = useMemo(
    () => new Map(filteredIncludedTaskConfigs.map((task) => [taskConfigKey(task.taskId, task.subjectId), task])),
    [filteredIncludedTaskConfigs]
  );
  const includedTaskRowById = useMemo(
    () => new Map(filteredIncludedTasks.map((task) => [task.configKey, task])),
    [filteredIncludedTasks]
  );

  const taskScoreByTaskStudent = useMemo(
    () =>
      calculateTaskScoresByStudent({
        tasks: filteredIncludedTaskConfigs,
        students,
        selectedClassId: selectedClassId ?? "",
        rubricTemplates,
        checklistTemplates,
        taskDailyEvaluationSettings,
        taskRubricAssessments,
        taskChecklistAssessments,
        taskDirectGrades
      }),
    [
      checklistTemplates,
      filteredIncludedTaskConfigs,
      rubricTemplates,
      selectedClassId,
      students,
      taskChecklistAssessments,
      taskDailyEvaluationSettings,
      taskDirectGrades,
      taskRubricAssessments
    ]
  );

  const partialByStudentGroup = useMemo(() => {
    const map = new Map<string, number | null>();

    for (const student of students) {
      for (const group of orderedGroupRows) {
        const subtree = groupSubtreeById.get(group.id) ?? new Set<string>([group.id]);
        let weightedSum = 0;
        let usedWeight = 0;

        for (const assessment of filteredAssessments) {
          if (!assessment.groupId || !subtree.has(assessment.groupId)) {
            continue;
          }
          const contribution = contributionData.assessmentContributionById.get(assessment.id) ?? 0;
          if (contribution <= 0) {
            continue;
          }
          const score = resolveGradeEntryScore(
            entriesByKey.get(gradeCellKey(student.id, assessment.id)),
            notSubmittedGradePolicy
          );
          if (typeof score !== "number") {
            continue;
          }
          weightedSum += score * contribution;
          usedWeight += contribution;
        }

        for (const task of filteredIncludedTaskConfigs) {
          const taskGroupId = task.groupId ?? "";
          if (!taskGroupId || !subtree.has(taskGroupId)) {
            continue;
          }
          const contribution = contributionData.taskContributionByKey.get(taskConfigKey(task.taskId, task.subjectId)) ?? 0;
          if (contribution <= 0) {
            continue;
          }
          const taskScore = taskScoreByTaskStudent.get(taskStudentKey(task.taskId, task.subjectId, student.id));
          if (typeof taskScore !== "number") {
            continue;
          }
          weightedSum += taskScore * contribution;
          usedWeight += contribution;
        }

        map.set(studentGroupKey(student.id, group.id), usedWeight > 0 ? weightedSum / usedWeight : null);
      }
    }

    return map;
  }, [
    filteredAssessments,
    contributionData,
    entriesByKey,
    groupSubtreeById,
    filteredIncludedTaskConfigs,
    orderedGroupRows,
    students,
    taskScoreByTaskStudent,
    notSubmittedGradePolicy
  ]);

  const finalByStudent = useMemo(() => {
    const map = new Map<string, number | null>();

    for (const student of students) {
      let weightedSum = 0;
      let usedWeight = 0;

      for (const assessment of filteredAssessments) {
        const contribution = contributionData.assessmentContributionById.get(assessment.id) ?? 0;
        if (contribution <= 0) {
          continue;
        }
        const score = resolveGradeEntryScore(
          entriesByKey.get(gradeCellKey(student.id, assessment.id)),
          notSubmittedGradePolicy
        );
        if (typeof score !== "number") {
          continue;
        }
        weightedSum += score * contribution;
        usedWeight += contribution;
      }

      for (const task of filteredIncludedTaskConfigs) {
        const contribution = contributionData.taskContributionByKey.get(taskConfigKey(task.taskId, task.subjectId)) ?? 0;
        if (contribution <= 0) {
          continue;
        }
        const taskScore = taskScoreByTaskStudent.get(taskStudentKey(task.taskId, task.subjectId, student.id));
        if (typeof taskScore !== "number") {
          continue;
        }
        weightedSum += taskScore * contribution;
        usedWeight += contribution;
      }

      map.set(student.id, usedWeight > 0 ? weightedSum / usedWeight : null);
    }

    return map;
  }, [
    contributionData,
    entriesByKey,
    filteredAssessments,
    filteredIncludedTaskConfigs,
    students,
    taskScoreByTaskStudent,
    notSubmittedGradePolicy
  ]);

  const evaluatedWeightByStudent = useMemo(() => {
    const map = new Map<string, number>();
    for (const student of students) {
      let evaluatedWeight = 0;
      for (const assessment of filteredAssessments) {
        const contribution = contributionData.assessmentContributionById.get(assessment.id) ?? 0;
        const score = resolveGradeEntryScore(
          entriesByKey.get(gradeCellKey(student.id, assessment.id)),
          notSubmittedGradePolicy
        );
        if (contribution > 0 && typeof score === "number") evaluatedWeight += contribution;
      }
      for (const task of filteredIncludedTaskConfigs) {
        const contribution =
          contributionData.taskContributionByKey.get(taskConfigKey(task.taskId, task.subjectId)) ?? 0;
        const score = taskScoreByTaskStudent.get(
          taskStudentKey(task.taskId, task.subjectId, student.id)
        );
        if (contribution > 0 && typeof score === "number") evaluatedWeight += contribution;
      }
      map.set(student.id, Math.min(1, evaluatedWeight));
    }
    return map;
  }, [
    contributionData,
    entriesByKey,
    filteredAssessments,
    filteredIncludedTaskConfigs,
    notSubmittedGradePolicy,
    students,
    taskScoreByTaskStudent
  ]);

  const selectedStudent = useMemo(
    () => students.find((student) => student.id === selectedStudentId) ?? students[0] ?? null,
    [selectedStudentId, students]
  );

  const visibleGradeStudents = useMemo(() => {
    const query = studentGradeFilter.trim().toLocaleLowerCase("es");
    if (!query) return students;
    return students.filter((student) => formatName(student).toLocaleLowerCase("es").includes(query));
  }, [formatName, studentGradeFilter, students]);

  const gradebookMatrixData = useMemo<{
    columns: GradebookTableColumn[];
    headerRows: GradebookMatrixHeaderCell[][];
  }>(() => {
    const columns: GradebookTableColumn[] = [];
    const headerRows: GradebookMatrixHeaderCell[][] = [];
    const visitedGroupIds = new Set<string>();

    const ensureHeaderRow = (depth: number): GradebookMatrixHeaderCell[] => {
      if (!headerRows[depth]) {
        headerRows[depth] = [];
      }
      return headerRows[depth];
    };
    const pushLeaf = (
      title: string,
      meta: string,
      kind: "group" | "assessment" | "task",
      sourceId: string,
      key: string,
      depth: number
    ): number => {
      ensureHeaderRow(depth).push({ key, title, kind, colSpan: 1 });
      columns.push({ key, title, meta, kind, sourceId });
      return 1;
    };
    const visitGroup = (groupId: string, depth: number): number => {
      const group = gradebookGroupById.get(groupId);
      if (!group || visitedGroupIds.has(groupId)) {
        return 0;
      }
      visitedGroupIds.add(groupId);
      const row = ensureHeaderRow(depth);
      const cell: GradebookMatrixHeaderCell = {
        key: `group-header:${group.id}`,
        title: group.name,
        kind: "group",
        colSpan: 0
      };
      row.push(cell);

      let span = 0;
      for (const childId of orderedGroupIdsByParent.get(groupId) ?? []) {
        span += visitGroup(childId, depth + 1);
      }
      for (const assessment of assessmentsByGroupId.get(groupId) ?? []) {
        span += pushLeaf(
          assessment.title,
          `Prueba | ${formatContribution(contributionData.assessmentContributionById.get(assessment.id) ?? 0)}`,
          "assessment",
          assessment.id,
          `assessment:${assessment.id}`,
          depth + 1
        );
      }
      for (const task of tasksByGroupId.get(groupId) ?? []) {
        span += pushLeaf(
          task.title,
          `Tarea | ${task.instrument} | ${formatContribution(
            contributionData.taskContributionByKey.get(taskConfigKey(task.taskId, task.subjectId)) ?? 0
          )}`,
          "task",
          task.taskId,
          `task:${task.configKey}`,
          depth + 1
        );
      }
      span += pushLeaf(
        "Total",
        `Carpeta | ${formatContribution(contributionData.groupLeafContributionById.get(group.id) ?? 0)}`,
        "group",
        group.id,
        `group:${group.id}`,
        depth + 1
      );
      cell.colSpan = Math.max(1, span);
      return span;
    };

    const rootCell: GradebookMatrixHeaderCell = {
      key: "root",
      title: gradebookRootName,
      kind: "root",
      colSpan: 0
    };
    ensureHeaderRow(0).push(rootCell);
    let rootSpan = 0;
    for (const groupId of orderedGroupIdsByParent.get("") ?? []) {
      rootSpan += visitGroup(groupId, 1);
    }
    for (const assessment of assessmentsByGroupId.get("") ?? []) {
      rootSpan += pushLeaf(
        assessment.title,
        `Prueba | ${formatContribution(contributionData.assessmentContributionById.get(assessment.id) ?? 0)}`,
        "assessment",
        assessment.id,
        `assessment:${assessment.id}`,
        1
      );
    }
    for (const task of tasksByGroupId.get("") ?? []) {
      rootSpan += pushLeaf(
        task.title,
        `Tarea | ${task.instrument} | ${formatContribution(
            contributionData.taskContributionByKey.get(taskConfigKey(task.taskId, task.subjectId)) ?? 0
        )}`,
        "task",
        task.taskId,
        `task:${task.configKey}`,
        1
      );
    }
    rootCell.colSpan = Math.max(1, rootSpan);

    const matrixDepth = Math.max(1, headerRows.length);
    headerRows.forEach((row, rowIndex) => {
      for (const cell of row) {
        const isGeneratedLeaf =
          !cell.key.startsWith("group-header:") && cell.kind !== "root" && cell.rowSpan === undefined;
        if (isGeneratedLeaf) {
          cell.rowSpan = Math.max(1, matrixDepth - rowIndex);
        }
      }
    });

    const finalCell: GradebookMatrixHeaderCell = {
      key: "final",
      title: "Final",
      kind: "final",
      colSpan: 1,
      rowSpan: matrixDepth
    };
    headerRows[0].push(finalCell);
    columns.push({ key: "final", title: "Final", meta: "Nota final", kind: "final", sourceId: "final" });

    return { columns, headerRows };
  }, [
    assessmentsByGroupId,
    contributionData,
    gradebookGroupById,
    gradebookRootName,
    orderedGroupIdsByParent,
    tasksByGroupId
  ]);

  const createGradebookGroupAt = async (rawName: string, parentGroupId: string): Promise<boolean> => {
    if (!selectedClassId || !selectedSubjectId) {
      setGradebookNotice("Selecciona una asignatura para crear carpetas del cuaderno.");
      return false;
    }

    const name = rawName.trim();
    if (name.length < 2) {
      setGradebookNotice("La carpeta necesita nombre (minimo 2).");
      return false;
    }

    const parentId = parentGroupId || "";
    const siblings = gradebookGroups.filter((group) => (group.parentId ?? "") === parentId);
    const nextPosition = siblings.reduce((max, group) => Math.max(max, group.position), 0) + 1;

    await db.gradebookGroups.add({
      id: crypto.randomUUID(),
      classId: selectedClassId,
      subjectId: selectedSubjectId,
      name,
      parentId: parentId || undefined,
      position: nextPosition,
      weight: 0
    });

    setGradebookNotice("Carpeta creada.");
    await loadData();
    return true;
  };

  const deleteGradebookGroup = async (groupId: string): Promise<void> => {
    const hasChildren = gradebookGroups.some((group) => (group.parentId ?? "") === groupId);
    if (hasChildren) {
      setGradebookNotice("No se puede borrar la carpeta porque tiene subcarpetas.");
      return;
    }

    const usedByAssessments = filteredAssessments.some((assessment) => assessment.groupId === groupId);
    const usedByTasks = filteredIncludedTaskConfigs.some((task) => task.groupId === groupId);
    if (usedByAssessments || usedByTasks) {
      setGradebookNotice("No se puede borrar la carpeta porque está asignada a evaluaciones o tareas.");
      return;
    }

    await db.gradebookGroups.delete(groupId);
    setGradebookNotice("Carpeta eliminada.");
    await loadData();
  };

  const isClosedAcademicPeriod = async (academicPeriodId?: string): Promise<boolean> => {
    if (!academicPeriodId) return false;
    return (await db.academicPeriods.get(academicPeriodId))?.status === "closed";
  };

  const updateTaskGroup = async (taskKey: string, groupId: string): Promise<void> => {
    const task = includedTaskConfigById.get(taskKey);
    if (!task) {
      return;
    }
    if (await isClosedAcademicPeriod(task.academicPeriodId)) {
      setGradebookNotice("Reabre el periodo académico antes de modificar esta tarea.");
      return;
    }

    const nextConfig: TaskGradebookConfig = {
      ...task,
      groupId: groupId || undefined
    };
    if (isMeaningfulTaskGradebookConfig(nextConfig)) {
      await db.taskGradebookConfigs.put(nextConfig);
    } else if (persistedTaskConfigKeys.has(taskKey)) {
      await db.taskGradebookConfigs.delete(task.id);
    }
    await loadData();
  };

  const updateGroupParent = async (groupId: string, parentGroupId: string): Promise<void> => {
    const group = gradebookGroupById.get(groupId);
    if (!group) {
      return;
    }
    const targetParentId = parentGroupId || "";
    const currentParentId = group.parentId ?? "";
    if (currentParentId === targetParentId) {
      return;
    }
    if (targetParentId === groupId) {
      setGradebookNotice("No se puede mover una carpeta dentro de si misma.");
      return;
    }
    const subtree = groupSubtreeById.get(groupId) ?? new Set<string>([groupId]);
    if (targetParentId && subtree.has(targetParentId)) {
      setGradebookNotice("No se puede mover una carpeta dentro de una subcarpeta propia.");
      return;
    }
    const siblings = gradebookGroups.filter(
      (candidate) => candidate.id !== groupId && (candidate.parentId ?? "") === targetParentId
    );
    const nextPosition = siblings.reduce((max, candidate) => Math.max(max, candidate.position), 0) + 1;
    await db.gradebookGroups.put({
      ...group,
      parentId: targetParentId || undefined,
      position: nextPosition
    });
    setExpandedGroupIds((current) => {
      const next = new Set(current);
      if (targetParentId) {
        next.add(targetParentId);
      }
      return next;
    });
    await loadData();
  };

  const savePendingGradebookWeights = async (
    notice = "Cambios del arbol guardados automaticamente."
  ): Promise<boolean> => {
    if (pendingTaskWeightKeys.size === 0 && pendingGroupWeightKeys.size === 0) {
      return true;
    }
    if (gradebookAutoSaveTimerRef.current !== null) {
      window.clearTimeout(gradebookAutoSaveTimerRef.current);
      gradebookAutoSaveTimerRef.current = null;
    }

    const taskUpdates: TaskGradebookConfig[] = [];
    const taskConfigIdsToDelete: string[] = [];
    for (const taskKey of pendingTaskWeightKeys) {
      const parsed = parseWeight(taskWeightDrafts[taskKey] ?? "");
      if (parsed === null) {
        setGradebookNotice("El peso de tarea debe ser un numero mayor o igual a 0.");
        return false;
      }
      const task = includedTaskConfigById.get(taskKey);
      if (task) {
        if (await isClosedAcademicPeriod(task.academicPeriodId)) {
          setGradebookNotice("Reabre el periodo académico antes de modificar sus ponderaciones.");
          return false;
        }
        const nextConfig: TaskGradebookConfig = { ...task, gradebookWeight: parsed };
        if (isMeaningfulTaskGradebookConfig(nextConfig)) {
          taskUpdates.push(nextConfig);
        } else if (persistedTaskConfigKeys.has(taskKey)) {
          taskConfigIdsToDelete.push(task.id);
        }
      }
    }

    const groupUpdates: GradebookGroup[] = [];
    for (const groupId of pendingGroupWeightKeys) {
      const parsed = parseWeight(groupWeightDrafts[groupId] ?? "");
      if (parsed === null) {
        setGradebookNotice("La ponderacion de carpeta debe ser un numero mayor o igual a 0.");
        return false;
      }
      const group = gradebookGroupById.get(groupId);
      if (group) {
        groupUpdates.push({ ...group, weight: parsed });
      }
    }

    setIsSavingGradebookWeights(true);
    try {
      await db.transaction("rw", db.taskGradebookConfigs, db.gradebookGroups, async () => {
        if (taskConfigIdsToDelete.length > 0) {
          await db.taskGradebookConfigs.bulkDelete(taskConfigIdsToDelete);
        }
        if (taskUpdates.length > 0) {
          await db.taskGradebookConfigs.bulkPut(taskUpdates);
        }
        if (groupUpdates.length > 0) {
          await db.gradebookGroups.bulkPut(groupUpdates);
        }
      });

      setPendingTaskWeightKeys(new Set());
      setPendingGroupWeightKeys(new Set());
      setGradebookNotice(notice);
      await loadData();
      return true;
    } finally {
      setIsSavingGradebookWeights(false);
    }
  };

  const changeGradebookTab = async (tab: "tree" | "grades" | "table"): Promise<void> => {
    if (tab === activeGradebookTab) {
      return;
    }
    const saved = await savePendingGradebookWeights("Cambios del arbol guardados.");
    if (saved) {
      setActiveGradebookTab(tab);
    }
  };

  const createManualAssessment = async (): Promise<void> => {
    if (!selectedClassId || !selectedSubjectId) {
      setGradebookNotice("Selecciona curso y asignatura para crear una prueba.");
      return;
    }

    const nextIndex = filteredAssessments.length + 1;
    const assessmentDate = toLocalIsoDate();
    const matchingPeriod = (
      await db.academicPeriods
        .where("[classId+status]")
        .equals([selectedClassId, "open"])
        .toArray()
    ).find(
      (period) => assessmentDate >= period.startDate && assessmentDate <= period.endDate
    );
    await db.assessments.add({
      id: crypto.randomUUID(),
      classId: selectedClassId,
      subjectId: selectedSubjectId,
      academicPeriodId: matchingPeriod?.id,
      assessmentDate,
      title: `Prueba ${nextIndex}`,
      weight: 0,
      period: matchingPeriod?.name ?? ""
    });
    setGradebookNotice("Prueba creada.");
    await loadData();
  };

  const updateAssessmentDraft = (assessmentId: string, patch: Partial<ManualAssessmentDraft>): ManualAssessmentDraft => {
    const assessment = filteredAssessments.find((item) => item.id === assessmentId);
    const current = assessmentDrafts[assessmentId] ?? (assessment ? assessmentDraftFromRow(assessment) : {
      title: "",
      weight: "0",
      period: "",
      competency: "",
      groupId: ""
    });
    const next = { ...current, ...patch };
    setAssessmentDrafts((drafts) => ({
      ...drafts,
      [assessmentId]: next
    }));
    setGradebookNotice("");
    return next;
  };

  const saveAssessmentDraft = async (assessmentId: string, overrideDraft?: ManualAssessmentDraft): Promise<void> => {
    const assessment = filteredAssessments.find((item) => item.id === assessmentId);
    if (!assessment) {
      return;
    }
    if (await isClosedAcademicPeriod(assessment.academicPeriodId)) {
      setGradebookNotice("Reabre el periodo académico antes de modificar esta prueba.");
      await loadData();
      return;
    }
    const normalized = normalizeManualAssessmentDraft(overrideDraft ?? assessmentDrafts[assessmentId] ?? assessmentDraftFromRow(assessment));
    if (!normalized) {
      setGradebookNotice("La prueba necesita título válido y peso mayor o igual a 0.");
      return;
    }

    await db.assessments.put({
      ...assessment,
      ...normalized
    });
    setGradebookNotice("Prueba guardada.");
    await loadData();
  };

  const deleteManualAssessment = async (assessmentId: string): Promise<void> => {
    const assessment = filteredAssessments.find((item) => item.id === assessmentId);
    if (await isClosedAcademicPeriod(assessment?.academicPeriodId)) {
      setGradebookNotice("Reabre el periodo académico antes de eliminar esta prueba.");
      return;
    }
    const entriesCount = await db.gradeEntries.where("assessmentId").equals(assessmentId).count();
    if (entriesCount > 0) {
      setGradebookNotice("No se puede eliminar una prueba que ya tiene notas.");
      return;
    }
    await db.assessments.delete(assessmentId);
    setGradebookNotice("Prueba eliminada.");
    await loadData();
  };

  const saveManualGradeCell = async (
    studentId: string,
    assessmentId: string,
    rawValue: string,
    rawComment: string,
    requestedStatus?: GradeEntryStatus
  ): Promise<void> => {
    if (!selectedClassId) {
      setGradebookNotice("Selecciona un grupo para guardar notas.");
      return;
    }
    const assessment = filteredAssessments.find((item) => item.id === assessmentId);
    if (!assessment) {
      return;
    }
    if (await isClosedAcademicPeriod(assessment.academicPeriodId)) {
      setGradebookNotice("Reabre el periodo académico antes de modificar sus notas.");
      await loadData();
      return;
    }
    const parsed = parseManualGradeValue(rawValue);
    const comment = rawComment.trim();
    const key = gradeCellKey(studentId, assessmentId);
    const existingEntry = entriesByKey.get(key);
    const status =
      parsed !== null
        ? "graded"
        : (requestedStatus ?? gradeStatusDrafts[key] ?? resolveGradeEntryStatus(existingEntry));

    if (Number.isNaN(parsed)) {
      setGradebookNotice("La nota debe estar entre 0 y 10.");
      return;
    }

    if (parsed === null && comment.length === 0 && status === "pending") {
      if (existingEntry) {
        await db.gradeEntries.delete(existingEntry.id);
      }
      setGradebookNotice("Nota y observación eliminadas.");
      await loadData();
      return;
    }

    await db.gradeEntries.put(
      buildManualGradeEntry({
        existingEntry,
        classId: selectedClassId,
        assessment,
        studentId,
        numericValue: parsed ?? undefined,
        comment,
        status
      })
    );
    setGradebookNotice("Nota guardada.");
    await loadData();
  };

  const applyBulkGrade = async (): Promise<void> => {
    if (!selectedClassId || visibleGradeStudents.length === 0) {
      setGradebookNotice("No hay alumnos visibles a los que aplicar el cambio.");
      return;
    }
    const assessment = filteredAssessments.find((item) => item.id === bulkAssessmentId) ?? filteredAssessments[0];
    if (!assessment) {
      setGradebookNotice("Selecciona una prueba.");
      return;
    }
    if (await isClosedAcademicPeriod(assessment.academicPeriodId)) {
      setGradebookNotice("Reabre el periodo académico antes de aplicar notas masivas.");
      return;
    }

    const parsed = bulkGradeStatus === "graded" ? parseManualGradeValue(bulkGradeDraft) : null;
    if (bulkGradeStatus === "graded" && (parsed === null || Number.isNaN(parsed))) {
      setGradebookNotice("Indica una nota entre 0 y 10 para aplicar al grupo.");
      return;
    }

    const updates = visibleGradeStudents.map((student) =>
      buildManualGradeEntry({
        existingEntry: entriesByKey.get(gradeCellKey(student.id, assessment.id)),
        classId: selectedClassId,
        assessment,
        studentId: student.id,
        numericValue: parsed ?? undefined,
        comment: entriesByKey.get(gradeCellKey(student.id, assessment.id))?.comment ?? "",
        status: bulkGradeStatus
      })
    );
    await db.gradeEntries.bulkPut(updates);
    setGradebookNotice(
      `Cambio aplicado a ${updates.length} alumno${updates.length === 1 ? "" : "s"} en ${assessment.title}.`
    );
    await loadData();
  };

  const applyPastedGrades = async (): Promise<void> => {
    if (!selectedClassId) return;
    const assignedPeriodIds = Array.from(
      new Set(filteredAssessments.flatMap((assessment) => assessment.academicPeriodId ? [assessment.academicPeriodId] : []))
    );
    const assignedPeriods = assignedPeriodIds.length > 0
      ? await db.academicPeriods.where("id").anyOf(assignedPeriodIds).toArray()
      : [];
    if (assignedPeriods.some((period) => period.status === "closed")) {
      setGradebookNotice("La tabla contiene pruebas de un periodo cerrado. Reábrelo antes de pegar notas.");
      return;
    }
    const parsed = parsePastedGradeGrid(
      pastedGradeDraft,
      visibleGradeStudents.length,
      filteredAssessments.length
    );
    if (!parsed.ok) {
      setGradebookNotice(parsed.message);
      return;
    }

    const updates: GradeEntry[] = [];
    parsed.rows.forEach((row, rowIndex) => {
      row.forEach((numericValue, columnIndex) => {
        if (numericValue === null) return;
        const student = visibleGradeStudents[rowIndex];
        const assessment = filteredAssessments[columnIndex];
        if (!student || !assessment) return;
        updates.push(
          buildManualGradeEntry({
            existingEntry: entriesByKey.get(gradeCellKey(student.id, assessment.id)),
            classId: selectedClassId,
            assessment,
            studentId: student.id,
            numericValue,
            comment: entriesByKey.get(gradeCellKey(student.id, assessment.id))?.comment ?? "",
            status: "graded"
          })
        );
      });
    });
    if (updates.length === 0) {
      setGradebookNotice("La matriz pegada no contiene notas.");
      return;
    }
    await db.gradeEntries.bulkPut(updates);
    setPastedGradeDraft("");
    setGradebookNotice(`${updates.length} notas pegadas correctamente.`);
    await loadData();
  };

  const focusAdjacentGradeCell = (
    event: KeyboardEvent<HTMLInputElement>,
    rowIndex: number,
    columnIndex: number
  ): void => {
    const field = event.currentTarget;
    const offsets: Record<string, [number, number]> = {
      Enter: [1, 0],
      ArrowDown: [1, 0],
      ArrowUp: [-1, 0]
    };
    // Only hand off ArrowLeft/ArrowRight to the neighboring cell when the caret is already
    // at that edge of the value, so normal in-cell text navigation keeps working.
    if (event.key === "ArrowLeft" && field.selectionStart === 0 && field.selectionEnd === 0) {
      offsets.ArrowLeft = [0, -1];
    }
    if (
      event.key === "ArrowRight" &&
      field.selectionStart === field.value.length &&
      field.selectionEnd === field.value.length
    ) {
      offsets.ArrowRight = [0, 1];
    }
    const offset = offsets[event.key];
    if (!offset) return;
    const target = document.querySelector<HTMLInputElement>(
      `[data-grade-row="${rowIndex + offset[0]}"][data-grade-column="${columnIndex + offset[1]}"]`
    );
    if (target) {
      event.preventDefault();
      target.focus();
      target.select();
    }
  };

  useEffect(() => {
    return () => {
      if (gradebookAutoSaveTimerRef.current !== null) {
        window.clearTimeout(gradebookAutoSaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (pendingTaskWeightKeys.size === 0 && pendingGroupWeightKeys.size === 0) {
      return;
    }

    if (gradebookAutoSaveTimerRef.current !== null) {
      window.clearTimeout(gradebookAutoSaveTimerRef.current);
    }

    gradebookAutoSaveTimerRef.current = window.setTimeout(() => {
      gradebookAutoSaveTimerRef.current = null;
      void savePendingGradebookWeights();
    }, 700);

    return () => {
      if (gradebookAutoSaveTimerRef.current !== null) {
        window.clearTimeout(gradebookAutoSaveTimerRef.current);
        gradebookAutoSaveTimerRef.current = null;
      }
    };
  }, [groupWeightDrafts, pendingGroupWeightKeys, pendingTaskWeightKeys, taskWeightDrafts]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleGroupExpanded = (groupId: string): void => {
    setExpandedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const toggleGradeGroupCollapsed = (groupId: string): void => {
    setCollapsedGradeGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const expandAllGradeBranches = (): void => {
    setIsStudentGradeTreeCollapsed(false);
    setCollapsedGradeGroupIds(new Set());
  };

  const collapseAllGradeBranches = (): void => {
    setIsStudentGradeTreeCollapsed(false);
    setCollapsedGradeGroupIds(new Set(orderedGroupRows.map((row) => row.id)));
  };

  const beginCreateSubgroup = (parentId: string): void => {
    setNewGroupDraftByParent((current) => ({
      ...current,
      [parentId]: current[parentId] ?? ""
    }));
  };

  const cancelCreateSubgroup = (parentId: string): void => {
    setNewGroupDraftByParent((current) => {
      const next = { ...current };
      delete next[parentId];
      return next;
    });
  };

  const updateSubgroupDraft = (parentId: string, value: string): void => {
    setNewGroupDraftByParent((current) => ({
      ...current,
      [parentId]: value
    }));
    setGradebookNotice("");
  };

  const submitCreateSubgroup = async (parentId: string): Promise<void> => {
    const draft = newGroupDraftByParent[parentId] ?? "";
    const created = await createGradebookGroupAt(draft, parentId);
    if (!created) {
      return;
    }
    setNewGroupDraftByParent((current) => {
      const next = { ...current };
      delete next[parentId];
      return next;
    });
    setExpandedGroupIds((current) => {
      const next = new Set(current);
      if (parentId) {
        next.add(parentId);
      }
      return next;
    });
  };

  const handleTaskDragStart = (taskKey: string): void => {
    setDraggedTaskKey(taskKey);
    setDraggedGroupId(null);
  };

  const handleGroupDragStart = (groupId: string): void => {
    setDraggedGroupId(groupId);
    setDraggedTaskKey(null);
  };

  const handleTaskDragEnd = (): void => {
    setDraggedTaskKey(null);
    setDraggedGroupId(null);
    setDropTargetGroupId("");
  };

  const handleGroupDragOver = (event: DragEvent<HTMLDivElement>, groupId: string): void => {
    event.preventDefault();
    if (!draggedTaskKey && !draggedGroupId) {
      return;
    }
    setDropTargetGroupId(groupId);
  };

  const handleGroupDragLeave = (groupId: string): void => {
    if (dropTargetGroupId === groupId) {
      setDropTargetGroupId("");
    }
  };

  const handleDropToGroup = async (targetGroupId: string): Promise<void> => {
    if (draggedGroupId) {
      await updateGroupParent(draggedGroupId, targetGroupId);
      setDraggedTaskKey(null);
      setDraggedGroupId(null);
      setDropTargetGroupId("");
      setGradebookNotice("Carpeta movida.");
      return;
    }
    if (!draggedTaskKey) {
      return;
    }
    const task = includedTaskRowById.get(draggedTaskKey);
    if (!task) {
      setDraggedTaskKey(null);
      setDraggedGroupId(null);
      setDropTargetGroupId("");
      return;
    }

    const currentGroupId = task.groupId ?? "";
    if (currentGroupId === targetGroupId) {
      setDraggedTaskKey(null);
      setDraggedGroupId(null);
      setDropTargetGroupId("");
      return;
    }

    await updateTaskGroup(draggedTaskKey, targetGroupId);
    setDraggedTaskKey(null);
    setDraggedGroupId(null);
    setDropTargetGroupId("");
    setGradebookNotice("Tarea movida.");
  };

  const renderCreateGroupInline = (parentId: string) => {
    if (!(parentId in newGroupDraftByParent)) {
      return null;
    }
    const draft = newGroupDraftByParent[parentId] ?? "";
    return (
      <li key={`draft-${parentId || "root"}`} className="gradebook-tree-item">
        <div className="gradebook-tree-row create">
          <input
            className="input"
            value={draft}
            onChange={(event) => updateSubgroupDraft(parentId, event.target.value)}
            placeholder={parentId ? "Nombre de subcarpeta" : "Nombre de carpeta"}
          />
          <button
            className="icon-btn"
            type="button"
            onClick={() => void submitCreateSubgroup(parentId)}
            title="Guardar carpeta"
            aria-label="Guardar carpeta"
          >
            <IconCheck />
          </button>
          <button
            className="icon-btn"
            type="button"
            onClick={() => cancelCreateSubgroup(parentId)}
            title="Cancelar"
            aria-label="Cancelar"
          >
            <IconClose />
          </button>
        </div>
      </li>
    );
  };

  const renderTaskNode = (task: IncludedTaskRow) => {
    const taskContribution = contributionData.taskContributionByKey.get(taskConfigKey(task.taskId, task.subjectId)) ?? 0;
    return (
      <li key={`task-${task.configKey}`} className="gradebook-tree-item">
        <div
          className={`gradebook-tree-row task ${draggedTaskKey === task.configKey ? "dragging" : ""}`}
          draggable
          onDragStart={() => handleTaskDragStart(task.configKey)}
          onDragEnd={handleTaskDragEnd}
        >
          <span className="gradebook-tree-node-main">
            <span className="gradebook-tree-node-title">
              <span className="gradebook-tree-node-icon" aria-hidden="true" title="Tarea">
                <IconTask />
              </span>
              <span className="gradebook-tree-node-name">{task.title}</span>
            </span>
            <span className="gradebook-tree-node-meta">
              {task.subjectName} | {task.unitName} | {task.sessionsCount}/{task.plannedSessionsCount} sesiones
            </span>
          </span>
          <label className="gradebook-weight-field">
            <span>Peso</span>
            <input
              className="input grade-input"
              type="number"
              min={0}
              step={0.1}
              value={taskWeightDrafts[task.configKey] ?? formatWeightDraft(task.weight)}
              onChange={(event) => {
                const value = event.target.value;
                setTaskWeightDrafts((current) => ({
                  ...current,
                  [task.configKey]: value
                }));
                setPendingTaskWeightKeys((current) => {
                  const next = new Set(current);
                  next.add(task.configKey);
                  return next;
                });
                setGradebookNotice("");
              }}
            />
          </label>
          <label className="gradebook-weight-field">
            <span>Mover a</span>
            <select
              className="input gradebook-group-select"
              value={task.groupId ?? ""}
              onChange={(event) => {
                void updateTaskGroup(task.configKey, event.target.value).then(() => {
                  setGradebookNotice("Tarea movida.");
                });
              }}
              aria-label={`Mover ${task.title} a otra carpeta`}
            >
              {renderGradebookGroupOptions()}
            </select>
          </label>
          <span className="pill">{task.instrument}</span>
          <span className="pill">Aporta {formatContribution(taskContribution)}</span>
        </div>
      </li>
    );
  };

  const renderGradebookGroupOptions = () => (
    <>
      <option value="">Raíz del cuaderno</option>
      {orderedGroupRows.map((group) => (
        <option key={group.id} value={group.id}>
          {group.treeLabel}
        </option>
      ))}
    </>
  );

  const renderAssessmentNode = (assessment: Assessment) => {
    const draft = assessmentDrafts[assessment.id] ?? assessmentDraftFromRow(assessment);
    const contribution = contributionData.assessmentContributionById.get(assessment.id) ?? 0;

    return (
      <li key={`assessment-${assessment.id}`} className="gradebook-tree-item">
        <div className="gradebook-tree-row assessment">
          <span className="gradebook-tree-node-main">
            <span className="gradebook-tree-node-title">
              <span className="gradebook-tree-node-icon" aria-hidden="true" title="Prueba">
                <IconAssessment />
              </span>
              <input
                className="input gradebook-inline-input"
                value={draft.title}
                onChange={(event) => updateAssessmentDraft(assessment.id, { title: event.target.value })}
                onBlur={() => void saveAssessmentDraft(assessment.id)}
                aria-label="Título de prueba"
              />
            </span>
            <span className="gradebook-tree-node-meta">Prueba manual</span>
          </span>
          <label className="gradebook-weight-field">
            <span>Peso</span>
            <input
              className="input grade-input"
              type="number"
              min={0}
              step={0.1}
              value={draft.weight}
              onChange={(event) => updateAssessmentDraft(assessment.id, { weight: event.target.value })}
              onBlur={() => void saveAssessmentDraft(assessment.id)}
              aria-label="Peso de prueba"
            />
          </label>
          <label className="gradebook-weight-field">
            <span>Periodo</span>
            <input
              className="input gradebook-period-input"
              value={draft.period}
              onChange={(event) => updateAssessmentDraft(assessment.id, { period: event.target.value })}
              onBlur={() => void saveAssessmentDraft(assessment.id)}
              aria-label="Periodo de prueba"
              placeholder="1ª eval."
            />
          </label>
          <label className="gradebook-weight-field">
            <span>Competencia</span>
            <input
              className="input gradebook-competency-input"
              value={draft.competency}
              onChange={(event) => updateAssessmentDraft(assessment.id, { competency: event.target.value })}
              onBlur={() => void saveAssessmentDraft(assessment.id)}
              aria-label="Competencia de prueba"
              placeholder="CE1"
            />
          </label>
          <label className="gradebook-weight-field">
            <span>Carpeta</span>
            <select
              className="input gradebook-group-select"
              value={draft.groupId}
              onChange={(event) => {
                const next = updateAssessmentDraft(assessment.id, { groupId: event.target.value });
                void saveAssessmentDraft(assessment.id, next);
              }}
              aria-label="Carpeta de prueba"
            >
              {renderGradebookGroupOptions()}
            </select>
          </label>
          <span className="pill">Aporta {formatContribution(contribution)}</span>
          <span className="gradebook-tree-actions">
            <button
              type="button"
              className="icon-btn danger"
              onClick={() => void deleteManualAssessment(assessment.id)}
              title="Eliminar prueba"
              aria-label="Eliminar prueba"
            >
              <IconTrash />
            </button>
          </span>
        </div>
      </li>
    );
  };

  const renderGroupNode = (groupId: string) => {
    const group = gradebookGroupById.get(groupId);
    if (!group) {
      return null;
    }
    const childGroupIds = orderedGroupIdsByParent.get(groupId) ?? [];
    const assessments = assessmentsByGroupId.get(groupId) ?? [];
    const tasks = tasksByGroupId.get(groupId) ?? [];
    const isExpanded = expandedGroupIds.has(groupId);
    const isDropTarget = dropTargetGroupId === groupId;
    const hasChildren = childGroupIds.length > 0 || assessments.length > 0 || tasks.length > 0 || groupId in newGroupDraftByParent;
    const groupWeight = Number(group.weight ?? 0);
    const groupLeafContribution = contributionData.groupLeafContributionById.get(groupId) ?? 0;
    const groupLeafItems = contributionData.groupLeafItemCountById.get(groupId) ?? 0;
    const isEmptyGroup = groupLeafItems === 0;

    return (
      <li key={`group-${groupId}`} className="gradebook-tree-item">
        <div
          className={`gradebook-tree-row group ${isDropTarget ? "drop-target" : ""}`}
          onDragOver={(event) => handleGroupDragOver(event, groupId)}
          onDragLeave={() => handleGroupDragLeave(groupId)}
          onDrop={(event) => {
            event.preventDefault();
            void handleDropToGroup(groupId);
          }}
          draggable
          onDragStart={() => handleGroupDragStart(groupId)}
          onDragEnd={handleTaskDragEnd}
        >
          <span className="gradebook-tree-node-main">
            <span className="gradebook-tree-node-title">
              <span className="gradebook-tree-node-icon" aria-hidden="true" title="Carpeta">
                <IconFolder />
              </span>
              <span className="gradebook-tree-node-name">{group.name}</span>
            </span>
            <span className="gradebook-tree-node-meta">
              {childGroupIds.length} subcarpetas | {assessments.length} pruebas | {tasks.length} tareas
            </span>
          </span>
          <label className="gradebook-weight-field">
            <span>Peso</span>
            <input
              className="input grade-input"
              type="number"
              min={0}
              step={0.1}
              value={groupWeightDrafts[groupId] ?? formatWeightDraft(groupWeight)}
              onChange={(event) => {
                const value = event.target.value;
                setGroupWeightDrafts((current) => ({
                  ...current,
                  [groupId]: value
                }));
                setPendingGroupWeightKeys((current) => {
                  const next = new Set(current);
                  next.add(groupId);
                  return next;
                });
                setGradebookNotice("");
              }}
              title="Ponderacion de carpeta"
              aria-label="Ponderacion de carpeta"
            />
          </label>
          {isEmptyGroup ? (
            <span className="aporte-empty-dot" title="Carpeta vacia: no aporta" aria-label="Carpeta vacia: no aporta" />
          ) : null}
          <span className="pill">Aporta {formatContribution(groupLeafContribution)}</span>
          <label className="gradebook-weight-field">
            <span>Mover a</span>
            <select
              className="input gradebook-group-select"
              value={group.parentId ?? ""}
              onChange={(event) => void updateGroupParent(group.id, event.target.value)}
              aria-label={`Mover la carpeta ${group.name}`}
            >
              <option value="">Raíz del cuaderno</option>
              {orderedGroupRows
                .filter((candidate) => !(groupSubtreeById.get(group.id) ?? new Set([group.id])).has(candidate.id))
                .map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.treeLabel}
                  </option>
                ))}
            </select>
          </label>
            <span className="gradebook-tree-actions">
            <button
              type="button"
              className="gradebook-tree-toggle"
              onClick={() => toggleGroupExpanded(groupId)}
              aria-label={isExpanded ? "Contraer carpeta" : "Expandir carpeta"}
              title={isExpanded ? "Contraer carpeta" : "Expandir carpeta"}
              disabled={!hasChildren}
            >
              {isExpanded ? <IconChevronDown /> : <IconChevronRight />}
            </button>
            <button
              className="icon-btn"
              type="button"
              onClick={() => beginCreateSubgroup(groupId)}
              title="Nueva subcarpeta"
              aria-label="Nueva subcarpeta"
            >
              <IconFolderPlus />
            </button>
            <button
              type="button"
              className="icon-btn danger"
              onClick={() => void deleteGradebookGroup(groupId)}
              title="Eliminar carpeta"
              aria-label="Eliminar carpeta"
            >
              <IconTrash />
            </button>
          </span>
        </div>

        {isExpanded ? (
          <ul className="gradebook-tree-list nested">
            {renderCreateGroupInline(groupId)}
            {childGroupIds.map((childId) => renderGroupNode(childId))}
            {assessments.map((assessment) => renderAssessmentNode(assessment))}
            {tasks.map((task) => renderTaskNode(task))}
          </ul>
        ) : null}
      </li>
    );
  };

  const renderStudentAssessmentNode = (student: Student, assessment: Assessment) => {
    const entry = entriesByKey.get(gradeCellKey(student.id, assessment.id));
    const contribution = contributionData.assessmentContributionById.get(assessment.id) ?? 0;
    const value = resolveGradeEntryScore(entry, notSubmittedGradePolicy);
    const status = resolveGradeEntryStatus(entry);
    const statusLabel =
      status === "notSubmitted"
        ? "No presentado"
        : status === "exempt"
          ? "Exento"
          : status === "pending"
            ? "Pendiente"
            : null;

    return (
      <li key={`student-${student.id}-assessment-${assessment.id}`} className="gradebook-tree-item">
        <div className="gradebook-tree-row assessment">
          <span className="gradebook-tree-node-main">
            <span className="gradebook-tree-node-title">
              <span className="gradebook-tree-node-icon" aria-hidden="true" title="Prueba">
                <IconAssessment />
              </span>
              <span className="gradebook-tree-node-name">{assessment.title}</span>
            </span>
            <span className="gradebook-tree-node-meta">Prueba | Peso {Number(assessment.weight ?? 0).toFixed(2)}</span>
          </span>
          <span className="pill">{typeof value === "number" ? value.toFixed(2) : (statusLabel ?? "-")}</span>
          <span className="pill">Aporta {formatContribution(contribution)}</span>
        </div>
      </li>
    );
  };

  const renderStudentTaskNode = (student: Student, task: IncludedTaskRow) => {
    const contribution = contributionData.taskContributionByKey.get(taskConfigKey(task.taskId, task.subjectId)) ?? 0;
    const value = taskScoreByTaskStudent.get(taskStudentKey(task.taskId, task.subjectId, student.id));

    return (
      <li key={`student-${student.id}-task-${task.configKey}`} className="gradebook-tree-item">
        <div className="gradebook-tree-row task readonly">
          <span className="gradebook-tree-node-main">
            <span className="gradebook-tree-node-title">
              <span className="gradebook-tree-node-icon" aria-hidden="true" title="Tarea">
                <IconTask />
              </span>
              <span className="gradebook-tree-node-name">{task.title}</span>
            </span>
            <span className="gradebook-tree-node-meta">
              Tarea | {task.unitName} | {task.instrument}
            </span>
          </span>
          <span className="pill">{typeof value === "number" ? value.toFixed(2) : "-"}</span>
          <span className="pill">Aporta {formatContribution(contribution)}</span>
        </div>
      </li>
    );
  };

  const renderStudentGroupNode = (student: Student, groupId: string) => {
    const group = gradebookGroupById.get(groupId);
    if (!group) {
      return null;
    }

    const childGroupIds = orderedGroupIdsByParent.get(groupId) ?? [];
    const assessments = assessmentsByGroupId.get(groupId) ?? [];
    const tasks = tasksByGroupId.get(groupId) ?? [];
    const value = partialByStudentGroup.get(studentGroupKey(student.id, group.id));
    const contribution = contributionData.groupLeafContributionById.get(groupId) ?? 0;
    const hasChildren = childGroupIds.length > 0 || assessments.length > 0 || tasks.length > 0;
    const isCollapsed = collapsedGradeGroupIds.has(groupId);

    return (
      <li key={`student-${student.id}-group-${groupId}`} className="gradebook-tree-item">
        <div className="gradebook-tree-row group readonly">
          <span className="gradebook-tree-node-main">
            <span className="gradebook-tree-node-title">
              <span className="gradebook-tree-node-icon" aria-hidden="true" title="Carpeta">
                <IconFolder />
              </span>
              <span className="gradebook-tree-node-name">{group.name}</span>
            </span>
            <span className="gradebook-tree-node-meta">
              {childGroupIds.length} subcarpetas | {assessments.length} pruebas | {tasks.length} tareas
            </span>
          </span>
          <span className="pill">{typeof value === "number" ? value.toFixed(2) : "-"}</span>
          <span className="pill">Aporta {formatContribution(contribution)}</span>
          <span className="gradebook-tree-actions">
            <button
              type="button"
              className="gradebook-tree-toggle"
              onClick={() => toggleGradeGroupCollapsed(groupId)}
              aria-label={isCollapsed ? "Desplegar rama" : "Plegar rama"}
              title={isCollapsed ? "Desplegar rama" : "Plegar rama"}
              disabled={!hasChildren}
            >
              {isCollapsed ? <IconChevronRight /> : <IconChevronDown />}
            </button>
          </span>
        </div>

        {hasChildren && !isCollapsed ? (
          <ul className="gradebook-tree-list nested">
            {childGroupIds.map((childId) => renderStudentGroupNode(student, childId))}
            {assessments.map((assessment) => renderStudentAssessmentNode(student, assessment))}
            {tasks.map((task) => renderStudentTaskNode(student, task))}
          </ul>
        ) : null}
      </li>
    );
  };

  const renderStudentGradeTree = (student: Student) => {
    const rootGroupIds = orderedGroupIdsByParent.get("") ?? [];
    const rootAssessments = assessmentsByGroupId.get("") ?? [];
    const rootTasks = tasksByGroupId.get("") ?? [];
    const finalValue = finalByStudent.get(student.id);
    const evaluatedWeight = evaluatedWeightByStudent.get(student.id) ?? 0;
    const hasChildren = rootGroupIds.length > 0 || rootAssessments.length > 0 || rootTasks.length > 0;

    return (
      <article
        className={`student-grade-tree ${isStudentGradeTreeCollapsed ? "collapsed" : ""}`}
        key={`student-tree-${student.id}`}
      >
        <div className="gradebook-tree-row group root readonly">
          <span className="gradebook-tree-node-main">
            <span className="gradebook-tree-node-title">
              <span className="gradebook-tree-node-icon" aria-hidden="true" title="Cuaderno">
                <IconFolder />
              </span>
              <span className="gradebook-tree-node-name">{formatName(student)}</span>
            </span>
            <span className="gradebook-tree-node-meta">
              Nota final · {(evaluatedWeight * 100).toFixed(0)}% evaluado
            </span>
          </span>
          <span className="pill">{typeof finalValue === "number" ? finalValue.toFixed(2) : "-"}</span>
          <span className="gradebook-tree-actions">
            <button
              type="button"
              className="gradebook-tree-toggle"
              onClick={() => setIsStudentGradeTreeCollapsed((current) => !current)}
              aria-label={isStudentGradeTreeCollapsed ? "Desplegar arbol de notas" : "Plegar arbol de notas"}
              title={isStudentGradeTreeCollapsed ? "Desplegar arbol de notas" : "Plegar arbol de notas"}
              disabled={!hasChildren}
            >
              {isStudentGradeTreeCollapsed ? <IconChevronRight /> : <IconChevronDown />}
            </button>
          </span>
        </div>

        {!isStudentGradeTreeCollapsed && hasChildren ? (
          <ul className="gradebook-tree-list root">
            {rootGroupIds.map((groupId) => renderStudentGroupNode(student, groupId))}
            {rootAssessments.map((assessment) => renderStudentAssessmentNode(student, assessment))}
            {rootTasks.map((task) => renderStudentTaskNode(student, task))}
          </ul>
        ) : null}
        {!isStudentGradeTreeCollapsed && !hasChildren ? (
          <p className="hint">No hay pruebas ni tareas en el cuaderno.</p>
        ) : null}
      </article>
    );
  };

  const groupDraftDirty = Object.values(newGroupDraftByParent).some((value) => value.trim().length > 0);
  const hasUnsavedChanges =
    pendingTaskWeightKeys.size > 0 ||
    pendingGroupWeightKeys.size > 0 ||
    groupDraftDirty;

  useUnsavedChangesGuard(hasUnsavedChanges, "Hay cambios del cuaderno sin guardar.", async () => {
    if (groupDraftDirty) return false;
    return savePendingGradebookWeights();
  });

  return (
    <section className="module-card">
      <div className="courses-layout">
        <aside className="courses-list-panel">
          <ContextSidebarTabs
            beforeChange={async () => {
              if (groupDraftDirty) {
                setGradebookNotice("Crea la carpeta pendiente o borra su nombre antes de cambiar de grupo o asignatura.");
                return false;
              }
              return await savePendingGradebookWeights("Cambios del arbol guardados.");
            }}
          />
        </aside>

        <section className="course-detail-panel">
          <header className="workflow-page-header">
            <div>
              <h1>Cuaderno de notas</h1>
              <p>{selectedSubjectId ? gradebookRootName : "Selecciona curso y asignatura"}</p>
            </div>
            <NavLink className="btn secondary" to="/management/periods">
              Periodos y cierre
            </NavLink>
          </header>
          <div className="gradebook-internal-tabs section-tabs" role="group" aria-label="Secciones del cuaderno">
            <button
              type="button"
              aria-pressed={activeGradebookTab === "tree"}
              className={`section-tab ${activeGradebookTab === "tree" ? "active" : ""}`}
              onClick={() => void changeGradebookTab("tree")}
            >
              <span>Organización</span>
            </button>
            <button
              type="button"
              aria-pressed={activeGradebookTab === "grades"}
              className={`section-tab ${activeGradebookTab === "grades" ? "active" : ""}`}
              onClick={() => void changeGradebookTab("grades")}
            >
              <span>Notas</span>
            </button>
            <button
              type="button"
              aria-pressed={activeGradebookTab === "table"}
              className={`section-tab ${activeGradebookTab === "table" ? "active" : ""}`}
              onClick={() => void changeGradebookTab("table")}
            >
              <span>Resultados</span>
            </button>
          </div>

          {activeGradebookTab === "tree" ? (
          <section className="detail-section flush">
            <div className="course-detail-header">
              <h5>Arbol de carpetas, pruebas y tareas del cuaderno</h5>
              <button
                type="button"
                className="btn secondary"
                onClick={() => void createManualAssessment()}
                disabled={!selectedClassId || !selectedSubjectId}
              >
                Nueva prueba
              </button>
            </div>
            <p className="hint">
              Crea pruebas manuales, introduce sus notas en la pestaña Notas y arrastra tareas sobre carpetas para moverlas.
              Tambien puedes crear carpetas y subcarpetas directamente en el arbol.
            </p>
          {isSavingGradebookWeights ? (
            <p className="hint" role="status" aria-live="polite">
              Guardando cambios del arbol...
            </p>
          ) : null}
          {gradebookNotice ? (
            <p className="hint" role="status" aria-live="polite">
              {gradebookNotice}
            </p>
          ) : null}
            <div className="gradebook-tree">
              <div
                className={`gradebook-tree-row group root ${dropTargetGroupId === "" ? "drop-target" : ""}`}
                onDragOver={(event) => handleGroupDragOver(event, "")}
                onDragLeave={() => handleGroupDragLeave("")}
                onDrop={(event) => {
                  event.preventDefault();
                  void handleDropToGroup("");
                }}
              >
                <span className="gradebook-tree-node-main">
                  <span className="gradebook-tree-node-title">
                    <span className="gradebook-tree-node-icon" aria-hidden="true" title={gradebookRootName}>
                      <IconFolder />
                    </span>
                    <span className="gradebook-tree-node-name">{gradebookRootName}</span>
                  </span>
                  <span className="gradebook-tree-node-meta">
                    {(orderedGroupIdsByParent.get("") ?? []).length} carpetas raiz
                  </span>
                </span>
                <span className="gradebook-tree-actions">
                  <button
                    className="icon-btn"
                    type="button"
                    onClick={() => beginCreateSubgroup("")}
                    title={`Nueva carpeta en ${gradebookRootName}`}
                    aria-label={`Nueva carpeta en ${gradebookRootName}`}
                  >
                    <IconFolderPlus />
                  </button>
                </span>
              </div>

              <ul className="gradebook-tree-list root">
                {renderCreateGroupInline("")}
                {(orderedGroupIdsByParent.get("") ?? []).map((groupId) => renderGroupNode(groupId))}
                {(assessmentsByGroupId.get("") ?? []).map((assessment) => renderAssessmentNode(assessment))}
                {(tasksByGroupId.get("") ?? []).map((task) => renderTaskNode(task))}
              </ul>

              {filteredIncludedTasks.length === 0 && filteredAssessments.length === 0 ? (
                <p className="hint">No hay pruebas ni tareas marcadas para incluir en el cuaderno.</p>
              ) : null}
            </div>
          </section>
          ) : null}

          {activeGradebookTab === "grades" ? (
          <section className="detail-section">
            <h5>Arbol de notas por alumno</h5>
            <div className="gradebook-student-toolbar">
              <label className="detail-field compact-field">
                <span>Alumno</span>
                <select
                  className="input"
                  value={selectedStudent?.id ?? ""}
                  onChange={(event) => setSelectedStudentId(event.target.value)}
                  disabled={students.length === 0}
                >
                  {students.map((student) => (
                    <option key={student.id} value={student.id}>
                      {formatName(student)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn secondary"
                onClick={() => setIsStudentGradeTreeCollapsed((current) => !current)}
                disabled={!selectedStudent}
              >
                {isStudentGradeTreeCollapsed ? "Desplegar arbol" : "Plegar arbol"}
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={expandAllGradeBranches}
                disabled={!selectedStudent}
              >
                Desplegar ramas
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={collapseAllGradeBranches}
                disabled={!selectedStudent}
              >
                Plegar ramas
              </button>
            </div>
            <div className="gradebook-bulk-toolbar" aria-label="Herramientas de calificación masiva">
              <label className="detail-field compact-field">
                <span>Filtrar alumnos</span>
                <input
                  className="input"
                  type="search"
                  value={studentGradeFilter}
                  onChange={(event) => setStudentGradeFilter(event.target.value)}
                  placeholder="Nombre o apellidos"
                />
              </label>
              <label className="detail-field compact-field">
                <span>Prueba</span>
                <select
                  className="input"
                  value={bulkAssessmentId || filteredAssessments[0]?.id || ""}
                  onChange={(event) => setBulkAssessmentId(event.target.value)}
                >
                  {filteredAssessments.map((assessment) => (
                    <option key={assessment.id} value={assessment.id}>
                      {assessment.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="detail-field compact-field">
                <span>Estado común</span>
                <select
                  className="input"
                  value={bulkGradeStatus}
                  onChange={(event) => setBulkGradeStatus(event.target.value as GradeEntryStatus)}
                >
                  <option value="graded">Calificado</option>
                  <option value="pending">Pendiente</option>
                  <option value="notSubmitted">No presentado</option>
                  <option value="exempt">Exento</option>
                </select>
              </label>
              <label className="detail-field compact-field">
                <span>Nota común</span>
                <input
                  className="input grade-input"
                  value={bulkGradeDraft}
                  inputMode="decimal"
                  disabled={bulkGradeStatus !== "graded"}
                  onChange={(event) => setBulkGradeDraft(event.target.value)}
                  placeholder="0-10"
                />
              </label>
              <button type="button" className="btn secondary" onClick={() => void applyBulkGrade()}>
                Aplicar a {visibleGradeStudents.length} visibles
              </button>
              <label className="detail-field gradebook-paste-field">
                <span>Pegar desde hoja de cálculo (filas × pruebas)</span>
                <textarea
                  className="input"
                  rows={2}
                  value={pastedGradeDraft}
                  onChange={(event) => setPastedGradeDraft(event.target.value)}
                  placeholder={"7,5\t8\n9\t6"}
                />
              </label>
              <button type="button" className="btn secondary" onClick={() => void applyPastedGrades()}>
                Importar matriz
              </button>
            </div>
            {filteredAssessments.length > 0 ? (
              <div className="table-scroll gradebook-manual-grades-scroll">
                <table className="gradebook-manual-grades-table" aria-label="Notas de pruebas manuales">
                  <thead>
                    <tr>
                      <th>Alumno</th>
                      {filteredAssessments.map((assessment) => (
                        <th key={assessment.id}>
                          <span>{assessment.title}</span>
                          <small>Peso {Number(assessment.weight ?? 0).toFixed(2)}</small>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleGradeStudents.map((student, rowIndex) => (
                      <tr key={student.id}>
                        <th>{formatName(student)}</th>
                        {filteredAssessments.map((assessment, columnIndex) => {
                          const key = gradeCellKey(student.id, assessment.id);
                          const entry = entriesByKey.get(key);
                          const value = gradeDrafts[key] ?? formatGradeValue(entry?.numericValue);
                          const comment = gradeCommentDrafts[key] ?? entry?.comment ?? "";
                          const status = gradeStatusDrafts[key] ?? resolveGradeEntryStatus(entry);
                          return (
                            <td key={key}>
                              <div className="manual-grade-cell">
                                <input
                                  className="input grade-input"
                                  value={value}
                                  inputMode="decimal"
                                  placeholder="0-10"
                                  data-grade-row={rowIndex}
                                  data-grade-column={columnIndex}
                                  aria-label={`Nota de ${formatName(student)} en ${assessment.title}`}
                                  onKeyDown={(event) =>
                                    focusAdjacentGradeCell(event, rowIndex, columnIndex)
                                  }
                                  onChange={(event) => {
                                    const nextValue = event.target.value;
                                    setGradeDrafts((current) => ({
                                      ...current,
                                      [key]: nextValue
                                    }));
                                    setGradebookNotice("");
                                  }}
                                  onBlur={(event) =>
                                    void saveManualGradeCell(
                                      student.id,
                                      assessment.id,
                                      event.target.value,
                                      comment,
                                      status
                                    )
                                  }
                                />
                                <select
                                  className="input manual-grade-status"
                                  value={status}
                                  aria-label={`Estado de ${formatName(student)} en ${assessment.title}`}
                                  onChange={(event) => {
                                    const nextStatus = event.target.value as GradeEntryStatus;
                                    setGradeStatusDrafts((current) => ({
                                      ...current,
                                      [key]: nextStatus
                                    }));
                                    if (nextStatus !== "graded") {
                                      setGradeDrafts((current) => ({
                                        ...current,
                                        [key]: ""
                                      }));
                                    }
                                    void saveManualGradeCell(
                                      student.id,
                                      assessment.id,
                                      nextStatus === "graded" ? value : "",
                                      comment,
                                      nextStatus
                                    );
                                  }}
                                >
                                  <option value="graded">Calificado</option>
                                  <option value="pending">Pendiente</option>
                                  <option value="notSubmitted">No presentado</option>
                                  <option value="exempt">Exento</option>
                                </select>
                                <textarea
                                  className="input manual-grade-comment"
                                  value={comment}
                                  rows={2}
                                  placeholder="Observación"
                                  aria-label={`Observación de ${formatName(student)} en ${assessment.title}`}
                                  onChange={(event) => {
                                    const nextComment = event.target.value;
                                    setGradeCommentDrafts((current) => ({
                                      ...current,
                                      [key]: nextComment
                                    }));
                                    setGradebookNotice("");
                                  }}
                                  onBlur={(event) =>
                                    void saveManualGradeCell(
                                      student.id,
                                      assessment.id,
                                      value,
                                      event.target.value,
                                      status
                                    )
                                  }
                                />
                                {feedbackComments.length > 0 ? (
                                  <select
                                    className="input manual-grade-feedback"
                                    value=""
                                    aria-label={`Comentario guardado para ${formatName(student)} en ${assessment.title}`}
                                    onChange={(event) => {
                                      const selectedComment = feedbackComments.find((item) => item.id === event.target.value);
                                      if (!selectedComment) return;
                                      const nextComment = appendFeedbackComment(comment, selectedComment.text);
                                      setGradeCommentDrafts((current) => ({ ...current, [key]: nextComment }));
                                      void saveManualGradeCell(student.id, assessment.id, value, nextComment, status);
                                    }}
                                  >
                                    <option value="">Insertar comentario…</option>
                                    {feedbackComments.map((item) => <option key={item.id} value={item.id}>{item.text}</option>)}
                                  </select>
                                ) : null}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="hint">Crea una prueba manual en Organización para introducir notas aquí.</p>
            )}
            <div className="student-grade-tree-list">
              {selectedStudent ? renderStudentGradeTree(selectedStudent) : null}
              {students.length === 0 ? <p className="empty-state">No hay alumnos en esta clase.</p> : null}
            </div>
          </section>
          ) : null}

          {activeGradebookTab === "table" ? (
          <section className="detail-section">
            <h5>Resumen de notas</h5>
            <div className="table-scroll gradebook-matrix-scroll">
              <table className="gradebook-matrix-table">
                <thead>
                  {gradebookMatrixData.headerRows.map((row, rowIndex) => (
                    <tr key={`header-${rowIndex}`}>
                      {rowIndex === 0 ? (
                        <th className="sticky-column" rowSpan={gradebookMatrixData.headerRows.length}>
                          Alumno
                        </th>
                      ) : null}
                      {row.map((cell) => (
                        <th
                          key={cell.key}
                          className={`matrix-${cell.kind}`}
                          colSpan={cell.colSpan}
                          rowSpan={cell.rowSpan}
                        >
                          <span className="matrix-heading-title">
                            <span
                              className="matrix-heading-type"
                              title={
                                cell.kind === "root"
                                  ? "Asignatura"
                                  : cell.kind === "group"
                                    ? "Carpeta"
                                    : cell.kind === "assessment"
                                      ? "Prueba"
                                      : cell.kind === "task"
                                        ? "Tarea"
                                        : "Final"
                              }
                              aria-label={
                                cell.kind === "root"
                                  ? "Asignatura"
                                  : cell.kind === "group"
                                    ? "Carpeta"
                                    : cell.kind === "assessment"
                                      ? "Prueba"
                                      : cell.kind === "task"
                                        ? "Tarea"
                                        : "Final"
                              }
                            >
                              {cell.kind === "assessment" ? (
                                <IconAssessment />
                              ) : cell.kind === "task" ? (
                                <IconTask />
                              ) : cell.kind === "final" ? (
                                <IconCheck />
                              ) : (
                                <IconFolder />
                              )}
                            </span>
                            <span className="matrix-heading-name">{cell.title}</span>
                          </span>
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {students.map((student) => (
                    <tr key={student.id}>
                      <th className="sticky-column">{formatName(student)}</th>
                      {gradebookMatrixData.columns.map((column) => {
                        const value =
                          column.kind === "group"
                            ? partialByStudentGroup.get(studentGroupKey(student.id, column.sourceId))
                            : column.kind === "assessment"
                              ? resolveGradeEntryScore(
                                  entriesByKey.get(gradeCellKey(student.id, column.sourceId)),
                                  notSubmittedGradePolicy
                                )
                              : column.kind === "task"
                                ? taskScoreByTaskStudent.get(taskStudentKey(column.sourceId, selectedSubjectId ?? "", student.id))
                                : finalByStudent.get(student.id);
                        return (
                          <td
                            key={`${student.id}:${column.key}`}
                            className={column.kind === "final" ? "final-grade-cell" : `matrix-${column.kind}`}
                          >
                            {formatGradeValue(value)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {students.length === 0 ? (
                    <tr>
                      <td colSpan={gradebookMatrixData.columns.length + 1}>No hay alumnos en esta clase.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
          ) : null}
        </section>
      </div>
    </section>
  );
}
