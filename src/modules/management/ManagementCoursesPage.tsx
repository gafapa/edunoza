import { useCallback, useEffect, useMemo, useState } from "react";
import { useManagement } from "./ManagementContext";
import { useStudentDisplay } from "../../shared/hooks/useStudentDisplay";
import { IconButton } from "../../shared/ui/IconButton";
import { Modal } from "../../shared/ui/Modal";
import { useUnsavedChangesGuard } from "../../shared/hooks/useUnsavedChangesGuard";

export function ManagementCoursesPage() {
  const { formatName } = useStudentDisplay();
  const {
    courses,
    students,
    createCourse,
    updateCourse,
    deleteCourse,
    addStudentToCourse,
  } = useManagement();

  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [draggingStudentId, setDraggingStudentId] = useState<string | null>(null);
  const [dropCourseId, setDropCourseId] = useState<string | null>(null);
  const [moveTargetByStudentId, setMoveTargetByStudentId] = useState<Record<string, string>>({});

  const [detailCourseName, setDetailCourseName] = useState("");
  const [detailCourseYear, setDetailCourseYear] = useState("");
  const [detailCourseComments, setDetailCourseComments] = useState("");
  const [courseDirty, setCourseDirty] = useState(false);
  const [showCreateCourseModal, setShowCreateCourseModal] = useState(false);
  const [newCourseName, setNewCourseName] = useState("");
  const [newCourseLevel, setNewCourseLevel] = useState("");
  const [newCourseYear, setNewCourseYear] = useState(
    () => `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`
  );
  useUnsavedChangesGuard(courseDirty, "Hay cambios del curso sin guardar.");

  useEffect(() => {
    if (!selectedCourseId && courses.length > 0) {
      setSelectedCourseId(courses[0].id);
    }
    const exists = courses.some((course) => course.id === selectedCourseId);
    if (!exists && courses.length > 0) {
      setSelectedCourseId(courses[0].id);
    }
  }, [courses, selectedCourseId]);

  const selectedCourse = courses.find((course) => course.id === selectedCourseId) ?? null;
  const selectedStudents = useMemo(
    () => students.filter((student) => student.classId === selectedCourseId),
    [selectedCourseId, students]
  );

  useEffect(() => {
    if (!selectedCourse) {
      setDetailCourseName("");
      setDetailCourseYear("");
      setDetailCourseComments("");
      setCourseDirty(false);
      return;
    }
    setDetailCourseName(selectedCourse.name);
    setDetailCourseYear(selectedCourse.schoolYear);
    setDetailCourseComments(selectedCourse.comments ?? "");
    setCourseDirty(false);
  }, [selectedCourse]);

  // Debounced autosave. The context action is intentionally omitted because its reference is unstable.
  useEffect(() => {
    if (!courseDirty || !selectedCourse) return;
    const name = detailCourseName.trim();
    const year = detailCourseYear.trim();
    if (name.length < 3 || year.length < 4) return;
    const id = selectedCourse.id;
    const comments = detailCourseComments;
    const timer = setTimeout(() => {
      void updateCourse(id, name, year, comments).then((saved) => {
        if (saved) setCourseDirty(false);
      });
    }, 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseDirty, detailCourseName, detailCourseYear, detailCourseComments, selectedCourse?.id]);

  const saveIfDirty = useCallback(async (): Promise<boolean> => {
    if (!courseDirty || !selectedCourse) return true;
    const name = detailCourseName.trim();
    const year = detailCourseYear.trim();
    const saved = await updateCourse(selectedCourse.id, name, year, detailCourseComments);
    if (saved) setCourseDirty(false);
    return saved;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseDirty, selectedCourse?.id, detailCourseName, detailCourseYear, detailCourseComments]);

  const handleCourseDrop = async (targetCourseId: string, rawStudentId: string | null) => {
    if (!(await saveIfDirty())) return;
    const studentId = rawStudentId || draggingStudentId;
    if (!studentId) return;
    void addStudentToCourse(studentId, targetCourseId);
    setDraggingStudentId(null);
    setDropCourseId(null);
  };

  const moveStudentToSelectedCourse = async (studentId: string): Promise<void> => {
    const targetCourseId = moveTargetByStudentId[studentId] ?? "";
    if (!targetCourseId || !(await saveIfDirty())) return;
    await addStudentToCourse(studentId, targetCourseId);
    setMoveTargetByStudentId((current) => {
      const next = { ...current };
      delete next[studentId];
      return next;
    });
  };

  const openCreateGroup = (): void => {
    void saveIfDirty().then((saved) => {
      if (!saved) return;
      setNewCourseName("");
      setNewCourseLevel("");
      setShowCreateCourseModal(true);
    });
  };

  return (
    <article className="management-card">
      <h1 className="management-page-title">Grupos</h1>
      {courses.length === 0 ? (
        <section className="management-first-group" aria-labelledby="first-group-title">
          <span className="management-first-group-mark" aria-hidden="true">01</span>
          <div>
            <h2 id="first-group-title">Aún no hay grupos</h2>
            <p>Crea el grupo de tu clase para añadir alumnado, asignaturas y horario.</p>
            <button type="button" className="btn" onClick={openCreateGroup}>Crear el primer grupo</button>
          </div>
        </section>
      ) : (
      <div className="courses-layout">
        <aside className="courses-list-panel">
          <div className="courses-list-header">
            <strong>Grupos</strong>
            <button type="button" className="btn secondary" onClick={openCreateGroup}>Nuevo grupo</button>
          </div>
          <div className="courses-list section-tabs" role="group" aria-label="Grupos">
            {courses.map((course) => (
              <div key={course.id} className="courses-list-row">
                <button
                  type="button"
                  aria-pressed={selectedCourseId === course.id}
                  className={`section-tab ${selectedCourseId === course.id ? "active" : ""} ${
                    dropCourseId === course.id ? "drop-target" : ""
                  }`}
                  onClick={async () => {
                    if (!(await saveIfDirty())) return;
                    setSelectedCourseId(course.id);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDropCourseId(course.id);
                  }}
                  onDragLeave={() => setDropCourseId(null)}
                  onDrop={(event) => {
                    event.preventDefault();
                    void handleCourseDrop(course.id, event.dataTransfer.getData("text/student-id"));
                  }}
                >
                  <span>{course.name}</span>
                  <small>{course.schoolYear}</small>
                </button>
                <IconButton
                  icon="delete"
                  label={`Eliminar ${course.name || "grupo"}`}
                  onClick={async () => {
                    if (!window.confirm(`¿Eliminar el grupo "${course.name || "este grupo"}"? Esta acción no se puede deshacer.`)) return;
                    if (!(await saveIfDirty())) return;
                    await deleteCourse(course.id);
                  }}
                />
              </div>
            ))}
          </div>
        </aside>

        <section className="course-detail-panel">
          {selectedCourse ? (
            <>
              <div className="course-detail-header">
                <div>
                  <h2>Detalle del grupo</h2>
                </div>
              </div>

              <div className="detail-summary">
                <span className="pill">{selectedStudents.length} de alumnado</span>
                <span className="pill">{detailCourseYear || "Sin curso escolar"}</span>
              </div>

              <section className="detail-section">
                <h3>Datos del grupo</h3>
                <div className="detail-grid">
                  <div className="detail-field compact-field">
                    <label>Nombre</label>
                    <input
                      className="input"
                      placeholder="Ej. 4 ESO A"
                      value={detailCourseName}
                      onChange={(event) => {
                        setDetailCourseName(event.target.value);
                        setCourseDirty(true);
                      }}
                    />
                  </div>
                  <div className="detail-field">
                    <label>Curso escolar</label>
                    <div className="year-stepper">
                      <button
                        type="button"
                        className="year-stepper-btn"
                        aria-label="Año anterior"
                        onClick={() => {
                          const raw = parseInt(detailCourseYear.split("-")[0] ?? "0", 10);
                          const start = Number.isFinite(raw) ? raw : new Date().getFullYear();
                          setDetailCourseYear(`${start - 1}-${start}`);
                          setCourseDirty(true);
                        }}
                      >−</button>
                      <span className="year-stepper-value">{detailCourseYear || "—"}</span>
                      <button
                        type="button"
                        className="year-stepper-btn"
                        aria-label="Año siguiente"
                        onClick={() => {
                          const raw = parseInt(detailCourseYear.split("-")[0] ?? "0", 10);
                          const start = Number.isFinite(raw) ? raw : new Date().getFullYear();
                          setDetailCourseYear(`${start + 1}-${start + 2}`);
                          setCourseDirty(true);
                        }}
                      >+</button>
                    </div>
                  </div>
                  <div className="detail-field full">
                    <label>Comentarios</label>
                    <textarea
                      className="input"
                      placeholder="Comentarios del grupo (opcional)"
                      value={detailCourseComments}
                      onChange={(event) => {
                        setDetailCourseComments(event.target.value);
                        setCourseDirty(true);
                      }}
                    />
                  </div>
                </div>
              </section>

              <section className="detail-section">
                <h3>Alumnado del grupo</h3>
                <p className="notice compact">
                  Usa “Mover a” o arrastra una ficha hacia otro grupo. Los movimientos con datos registrados se bloquean.
                </p>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Foto</th>
                        <th>Alumno o alumna</th>
                        <th>Mover a</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedStudents.map((student) => {
                        return (
                          <tr
                            key={student.id}
                            draggable
                            onDragStart={(event) => {
                              setDraggingStudentId(student.id);
                              event.dataTransfer.setData("text/student-id", student.id);
                              event.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={() => {
                              setDraggingStudentId(null);
                              setDropCourseId(null);
                            }}
                          >
                            <td>
                              {student.photoDataUrl ? (
                                <img
                                  className="student-avatar"
                                  src={student.photoDataUrl}
                                  alt={formatName(student)}
                                />
                              ) : (
                                "-"
                              )}
                            </td>
                            <td>{formatName(student)}</td>
                            <td>
                              <div className="inline-form flush">
                                <select
                                  className="input"
                                  value={moveTargetByStudentId[student.id] ?? ""}
                                  aria-label={`Grupo de destino para ${formatName(student)}`}
                                  onChange={(event) =>
                                    setMoveTargetByStudentId((current) => ({
                                      ...current,
                                      [student.id]: event.target.value
                                    }))
                                  }
                                >
                                  <option value="">Selecciona destino</option>
                                  {courses
                                    .filter((course) => course.id !== selectedCourseId)
                                    .map((course) => (
                                      <option key={course.id} value={course.id}>
                                        {course.name} · {course.schoolYear}
                                      </option>
                                    ))}
                                </select>
                                <button
                                  type="button"
                                  className="btn secondary"
                                  disabled={!moveTargetByStudentId[student.id]}
                                  onClick={() => void moveStudentToSelectedCourse(student.id)}
                                >
                                  Mover
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : null}
        </section>
      </div>
      )}
      <Modal
        open={showCreateCourseModal}
        title="Crear grupo"
        subtitle="Los datos no se guardarán hasta que confirmes."
        onClose={() => setShowCreateCourseModal(false)}
      >
        <div className="detail-grid">
          <label className="detail-field compact-field">
            <span>Nombre del grupo</span>
            <input
              className="input"
              value={newCourseName}
              placeholder="Ej. 4º Primaria A"
              autoFocus
              onChange={(event) => setNewCourseName(event.target.value)}
            />
          </label>
          <label className="detail-field compact-field">
            <span>Nivel</span>
            <input
              className="input"
              value={newCourseLevel}
              placeholder="Ej. 4º Primaria"
              onChange={(event) => setNewCourseLevel(event.target.value)}
            />
          </label>
          <label className="detail-field compact-field">
            <span>Curso escolar</span>
            <input
              className="input"
              value={newCourseYear}
              placeholder="2026-2027"
              onChange={(event) => setNewCourseYear(event.target.value)}
            />
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={() => setShowCreateCourseModal(false)}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={
              newCourseName.trim().length < 3 ||
              newCourseLevel.trim().length < 2 ||
              newCourseYear.trim().length < 4
            }
            onClick={() => {
              void createCourse(
                newCourseName.trim(),
                newCourseYear.trim(),
                undefined,
                newCourseLevel.trim()
              ).then(() => {
                setShowCreateCourseModal(false);
              });
            }}
          >
            Confirmar y crear
          </button>
        </div>
      </Modal>
    </article>
  );
}
