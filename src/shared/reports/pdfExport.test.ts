import { afterEach, describe, expect, it, vi } from "vitest";
import { exportPdfInWorker } from "./pdfExport";
import type { SavedAiReport } from "./aiReportArchive";

class FakeWorker {
  static current: FakeWorker;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { FakeWorker.current = this; }
}
const report: SavedAiReport = { id: "version", reportId: "report", classId: "class", title: "Synthetic report", text: "Synthetic text", context: "Synthetic context", provider: "ollama", model: "local", createdAt: "2026-10-11T12:00:00Z" };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("PDF worker lifecycle", () => {
  it("terminates the worker after receiving a PDF", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const result = exportPdfInWorker(report);
    const blob = new Blob(["%PDF-"], { type: "application/pdf" });
    FakeWorker.current.onmessage!({ data: { blob } } as MessageEvent);
    await expect(result).resolves.toBe(blob);
    expect(FakeWorker.current.terminate).toHaveBeenCalledOnce();
    expect(FakeWorker.current.postMessage).toHaveBeenCalledWith(report);
  });
  it("cancels pending work when the report workspace unmounts", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const controller = new AbortController();
    const result = exportPdfInWorker(report, controller.signal);
    controller.abort();
    await expect(result).rejects.toThrow(/cancelada/);
    expect(FakeWorker.current.terminate).toHaveBeenCalledOnce();
  });
  it("does not start work for an already aborted request", async () => {
    const constructor = vi.fn();
    vi.stubGlobal("Worker", constructor);
    const controller = new AbortController(); controller.abort();
    await expect(exportPdfInWorker(report, controller.signal)).rejects.toThrow(/cancelada/);
    expect(constructor).not.toHaveBeenCalled();
  });
  it.each(["error", "messageerror", "invalid", "reported"])("cleans up after %s", async kind => {
    vi.stubGlobal("Worker", FakeWorker);
    const result = exportPdfInWorker(report);
    if (kind === "error") FakeWorker.current.onerror!();
    else if (kind === "messageerror") FakeWorker.current.onmessageerror!();
    else FakeWorker.current.onmessage!({ data: kind === "reported" ? { error: "Unsupported glyph" } : { blob: "invalid" } } as MessageEvent);
    await expect(result).rejects.toThrow();
    expect(FakeWorker.current.terminate).toHaveBeenCalledOnce();
  });
  it("terminates stalled exports and preserves the retry path", async () => {
    vi.useFakeTimers(); vi.stubGlobal("Worker", FakeWorker);
    const result = exportPdfInWorker(report);
    const assertion = expect(result).rejects.toThrow(/tiempo de espera/);
    await vi.advanceTimersByTimeAsync(120_000);
    await assertion;
    expect(FakeWorker.current.terminate).toHaveBeenCalledOnce();
  });
});
