import { downloadBlob } from "../utils/download";
/** A header-only template avoids importing fictional examples as real pupils. */
export const STUDENT_IMPORT_TEMPLATE = "\uFEFFNOMBRE;APELLIDO 1;CURSO;GRUPO\r\n";

export function downloadStudentImportTemplate(): void {
  downloadBlob("edunoza-plantilla-alumnado.csv", new Blob([STUDENT_IMPORT_TEMPLATE], { type: "text/csv;charset=utf-8" }));
}
