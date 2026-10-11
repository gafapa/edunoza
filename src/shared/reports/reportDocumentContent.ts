import type { SavedAiReport } from "./aiReportArchive";

export const REPORT_REVIEW_NOTICE = "Informe elaborado con asistencia de IA. Requiere revisión docente.";

export function reportParagraphs(report: SavedAiReport): string[] {
  return [report.title, ...report.context.split(/\r?\n/), `${report.provider} · ${report.model} · ${new Date(report.createdAt).toLocaleString("es-ES")}`, REPORT_REVIEW_NOTICE, "", ...report.text.split(/\r?\n/)];
}

export function validateReport(report: SavedAiReport) {
  if (!report.title.trim() || !report.text.trim()) throw new Error("Escribe un título y contenido antes de descargar.");
  if (report.title.length > 300 || report.text.length > 200_000 || report.context.length > 10_000) throw new Error("El informe supera el tamaño admitido para exportar.");
  // XML 1.0 forbids these controls; do not silently corrupt an Office package.
  if (reportParagraphs(report).some(text => Array.from(text).some(char => { const code = char.codePointAt(0)!; return (code < 32 && code !== 9) || (code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff; }))) {
    throw new Error("El informe contiene caracteres de control no admitidos. Elimínalos antes de exportar.");
  }
}

