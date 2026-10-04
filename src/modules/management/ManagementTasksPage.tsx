import { useCallback, useEffect, useMemo, useState } from "react";
import { useManagement } from "./ManagementContext";
import { useAppSelector } from "../../app/hooks";
import { db } from "../../shared/db/database";
import type { ChecklistItem, ChecklistTemplate, RubricCriterion, RubricTemplate, TaskGradebookConfig } from "../../shared/db/types";
import { generateAiText, getAiErrorMessage } from "../../shared/ai/runtime";
import { ContextSidebarTabs } from "../../shared/ui/ContextSidebarTabs";
import { IconButton } from "../../shared/ui/IconButton";
import { Modal } from "../../shared/ui/Modal";
import { useUnsavedChangesGuard } from "../../shared/hooks/useUnsavedChangesGuard";
import { ResourceManager } from "../../shared/resources/ResourceManager";
import { NavLink, useSearchParams } from "react-router-dom";
import {
  defaultChecklist,
  defaultRubric,
  normalizeGeneratedChecklist,
  normalizeGeneratedRubric,
  parseFirstJsonObject,
  type GeneratedChecklist,
  type GeneratedRubric
} from "./instrumentAi";

type InstrumentKind = "rubric" | "checklist" | "direct";
const UNASSIGNED_UNIT_FILTER = "__unassigned__";

