import { createPdf } from "./pdfReport";
import type { SavedAiReport } from "./aiReportArchive";

globalThis.addEventListener("message", async (event: MessageEvent<SavedAiReport>) => {
  try { globalThis.postMessage({ blob: await createPdf(event.data) }); }
  catch (error) { globalThis.postMessage({ error: error instanceof Error ? error.message : "No se pudo generar el PDF." }); }
});
