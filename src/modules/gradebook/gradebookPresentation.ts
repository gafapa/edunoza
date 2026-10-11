import type { Assessment, TaskGradebookConfig, GradebookGroup } from "../../shared/db/types";
import type { ManualAssessmentDraft } from "../../shared/gradebook/manualAssessments";
import { taskSubjectKey } from "../../shared/gradebook/calculations";

export type IncludedTaskRow = {
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

export type OrderedGroupRow = {
  id: string;
  name: string;
  depth: number;
  pathLabel: string;
  treeLabel: string;
};

export type GradebookTableColumn = {
  key: string;
  title: string;
  meta: string;
  kind: "group" | "assessment" | "task" | "final";
  sourceId: string;
};

export type GradebookMatrixHeaderCell = {
  key: string;
  title: string;
  kind: "root" | "group" | "assessment" | "task" | "final" | "empty";
  colSpan: number;
  rowSpan?: number;
};

export function taskConfigKey(taskId: string, subjectId: string): string {
  return taskSubjectKey(taskId, subjectId);
}

export function defaultTaskGradebookConfigId(taskId: string, subjectId: string, classId: string): string {
  return `task-config-${taskId}-${subjectId}-${classId}`;
}

export function studentGroupKey(studentId: string, groupId: string): string {
  return `${studentId}:${groupId}`;
}

export function formatWeightDraft(value: number): string {
  return Number(value ?? 0).toString();
}

export function parseWeight(rawValue: string): number | null {
  const normalized = rawValue.replace(",", ".").trim();
  if (normalized.length === 0) {
    return 0;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Number(parsed.toFixed(2));
}

export function formatContribution(share: number): string {
  return `${(Math.max(0, share) * 100).toFixed(2)}%`;
}

export function formatGradeValue(value: number | null | undefined): string {
  return typeof value === "number" ? value.toFixed(2) : "";
}

export function assessmentDraftFromRow(assessment: Assessment): ManualAssessmentDraft {
  return {
    title: assessment.title,
    weight: formatWeightDraft(Number(assessment.weight ?? 0)),
    period: assessment.period ?? "",
    competency: assessment.competency ?? "",
    groupId: assessment.groupId ?? ""
  };
}

export function isMeaningfulTaskGradebookConfig(config: TaskGradebookConfig): boolean {
  return (
    Number(config.gradebookWeight ?? 0) > 0 ||
    Boolean(config.groupId) ||
    Boolean(config.rubricTemplateId) ||
    Boolean(config.checklistTemplateId) ||
    Boolean(config.directGradeEnabled)
  );
}

export function buildOrderedGroupRows(groups: GradebookGroup[]): OrderedGroupRow[] {
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
