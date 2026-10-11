import { useEffect, useRef, useState } from "react";
import { liveQuery } from "dexie";
import { db } from "../../shared/db/database";
import { type SavedAiReport, printableAiReport } from "../../shared/reports/aiReportArchive";
import { Modal } from "../../shared/ui/Modal";
import { useUnsavedChangesGuard } from "../../shared/hooks/useUnsavedChangesGuard";
import type { ReportDocumentFormat } from "../../shared/reports/reportDocuments";

function download(report: SavedAiReport, html: boolean) {
  const url = URL.createObjectURL(new Blob([html ? printableAiReport(report) : `${report.title}\n${report.context}\n\n${report.text}`], { type: html ? "text/html;charset=utf-8" : "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `edunoza-informe-${report.createdAt.slice(0, 10)}.${html ? "html" : "txt"}`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function AiReportWorkspace({ generated, classId }: { generated: SavedAiReport | null; classId: string | null }) {
  const [history, setHistory] = useState<SavedAiReport[]>([]);
  const [editor, setEditor] = useState<SavedAiReport | null>(null);
  const [baseline, setBaseline] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportLock = useRef(false);
  const exportController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; exportController.current?.abort(); }; }, []);
  const dirty = Boolean(editor && JSON.stringify([editor.title, editor.text]) !== baseline);
  useUnsavedChangesGuard(dirty, "El informe tiene cambios sin guardar en el historial.");
  useEffect(() => {
    const subscription = liveQuery(() => db.aiReports.where("classId").equals(classId ?? "").reverse().sortBy("createdAt")).subscribe({ next: setHistory, error: () => setStatus("No se pudo leer el historial local. Recarga la página para volver a intentarlo.") });
    return () => subscription.unsubscribe();
  }, [classId]);
  useEffect(() => {
    if (generated) { setEditor(generated); setBaseline(""); setStatus("Borrador generado. Revísalo y guarda una versión."); }
  }, [generated]);
  const close = () => {
    if (saving || exporting || (dirty && !window.confirm("¿Cerrar sin guardar los cambios del informe?"))) return;
    setEditor(null);
  };
  const save = async () => {
    if (!editor || saving || !editor.title.trim() || !editor.text.trim()) return;
    setSaving(true);
    try {
      const version = { ...editor, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
      await db.aiReports.add(version);
      setEditor(version);
      setBaseline(JSON.stringify([version.title, version.text]));
      setStatus("Versión guardada en este navegador. Incluida en las próximas copias de seguridad.");
    } catch { setStatus("No se pudo guardar. Conserva el texto descargándolo y vuelve a intentarlo."); }
    finally { setSaving(false); }
  };
  const exportDocument = async (format: ReportDocumentFormat) => {
    if (!editor || exportLock.current) return;
    exportLock.current = true;
    const controller = new AbortController();
    exportController.current = controller;
    setExporting(true);
    setStatus(`Preparando ${format.toUpperCase()} en este dispositivo…`);
    try {
      const { createReportDocument } = await import("../../shared/reports/reportDocuments");
      const blob = await createReportDocument(editor, format, controller.signal);
      if (!mounted.current) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `edunoza-informe-${editor.createdAt.slice(0, 10)}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setStatus(`Descarga ${format.toUpperCase()} preparada con el texto actual. No se ha guardado una nueva versión.`);
    } catch (error) {
      if (mounted.current) setStatus(error instanceof Error ? `No se pudo exportar: ${error.message}` : "No se pudo exportar. Inténtalo de nuevo; el texto se conserva.");
    } finally {
      exportLock.current = false;
      exportController.current = null;
      if (mounted.current) setExporting(false);
    }
  };
  return <section className="detail-section" aria-label="Historial de informes IA">
    <h2>Historial de informes IA</h2>
    <p className="hint">Versiones del grupo seleccionado, guardadas solo en este navegador. Cada guardado conserva la versión anterior. No se envían a la IA al abrirlas.</p>
    {history.length === 0 ? <p>Aún no hay informes guardados para este grupo.</p> : <ul>{history.map(report => <li key={report.id}>
      <button type="button" className="btn secondary" onClick={() => { setEditor(report); setBaseline(JSON.stringify([report.title, report.text])); setStatus("Versión guardada. Puedes editarla y guardar una nueva versión."); }}>{report.title} · {new Date(report.createdAt).toLocaleString("es-ES")}</button>
      <button type="button" className="btn secondary" aria-label={`Eliminar versión de ${report.title}`} onClick={async () => {
        if (!window.confirm("¿Eliminar esta versión del historial? Las otras versiones se conservarán.")) return;
        try { await db.aiReports.delete(report.id); setStatus("Versión eliminada."); } catch { setStatus("No se pudo eliminar la versión. Inténtalo de nuevo."); }
      }}>Eliminar versión</button>
    </li>)}</ul>}
    <p role="status">{status}</p>
    <Modal open={editor !== null} title="Revisar y editar informe IA" onClose={close}>
      {editor && <div className="ai-report-editor">
        <p className="hint">{editor.context}</p>
        <p>La IA puede equivocarse. Comprueba las evidencias antes de compartir. Descargar no guarda una versión en el historial.</p>
        <label className="compact-field" htmlFor="ai-report-title"><span>Título del informe</span>
          <input className="input" id="ai-report-title" value={editor.title} maxLength={300} disabled={saving} onChange={event => setEditor({ ...editor, title: event.target.value })} />
        </label>
        <label htmlFor="ai-report-content">Contenido del informe</label>
        <textarea id="ai-report-content" rows={16} value={editor.text} maxLength={200_000} disabled={saving} onChange={event => setEditor({ ...editor, text: event.target.value })} />
        <p role="status">{status}</p>
        <div className="actions-cell">
          <button type="button" className="btn" disabled={saving || !dirty || !editor.title.trim() || !editor.text.trim()} onClick={() => void save()}>{saving ? "Guardando…" : "Guardar versión"}</button>
          <button type="button" className="btn secondary" onClick={() => download(editor, false)}>Descargar TXT</button>
          <button type="button" className="btn secondary" onClick={() => download(editor, true)}>Descargar HTML imprimible</button>
          <button type="button" className="btn secondary" disabled={exporting || !editor.title.trim() || !editor.text.trim()} onClick={() => void exportDocument("docx")}>Descargar Word</button>
          <button type="button" className="btn secondary" disabled={exporting || !editor.title.trim() || !editor.text.trim()} onClick={() => void exportDocument("odt")}>Descargar ODT</button>
          <button type="button" className="btn secondary" disabled={exporting || !editor.title.trim() || !editor.text.trim()} onClick={() => void exportDocument("pdf")}>Descargar PDF</button>
          <button type="button" className="btn secondary" onClick={async () => { try { await navigator.clipboard.writeText(editor.text); setStatus("Texto copiado."); } catch { setStatus("No se pudo copiar. Selecciona el texto o descarga el informe."); } }}>Copiar</button>
        </div>
        <p className="hint">Word (.docx) y ODT son editables. PDF se descarga directamente, listo para imprimir. Todos los formatos se generan en este dispositivo.</p>
      </div>}
    </Modal>
  </section>;
}
