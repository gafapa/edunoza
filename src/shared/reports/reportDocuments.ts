import type { SavedAiReport } from "./aiReportArchive";

export type ReportDocumentFormat = "docx" | "odt" | "pdf";
export const REPORT_REVIEW_NOTICE = "Informe elaborado con asistencia de IA. Requiere revisión docente.";

export function reportParagraphs(report: SavedAiReport): string[] {
  return [report.title, ...report.context.split(/\r?\n/), `${report.provider} · ${report.model} · ${new Date(report.createdAt).toLocaleString("es-ES")}`, REPORT_REVIEW_NOTICE, "", ...report.text.split(/\r?\n/)];
}

function validateReport(report: SavedAiReport) {
  if (!report.title.trim() || !report.text.trim()) throw new Error("Escribe un título y contenido antes de descargar.");
  if (report.title.length > 300 || report.text.length > 200_000 || report.context.length > 10_000) throw new Error("El informe supera el tamaño admitido para exportar.");
  // XML 1.0 forbids these controls; do not silently corrupt an Office package.
  if (reportParagraphs(report).some(text => Array.from(text).some(char => { const code = char.codePointAt(0)!; return (code < 32 && code !== 9) || (code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff; }))) {
    throw new Error("El informe contiene caracteres de control no admitidos. Elimínalos antes de exportar.");
  }
}

function xmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export async function createDocx(report: SavedAiReport): Promise<Blob> {
  validateReport(report);
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");
  const document = new Document({
    creator: "Edunoza", title: report.title,
    styles: { default: { document: { run: { font: "Arial", size: 22, color: "000000" }, paragraph: { spacing: { after: 120, line: 300 } } } }, paragraphStyles: [{ id: "Title", name: "Title", basedOn: "Normal", next: "Normal", run: { size: 36, bold: true, color: "000000" }, paragraph: { spacing: { after: 240 }, keepNext: true } }] },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } }, children: reportParagraphs(report).map((text, index) => new Paragraph({ ...(index === 0 ? { heading: HeadingLevel.TITLE } : {}), children: [new TextRun(text)] })) }]
  });
  return Packer.toBlob(document);
}

export async function createOdt(report: SavedAiReport): Promise<Blob> {
  validateReport(report);
  const { zipSync, strToU8 } = await import("fflate");
  const mime = "application/vnd.oasis.opendocument.text";
  const namespaces = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"';
  const paragraphs = reportParagraphs(report).map((text, index) => `<text:p text:style-name="${index === 0 ? "Title" : "Body"}">${xmlText(text).replace(/\t/g, "<text:tab/>").replace(/ {2,}/g, spaces => `<text:s text:c="${spaces.length}"/>`)}</text:p>`).join("");
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${namespaces} office:version="1.3"><office:body><office:text>${paragraphs}</office:text></office:body></office:document-content>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${namespaces} office:version="1.3"><office:styles><style:style style:name="Body" style:family="paragraph" style:master-page-name="Standard"><style:paragraph-properties fo:margin-bottom="0.2cm" fo:line-height="125%"/><style:text-properties fo:font-family="Arial" fo:font-size="11pt" fo:color="#000000"/></style:style><style:style style:name="Title" style:family="paragraph" style:parent-style-name="Body"><style:paragraph-properties fo:keep-with-next="always" fo:margin-bottom="0.4cm"/><style:text-properties fo:font-size="18pt" fo:font-weight="bold"/></style:style></office:styles><office:automatic-styles><style:page-layout style:name="A4"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" fo:margin="2cm" style:print-orientation="portrait"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="A4"/></office:master-styles></office:document-styles>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="${mime}" manifest:version="1.3"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/></manifest:manifest>`;
  // ODF requires the first ZIP entry to be the uncompressed mimetype file.
  const bytes = zipSync({ mimetype: [strToU8(mime), { level: 0 }], "content.xml": strToU8(content), "styles.xml": strToU8(styles), "META-INF/manifest.xml": strToU8(manifest) });
  return new Blob([new Uint8Array(bytes)], { type: mime });
}

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

export async function createReportDocument(report: SavedAiReport, format: ReportDocumentFormat): Promise<Blob> {
  if (format === "docx") return createDocx(report);
  if (format === "odt") return createOdt(report);
  return createPdf(report);
}
