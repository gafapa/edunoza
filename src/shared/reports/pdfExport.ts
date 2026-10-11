import type { SavedAiReport } from "./aiReportArchive";

/** PDF generation stays on this device, in a same-origin module worker. */
export function exportPdfInWorker(report: SavedAiReport, signal?: AbortSignal): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("Exportación cancelada.")); return; }
    let worker: Worker;
    try { worker = new Worker(new URL("./pdfExport.worker.ts", import.meta.url), { type: "module" }); }
    catch { reject(new Error("No se pudo iniciar la exportación de PDF. Recarga la aplicación e inténtalo de nuevo.")); return; }
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); worker.terminate(); };
    const fail = (message: string) => { cleanup(); reject(new Error(message)); };
    const abort = () => fail("Exportación cancelada.");
    const timer = setTimeout(() => fail("La exportación de PDF agotó el tiempo de espera. El texto se conserva; puedes descargar Word u ODT."), 120_000);
    worker.onmessage = (event: MessageEvent<unknown>) => {
      const result = event.data as { blob?: unknown; error?: unknown } | null;
      if (result?.blob instanceof Blob && result.blob.type === "application/pdf") { cleanup(); resolve(result.blob); }
      else fail(typeof result?.error === "string" ? result.error : "La exportación de PDF devolvió una respuesta no válida.");
    };
    worker.onerror = () => fail("No se pudo generar el PDF. El texto se conserva; puedes descargar Word u ODT.");
    worker.onmessageerror = () => fail("No se pudo recibir el PDF generado.");
    signal?.addEventListener("abort", abort, { once: true });
    try { worker.postMessage(report); } catch { fail("No se pudo preparar el informe para exportar."); }
  });
}
