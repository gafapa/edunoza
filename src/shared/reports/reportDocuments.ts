import type { SavedAiReport } from "./aiReportArchive";

export type ReportDocumentFormat = "docx" | "odt" | "pdf";
export { REPORT_REVIEW_NOTICE, reportParagraphs } from "./reportDocumentContent";
import { reportParagraphs, validateReport } from "./reportDocumentContent";
export { createPdf, wrapReportLine } from "./pdfReport";
import { exportPdfInWorker } from "./pdfExport";

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

export async function createReportDocument(report: SavedAiReport, format: ReportDocumentFormat, signal?: AbortSignal): Promise<Blob> {
  if (format === "docx") return createDocx(report);
  if (format === "odt") return createOdt(report);
  validateReport(report);
  return exportPdfInWorker(report, signal);
}
