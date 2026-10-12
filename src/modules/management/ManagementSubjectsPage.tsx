import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { setSelectedClass } from "../../app/store";
import { useManagement } from "./ManagementContext";
import { Modal } from "../../shared/ui/Modal";
import { useStudentDisplay } from "../../shared/hooks/useStudentDisplay";
import { IconButton } from "../../shared/ui/IconButton";
import { ClassGroupSelect } from "../../shared/ui/ClassGroupSelect";
import { useUnsavedChangesGuard } from "../../shared/hooks/useUnsavedChangesGuard";
import { SubnavActions } from "../../shared/ui/SubnavActions";

export function ManagementSubjectsPage() {
  const dispatch = useAppDispatch();
  const selectedCourseId = useAppSelector((state) => state.app.selectedClassId) ?? "";
  const setSelectedCourseId = useCallback(
    (courseId: string) => dispatch(setSelectedClass(courseId || null)),
    [dispatch]
  );
  const { formatName } = useStudentDisplay();
  const {
    subjects,
    courses,
    isReady,
    scheduleDays,
    subjectCourseLinks,
    createEmptySubject,
    updateSubject,
    deleteSubject,
    getEnrollmentRows,
    setStudentEnrollment,
    bulkAssignGroupStudentsToSubject,
    setNotice
  } = useManagement();

  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [detailName, setDetailName] = useState("");
  const [detailTeachingHours, setDetailTeachingHours] = useState("");
  const [detailScheduleSlotIds, setDetailScheduleSlotIds] = useState<string[]>([]);
  const [subjectDirty, setSubjectDirty] = useState(false);

  const [isAddStudentsModalOpen, setIsAddStudentsModalOpen] = useState(false);
  const [addSearchTerm, setAddSearchTerm] = useState("");
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);

  const courseIdsBySubject = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const subject of subjects) {
      map.set(subject.id, []);
    }
    for (const link of subjectCourseLinks) {
      const arr = map.get(link.subjectId) ?? [];
      arr.push(link.classId);
      map.set(link.subjectId, arr);
    }
    return map;
  }, [subjectCourseLinks, subjects]);

  const filteredSubjects = useMemo(
    () => subjects.filter((subject) => courseIdsBySubject.get(subject.id)?.includes(selectedCourseId)),
    [courseIdsBySubject, selectedCourseId, subjects]
  );

  useEffect(() => {
    if (!isReady) return;
    if (courses.length === 0) {
      setSelectedCourseId("");
      return;
    }
    if (!courses.some((course) => course.id === selectedCourseId)) {
      setSelectedCourseId(courses[0].id);
    }
  }, [courses, isReady, selectedCourseId, setSelectedCourseId]);

  useEffect(() => {
    if (filteredSubjects.length === 0) {
      setSelectedSubjectId("");
      return;
    }
    if (!filteredSubjects.some((subject) => subject.id === selectedSubjectId)) {
      setSelectedSubjectId(filteredSubjects[0].id);
    }
  }, [filteredSubjects, selectedSubjectId]);

  const selectedSubject = useMemo(
    () => filteredSubjects.find((subject) => subject.id === selectedSubjectId) ?? null,
    [filteredSubjects, selectedSubjectId]
  );
  const allScheduleSlotIds = useMemo(() => {
    const ids = new Set<string>();
    for (const day of scheduleDays) {
      for (const block of day.blocks) {
        if (block.isBreak) continue;
        ids.add(block.id);
      }
    }
    return ids;
  }, [scheduleDays]);
  const activeScheduleDays = useMemo(
    () => scheduleDays.filter((day) => day.enabled),
    [scheduleDays]
  );
  const occupiedSlotsByOtherSubjects = useMemo(() => {
    const map = new Map<string, string>();
    for (const subject of subjects) {
      if (subject.id === selectedSubjectId) continue;
      for (const slotId of subject.scheduleSlotIds ?? []) {
        if (!map.has(slotId)) map.set(slotId, subject.name);
      }
    }
    return map;
  }, [selectedSubjectId, subjects]);
  const conflictingSelectedSlotIds = useMemo(
    () => detailScheduleSlotIds.filter((slotId) => occupiedSlotsByOtherSubjects.has(slotId)),
    [detailScheduleSlotIds, occupiedSlotsByOtherSubjects]
  );
  const orphanSelectedSlotIds = useMemo(
    () => detailScheduleSlotIds.filter((slotId) => !allScheduleSlotIds.has(slotId)),
    [allScheduleSlotIds, detailScheduleSlotIds]
  );

  useEffect(() => {
    if (!selectedSubject) {
      setDetailName("");
      setDetailTeachingHours("");
      setDetailScheduleSlotIds([]);
      setSubjectDirty(false);
      return;
    }
    setDetailName(selectedSubject.name);
    setDetailTeachingHours(selectedSubject.teachingHours ?? "");
    setDetailScheduleSlotIds(selectedSubject.scheduleSlotIds ?? []);
    setSubjectDirty(false);
  }, [selectedSubject]);

  // Debounced autosave. Context actions are intentionally omitted because their references are unstable.
  useEffect(() => {
    if (!subjectDirty || !selectedSubject) return;
    const name = detailName.trim();
    if (name.length < 2) return;
    const normalizedSlotIds = detailScheduleSlotIds.filter((id) => allScheduleSlotIds.has(id));
    const hasConflicts = normalizedSlotIds.some((id) => occupiedSlotsByOtherSubjects.has(id));
    if (hasConflicts) return;
    const id = selectedSubject.id;
    const hours = detailTeachingHours;
    const timer = setTimeout(() => {
      void updateSubject(id, name, hours, normalizedSlotIds, selectedCourseId).then((saved) => {
        if (saved) setSubjectDirty(false);
      });
    }, 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectDirty, detailName, detailTeachingHours, detailScheduleSlotIds, selectedCourseId, selectedSubject?.id]);

  const saveIfDirty = useCallback(async (): Promise<boolean> => {
    if (!subjectDirty || !selectedSubject) return true;
    const name = detailName.trim();
    const normalizedSlotIds = detailScheduleSlotIds.filter((id) => allScheduleSlotIds.has(id));
    const hasConflicts = normalizedSlotIds.some((id) => occupiedSlotsByOtherSubjects.has(id));
    if (hasConflicts) return false;
    const saved = await updateSubject(selectedSubject.id, name, detailTeachingHours, normalizedSlotIds, selectedCourseId);
    if (saved) setSubjectDirty(false);
    return saved;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectDirty, detailName, detailTeachingHours, detailScheduleSlotIds, selectedCourseId, selectedSubject?.id, allScheduleSlotIds, occupiedSlotsByOtherSubjects]);

  useUnsavedChangesGuard(subjectDirty, "Hay cambios de la asignatura sin guardar.", saveIfDirty);

  const changeSelectedCourse = useCallback(async (courseId: string): Promise<void> => {
    if (!(await saveIfDirty())) return;
    setSelectedCourseId(courseId);
  }, [saveIfDirty, setSelectedCourseId]);

  const rows = useMemo(() => getEnrollmentRows(selectedSubjectId), [getEnrollmentRows, selectedSubjectId]);
  const groupRows = useMemo(
    () => rows.filter((row) => row.student.classId === selectedCourseId),
    [rows, selectedCourseId]
  );
  const assignedRows = useMemo(() => groupRows.filter((row) => row.effectiveIncluded), [groupRows]);
  const candidateRows = useMemo(() => {
    const search = addSearchTerm.trim().toLowerCase();
    return groupRows.filter((row) => {
      if (row.effectiveIncluded) return false;
      const bySearch = search.length === 0 ? true : formatName(row.student).toLowerCase().includes(search);
      return bySearch;
    });
  }, [addSearchTerm, formatName, groupRows]);

  useEffect(() => {
    if (!isAddStudentsModalOpen) {
      setSelectedCandidateIds([]);
      setAddSearchTerm("");
    }
  }, [isAddStudentsModalOpen]);

  const toggleSlot = (slotId: string, value: string[], setter: (next: string[]) => void) => {
    if (value.includes(slotId)) {
      setter(value.filter((item) => item !== slotId));
    } else {
      setter([...value, slotId]);
    }
  };

  const toggleCandidate = (studentId: string) => {
    if (selectedCandidateIds.includes(studentId)) {
      setSelectedCandidateIds(selectedCandidateIds.filter((id) => id !== studentId));
    } else {
      setSelectedCandidateIds([...selectedCandidateIds, studentId]);
    }
  };

  const cleanOrphanSlots = () => {
    if (orphanSelectedSlotIds.length === 0) return;
    setDetailScheduleSlotIds((current) => current.filter((slotId) => allScheduleSlotIds.has(slotId)));
    setSubjectDirty(true);
    setNotice(`Se han quitado ${orphanSelectedSlotIds.length} horas antiguas que no existen en el horario actual.`);
  };

  const reassignOrphanSlotsAutomatically = () => {
    const orphanCount = orphanSelectedSlotIds.length;
    if (orphanCount === 0) return;

    const baseSlotIds = detailScheduleSlotIds.filter((slotId) => allScheduleSlotIds.has(slotId));
    const nextSlotIds = [...baseSlotIds];
    const selectedSet = new Set(baseSlotIds);
    const candidateSlotIds = activeScheduleDays.flatMap((day) =>
      day.blocks.filter((block) => !block.isBreak).map((block) => block.id)
    );

    for (const slotId of candidateSlotIds) {
      if (selectedSet.has(slotId)) continue;
      if (occupiedSlotsByOtherSubjects.has(slotId)) continue;
      nextSlotIds.push(slotId);
      selectedSet.add(slotId);
      if (nextSlotIds.length >= baseSlotIds.length + orphanCount) break;
    }

    setDetailScheduleSlotIds(nextSlotIds);
    setSubjectDirty(true);
    if (nextSlotIds.length < baseSlotIds.length + orphanCount) {
      setNotice(`Se pudieron reasignar ${nextSlotIds.length - baseSlotIds.length} de ${orphanCount} horas. Revisa y ajusta manualmente.`);
      return;
    }
    setNotice(`Se han reasignado automaticamente ${orphanCount} horas. Revisa y guarda la asignatura.`);
  };

  return (
    <article className="management-card">
      <h1 className="sr-only">Asignaturas</h1>
      <div className="courses-layout">
        <aside className="courses-list-panel">
          <div className="context-sidebar-tabs">
            <ClassGroupSelect
              groups={courses}
              value={selectedCourseId}
              onChange={changeSelectedCourse}
            />
          </div>
          <div className="courses-list-header">
            <strong>Listado</strong>
            <IconButton
              icon="add"
              label="Crear asignatura"
              showLabel
              onClick={async () => {
                if (!(await saveIfDirty())) return;
                const createdId = await createEmptySubject(selectedCourseId);
                if (createdId) setSelectedSubjectId(createdId);
              }}
              disabled={!selectedCourseId}
            />
          </div>
          <div className="courses-list section-tabs" role="group" aria-label="Secciones de asignaturas">
            {filteredSubjects.map((subject) => {
              const validSlotCount = (subject.scheduleSlotIds ?? []).filter((slotId) =>
                allScheduleSlotIds.has(slotId)
              ).length;
              return (
                <div key={subject.id} className="courses-list-row">
                  <button
                    type="button"
                    aria-pressed={selectedSubjectId === subject.id}
                    className={`section-tab ${selectedSubjectId === subject.id ? "active" : ""}`}
                    onClick={async () => {
                      if (!(await saveIfDirty())) return;
                      setSelectedSubjectId(subject.id);
                    }}
                  >
                    <span>{subject.name}</span>
                    <small>{validSlotCount} {validSlotCount === 1 ? "bloque marcado" : "bloques marcados"}</small>
                  </button>
                  <IconButton
                    icon="delete"
                    label={`Eliminar ${subject.name || "asignatura"}`}
                    onClick={async () => {
                      if (!window.confirm(`¿Eliminar la materia "${subject.name || "esta materia"}"? Esta acción no se puede deshacer.`)) return;
                      if (!(await saveIfDirty())) return;
                      await deleteSubject(subject.id);
                    }}
                  />
                </div>
              );
            })}
            {selectedCourseId && filteredSubjects.length === 0 ? (
              <p className="empty-state">No hay asignaturas en este grupo.</p>
            ) : null}
          </div>
        </aside>

        <section className="course-detail-panel">
          {selectedSubject ? (
            <>
              <div className="course-detail-header">
                <div>
                  <h2>Detalle de asignatura</h2>
                  <SubnavActions>
                  <span role="status" className={`subnav-chip ${subjectDirty ? "warning" : "success"}`}>{subjectDirty ? "Cambios pendientes de guardar" : "Guardado"}</span>
                </SubnavActions>
                </div>
              </div>

              <div className="detail-summary">
                <span className="pill">{assignedRows.length} {assignedRows.length === 1 ? "alumno" : "alumnos"}</span>
                <span className="pill">{detailScheduleSlotIds.length} {detailScheduleSlotIds.length === 1 ? "franja marcada" : "franjas marcadas"}</span>
              </div>

              <section className="detail-section">
                <h3>Datos de asignatura</h3>
                <div className="detail-grid">
                  <div className="detail-field full compact-field">
                    <label htmlFor="subject-detail-name">Nombre</label>
                    <input
                      id="subject-detail-name"
                      className="input"
                      placeholder="Nombre de asignatura"
                      value={detailName}
                      onChange={(event) => {
                        setDetailName(event.target.value);
                        setSubjectDirty(true);
                      }}
                    />
                  </div>
                </div>
              </section>

              <section className="detail-section">
                <h3>Horario de impartición</h3>
                {orphanSelectedSlotIds.length > 0 ? (
                  <div className="hint">
                    Esta asignatura tiene {orphanSelectedSlotIds.length} horas antiguas que ya no existen en el horario.
                    <div className="inline-form tight">
                      <button type="button" className="btn secondary" onClick={cleanOrphanSlots}>
                        Limpiar horas antiguas
                      </button>
                      <button type="button" className="btn secondary" onClick={reassignOrphanSlotsAutomatically}>
                        Reasignar automaticamente
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="schedule-grid-wrap">
                  <div className="schedule-grid">
                    {activeScheduleDays.map((day) => (
                      <div className="schedule-day-card" key={day.id}>
                        <strong>{day.dayName}</strong>
                        <div className="schedule-slot-list">
                          {day.blocks.map((block) => {
                            const slotId = block.id;
                            const occupiedBy = occupiedSlotsByOtherSubjects.get(slotId);
                            const isActive = detailScheduleSlotIds.includes(slotId);
                            const isBreak = Boolean(block.isBreak);
                            const isBlocked = Boolean(occupiedBy) && !isActive;
                            return (
                              <button
                                key={slotId}
                                type="button"
                                className={`schedule-slot-pill ${isActive ? "active" : ""} ${isBlocked ? "blocked" : ""} ${isBreak ? "break" : ""}`}
                                title={isBreak ? "Descanso" : occupiedBy ? `Ocupado por ${occupiedBy}` : undefined}
                                disabled={isBlocked || isBreak}
                                onClick={() => {
                                  if (isBlocked || isBreak) return;
                                  toggleSlot(slotId, detailScheduleSlotIds, setDetailScheduleSlotIds);
                                  setSubjectDirty(true);
                                }}
                              >
                                {block.isBreak ? "Descanso" : block.startTime}
                              </button>
                            );
                          })}
                          {day.blocks.length === 0 ? <small>Sin bloques</small> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {conflictingSelectedSlotIds.length > 0 ? (
                  <p className="hint">
                    Hay bloques en conflicto con otras asignaturas. Debes quitarlos para poder guardar.
                  </p>
                ) : null}
              </section>

              <section className="detail-section">
                <div className="course-detail-header">
                  <h3>Alumnado de la asignatura</h3>
                  <div className="inline-form flush">
                    <button
                      type="button"
                      className="btn secondary compact-link"
                      disabled={!selectedCourseId || assignedRows.length >= groupRows.length}
                      onClick={async () => {
                        if (!(await saveIfDirty()) || !selectedCourseId) return;
                        await bulkAssignGroupStudentsToSubject(selectedCourseId, selectedSubject.id);
                      }}
                    >
                      Asignar todo el grupo
                    </button>
                    <IconButton
                      icon="add"
                      label="Añadir alumnos"
                      showLabel
                      onClick={async () => {
                        if (!(await saveIfDirty())) return;
                        setIsAddStudentsModalOpen(true);
                      }}
                    />
                  </div>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Alumno</th>
                        <th>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assignedRows.map((row) => (
                        <tr key={row.student.id}>
                          <td>{formatName(row.student)}</td>
                          <td className="actions-cell">
                            <IconButton
                              icon="remove"
                              label="Quitar alumno"
                              onClick={async () => {
                                if (!(await saveIfDirty())) return;
                                await setStudentEnrollment(selectedSubject.id, row.student.id, false);
                              }}
                            />
                          </td>
                        </tr>
                      ))}
                      {assignedRows.length === 0 ? (
                        <tr>
                          <td colSpan={2}>No hay alumnos asignados.</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : (
            <p className="empty-state">No hay asignaturas para mostrar.</p>
          )}
        </section>
      </div>

      <Modal
        open={isAddStudentsModalOpen && selectedSubject !== null}
        title={`Añadir alumnos a ${selectedSubject?.name ?? "asignatura"}`}
        onClose={() => setIsAddStudentsModalOpen(false)}
      >
        <div className="inline-form">
          <input
            className="input"
            placeholder="Buscar alumno..."
            aria-label="Buscar alumno"
            value={addSearchTerm}
            onChange={(event) => setAddSearchTerm(event.target.value)}
          />
          <IconButton
            icon="assign"
            label="Seleccionar todos"
            onClick={() => setSelectedCandidateIds(candidateRows.map((row) => row.student.id))}
            disabled={candidateRows.length === 0}
          />
          <IconButton
            icon="remove"
            label="Limpiar seleccion"
            onClick={() => setSelectedCandidateIds([])}
            disabled={selectedCandidateIds.length === 0}
          />
          <IconButton
            icon="save"
            label="Añadir seleccionados"
            onClick={async () => {
              if (!selectedSubject || selectedCandidateIds.length === 0) return;
              for (const studentId of selectedCandidateIds) {
                await setStudentEnrollment(selectedSubject.id, studentId, true);
              }
              setIsAddStudentsModalOpen(false);
            }}
            disabled={selectedCandidateIds.length === 0}
          />
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Alumno</th>
              </tr>
            </thead>
            <tbody>
              {candidateRows.map((row) => (
                <tr key={row.student.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Seleccionar ${formatName(row.student)}`}
                      checked={selectedCandidateIds.includes(row.student.id)}
                      onChange={() => toggleCandidate(row.student.id)}
                    />
                  </td>
                  <td>{formatName(row.student)}</td>
                </tr>
              ))}
              {candidateRows.length === 0 ? (
                <tr>
                  <td colSpan={2}>No hay alumnos disponibles con esos filtros.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Modal>
    </article>
  );
}