export function ManagementTasksPage() {
  const [searchParams] = useSearchParams();
  const selectedClassId = useAppSelector((s) => s.app.selectedClassId);
  const selectedSubjectId = useAppSelector((s) => s.app.selectedSubjectId);

  const {
    allTasks,
    taskSubjectLinks,
    units,
    createEmptyTask,
    updateTask,
    deleteTask,
    addTaskSubjectLink,
    updateTaskSubjectLink,
    setNotice,
  } = useManagement();

  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [detailTitle, setDetailTitle] = useState("");
  const [detailDescription, setDetailDescription] = useState("");
  const [detailSessionCount, setDetailSessionCount] = useState(1);
  const [detailSendToGradebook, setDetailSendToGradebook] = useState(false);
  const [detailUnitId, setDetailUnitId] = useState("");
  const [taskDirty, setTaskDirty] = useState(false);
  const [selectedUnitFilterId, setSelectedUnitFilterId] = useState("");
  const [rubricTemplates, setRubricTemplates] = useState<RubricTemplate[]>([]);
  const [checklistTemplates, setChecklistTemplates] = useState<ChecklistTemplate[]>([]);
  const [taskGradebookConfigs, setTaskGradebookConfigs] = useState<TaskGradebookConfig[]>([]);
  const [rubricName, setRubricName] = useState("");
  const [rubricDescription, setRubricDescription] = useState("");
  const [rubricCriteria, setRubricCriteria] = useState<RubricCriterion[]>([]);
  const [checklistName, setChecklistName] = useState("");
  const [checklistDescription, setChecklistDescription] = useState("");
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [instrumentDirty, setInstrumentDirty] = useState(false);
  const [evaluationDataCount, setEvaluationDataCount] = useState(0);
  const [aiInstrumentKind, setAiInstrumentKind] = useState<InstrumentKind>("rubric");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiStatus, setAiStatus] = useState("");
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [reusableTaskId, setReusableTaskId] = useState("");
  const [reusableInstrumentId, setReusableInstrumentId] = useState("");

  const unitsForSubject = useMemo(
    () => units.filter((u) => u.subjectId === selectedSubjectId).sort((a, b) => a.position - b.position),
    [units, selectedSubjectId]
  );

  const linksForSubject = useMemo(
    () => taskSubjectLinks.filter((l) => l.subjectId === selectedSubjectId),
    [taskSubjectLinks, selectedSubjectId]
  );

  const linkByTaskId = useMemo(
    () => new Map(linksForSubject.map((link) => [link.taskId, link])),
    [linksForSubject]
  );

  const taskIdsForSubject = useMemo(
    () => new Set(linksForSubject.map((l) => l.taskId)),
    [linksForSubject]
  );

  const tasksForSubject = useMemo(
    () => allTasks.filter((t) => taskIdsForSubject.has(t.id)),
    [allTasks, taskIdsForSubject]
  );

  const reusableTasks = useMemo(
    () => allTasks.filter((task) => !taskIdsForSubject.has(task.id)).sort((a, b) => a.title.localeCompare(b.title)),
    [allTasks, taskIdsForSubject]
  );

  const tasksForUnitFilter = useMemo(() => {
    if (!selectedUnitFilterId) return [];
    return tasksForSubject.filter((task) => {
      const unitId = linkByTaskId.get(task.id)?.unitId;
      return selectedUnitFilterId === UNASSIGNED_UNIT_FILTER ? !unitId : unitId === selectedUnitFilterId;
    });
  }, [linkByTaskId, selectedUnitFilterId, tasksForSubject]);

  useEffect(() => {
    const targetTaskId = searchParams.get("taskId");
    if (!targetTaskId || !selectedSubjectId) return;
    const targetLink = linksForSubject.find((link) => link.taskId === targetTaskId);
    if (!targetLink) return;
    setSelectedUnitFilterId(targetLink.unitId ?? UNASSIGNED_UNIT_FILTER);
    setSelectedTaskId(targetTaskId);
  }, [linksForSubject, searchParams, selectedSubjectId]);

  useEffect(() => {
    if (!selectedSubjectId) {
      setSelectedUnitFilterId("");
      return;
    }
    const isValidUnit = unitsForSubject.some((unit) => unit.id === selectedUnitFilterId);
    if (!isValidUnit && selectedUnitFilterId !== UNASSIGNED_UNIT_FILTER) {
      setSelectedUnitFilterId(unitsForSubject[0]?.id ?? UNASSIGNED_UNIT_FILTER);
    }
  }, [selectedSubjectId, selectedUnitFilterId, unitsForSubject]);

  useEffect(() => {
    if (tasksForUnitFilter.length === 0) { setSelectedTaskId(""); return; }
    const exists = tasksForUnitFilter.some((t) => t.id === selectedTaskId);
    if (!exists) setSelectedTaskId(tasksForUnitFilter[0].id);
  }, [selectedSubjectId, selectedUnitFilterId, tasksForUnitFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedTask = useMemo(
    () => allTasks.find((t) => t.id === selectedTaskId) ?? null,
    [allTasks, selectedTaskId]
  );

  const currentLink = useMemo(
    () => linksForSubject.find((l) => l.taskId === selectedTaskId) ?? null,
    [linksForSubject, selectedTaskId]
  );

  const selectedUnitName = useMemo(
    () => selectedUnitFilterId === UNASSIGNED_UNIT_FILTER
      ? "Sin unidad"
      : unitsForSubject.find((unit) => unit.id === selectedUnitFilterId)?.name || "Unidad seleccionada",
    [selectedUnitFilterId, unitsForSubject]
  );

  const loadInstrumentData = useCallback(async (): Promise<void> => {
    if (!selectedClassId || !selectedSubjectId) {
      setRubricTemplates([]);
      setChecklistTemplates([]);
      setTaskGradebookConfigs([]);
      return;
    }
    const [rubrics, checklists, configs] = await Promise.all([
      db.rubricTemplates.toArray(),
      db.checklistTemplates.toArray(),
      db.taskGradebookConfigs.where("[classId+subjectId]").equals([selectedClassId, selectedSubjectId]).toArray()
    ]);
    setRubricTemplates(rubrics);
    setChecklistTemplates(checklists);
    setTaskGradebookConfigs(configs);
  }, [selectedClassId, selectedSubjectId]);

  useEffect(() => {
    void loadInstrumentData();
  }, [loadInstrumentData]);

  const currentTaskConfig = useMemo(
    () =>
      taskGradebookConfigs.find(
        (config) =>
          config.taskId === selectedTaskId &&
          config.subjectId === selectedSubjectId &&
          config.classId === selectedClassId
      ) ?? null,
    [selectedClassId, selectedSubjectId, selectedTaskId, taskGradebookConfigs]
  );

  const selectedRubricTemplate = useMemo(
    () =>
      currentTaskConfig?.rubricTemplateId
        ? rubricTemplates.find((template) => template.id === currentTaskConfig.rubricTemplateId) ?? null
        : null,
    [currentTaskConfig?.rubricTemplateId, rubricTemplates]
  );

  const selectedChecklistTemplate = useMemo(
    () =>
      currentTaskConfig?.checklistTemplateId
        ? checklistTemplates.find((template) => template.id === currentTaskConfig.checklistTemplateId) ?? null
        : null,
    [checklistTemplates, currentTaskConfig?.checklistTemplateId]
  );

  const activeInstrumentKind: InstrumentKind | "" = selectedRubricTemplate
    ? "rubric"
    : selectedChecklistTemplate
      ? "checklist"
      : currentTaskConfig?.directGradeEnabled
        ? "direct"
        : "";
  const hasInstrumentContext = Boolean(selectedClassId && selectedSubjectId);
  const hasEvaluationData = evaluationDataCount > 0;
  const canChangeEvaluationMethod = hasInstrumentContext && !hasEvaluationData;
  const showCreateRubricButton = canChangeEvaluationMethod && activeInstrumentKind !== "rubric";
  const showCreateChecklistButton = canChangeEvaluationMethod && activeInstrumentKind !== "checklist";
  const showDirectGradeButton = canChangeEvaluationMethod && activeInstrumentKind !== "direct";
  const showGenerateRubricButton = canChangeEvaluationMethod;
  const showGenerateChecklistButton = canChangeEvaluationMethod;
  const showDeleteInstrumentButton = Boolean(activeInstrumentKind) && !hasEvaluationData;
  const showDeleteEvaluationDataButton = Boolean(activeInstrumentKind) && hasEvaluationData;
  const showSaveInstrumentButton = instrumentDirty && !hasEvaluationData;

  const getEvaluationDataCount = useCallback(async (config: TaskGradebookConfig | null): Promise<number> => {
    if (!config) {
      return 0;
    }
    if (config.rubricTemplateId) {
      return db.taskRubricAssessments
        .where("rubricTemplateId")
        .equals(config.rubricTemplateId)
        .filter((row) => row.taskId === config.taskId)
        .count();
    }
    if (config.checklistTemplateId) {
      return db.taskChecklistAssessments
        .where("checklistTemplateId")
        .equals(config.checklistTemplateId)
        .filter((row) => row.taskId === config.taskId)
        .count();
    }
    if (config.directGradeEnabled) {
      return db.taskDirectGrades
        .where("[taskId+subjectId+classId]")
        .equals([config.taskId, config.subjectId, config.classId])
        .count();
    }
    return 0;
  }, []);

  useEffect(() => {
    let active = true;
    const loadCount = async (): Promise<void> => {
      const count = await getEvaluationDataCount(currentTaskConfig);
      if (active) {
        setEvaluationDataCount(count);
      }
    };
    void loadCount();
    return () => {
      active = false;
    };
  }, [
    currentTaskConfig,
    getEvaluationDataCount
  ]);

  const ensureInstrumentCanBeReplaced = async (): Promise<boolean> => {
    const count = await getEvaluationDataCount(currentTaskConfig);
    setEvaluationDataCount(count);
    if (activeInstrumentKind && count > 0) {
      setNotice(
        `No se puede cambiar el método de evaluación porque tiene ${count} registros. Borra primero los datos de evaluación.`
      );
      return false;
    }
    return true;
  };

  useEffect(() => {
    if (!selectedTask) {
      setDetailTitle(""); setDetailDescription("");
      setDetailSessionCount(1);
      setDetailSendToGradebook(false);
      setDetailUnitId(""); setTaskDirty(false);
      return;
    }
    setDetailTitle(selectedTask.title);
    setDetailDescription(selectedTask.description);
    setDetailSessionCount(selectedTask.sessionCount ?? 1);
    setDetailSendToGradebook(selectedTask.sendToGradebook);
    setDetailUnitId(currentLink?.unitId ?? "");
    setTaskDirty(false);
  }, [selectedTask, currentLink]);

  useEffect(() => {
    if (!selectedRubricTemplate) {
      setRubricName("");
      setRubricDescription("");
      setRubricCriteria([]);
      setInstrumentDirty(false);
      return;
    }
    setRubricName(selectedRubricTemplate.name);
    setRubricDescription(selectedRubricTemplate.description ?? "");
    setRubricCriteria(selectedRubricTemplate.criteria ?? []);
    setInstrumentDirty(false);
  }, [selectedRubricTemplate]);

  useEffect(() => {
    if (!selectedChecklistTemplate) {
      setChecklistName("");
      setChecklistDescription("");
      setChecklistItems([]);
      if (!selectedRubricTemplate) {
        setInstrumentDirty(false);
      }
      return;
    }
    setChecklistName(selectedChecklistTemplate.name);
    setChecklistDescription(selectedChecklistTemplate.description ?? "");
    setChecklistItems(selectedChecklistTemplate.items ?? []);
    setInstrumentDirty(false);
  }, [selectedChecklistTemplate, selectedRubricTemplate]);

  // Debounced autosave. Context actions are intentionally omitted because their references are unstable.
  useEffect(() => {
    if (!taskDirty || !selectedTask) return;
    const title = detailTitle.trim();
    if (title.length < 2) return;
    const taskId = selectedTask.id;
    const desc = detailDescription;
    const sessionCount = detailSessionCount;
    const toGradebook = detailSendToGradebook;
    const unitId = detailUnitId;
    const linkId = currentLink?.id;
    const timer = setTimeout(async () => {
      const linkSaved = linkId ? await updateTaskSubjectLink(linkId, unitId || undefined) : true;
      if (!linkSaved) return;
      const taskSaved = await updateTask(taskId, title, desc, sessionCount, toGradebook);
      if (taskSaved) setTaskDirty(false);
    }, 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskDirty, detailTitle, detailDescription, detailSessionCount, detailSendToGradebook, detailUnitId, selectedTask?.id, currentLink?.id]);

  const ensureTaskGradebookConfig = async (): Promise<TaskGradebookConfig | null> => {
    if (!selectedTask || !selectedClassId || !selectedSubjectId) {
      setNotice("Selecciona curso, asignatura y tarea para asignar un instrumento.");
      return null;
    }
    const existing =
      (await db.taskGradebookConfigs
        .where("[taskId+subjectId+classId]")
        .equals([selectedTask.id, selectedSubjectId, selectedClassId])
        .first()) ?? null;
    if (existing) {
      return existing;
    }
    const created: TaskGradebookConfig = {
      id: crypto.randomUUID(),
      taskId: selectedTask.id,
      subjectId: selectedSubjectId,
      classId: selectedClassId,
      gradebookWeight: 0
    };
    await db.taskGradebookConfigs.add(created);
    return created;
  };

  const assignRubricTemplate = async (rubricTemplateId: string): Promise<void> => {
    const config = await ensureTaskGradebookConfig();
    if (!config) return;
    const isSameInstrument =
      config.rubricTemplateId === rubricTemplateId && !config.checklistTemplateId && !config.directGradeEnabled;
    if (!isSameInstrument && !(await ensureInstrumentCanBeReplaced())) {
      return;
    }
    await db.taskGradebookConfigs.put({
      ...config,
      rubricTemplateId,
      checklistTemplateId: undefined,
      directGradeEnabled: false
    });
    await loadInstrumentData();
  };

  const assignChecklistTemplate = async (checklistTemplateId: string): Promise<void> => {
    const config = await ensureTaskGradebookConfig();
    if (!config) return;
    const isSameInstrument =
      config.checklistTemplateId === checklistTemplateId && !config.rubricTemplateId && !config.directGradeEnabled;
    if (!isSameInstrument && !(await ensureInstrumentCanBeReplaced())) {
      return;
    }
    await db.taskGradebookConfigs.put({
      ...config,
      rubricTemplateId: undefined,
      checklistTemplateId,
      directGradeEnabled: false
    });
    await loadInstrumentData();
  };

  const assignDirectGrade = async (): Promise<void> => {
    if (activeInstrumentKind !== "direct" && !(await ensureInstrumentCanBeReplaced())) {
      return;
    }
    const config = await ensureTaskGradebookConfig();
    if (!config) return;
    await db.taskGradebookConfigs.put({
      ...config,
      rubricTemplateId: undefined,
      checklistTemplateId: undefined,
      directGradeEnabled: true
    });
    setInstrumentDirty(false);
    setNotice("Nota directa asignada a la tarea.");
    await loadInstrumentData();
  };

  const createTaskRubric = async (initial = defaultRubric(detailTitle.trim())): Promise<void> => {
    if (!selectedClassId || !selectedTask) {
      setNotice("Selecciona curso y tarea para crear la rúbrica.");
      return;
    }
    if (activeInstrumentKind && !(await ensureInstrumentCanBeReplaced())) {
      return;
    }
    if (!(await saveIfDirty())) return;
    const id = crypto.randomUUID();
    await db.rubricTemplates.add({
      id,
      classId: selectedClassId,
      taskId: selectedTask.id,
      name: initial.name,
      description: initial.description,
      criteria: initial.criteria,
      criteriaCount: initial.criteria.length,
      levelCount: initial.criteria[0]?.levels?.length ?? 0
    });
    await assignRubricTemplate(id);
    setNotice("Rúbrica creada y asignada a la tarea.");
  };

  const createTaskChecklist = async (initial = defaultChecklist(detailTitle.trim())): Promise<void> => {
    if (!selectedClassId || !selectedTask) {
      setNotice("Selecciona curso y tarea para crear la lista de cotejo.");
      return;
    }
    if (activeInstrumentKind && !(await ensureInstrumentCanBeReplaced())) {
      return;
    }
    if (!(await saveIfDirty())) return;
    const id = crypto.randomUUID();
    await db.checklistTemplates.add({
      id,
      classId: selectedClassId,
      taskId: selectedTask.id,
      name: initial.name,
      description: initial.description,
      items: initial.items
    });
    await assignChecklistTemplate(id);
    setNotice("Lista de cotejo creada y asignada a la tarea.");
  };

  const reuseSelectedTask = async (): Promise<void> => {
    if (!selectedSubjectId || !reusableTaskId) return;
    if (!(await saveIfDirty())) return;
    await addTaskSubjectLink(
      reusableTaskId,
      selectedSubjectId,
      selectedUnitFilterId === UNASSIGNED_UNIT_FILTER ? undefined : selectedUnitFilterId
    );
    setSelectedTaskId(reusableTaskId);
    setReusableTaskId("");
    setNotice("Tarea reutilizada en la asignatura actual.");
  };

  const copySelectedInstrument = async (): Promise<void> => {
    if (!selectedClassId || !selectedTask || !reusableInstrumentId) return;
    if (!(await saveIfDirty())) return;
    if (activeInstrumentKind && !(await ensureInstrumentCanBeReplaced())) return;

    const [kind, sourceId] = reusableInstrumentId.split(":", 2);
    if (kind === "rubric") {
      const source = rubricTemplates.find((template) => template.id === sourceId);
      if (!source) return;
      const id = crypto.randomUUID();
      await db.rubricTemplates.add({
        ...structuredClone(source),
        id,
        classId: selectedClassId,
        taskId: selectedTask.id,
        name: `${source.name} (copia)`
      });
      await assignRubricTemplate(id);
    } else if (kind === "checklist") {
      const source = checklistTemplates.find((template) => template.id === sourceId);
      if (!source) return;
      const id = crypto.randomUUID();
      await db.checklistTemplates.add({
        ...structuredClone(source),
        id,
        classId: selectedClassId,
        taskId: selectedTask.id,
        name: `${source.name} (copia)`
      });
      await assignChecklistTemplate(id);
    } else {
      return;
    }
    setReusableInstrumentId("");
    setNotice("Instrumento copiado y asignado sin trasladar calificaciones anteriores.");
  };

  const deleteEvaluationData = async (): Promise<void> => {
    if (!currentTaskConfig || !activeInstrumentKind) {
      return;
    }
    const count = await getEvaluationDataCount(currentTaskConfig);
    setEvaluationDataCount(count);
    if (count === 0) {
      setNotice("No hay datos de evaluación que borrar.");
      return;
    }
    const confirmed = window.confirm(
      `Se borrarán ${count} registros de evaluación de esta tarea. Esta acción no se puede deshacer.`
    );
    if (!confirmed) {
      return;
    }

    await db.transaction(
      "rw",
      db.taskRubricAssessments,
      db.taskChecklistAssessments,
      db.taskDirectGrades,
      async () => {
        if (currentTaskConfig.rubricTemplateId) {
          const rows = await db.taskRubricAssessments
            .where("rubricTemplateId")
            .equals(currentTaskConfig.rubricTemplateId)
            .filter((row) => row.taskId === currentTaskConfig.taskId)
            .toArray();
          if (rows.length > 0) {
            await db.taskRubricAssessments.bulkDelete(rows.map((row) => row.id));
          }
        } else if (currentTaskConfig.checklistTemplateId) {
          const rows = await db.taskChecklistAssessments
            .where("checklistTemplateId")
            .equals(currentTaskConfig.checklistTemplateId)
            .filter((row) => row.taskId === currentTaskConfig.taskId)
            .toArray();
          if (rows.length > 0) {
            await db.taskChecklistAssessments.bulkDelete(rows.map((row) => row.id));
          }
        } else if (currentTaskConfig.directGradeEnabled) {
          await db.taskDirectGrades
            .where("[taskId+subjectId+classId]")
            .equals([currentTaskConfig.taskId, currentTaskConfig.subjectId, currentTaskConfig.classId])
            .delete();
        }
      }
    );

    setEvaluationDataCount(0);
    setNotice("Datos de evaluación borrados. Ahora puedes cambiar o eliminar el método.");
  };

  const deleteAssignedRubric = async (): Promise<void> => {
    if (!selectedRubricTemplate) {
      return;
    }
    const assessmentsCount = await db.taskRubricAssessments
      .where("rubricTemplateId")
      .equals(selectedRubricTemplate.id)
      .count();
    if (assessmentsCount > 0) {
      setNotice("No se puede eliminar la rúbrica porque ya tiene evaluaciones.");
      return;
    }
    await db.transaction("rw", db.rubricTemplates, db.taskGradebookConfigs, db.taskDailyEvaluationSettings, async () => {
      await db.rubricTemplates.delete(selectedRubricTemplate.id);
      const configs = await db.taskGradebookConfigs.where("rubricTemplateId").equals(selectedRubricTemplate.id).toArray();
      if (configs.length > 0) {
        await db.taskGradebookConfigs.bulkPut(
          configs.map((config) => ({
            ...config,
            rubricTemplateId: undefined
          }))
        );
      }
      const settings = await db.taskDailyEvaluationSettings.where("rubricTemplateId").equals(selectedRubricTemplate.id).toArray();
      if (settings.length > 0) {
        await db.taskDailyEvaluationSettings.bulkPut(
          settings.map((setting) => ({
            ...setting,
            rubricTemplateId: undefined
          }))
        );
      }
    });
    setInstrumentDirty(false);
    setRubricName("");
    setRubricDescription("");
    setRubricCriteria([]);
    setNotice("Rúbrica eliminada.");
    await loadInstrumentData();
  };

  const deleteAssignedInstrument = async (): Promise<void> => {
    if (!currentTaskConfig || !activeInstrumentKind) {
      return;
    }
    const count = await getEvaluationDataCount(currentTaskConfig);
    setEvaluationDataCount(count);
    if (count > 0) {
      setNotice(
        `No se puede eliminar el método de evaluación porque tiene ${count} registros. Borra primero los datos de evaluación.`
      );
      return;
    }
    if (currentTaskConfig.rubricTemplateId) {
      await deleteAssignedRubric();
      return;
    }
    await db.transaction("rw", db.checklistTemplates, db.taskGradebookConfigs, db.taskDailyEvaluationSettings, async () => {
      if (currentTaskConfig.checklistTemplateId) {
        await db.checklistTemplates.delete(currentTaskConfig.checklistTemplateId);
        const settings = await db.taskDailyEvaluationSettings
          .where("checklistTemplateId")
          .equals(currentTaskConfig.checklistTemplateId)
          .toArray();
        const matchingSettings = settings.filter((setting) => setting.taskId === currentTaskConfig.taskId);
        if (matchingSettings.length > 0) {
          await db.taskDailyEvaluationSettings.bulkPut(
            matchingSettings.map((setting) => ({
              ...setting,
              checklistTemplateId: undefined
            }))
          );
        }
      }
      await db.taskGradebookConfigs.put({
        ...currentTaskConfig,
        rubricTemplateId: undefined,
        checklistTemplateId: undefined,
        directGradeEnabled: false
      });
    });
    setInstrumentDirty(false);
    setChecklistName("");
    setChecklistDescription("");
    setChecklistItems([]);
    setEvaluationDataCount(0);
    setNotice("Método de evaluación eliminado.");
    await loadInstrumentData();
  };

  const persistInstrument = async (): Promise<boolean> => {
    if (!instrumentDirty) return true;
    if (selectedRubricTemplate) {
      const name = rubricName.trim();
      const criteria = rubricCriteria
        .map((criterion) => ({
          ...criterion,
          name: criterion.name.trim(),
          description: criterion.description?.trim() || undefined,
          levels: (criterion.levels ?? [])
            .map((level) => ({ ...level, name: level.name.trim(), score: Number(level.score) }))
            .filter((level) => level.name.length > 0 && Number.isFinite(level.score))
        }))
        .filter((criterion) => criterion.name.length > 0);
      const valid =
        name.length >= 2 && criteria.length > 0 && criteria.every((criterion) => (criterion.levels?.length ?? 0) >= 2);
      if (!valid) {
      setNotice("La rúbrica necesita nombre, criterios y al menos dos niveles por criterio.");
        return false;
      }
      await db.rubricTemplates.put({
        ...selectedRubricTemplate,
        name,
        description: rubricDescription.trim() || undefined,
        criteria,
        criteriaCount: criteria.length,
        levelCount: criteria[0]?.levels?.length ?? 0
      });
      setInstrumentDirty(false);
    setNotice("Rúbrica guardada.");
      await loadInstrumentData();
      return true;
    }
    if (selectedChecklistTemplate) {
      const name = checklistName.trim();
      const items = checklistItems
        .map((item) => ({ ...item, text: item.text.trim() }))
        .filter((item) => item.text.length > 0);
      if (name.length < 2 || items.length === 0) {
        setNotice("La lista de cotejo necesita nombre e items.");
        return false;
      }
      await db.checklistTemplates.put({
        ...selectedChecklistTemplate,
        name,
        description: checklistDescription.trim() || undefined,
        items
      });
      setInstrumentDirty(false);
      setNotice("Lista de cotejo guardada.");
      await loadInstrumentData();
      return true;
    }
    return true;
  };

  const saveIfDirty = useCallback(async (): Promise<boolean> => {
    if (taskDirty && selectedTask) {
      const title = detailTitle.trim();
      if (currentLink && !(await updateTaskSubjectLink(currentLink.id, detailUnitId || undefined))) return false;
      const taskSaved = await updateTask(selectedTask.id, title, detailDescription, detailSessionCount, detailSendToGradebook);
      if (!taskSaved) return false;
      setTaskDirty(false);
    }
    return persistInstrument();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    taskDirty,
    detailTitle,
    detailDescription,
    detailSessionCount,
    detailSendToGradebook,
    detailUnitId,
    selectedTask?.id,
    currentLink?.id,
    instrumentDirty,
    selectedRubricTemplate?.id,
    selectedChecklistTemplate?.id,
    rubricName,
    rubricDescription,
    rubricCriteria,
    checklistName,
    checklistDescription,
    checklistItems
  ]);

  useUnsavedChangesGuard(taskDirty || instrumentDirty, "Hay cambios de la tarea o su instrumento sin guardar.", saveIfDirty);

  const openAiInstrumentModal = (kind: InstrumentKind): void => {
    const basePrompt = [
      detailTitle.trim() ? `Tarea: ${detailTitle.trim()}` : "",
        detailDescription.trim() ? `Descripción: ${detailDescription.trim()}` : ""
    ]
      .filter(Boolean)
      .join("\n");
    setAiInstrumentKind(kind);
    setAiPrompt(basePrompt);
    setAiStatus("");
    setIsAIModalOpen(true);
  };

  const applyGeneratedRubric = async (generated: {
    name: string;
    description: string;
    criteria: RubricCriterion[];
  }): Promise<void> => {
    if (selectedRubricTemplate) {
      await db.rubricTemplates.put({
        ...selectedRubricTemplate,
        name: generated.name,
        description: generated.description,
        criteria: generated.criteria,
        criteriaCount: generated.criteria.length,
        levelCount: generated.criteria[0]?.levels?.length ?? 0
      });
      setRubricName(generated.name);
      setRubricDescription(generated.description);
      setRubricCriteria(generated.criteria);
      setInstrumentDirty(false);
      await loadInstrumentData();
      return;
    }
    await createTaskRubric(generated);
  };

  const applyGeneratedChecklist = async (generated: {
    name: string;
    description: string;
    items: ChecklistItem[];
  }): Promise<void> => {
    if (selectedChecklistTemplate) {
      await db.checklistTemplates.put({
        ...selectedChecklistTemplate,
        name: generated.name,
        description: generated.description,
        items: generated.items
      });
      setChecklistName(generated.name);
      setChecklistDescription(generated.description);
      setChecklistItems(generated.items);
      setInstrumentDirty(false);
      await loadInstrumentData();
      return;
    }
    await createTaskChecklist(generated);
  };

  const generateInstrumentWithAI = async (): Promise<void> => {
    const prompt = aiPrompt.trim();
    if (!prompt) {
      setAiStatus("Escribe que quieres generar.");
      return;
    }
    setIsGeneratingAI(true);
      setAiStatus(aiInstrumentKind === "rubric" ? "Generando rúbrica..." : "Generando lista de cotejo...");
    try {
      if (aiInstrumentKind === "rubric") {
        const response = await generateAiText(
          [
            {
              role: "system",
              content: "Genera rúbricas académicas en JSON válido. Devuelve solo JSON sin markdown ni explicaciones."
            },
            {
              role: "user",
              content: [
                prompt,
                "Formato JSON exacto:",
                '{"name":"","description":"","criteria":[{"name":"","description":"","levels":[{"name":"","score":4},{"name":"","score":3},{"name":"","score":2},{"name":"","score":1}]}]}',
                "Mínimo 3 criterios. Cada criterio debe tener al menos 4 niveles ordenados de mayor a menor puntuación."
              ].join("\n")
            }
          ],
          { temperature: 0.2, maxOutputTokens: 700, responseFormat: "json" }
        );
        const parsed = parseFirstJsonObject<GeneratedRubric>(response.text);
        let normalized = parsed ? normalizeGeneratedRubric(parsed, detailTitle.trim()) : null;
        let usedFallback = false;
        if (!normalized) {
          setAiStatus("Reformateando rúbrica...");
          const repairResponse = await generateAiText(
            [
              {
                role: "system",
                content: "Convierte el contenido recibido a JSON válido. Devuelve solo JSON sin markdown."
              },
              {
                role: "user",
                content: [
                  "Formato objetivo:",
                  '{"name":"","description":"","criteria":[{"name":"","description":"","levels":[{"name":"","score":4},{"name":"","score":3},{"name":"","score":2},{"name":"","score":1}]}]}',
                  "Contenido:",
                  response.text.slice(0, 4000)
                ].join("\n")
              }
            ],
            { temperature: 0, maxOutputTokens: 500, responseFormat: "json" }
          );
          const repaired = parseFirstJsonObject<GeneratedRubric>(repairResponse.text);
          normalized = repaired ? normalizeGeneratedRubric(repaired, detailTitle.trim()) : null;
        }
        if (!normalized) {
          normalized = defaultRubric(detailTitle.trim() || prompt);
          usedFallback = true;
        }
        await applyGeneratedRubric(normalized);
        const message = usedFallback
          ? "La IA no devolvió JSON válido. Se creó una rúbrica base para ajustarla."
          : "Rúbrica generada.";
        setAiStatus(message);
        setNotice(message);
      } else {
        const response = await generateAiText(
          [
            {
              role: "system",
              content:
                "Genera listas de cotejo académicas en JSON válido. Devuelve solo JSON sin markdown ni explicaciones."
            },
            {
              role: "user",
              content: [
                prompt,
                "Formato JSON exacto:",
                '{"name":"","description":"","items":[{"text":""}]}',
                "Mínimo 5 ítems claros, observables y evaluables."
              ].join("\n")
            }
          ],
          { temperature: 0.2, maxOutputTokens: 450, responseFormat: "json" }
        );
        const parsed = parseFirstJsonObject<GeneratedChecklist>(response.text);
        let normalized = parsed ? normalizeGeneratedChecklist(parsed, detailTitle.trim()) : null;
        let usedFallback = false;
        if (!normalized) {
          setAiStatus("Reformateando lista de cotejo...");
          const repairResponse = await generateAiText(
            [
              {
                role: "system",
                content: "Convierte el contenido recibido a JSON válido. Devuelve solo JSON sin markdown."
              },
              {
                role: "user",
                content: [
                  "Formato objetivo:",
                  '{"name":"","description":"","items":[{"text":""}]}',
                  "Contenido:",
                  response.text.slice(0, 3500)
                ].join("\n")
              }
            ],
            { temperature: 0, maxOutputTokens: 350, responseFormat: "json" }
          );
          const repaired = parseFirstJsonObject<GeneratedChecklist>(repairResponse.text);
          normalized = repaired ? normalizeGeneratedChecklist(repaired, detailTitle.trim()) : null;
        }
        if (!normalized) {
          normalized = defaultChecklist(detailTitle.trim() || prompt);
          usedFallback = true;
        }
        await applyGeneratedChecklist(normalized);
        const message = usedFallback
          ? "La IA no devolvió JSON válido. Se creó una lista base para ajustarla."
          : "Lista de cotejo generada.";
        setAiStatus(message);
        setNotice(message);
      }
      setIsAIModalOpen(false);
    } catch (error) {
      const message = getAiErrorMessage(error);
      setAiStatus(`No se pudo generar (${message}).`);
    } finally {
      setIsGeneratingAI(false);
    }
  };

  return (
    <article className="management-card">
      <h1 className="sr-only">Tareas</h1>
      <div className="courses-layout">
        <aside className="courses-list-panel">
          <ContextSidebarTabs beforeChange={saveIfDirty} />
          {selectedSubjectId ? (
            <div className="context-sidebar-tabs">
              <div className="context-sidebar-group">
                <strong>Unidades</strong>
                {unitsForSubject.length > 0 ? (
                  <div className="courses-list section-tabs context-sidebar-list" role="group" aria-label="Unidades">
                    {unitsForSubject.map((unit) => (
                      <button
                        key={unit.id}
                        type="button"
                        aria-pressed={selectedUnitFilterId === unit.id}
                        className={`section-tab ${selectedUnitFilterId === unit.id ? "active" : ""}`}
                        onClick={async () => {
                          if (!(await saveIfDirty())) return;
                          setSelectedUnitFilterId(unit.id);
                        }}
                      >
                        <span>{unit.name || "Unidad sin nombre"}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      aria-pressed={selectedUnitFilterId === UNASSIGNED_UNIT_FILTER}
                      className={`section-tab ${selectedUnitFilterId === UNASSIGNED_UNIT_FILTER ? "active" : ""}`}
                      onClick={async () => {
                        if (!(await saveIfDirty())) return;
                        setSelectedUnitFilterId(UNASSIGNED_UNIT_FILTER);
                      }}
                    >
                      <span>Sin unidad</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    aria-pressed="true"
                    className="section-tab active"
                    onClick={() => setSelectedUnitFilterId(UNASSIGNED_UNIT_FILTER)}
                  >
                    <span>Sin unidad</span>
                  </button>
                )}
              </div>
            </div>
          ) : null}
          <div className="courses-list-header">
            <strong>Tareas</strong>
            <IconButton
              icon="add"
              label="Crear tarea"
              showLabel
              disabled={!selectedSubjectId}
              onClick={async () => {
                if (!selectedSubjectId) {
                  setNotice("Selecciona una asignatura para crear la tarea.");
                  return;
                }
                if (!(await saveIfDirty())) return;
                const createdId = await createEmptyTask();
                if (createdId) {
                  await addTaskSubjectLink(
                    createdId,
                    selectedSubjectId,
                    selectedUnitFilterId === UNASSIGNED_UNIT_FILTER ? undefined : selectedUnitFilterId
                  );
                  setSelectedTaskId(createdId);
                }
              }}
            />
          </div>

          {selectedSubjectId && reusableTasks.length > 0 ? (
            <div className="sidebar-reuse-panel">
              <label className="detail-field compact-field">
                <span>Reutilizar tarea existente</span>
                <select
                  className="input"
                  value={reusableTaskId}
                  onChange={(event) => setReusableTaskId(event.target.value)}
                >
                  <option value="">Selecciona una tarea</option>
                  {reusableTasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title || "Sin título"}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn secondary"
                disabled={!reusableTaskId}
                onClick={() => void reuseSelectedTask()}
              >
                Añadir a esta unidad
              </button>
            </div>
          ) : null}

          <div className="courses-list section-tabs" role="group" aria-label="Tareas">
            {selectedSubjectId ? tasksForUnitFilter.map((task) => {
              const link = linkByTaskId.get(task.id);
              const unitName = link?.unitId
                ? (units.find((u) => u.id === link.unitId)?.name ?? "Unidad desconocida")
                : "Sin unidad";
              return (
                <div key={task.id} className="courses-list-row">
                  <button
                    type="button"
                    aria-pressed={selectedTaskId === task.id}
                    className={`section-tab ${selectedTaskId === task.id ? "active" : ""}`}
                    onClick={async () => {
                      if (!(await saveIfDirty())) return;
                      setSelectedTaskId(task.id);
                    }}
                  >
                    <span>{task.title || "Sin título"}</span>
                    <small>{unitName} · {task.sessionCount ?? 1} {(task.sessionCount ?? 1) === 1 ? "sesión" : "sesiones"}</small>
                  </button>
                  <IconButton
                    icon="delete"
                    label={`Eliminar ${task.title || "tarea"}`}
                    onClick={async () => {
                      if (!window.confirm(`¿Eliminar la tarea "${task.title || "esta tarea"}"? Esta acción no se puede deshacer.`)) return;
                      if (!(await saveIfDirty())) return;
                      await deleteTask(task.id);
                    }}
                  />
                </div>
              );
            }) : null}
            {selectedSubjectId && tasksForUnitFilter.length === 0 && (
              <p className="empty-state">
                {tasksForSubject.length === 0 ? "No hay tareas. Usa Crear tarea para preparar la primera." : "No hay tareas en esta sección."}
              </p>
            )}
          </div>
        </aside>

        <section className="course-detail-panel">
          {selectedTask ? (
            <>
              <div className="course-detail-header">
                <h2>Ficha de tarea</h2>
                <span role="status" className="hint">{taskDirty ? "Cambios pendientes de guardar" : instrumentDirty ? "Instrumento pendiente de guardar" : "Guardado"}</span>
              </div>

              <section className="detail-section">
                <div className="detail-grid">
                  <div className="detail-field full compact-field">
                    <label htmlFor="task-title">Título</label>
                    <input
                      id="task-title"
                      className="input"
                      placeholder="Título de la tarea"
                      value={detailTitle}
                      onChange={(e) => { setDetailTitle(e.target.value); setTaskDirty(true); }}
                    />
                  </div>

                  <div className="detail-field full">
                    <label htmlFor="task-description">Descripción</label>
                    <textarea
                      id="task-description"
                      className="input"
                      rows={3}
                      placeholder="Descripción o instrucciones"
                      value={detailDescription}
                      onChange={(e) => { setDetailDescription(e.target.value); setTaskDirty(true); }}
                    />
                  </div>

                  <div className="detail-field full">
                    <label>Unidad</label>
                    <div
                      className="input readonly-display"
                      aria-label="Unidad seleccionada"
                    >
                      {selectedUnitName}
                    </div>
                  </div>

                  <div className="detail-field compact-field">
                    <label htmlFor="task-session-count">Sesiones</label>
                    <input
                      id="task-session-count"
                      className="input"
                      type="number"
                      min={1}
                      step={1}
                      value={detailSessionCount}
                      onChange={(e) => {
                        setDetailSessionCount(Math.max(1, Math.round(Number(e.target.value) || 1)));
                        setTaskDirty(true);
                      }}
                    />
                  </div>

                  <div className="detail-field">
                    <label htmlFor="task-send-to-gradebook">Incluir en cuaderno</label>
                    <label className="chip-toggle">
                      <input
                        id="task-send-to-gradebook"
                        type="checkbox"
                        checked={detailSendToGradebook}
                        onChange={(e) => { setDetailSendToGradebook(e.target.checked); setTaskDirty(true); }}
                      />
                      {detailSendToGradebook ? "Sí" : "No"}
                    </label>
                  </div>

                </div>
              </section>

              <ResourceManager ownerType="task" ownerId={selectedTask.id} heading="Materiales y recursos" />

              <section className="detail-section">
                <div className="course-detail-header">
                  <div>
                    <h3>Instrumento de evaluación</h3>
                    <p className="hint">
                      {activeInstrumentKind === "rubric"
                        ? "Rúbrica asignada a esta tarea."
                        : activeInstrumentKind === "checklist"
                          ? "Lista de cotejo asignada a esta tarea."
                          : activeInstrumentKind === "direct"
                            ? "Nota directa asignada a esta tarea."
                            : "Sin instrumento de evaluación asignado."}
                      {evaluationDataCount > 0
                        ? ` Tiene ${evaluationDataCount} registros de evaluación.`
                        : ""}
                    </p>
                  </div>
                  <div className="actions-cell">
                    {showCreateRubricButton ? (
                      <IconButton
                        icon="rubric"
                        label="Crear rúbrica"
                        showLabel
                        className="instrument-rubric"
                        onClick={() => void createTaskRubric()}
                      />
                    ) : null}
                    {showCreateChecklistButton ? (
                      <IconButton
                        icon="checklist"
                        label="Crear lista de cotejo"
                        showLabel
                        className="instrument-checklist"
                        onClick={() => void createTaskChecklist()}
                      />
                    ) : null}
                    {showDirectGradeButton ? (
                      <IconButton
                        icon="assign"
                        label="Usar nota directa"
                        showLabel
                        onClick={() => void assignDirectGrade()}
                      />
                    ) : null}
                    {showGenerateRubricButton ? (
                      <IconButton
                        icon="ai"
                        label="Generar rúbrica con IA"
                        showLabel
                        className="instrument-rubric"
                        onClick={() => openAiInstrumentModal("rubric")}
                      />
                    ) : null}
                    {showGenerateChecklistButton ? (
                      <IconButton
                        icon="ai"
                        label="Generar lista de cotejo con IA"
                        showLabel
                        className="instrument-checklist"
                        onClick={() => openAiInstrumentModal("checklist")}
                      />
                    ) : null}
                    {showSaveInstrumentButton ? (
                      <IconButton
                        icon="save"
                        label="Guardar instrumento"
                        showLabel
                        className="save-attention"
                        onClick={() => void persistInstrument()}
                      />
                    ) : null}
                    {showDeleteEvaluationDataButton ? (
                      <IconButton
                        icon="remove"
                        label="Borrar datos de evaluación"
                        className="danger"
                        onClick={() => void deleteEvaluationData()}
                      />
                    ) : null}
                    {showDeleteInstrumentButton ? (
                      <IconButton
                        icon="delete"
                        label="Eliminar método de evaluación"
                        className="danger"
                        onClick={() => void deleteAssignedInstrument()}
                      />
                    ) : null}
                  </div>
                </div>

                {!selectedClassId || !selectedSubjectId ? (
                  <p className="hint">Selecciona curso y asignatura para crear o asignar instrumentos.</p>
                ) : null}

                {canChangeEvaluationMethod && (rubricTemplates.length > 0 || checklistTemplates.length > 0) ? (
                  <div className="instrument-reuse-panel">
                    <label className="detail-field compact-field">
                      <span>Copiar instrumento existente</span>
                      <select
                        className="input"
                        value={reusableInstrumentId}
                        onChange={(event) => setReusableInstrumentId(event.target.value)}
                      >
                        <option value="">Selecciona un instrumento</option>
                        {rubricTemplates
                          .filter((template) => template.id !== selectedRubricTemplate?.id)
                          .map((template) => (
                            <option key={template.id} value={`rubric:${template.id}`}>
                              Rúbrica · {template.name}
                            </option>
                          ))}
                        {checklistTemplates
                          .filter((template) => template.id !== selectedChecklistTemplate?.id)
                          .map((template) => (
                            <option key={template.id} value={`checklist:${template.id}`}>
                              Lista · {template.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="btn secondary"
                      disabled={!reusableInstrumentId}
                      onClick={() => void copySelectedInstrument()}
                    >
                      Copiar y asignar
                    </button>
                  </div>
                ) : null}

                {selectedRubricTemplate ? (
                  <div className="planner-list">
                    <div className="detail-grid">
                      <div className="detail-field full compact-field">
                    <label>Nombre de la rúbrica</label>
                        <input
                          className="input"
                          value={rubricName}
                          onChange={(event) => {
                            setRubricName(event.target.value);
                            setInstrumentDirty(true);
                          }}
                        />
                      </div>
                      <div className="detail-field full">
                        <label>Descripción</label>
                        <textarea
                          className="input"
                          rows={2}
                          value={rubricDescription}
                          onChange={(event) => {
                            setRubricDescription(event.target.value);
                            setInstrumentDirty(true);
                          }}
                        />
                      </div>
                    </div>

                    <div className="course-detail-header">
                      <h3>Criterios</h3>
                      <IconButton
                        icon="add"
                        label="Anadir criterio"
                        onClick={() => {
                          setRubricCriteria((current) => [
                            ...current,
                            {
                              id: crypto.randomUUID(),
                              name: `Criterio ${current.length + 1}`,
                              levels: [
                                { id: crypto.randomUUID(), name: "Conseguido", score: 2 },
                                { id: crypto.randomUUID(), name: "En proceso", score: 1 }
                              ]
                            }
                          ]);
                          setInstrumentDirty(true);
                        }}
                      />
                    </div>

                    {rubricCriteria.map((criterion, criterionIndex) => (
                      <article key={criterion.id} className="planner-card">
                        <div className="courses-list-row">
                          <input
                            className="input"
                            value={criterion.name}
                            onChange={(event) => {
                              const value = event.target.value;
                              setRubricCriteria((current) =>
                                current.map((item) => (item.id === criterion.id ? { ...item, name: value } : item))
                              );
                              setInstrumentDirty(true);
                            }}
                          />
                          <IconButton
                            icon="add"
                            label="Anadir nivel"
                            onClick={() => {
                              setRubricCriteria((current) =>
                                current.map((item) =>
                                  item.id === criterion.id
                                    ? {
                                        ...item,
                                        levels: [
                                          ...(item.levels ?? []),
                                          { id: crypto.randomUUID(), name: `Nivel ${(item.levels?.length ?? 0) + 1}`, score: 1 }
                                        ]
                                      }
                                    : item
                                )
                              );
                              setInstrumentDirty(true);
                            }}
                          />
                          <IconButton
                            icon="delete"
                            label="Eliminar criterio"
                            disabled={rubricCriteria.length <= 1}
                            onClick={() => {
                              setRubricCriteria((current) => current.filter((_, index) => index !== criterionIndex));
                              setInstrumentDirty(true);
                            }}
                          />
                        </div>
                        <div className="planner-list">
                          {(criterion.levels ?? []).map((level, levelIndex) => (
                            <div key={level.id} className="courses-list-row">
                              <input
                                className="input"
                                value={level.name}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setRubricCriteria((current) =>
                                    current.map((item) =>
                                      item.id === criterion.id
                                        ? {
                                            ...item,
                                            levels: (item.levels ?? []).map((levelItem) =>
                                              levelItem.id === level.id ? { ...levelItem, name: value } : levelItem
                                            )
                                          }
                                        : item
                                    )
                                  );
                                  setInstrumentDirty(true);
                                }}
                              />
                              <input
                                className="input"
                                type="number"
                                step={0.1}
                                value={level.score}
                                onChange={(event) => {
                                  const score = Number(event.target.value);
                                  setRubricCriteria((current) =>
                                    current.map((item) =>
                                      item.id === criterion.id
                                        ? {
                                            ...item,
                                            levels: (item.levels ?? []).map((levelItem) =>
                                              levelItem.id === level.id ? { ...levelItem, score } : levelItem
                                            )
                                          }
                                        : item
                                    )
                                  );
                                  setInstrumentDirty(true);
                                }}
                              />
                              <IconButton
                                icon="delete"
                                label="Eliminar nivel"
                                disabled={(criterion.levels?.length ?? 0) <= 2}
                                onClick={() => {
                                  setRubricCriteria((current) =>
                                    current.map((item) =>
                                      item.id === criterion.id
                                        ? { ...item, levels: (item.levels ?? []).filter((_, index) => index !== levelIndex) }
                                        : item
                                    )
                                  );
                                  setInstrumentDirty(true);
                                }}
                              />
                            </div>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}

                {selectedChecklistTemplate ? (
                  <div className="planner-list">
                    <div className="detail-grid">
                      <div className="detail-field full compact-field">
                        <label>Nombre de la lista</label>
                        <input
                          className="input"
                          value={checklistName}
                          onChange={(event) => {
                            setChecklistName(event.target.value);
                            setInstrumentDirty(true);
                          }}
                        />
                      </div>
                      <div className="detail-field full">
                        <label>Descripción</label>
                        <textarea
                          className="input"
                          rows={2}
                          value={checklistDescription}
                          onChange={(event) => {
                            setChecklistDescription(event.target.value);
                            setInstrumentDirty(true);
                          }}
                        />
                      </div>
                    </div>
                    <div className="course-detail-header">
                      <h3>Items</h3>
                      <IconButton
                        icon="add"
                        label="Anadir item"
                        onClick={() => {
                          setChecklistItems((current) => [
                            ...current,
                            { id: crypto.randomUUID(), text: `Item ${current.length + 1}` }
                          ]);
                          setInstrumentDirty(true);
                        }}
                      />
                    </div>
                    {checklistItems.map((item, index) => (
                      <div key={item.id} className="courses-list-row">
                        <input
                          className="input"
                          value={item.text}
                          onChange={(event) => {
                            const value = event.target.value;
                            setChecklistItems((current) =>
                              current.map((currentItem) =>
                                currentItem.id === item.id ? { ...currentItem, text: value } : currentItem
                              )
                            );
                            setInstrumentDirty(true);
                          }}
                        />
                        <IconButton
                          icon="delete"
                          label="Eliminar item"
                          onClick={() => {
                            setChecklistItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
                            setInstrumentDirty(true);
                          }}
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
              </section>
            </>
          ) : (
            <p className="empty-state">
              {selectedSubjectId ? "Selecciona o crea una tarea." : "Selecciona una asignatura en el panel izquierdo."}
            </p>
          )}
        </section>
      </div>
      <Modal
        open={isAIModalOpen}
      title={aiInstrumentKind === "rubric" ? "Generar rúbrica con IA" : "Generar lista de cotejo con IA"}
        onClose={() => {
          if (!isGeneratingAI) {
            setIsAIModalOpen(false);
          }
        }}
      >
        <div className="detail-grid">
          <div className="detail-field full">
            <label>Que quieres generar</label>
            <textarea
              className="input"
              rows={5}
              placeholder={
                aiInstrumentKind === "rubric"
              ? "Ej: Rúbrica para resolver problemas con ecuaciones de primer grado."
                  : "Ej: Lista de cotejo para una exposicion oral sobre ecosistemas."
              }
              value={aiPrompt}
              onChange={(event) => setAiPrompt(event.target.value)}
            />
          </div>
        </div>
        {aiStatus ? <p className="hint">{aiStatus}</p> : null}
        <div className="actions-cell">
          <NavLink className="btn secondary" to="/config/ai" onClick={() => setIsAIModalOpen(false)}>
            Configurar IA
          </NavLink>
          <button
            type="button"
            className="btn secondary"
            disabled={isGeneratingAI}
            onClick={() => setIsAIModalOpen(false)}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn secondary"
            disabled={isGeneratingAI}
            onClick={() => void generateInstrumentWithAI()}
          >
            {isGeneratingAI ? "Generando..." : "Generar"}
          </button>
        </div>
      </Modal>
    </article>
  );
}
