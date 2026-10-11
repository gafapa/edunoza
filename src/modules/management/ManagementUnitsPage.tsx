import { useCallback, useEffect, useMemo, useState } from "react";
import { useManagement } from "./ManagementContext";
import { useAppSelector } from "../../app/hooks";
import { ContextSidebarTabs } from "../../shared/ui/ContextSidebarTabs";
import { IconButton } from "../../shared/ui/IconButton";
import { useUnsavedChangesGuard } from "../../shared/hooks/useUnsavedChangesGuard";

export function ManagementUnitsPage() {
  const selectedSubjectId = useAppSelector((s) => s.app.selectedSubjectId);

  const {
    units,
    subjects,
    taskSubjectLinks,
    createEmptyUnit,
    updateUnit,
    deleteUnit,
    addTaskSubjectLink,
    setNotice
  } = useManagement();

  const [selectedUnitId, setSelectedUnitId] = useState("");
  const [detailName, setDetailName] = useState("");
  const [detailDescription, setDetailDescription] = useState("");
  const [detailSessionCount, setDetailSessionCount] = useState(1);
  const [unitDirty, setUnitDirty] = useState(false);
  const [reusableUnitId, setReusableUnitId] = useState("");

  const unitsBySubject = useMemo(
    () =>
      units
        .filter((u) => u.subjectId === selectedSubjectId)
        .sort((a, b) => a.position - b.position),
    [selectedSubjectId, units]
  );

  useEffect(() => {
    if (unitsBySubject.length === 0) { setSelectedUnitId(""); return; }
    const exists = unitsBySubject.some((u) => u.id === selectedUnitId);
    if (!exists) setSelectedUnitId(unitsBySubject[0].id);
  }, [selectedSubjectId, unitsBySubject]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedUnit = unitsBySubject.find((u) => u.id === selectedUnitId) ?? null;
  const reusableUnits = useMemo(
    () =>
      units
        .filter((unit) => unit.subjectId !== selectedSubjectId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [selectedSubjectId, units]
  );

  useEffect(() => {
    if (!selectedUnit) {
      setDetailName("");
      setDetailDescription("");
      setDetailSessionCount(1);
      setUnitDirty(false);
      return;
    }
    setDetailName(selectedUnit.name ?? "");
    setDetailDescription(selectedUnit.description ?? "");
    setDetailSessionCount(selectedUnit.sessionCount ?? 1);
    setUnitDirty(false);
  }, [selectedUnit]);

  // Debounced autosave. The context action is intentionally omitted because its reference is unstable.
  useEffect(() => {
    if (!unitDirty || !selectedUnit) return;
    const name = detailName.trim();
    if (name.length < 2) return;
    const id = selectedUnit.id;
    const desc = detailDescription;
    const count = detailSessionCount;
    const timer = setTimeout(() => {
      void updateUnit(id, name, desc, count).then((saved) => {
        if (saved) setUnitDirty(false);
      });
    }, 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitDirty, detailName, detailDescription, detailSessionCount, selectedUnit?.id]);

  const saveIfDirty = useCallback(async (): Promise<boolean> => {
    if (!unitDirty || !selectedUnit) return true;
    const saved = await updateUnit(selectedUnit.id, detailName.trim(), detailDescription, detailSessionCount);
    if (saved) setUnitDirty(false);
    return saved;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitDirty, detailName, detailDescription, detailSessionCount, selectedUnit?.id]);

  useUnsavedChangesGuard(unitDirty, "Hay cambios de la unidad sin guardar.", saveIfDirty);

  const reuseUnit = async (): Promise<void> => {
    if (!selectedSubjectId || !reusableUnitId) return;
    if (!(await saveIfDirty())) return;
    const source = units.find((unit) => unit.id === reusableUnitId);
    if (!source) return;
    const createdId = await createEmptyUnit(selectedSubjectId);
    if (!createdId) return;
    const saved = await updateUnit(
      createdId,
      `${source.name} (copia)`,
      source.description,
      source.sessionCount
    );
    if (!saved) return;

    const sourceLinks = taskSubjectLinks.filter((link) => link.unitId === source.id);
    for (const link of sourceLinks) {
      await addTaskSubjectLink(link.taskId, selectedSubjectId, createdId);
    }
    setSelectedUnitId(createdId);
    setReusableUnitId("");
    setNotice(
      `Unidad reutilizada con ${sourceLinks.length} tarea${sourceLinks.length === 1 ? "" : "s"} vinculada${sourceLinks.length === 1 ? "" : "s"}.`
    );
  };

  return (
    <article className="management-card">
      <h1 className="sr-only">Unidades</h1>
      <div className="courses-layout">
        <aside className="courses-list-panel">
          <ContextSidebarTabs beforeChange={saveIfDirty} />
          <div className="courses-list-header">
            <strong>Unidades</strong>
            <IconButton
              icon="add"
              label="Crear unidad"
              showLabel
              disabled={!selectedSubjectId}
              onClick={async () => {
                if (!(await saveIfDirty())) return;
                const createdId = await createEmptyUnit(selectedSubjectId);
                if (createdId) setSelectedUnitId(createdId);
              }}
            />
          </div>
          {selectedSubjectId && reusableUnits.length > 0 ? (
            <div className="sidebar-reuse-panel">
              <label className="detail-field compact-field">
                <span>Reutilizar unidad</span>
                <select
                  className="input"
                  value={reusableUnitId}
                  onChange={(event) => setReusableUnitId(event.target.value)}
                >
                  <option value="">Selecciona una unidad</option>
                  {reusableUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name} · {subjects.find((subject) => subject.id === unit.subjectId)?.name ?? "Otra asignatura"}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn secondary"
                disabled={!reusableUnitId}
                onClick={() => void reuseUnit()}
              >
                Copiar estructura
              </button>
            </div>
          ) : null}
          <div className="courses-list section-tabs" role="group" aria-label="Unidades">
            {selectedSubjectId ? unitsBySubject.map((unit) => (
              <div key={unit.id} className="courses-list-row">
                <button
                  type="button"
                  aria-pressed={selectedUnitId === unit.id}
                  className={`section-tab ${selectedUnitId === unit.id ? "active" : ""}`}
                  onClick={async () => {
                    if (!(await saveIfDirty())) return;
                    setSelectedUnitId(unit.id);
                  }}
                >
                  <span>{unit.name || "Sin nombre"}</span>
                  <small>{unit.sessionCount} {unit.sessionCount === 1 ? "sesión prevista" : "sesiones previstas"}</small>
                </button>
                <IconButton
                  icon="delete"
                  label={`Eliminar ${unit.name || "unidad"}`}
                  onClick={async () => {
                    if (!window.confirm(`¿Eliminar la unidad "${unit.name || "esta unidad"}"? Esta acción no se puede deshacer.`)) return;
                    if (!(await saveIfDirty())) return;
                    await deleteUnit(unit.id);
                }}
              />
            </div>
            )) : null}
            {selectedSubjectId && unitsBySubject.length === 0 && (
              <p className="hint">No hay unidades en esta asignatura.</p>
            )}
          </div>
        </aside>

        <section className="course-detail-panel">
          {selectedUnit ? (
            <>
              <div className="course-detail-header">
                <h2>Detalle de unidad</h2>
                <span role="status" className="hint">{unitDirty ? "Cambios pendientes de guardar" : "Guardado"}</span>
              </div>

              <section className="detail-section">
                <div className="unit-detail-layout">
                  <label className="unit-field unit-field-full compact-field">
                    <span className="unit-field-label">Nombre</span>
                    <input
                      className="input"
                      placeholder="Nombre de la unidad"
                      value={detailName}
                      onChange={(e) => { setDetailName(e.target.value); setUnitDirty(true); }}
                    />
                  </label>

                  <label className="unit-field unit-field-full">
                    <span className="unit-field-label">Descripción</span>
                    <textarea
                      className="input"
                      placeholder="Descripción de la unidad"
                      value={detailDescription}
                      onChange={(e) => { setDetailDescription(e.target.value); setUnitDirty(true); }}
                    />
                  </label>

                  <label className="unit-field compact-field">
                    <span className="unit-field-label">Sesiones previstas</span>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      value={detailSessionCount}
                      onChange={(e) => {
                        setDetailSessionCount(Math.max(1, Number(e.target.value) || 1));
                        setUnitDirty(true);
                      }}
                    />
                  </label>
                </div>

                <p className="hint">
                  Las fechas de inicio y fin se calculan automáticamente a partir de las sesiones
                  registradas en Hoy y en el Planificador.
                </p>
              </section>
            </>
          ) : (
            <p className="empty-state">
              {selectedSubjectId ? "Selecciona una unidad para editarla." : "Selecciona una asignatura en el panel izquierdo."}
            </p>
          )}
        </section>
      </div>
    </article>
  );
}
