import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { createDocx, createOdt, createPdf, reportParagraphs, wrapReportLine } from "./reportDocuments";
import type { SavedAiReport } from "./aiReportArchive";

const report: SavedAiReport = { id: "version", reportId: "report", classId: "class", title: "Informe de avaliación", text: "Lucía, Íñigo e Antón: evolución positiva.\nTexto <script> & contido editable.\n\nPróximos pasos: revisión da aprendizaxe.", context: "Grupo 3 ESO A\nCurso 2026-2027", provider: "ollama", model: "simulated", createdAt: "2026-09-08T12:00:00Z" };

describe("native report documents", () => {
  it("measures ordinary text by word while retaining long-word wrapping", () => {
    const measure = vi.fn((text: string) => text.length);
    const text = "ordinary words ".repeat(20);
    const lines = wrapReportLine(text, 60, measure);
    expect(lines.every(line => line.length <= 60)).toBe(true);
    expect(lines.join("").replace(/ /g, "")).toBe(text.replace(/ /g, ""));
    expect(measure.mock.calls.length).toBeLessThan(70);
  });
  it("creates genuine DOCX with escaped editable paragraphs and A4 layout", async () => {
    const blob = await createDocx(report);
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const xml = strFromU8(files["word/document.xml"]);
    expect(files["[Content_Types].xml"]).toBeDefined();
    expect(xml).toContain("Lucía, Íñigo e Antón");
    expect(xml).toContain("&lt;script&gt; &amp;");
    expect(xml).toContain('w:pStyle w:val="Title"');
    expect(xml).toContain('w:w="11906"');
    expect(xml).toContain("Grupo 3 ESO A");
    expect(xml).not.toContain("<script>");
  });

  it("creates a valid ODT package with first uncompressed mimetype and escaped text", async () => {
    const blob = await createOdt(report);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const header = new DataView(bytes.buffer);
    expect(header.getUint32(0, true)).toBe(0x04034b50);
    expect(header.getUint16(8, true)).toBe(0);
    expect(strFromU8(bytes.slice(30, 38))).toBe("mimetype");
    const files = unzipSync(bytes);
    expect(strFromU8(files.mimetype)).toBe("application/vnd.oasis.opendocument.text");
    expect(strFromU8(files["content.xml"])).toContain("Lucía, Íñigo e Antón");
    expect(strFromU8(files["content.xml"])).toContain("&lt;script&gt; &amp;");
    expect(files["styles.xml"]).toBeDefined();
    expect(files["META-INF/manifest.xml"]).toBeDefined();
  });

  it("wraps long words and preserves blank lines", () => {
    const text = "Supercalifragilístico ".repeat(5);
    const lines = wrapReportLine(text, 15, line => line.length);
    expect(lines.every(line => line.length <= 15)).toBe(true);
    expect(lines.join("").replace(/ /g, "")).toBe(text.replace(/ /g, ""));
    expect(wrapReportLine("", 15, line => line.length)).toEqual([""]);
    expect(reportParagraphs(report)).toContain("");
  });

  it("creates a multipage PDF with embedded font and correct metadata", async () => {
    const font = new Uint8Array(await readFile("public/fonts/NotoSans-Regular.ttf"));
    const blob = await createPdf({ ...report, text: report.text.repeat(40) }, font);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(strFromU8(bytes.slice(0, 5))).toBe("%PDF-");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getTitle()).toBe(report.title);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    expect(pdf.getPage(0).getWidth()).toBeCloseTo(595.28);
  }, 20_000);

  it("refuses empty reports and XML control characters without losing the original text", async () => {
    await expect(createDocx({ ...report, text: "" })).rejects.toThrow(/contenido/);
    await expect(createOdt({ ...report, text: "invalid\u0001" })).rejects.toThrow(/control/);
  });

  it("reports a font download failure with a retryable explanation", async () => {
    const mock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 503 }));
    try { await expect(createPdf(report)).rejects.toThrow(/fuente/); } finally { mock.mockRestore(); }
  });
});
