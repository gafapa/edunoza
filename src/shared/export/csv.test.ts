import { describe, expect, it } from "vitest";
import { buildCsv, sanitizeSpreadsheetCell } from "./csv";

describe("CSV export", () => {
  it.each(["=1+1", "+SUM(A1:A2)", "-2+3", "@IMPORTDATA('https://example.test')", "\t=1+1", "\n=1+1", "\r\n+SUM(A1:A2)", "\u0000=1+1", "\uFEFF@SUM(A1:A2)", "\u00a0-2+3"])(
    "neutralizes spreadsheet formulas in %s",
    (value) => {
      expect(sanitizeSpreadsheetCell(value)).toBe(`'${value}`);
    }
  );

  it("preserves ordinary text and escapes quotes", () => {
    expect(buildCsv([["Ana", 'Dijo "hola"']])).toBe('"Ana","Dijo ""hola"""');
  });
});
