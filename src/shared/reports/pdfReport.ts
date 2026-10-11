import type { SavedAiReport } from "./aiReportArchive";
import { reportParagraphs, validateReport } from "./reportDocumentContent";

export function wrapReportLine(text: string, width: number, measure: (text: string) => number): string[] {
  if (!text) return [""];
  const lines: string[] = [];
  let line = "";
  for (const token of text.replace(/\t/g, "    ").match(/\S+\s*|\s+/gu) ?? []) {
    if (measure(line + token) <= width) { line += token; continue; }
    if (line) { lines.push(line.trimEnd()); line = ""; }
    if (measure(token) <= width) { line = token; continue; }
    // Long URLs and words must also wrap without exceeding the page width.
    for (const character of token) {
      if (line && measure(line + character) > width) { lines.push(line.trimEnd()); line = ""; }
      line += character;
    }
  }
  if (line) lines.push(line.trimEnd());
  return lines;
}

export async function createPdf(report: SavedAiReport, fontBytes?: Uint8Array): Promise<Blob> {
  validateReport(report);
  const [{ PDFDocument, PageSizes, rgb }, { default: fontkit }] = await Promise.all([import("pdf-lib"), import("@pdf-lib/fontkit")]);
  if (!fontBytes) {
    const response = await fetch(`${import.meta.env.BASE_URL}fonts/NotoSans-Regular.ttf`);
    if (!response.ok) throw new Error("No se pudo cargar la fuente del PDF. Comprueba la conexión e inténtalo de nuevo.");
    fontBytes = new Uint8Array(await response.arrayBuffer());
  }
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  document.setTitle(report.title);
  document.setAuthor("Edunoza");
  document.setLanguage("es-ES");
  const font = await document.embedFont(fontBytes, { subset: true });
  const supported = new Set(font.getCharacterSet());
  const paragraphs = reportParagraphs(report);
  if (paragraphs.some(text => Array.from(text).some(char => char !== "\t" && !supported.has(char.codePointAt(0)!)))) {
    throw new Error("El PDF contiene símbolos que la fuente no puede representar. Usa Word u ODT, o elimina esos símbolos.");
  }
  const margin = 56.7;
  const widthCache = new Map<string, number>();
  let page = document.addPage(PageSizes.A4);
  let y = page.getHeight() - margin;
  for (const [index, paragraph] of paragraphs.entries()) {
    const size = index === 0 ? 18 : 11;
    const lineHeight = size * 1.4;
    const lines = wrapReportLine(paragraph, page.getWidth() - margin * 2, text => {
      const key = `${size}:${text}`;
      let width = widthCache.get(key);
      if (width === undefined) { width = font.widthOfTextAtSize(text, size); widthCache.set(key, width); }
      return width;
    });
    for (const line of lines) {
      if (y - lineHeight < margin) { page = document.addPage(PageSizes.A4); y = page.getHeight() - margin; }
      y -= lineHeight;
      page.drawText(line, { x: margin, y, size, font, color: rgb(0, 0, 0) });
    }
    y -= 6;
  }
  for (const [index, item] of document.getPages().entries()) {
    item.drawText(`${index + 1} / ${document.getPageCount()}`, { x: margin, y: 28, size: 9, font });
  }
  return new Blob([new Uint8Array(await document.save())], { type: "application/pdf" });
}
