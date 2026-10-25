import { useMemo, useRef, useState } from "react";
import type { ClassGroup, Student } from "../db/types";
import { prepareGroupedStudentsImport } from "./groupedStudentsImport";
import { importGroupedStudents } from "./groupedStudentsPersistence";
import { parseGroupedStudentsCsv, type GroupedStudentsCsvResult } from "./studentsCsv";
import { downloadStudentImportTemplate } from "./studentImportTemplate";

const MAX_GROUPED_CSV_SIZE_BYTES = 5 * 1024 * 1024;

type GroupedStudentsImporterProps = {
  courses: ClassGroup[];
  students: Student[];
  refreshAll: () => Promise<void>;
  setNotice: (message: string) => void;
  onImported?: (result: { firstCourseId?: string; firstStudentId?: string }) => void;
};

function currentSchoolYear(date = new Date()): string {
  const startYear = date.getMonth() >= 7 ? date.getFullYear() : date.getFullYear() - 1;
  return `${startYear}-${startYear + 1}`;
}

function isValidSchoolYear(value: string): boolean {
  const match = value.trim().match(/^(\d{4})-(\d{4})$/);
  return Boolean(match && Number(match[2]) === Number(match[1]) + 1);
}

async function readCsvFileText(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export function GroupedStudentsImporter({
  courses,
  students,
  refreshAll,
  setNotice,
  onImported
}: GroupedStudentsImporterProps) {
  const [preview, setPreview] = useState<GroupedStudentsCsvResult | null>(null);
  const [selectedGroupKeys, setSelectedGroupKeys] = useState<Set<string>>(new Set());
  const [fileName, setFileName] = useState("");
  const [schoolYear, setSchoolYear] = useState(() => currentSchoolYear());
  const [error, setError] = useState("");
  const [isReading, setIsReading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedGroups = useMemo(
    () => preview?.groups.filter((group) => selectedGroupKeys.has(group.key)) ?? [],
    [preview, selectedGroupKeys]
  );
  const previewPlan = useMemo(() => {
    if (selectedGroups.length === 0 || !isValidSchoolYear(schoolYear)) return null;
    let previewId = 0;
    return prepareGroupedStudentsImport({
      selectedGroups,
      schoolYear: schoolYear.trim(),
      existingCourses: courses,
      existingStudents: students,
      createId: () => `csv-import-preview-${previewId++}`
    });
  }, [courses, schoolYear, selectedGroups, students]);

  const loadFile = async (file: File): Promise<void> => {
    if (file.size > MAX_GROUPED_CSV_SIZE_BYTES) {
      setError("El CSV es demasiado grande. Usa un archivo de hasta 5 MB.");
      return;
    }
    setIsReading(true);
    setError("");
    setPreview(null);
    setSelectedGroupKeys(new Set());
    setFileName(file.name);
    try {
      const result = parseGroupedStudentsCsv(await readCsvFileText(file));
      if (result.missingHeaders.length > 0) {
        setError(`Faltan columnas obligatorias: ${result.missingHeaders.join(", ")}.`);
        return;
      }
      if (result.groups.length === 0) {
        setError("No se encontraron filas válidas con nombre, primer apellido, curso y grupo.");
        return;
      }
      setPreview(result);
    } catch (fileError) {
      const message = fileError instanceof Error ? fileError.message : "Error desconocido";
      setError(`No se pudo leer el CSV: ${message}`);
    } finally {
      setIsReading(false);
    }
  };

  const toggleGroup = (groupKey: string): void => {
    setSelectedGroupKeys((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  const importGroups = async (): Promise<void> => {
    if (!preview || selectedGroups.length === 0 || isImporting) return;
    if (!isValidSchoolYear(schoolYear)) {
      setError("El curso escolar debe tener el formato 2026-2027.");
      return;
    }

    setIsImporting(true);
    setError("");
    try {
      const plan = await importGroupedStudents({
        selectedGroups,
        schoolYear: schoolYear.trim(),
        existingCourses: courses,
        existingStudents: students
      });

      try {
        await refreshAll();
      } catch {
        setNotice("La importación se ha guardado, pero la pantalla no pudo actualizarse. Recarga Edunoza para verla.");
        onImported?.({
          firstCourseId: plan.selectedCourseIds[0],
          firstStudentId: plan.studentsToAdd[0]?.id
        });
        setPreview(null);
        setSelectedGroupKeys(new Set());
        setFileName("");
        return;
      }

      const summary = [
        `${plan.coursesToAdd.length} ${plan.coursesToAdd.length === 1 ? "grupo creado" : "grupos creados"}`,
        `${plan.studentsToAdd.length} ${plan.studentsToAdd.length === 1 ? "alumno importado" : "alumnos importados"}`
      ];
      if (plan.skippedExistingCount > 0) summary.push(`${plan.skippedExistingCount} ya existentes`);
      if (plan.conflictingStudentCount > 0) {
        summary.push(`${plan.conflictingStudentCount} no movidos por pertenecer a otro grupo`);
      }
      setNotice(`Importación completada: ${summary.join(", ")}.`);
      onImported?.({
        firstCourseId: plan.selectedCourseIds[0],
        firstStudentId: plan.studentsToAdd[0]?.id
      });
      setPreview(null);
      setSelectedGroupKeys(new Set());
      setFileName("");
    } catch (importError) {
      const message = importError instanceof Error ? importError.message : "Error desconocido";
      setError(`No se pudo completar la importación: ${message}`);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="student-group-import">
      <input
        ref={fileInputRef}
        className="student-photo-input-hidden"
        type="file"
        aria-hidden="true"
        tabIndex={-1}
        accept=".csv,text/csv,text/plain"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = "";
          if (file) void loadFile(file);
        }}
      />

      <section className="student-group-import-source" aria-labelledby="student-import-source-title">
        <div>
          <strong id="student-import-source-title">Archivo de origen</strong>
          <p>{fileName || "Aún no has seleccionado ningún archivo."}</p>
        </div>
        <button
          type="button"
          className="btn secondary"
          disabled={isReading || isImporting}
          onClick={() => fileInputRef.current?.click()}
        >
          {isReading ? "Leyendo CSV…" : fileName ? "Cambiar archivo" : "Seleccionar CSV"}
        </button>
      </section>

      <p className="student-group-import-privacy">
        El archivo se procesa solo en este navegador. Se guardan el código de alumno, nombre,
        apellidos, correo y observaciones; el resto de datos personales del CSV se ignora.
      </p>

      <section aria-labelledby="student-import-template-title">
        <h2 id="student-import-template-title">¿Tienes otro listado?</h2>
        <p className="hint">Descarga la plantilla vacía, ábrela en tu hoja de cálculo y añade una fila por alumno. Mantén los encabezados NOMBRE, APELLIDO 1, CURSO y GRUPO. Guarda como CSV y selecciónalo arriba. Revisarás los grupos antes de importar.</p>
        <button type="button" className="btn secondary" onClick={downloadStudentImportTemplate}>Descargar plantilla CSV</button>
      </section>

      {error ? <p className="notice error" role="alert">{error}</p> : null}

      {preview ? (
        <>
          <div className="student-group-import-settings">
            <label className="detail-field compact-field">
              <span>Curso escolar</span>
              <input
                className="input"
                value={schoolYear}
                inputMode="numeric"
                placeholder="2026-2027"
                aria-describedby="student-import-school-year-hint"
                disabled={isImporting}
                onChange={(event) => {
                  setSchoolYear(event.target.value);
                  setError("");
                }}
              />
              <small id="student-import-school-year-hint">Se aplicará a todos los grupos seleccionados.</small>
            </label>
            <dl className="student-group-import-summary" aria-label="Resumen del CSV">
              <div><dt>Grupos</dt><dd>{preview.groups.length}</dd></div>
              <div>
                <dt>Alumnado válido</dt>
                <dd>{preview.groups.reduce((total, group) => total + group.students.length, 0)}</dd>
              </div>
              <div><dt>Filas omitidas</dt><dd>{preview.skippedRowCount + preview.duplicateRowCount}</dd></div>
            </dl>
          </div>

          <fieldset className="student-group-import-groups">
            <legend>Grupos detectados</legend>
            <div className="student-group-import-selection">
              <span role="status" aria-live="polite">
                {selectedGroupKeys.size} de {preview.groups.length} seleccionados
              </span>
              <button
                type="button"
                className="btn secondary compact-link"
                disabled={isImporting}
                onClick={() => {
                  const allSelected = selectedGroupKeys.size === preview.groups.length;
                  setSelectedGroupKeys(allSelected ? new Set() : new Set(preview.groups.map((group) => group.key)));
                }}
              >
                {selectedGroupKeys.size === preview.groups.length ? "Quitar selección" : "Seleccionar todos"}
              </button>
            </div>
            <div className="student-group-import-list">
              {preview.groups.map((group) => {
                const isSelected = selectedGroupKeys.has(group.key);
                const groupResult = previewPlan?.groupResults.find((result) => result.groupKey === group.key);
                const importableCount = groupResult?.studentsToAdd ?? 0;
                return (
                  <label key={group.key} className="student-group-import-option">
                    <input
                      type="checkbox"
                      checked={selectedGroupKeys.has(group.key)}
                      disabled={isImporting}
                      onChange={() => toggleGroup(group.key)}
                    />
                    <span>
                      <strong>{group.name}</strong>
                      <small>
                        {group.students.length} {group.students.length === 1 ? "alumno" : "alumnos"} en el CSV
                        {!isSelected
                          ? " · No seleccionado"
                          : importableCount > 0
                          ? ` · ${importableCount} ${importableCount === 1 ? "alta nueva" : "altas nuevas"} · ${
                              groupResult?.courseCreated ? "Se creará el grupo" : "Se añadirá al grupo existente"
                            }`
                          : " · Sin altas nuevas; el grupo no se modificará"}
                      </small>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {previewPlan ? (
            <div className="student-group-import-outcome" role="status" aria-live="polite">
              <strong>Resultado previsto</strong>
              <span>
                {previewPlan.coursesToAdd.length} {previewPlan.coursesToAdd.length === 1 ? "grupo nuevo" : "grupos nuevos"}
                {" · "}
                {previewPlan.studentsToAdd.length} {previewPlan.studentsToAdd.length === 1 ? "alumno nuevo" : "alumnos nuevos"}
              </span>
              {previewPlan.skippedExistingCount > 0 ? (
                <small>{previewPlan.skippedExistingCount} ya existen y no se duplicarán.</small>
              ) : null}
              {previewPlan.conflictingStudentCount > 0 ? (
                <small>{previewPlan.conflictingStudentCount} pertenecen a otro grupo y no se moverán.</small>
              ) : null}
            </div>
          ) : null}

          <div className="student-group-import-actions">
            <button
              type="button"
              className="btn primary"
              disabled={
                !previewPlan ||
                (previewPlan.coursesToAdd.length === 0 && previewPlan.studentsToAdd.length === 0) ||
                isImporting
              }
              onClick={() => void importGroups()}
            >
              {isImporting
                ? "Importando…"
                : `Importar ${previewPlan?.studentsToAdd.length ?? 0} ${
                    (previewPlan?.studentsToAdd.length ?? 0) === 1 ? "alumno" : "alumnos"
                  }`}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
