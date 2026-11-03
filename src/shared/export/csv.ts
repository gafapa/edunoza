const SPREADSHEET_FORMULA_PREFIX = /^[\s\u0000-\u001f]*[=+\-@]/;

export function sanitizeSpreadsheetCell(value: unknown): string {
  const text = String(value);
  return SPREADSHEET_FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

export function buildCsv(rows: unknown[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => `"${sanitizeSpreadsheetCell(cell).replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\n");
}
