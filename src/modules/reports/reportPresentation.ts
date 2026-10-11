import type { Assessment, AttendanceEntry } from "../../shared/db/types";
import { buildCsv } from "../../shared/export/csv";
import { toLocalIsoDate } from "../../shared/utils/date";

export type ReportTaskRow = {
  taskId: string;
  subjectId: string;
  subjectName: string;
  title: string;
  gradebookWeight: number;
  groupId?: string;
  rubricTemplateId?: string;
  checklistTemplateId?: string;
  directGradeEnabled?: boolean;
};

export type ReportItem = {
  key: string;
  type: "assessment" | "task";
  sourceId: string;
  subjectId: string;
  subjectName: string;
  title: string;
  period?: string;
  competency?: string;
  contribution: number;
  weight: number;
};

export type AttendanceSummary = {
  present: number;
  late: number;
  absent: number;
  total: number;
  rate: number | null;
};

export type AiReportKind =
  | "tutorial"
  | "reinforcement"
  | "families"
  | "attendance"
  | "recovery"
  | "taskAnalysis"
  | "riskMap"
  | "acsSupport"
  | "subjectDiagnosis";

export type ReportIntent = "assessment" | "families" | "attendance" | "data";
export type ReportViewState = "no-group" | "loading" | "no-students" | "ready";

export function resolveReportViewState(
  selectedClassId: string | null,
  loadedClassId: string | undefined,
  studentCount: number | undefined
): ReportViewState {
  if (!selectedClassId) return "no-group";
  if (loadedClassId !== selectedClassId || studentCount === undefined) return "loading";
  return studentCount === 0 ? "no-students" : "ready";
}

export const REPORT_INTENTS: Array<{ id: ReportIntent; label: string; description: string }> = [
  { id: "assessment", label: "Evaluación", description: "Calificaciones, tareas y recuperación" },
  { id: "families", label: "Tutoría y familias", description: "Seguimiento y comunicación individual" },
  { id: "attendance", label: "Asistencia", description: "Presencia, retrasos y posibles patrones" },
  { id: "data", label: "Datos", description: "Detalle, análisis y tratamiento externo" }
];

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadCsv(filename: string, rows: string[][]): void {
  const content = buildCsv(rows);
  downloadBlob(filename, new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" }));
}

export function downloadHtml(filename: string, html: string): void {
  downloadBlob(filename, new Blob(["\uFEFF" + html], { type: "text/html;charset=utf-8;" }));
}

export function formatDate(): string {
  return toLocalIsoDate();
}

export function studentSubjectKey(studentId: string, subjectId: string): string {
  return `${studentId}:${subjectId}`;
}

export function formatOptionalNumber(value: number | null | undefined): string {
  return typeof value === "number" ? value.toFixed(2) : "";
}

export function formatOptionalPercent(value: number | null | undefined): string {
  return typeof value === "number" ? `${value.toFixed(0)}%` : "";
}

export function instrumentLabel(task: ReportTaskRow): string {
  if (task.rubricTemplateId) return "Rúbrica";
  if (task.checklistTemplateId) return "Lista de cotejo";
  if (task.directGradeEnabled) return "Nota directa";
  return "Sin método";
}

export function formatAttendanceRate(rate: number | null): string {
  return rate === null ? "Sin datos" : `${rate}%`;
}

export function attendanceRiskLabel(rate: number | null): string {
  if (rate === null) return "Sin datos";
  return rate < 90 ? `Revisar asistencia: ${rate}% registrado` : `Asistencia registrada: ${rate}%`;
}

export function formatAttendanceCounts(summary: AttendanceSummary): string {
  if (summary.total === 0) return "Sin datos de asistencia";
  return `${summary.present} presentes, ${summary.late} retrasos, ${summary.absent} ausencias`;
}

export function joinUnique(values: Array<string | undefined>): string {
  const seen = new Set<string>();
  const cleanValues: string[] = [];
  for (const value of values) {
    const clean = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    cleanValues.push(clean);
  }
  return cleanValues.join(" | ");
}

export function csvPreview(rows: string[][], maxRows: number): string {
  return rows
    .slice(0, maxRows)
    .map((row) => row.map((cell) => String(cell).replace(/\s+/g, " ").trim()).join("; "))
    .join("\n");
}

export function calculateAttendanceSummary(attendance: AttendanceEntry[], studentId: string): AttendanceSummary {
  const rows = attendance.filter((entry) => entry.studentId === studentId);
  const present = rows.filter((entry) => entry.status === "present").length;
  const late = rows.filter((entry) => entry.status === "late").length;
  const absent = rows.filter((entry) => entry.status === "absent").length;
  const total = present + late + absent;
  const rate = total > 0 ? Math.round(((present + late) / total) * 100) : null;
  return { present, late, absent, total, rate };
}

export function isDateInRange(date: string | undefined, start: string, end: string): boolean {
  if (!date) return true;
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

export function isAssessmentInReportRange(
  assessment: Pick<Assessment, "assessmentDate">,
  start: string,
  end: string
): boolean {
  if (!start && !end) return true;
  return Boolean(assessment.assessmentDate) && isDateInRange(assessment.assessmentDate, start, end);
}

