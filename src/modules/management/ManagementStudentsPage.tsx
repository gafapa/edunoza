import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { setSelectedClass } from "../../app/store";
import { useManagement } from "./ManagementContext";
import { db } from "../../shared/db/database";
import type { StudentFollowUp, StudentFollowUpKind } from "../../shared/db/types";
import {
  FOLLOW_UP_KINDS,
  defaultFollowUpDraft,
  followUpKindLabel,
  normalizeFollowUpDraft,
  updateFollowUpDetails,
  type StudentFollowUpDraft
} from "../../shared/students/followUp";
import { resizeImageToMaxSide } from "../../shared/utils/image";
import { toLocalIsoDate } from "../../shared/utils/date";
import { useStudentDisplay } from "../../shared/hooks/useStudentDisplay";
import { IconButton } from "../../shared/ui/IconButton";
import { ClassGroupSelect } from "../../shared/ui/ClassGroupSelect";
import { useUnsavedChangesGuard } from "../../shared/hooks/useUnsavedChangesGuard";
import { ResourceManager } from "../../shared/resources/ResourceManager";
import { useSearchParams } from "react-router-dom";
import { useUnsavedChangesDialog } from "../../shared/ui/UnsavedChangesDialog";
import { useRecoverableDraft } from "../../shared/hooks/useRecoverableDraft";
import { DraftRecoveryNotice } from "../../shared/ui/DraftRecoveryNotice";
import { SubnavActions } from "../../shared/ui/SubnavActions";

type FollowUpRecovery = { editingId: string; draft: StudentFollowUpDraft };
function isFollowUpRecovery(value: unknown): value is FollowUpRecovery {
  if (!value || typeof value !== "object") return false;
  const saved = value as FollowUpRecovery;
  return typeof saved.editingId === "string" && Boolean(saved.draft) &&
    [saved.draft.date, saved.draft.kind, saved.draft.title, saved.draft.notes, saved.draft.nextStep].every((item) => typeof item === "string") &&
    FOLLOW_UP_KINDS.includes(saved.draft.kind) && typeof saved.draft.resolved === "boolean";
}

const STUDENT_DETAIL_TABS = [
  { id: "data", label: "Datos del alumno" },
  { id: "follow-up", label: "Seguimiento tutorial" },
  { id: "resources", label: "Recursos y evidencias" }
] as const;

type StudentDetailTab = (typeof STUDENT_DETAIL_TABS)[number]["id"];

export function ManagementStudentsPage() {
  const dispatch = useAppDispatch();
  const selectedCourseId = useAppSelector((state) => state.app.selectedClassId) ?? "";
  const setSelectedCourseId = useCallback(
    (courseId: string) => dispatch(setSelectedClass(courseId || null)),
    [dispatch]
  );
  const [searchParams] = useSearchParams();
  const { formatName } = useStudentDisplay();
  const { students, courses, isReady, createEmptyStudent, updateStudent, deleteStudent, setNotice } =
    useManagement();

  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [detailFirstName, setDetailFirstName] = useState("");
  const [detailLastName, setDetailLastName] = useState("");
  const [detailEmail, setDetailEmail] = useState("");
  const [detailComments, setDetailComments] = useState("");
  const [detailHasAcs, setDetailHasAcs] = useState(false);
  const [detailHasReinforcement, setDetailHasReinforcement] = useState(false);
  const [detailPhoto, setDetailPhoto] = useState<string | undefined>(undefined);
  const [studentDirty, setStudentDirty] = useState(false);
  const unsavedDialog = useUnsavedChangesDialog();
  const [isProcessingPhoto, setIsProcessingPhoto] = useState(false);
  const [followUps, setFollowUps] = useState<StudentFollowUp[]>([]);
  const [followUpDraft, setFollowUpDraft] = useState<StudentFollowUpDraft>(() => defaultFollowUpDraft(toLocalIsoDate()));
  const [editingFollowUpId, setEditingFollowUpId] = useState("");
  const [activeDetailTab, setActiveDetailTab] = useState<StudentDetailTab>("data");
  const originalFollowUp = followUps.find((item) => item.id === editingFollowUpId);
  const baselineFollowUp = originalFollowUp ? {
    date: originalFollowUp.date, kind: originalFollowUp.kind, title: originalFollowUp.title,
    notes: originalFollowUp.notes, nextStep: originalFollowUp.nextStep ?? "", resolved: originalFollowUp.resolved
  } : defaultFollowUpDraft(toLocalIsoDate());
  const followUpDirty = JSON.stringify(followUpDraft) !== JSON.stringify(baselineFollowUp);
  const followUpRecovery = useRecoverableDraft<FollowUpRecovery>(
    selectedStudentId ? `follow-up:${selectedStudentId}` : null,
    { editingId: editingFollowUpId, draft: followUpDraft }, followUpDirty, isFollowUpRecovery,
    (saved) => { setEditingFollowUpId(saved.editingId); setFollowUpDraft(saved.draft); setActiveDetailTab("follow-up"); }
  );
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const selectedCourseRef = useRef("");
  const appliedStudentLinkRef = useRef("");

  useEffect(() => {
    const targetStudentId = searchParams.get("studentId");
    if (!targetStudentId || appliedStudentLinkRef.current === targetStudentId) return;
    const targetStudent = students.find((student) => student.id === targetStudentId);
    if (!targetStudent) return;
    appliedStudentLinkRef.current = targetStudentId;
    setSelectedCourseId(targetStudent.classId);
    setSelectedStudentId(targetStudent.id);
    selectedCourseRef.current = targetStudent.classId;
  }, [searchParams, setSelectedCourseId, students]);

  useEffect(() => {
    if (!isReady) return;
    if (courses.length === 0) {
      setSelectedCourseId("");
      return;
    }
    const exists = courses.some((course) => course.id === selectedCourseId);
    if (!selectedCourseId || !exists) {
      setSelectedCourseId(courses[0].id);
    }
  }, [courses, isReady, selectedCourseId, setSelectedCourseId]);

  const filteredStudents = useMemo(
    () => students.filter((student) => student.classId === selectedCourseId),
    [selectedCourseId, students]
  );

  useEffect(() => {
    if (filteredStudents.length === 0) {
      setSelectedStudentId("");
      selectedCourseRef.current = selectedCourseId;
      return;
    }
    const exists = filteredStudents.some((student) => student.id === selectedStudentId);
    const courseChanged = selectedCourseRef.current !== selectedCourseId;
    selectedCourseRef.current = selectedCourseId;
    if (courseChanged || !selectedStudentId || !exists) {
      setSelectedStudentId(filteredStudents[0].id);
    }
  }, [filteredStudents, selectedCourseId, selectedStudentId]);

  const selectedStudent = useMemo(
    () => students.find((s) => s.id === selectedStudentId) ?? null,
    [students, selectedStudentId]
  );

  useEffect(() => {
    if (!selectedStudent) {
      setDetailFirstName("");
      setDetailLastName("");
      setDetailEmail("");
      setDetailComments("");
      setDetailHasAcs(false);
      setDetailHasReinforcement(false);
      setDetailPhoto(undefined);
      setStudentDirty(false);
      setFollowUps([]);
      setEditingFollowUpId("");
      setFollowUpDraft(defaultFollowUpDraft(toLocalIsoDate()));
      return;
    }
    setDetailFirstName(selectedStudent.firstName ?? "");
    setDetailLastName(selectedStudent.lastName ?? "");
    setDetailEmail(selectedStudent.email ?? "");
    setDetailComments(selectedStudent.comments ?? "");
    setDetailHasAcs(Boolean(selectedStudent.hasAcs));
    setDetailHasReinforcement(Boolean(selectedStudent.hasReinforcement));
    setDetailPhoto(selectedStudent.photoDataUrl);
    setStudentDirty(false);
  }, [selectedStudent]);

  useEffect(() => {
    setEditingFollowUpId("");
    setFollowUpDraft(defaultFollowUpDraft(toLocalIsoDate()));
  }, [selectedStudentId]);

  useEffect(() => {
    let active = true;
    const loadFollowUps = async (): Promise<void> => {
      if (!selectedStudentId) {
        if (active) setFollowUps([]);
        return;
      }
      const rows = await db.studentFollowUps.where("studentId").equals(selectedStudentId).toArray();
      rows.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
      if (active) {
        setFollowUps(rows);
      }
    };
    void loadFollowUps();
    return () => {
      active = false;
    };
  }, [selectedStudentId]);

  // Debounced autosave. updateStudent is omitted because the context recreates its reference on each render.
  useEffect(() => {
    if (!studentDirty || !selectedStudent || isProcessingPhoto) return;
    const firstName = detailFirstName.trim();
    const lastName = detailLastName.trim();
    if (firstName.length < 2 || lastName.length < 2 || !selectedCourseId) return;
    const id = selectedStudent.id;
    const courseId = selectedCourseId;
    const photo = detailPhoto;
    const comments = detailComments;
    const email = detailEmail;
    const hasAcs = detailHasAcs;
    const hasReinforcement = detailHasReinforcement;
    const timer = setTimeout(() => {
      void updateStudent(id, firstName, lastName, courseId, photo, comments, email, hasAcs, hasReinforcement).then((saved) => {
        if (!saved) return;
        if (courseId) {
          setSelectedCourseId(courseId);
        }
        setStudentDirty(false);
      });
    }, 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentDirty, isProcessingPhoto, detailFirstName, detailLastName, detailEmail, detailComments, detailHasAcs, detailHasReinforcement, selectedCourseId, detailPhoto, selectedStudent?.id]);

  const saveIfDirty = useCallback(async (): Promise<boolean> => {
    if (!studentDirty || !selectedStudent) return true;
    if (isProcessingPhoto) return false;
    const firstName = detailFirstName.trim();
    const lastName = detailLastName.trim();
    const courseId = selectedCourseId;
    const saved = await updateStudent(
      selectedStudent.id,
      firstName,
      lastName,
      courseId,
      detailPhoto,
      detailComments,
      detailEmail,
      detailHasAcs,
      detailHasReinforcement
    );
    if (!saved) return false;
    if (courseId) {
      setSelectedCourseId(courseId);
    }
    setStudentDirty(false);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentDirty, isProcessingPhoto, detailFirstName, detailLastName, detailEmail, detailComments, detailHasAcs, detailHasReinforcement, selectedCourseId, detailPhoto, selectedStudent?.id]);

  useUnsavedChangesGuard(studentDirty || followUpDirty, "Hay cambios del alumno o del seguimiento sin guardar.", async () => {
    if (followUpDirty) return false;
    return saveIfDirty();
  });

  const confirmDiscardFollowUp = useCallback(async (): Promise<boolean> => {
    const message = "Hay un seguimiento sin guardar. Puedes quedarte para guardarlo o recuperar su borrador al volver.";
    return unsavedDialog ? await unsavedDialog.confirmLeave(message) : window.confirm(message);
  }, [unsavedDialog]);

  const changeSelectedCourse = useCallback(async (courseId: string) => {
    if (followUpDirty && !(await confirmDiscardFollowUp())) return;
    if (!(await saveIfDirty())) return;
    setSelectedCourseId(courseId);
  }, [saveIfDirty, setSelectedCourseId, followUpDirty, confirmDiscardFollowUp]);

  const changeSelectedStudent = useCallback(async (studentId: string) => {
    if (followUpDirty && !(await confirmDiscardFollowUp())) return;
    if (!(await saveIfDirty())) return;
    setSelectedStudentId(studentId);
  }, [saveIfDirty, followUpDirty, confirmDiscardFollowUp]);

  const handleDetailTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentTab: StudentDetailTab
  ): void => {
    const currentIndex = STUDENT_DETAIL_TABS.findIndex((tab) => tab.id === currentTab);
    let nextIndex = currentIndex;

    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % STUDENT_DETAIL_TABS.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + STUDENT_DETAIL_TABS.length) % STUDENT_DETAIL_TABS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = STUDENT_DETAIL_TABS.length - 1;
    else return;

    event.preventDefault();
    const nextTab = STUDENT_DETAIL_TABS[nextIndex].id;
    setActiveDetailTab(nextTab);
    document.getElementById(`student-detail-tab-${nextTab}`)?.focus();
  };

  const resetFollowUpForm = (): void => {
    setEditingFollowUpId("");
    setFollowUpDraft(defaultFollowUpDraft(toLocalIsoDate()));
  };

  const editFollowUp = (followUp: StudentFollowUp): void => {
    setEditingFollowUpId(followUp.id);
    setFollowUpDraft({
      date: followUp.date,
      kind: followUp.kind,
      title: followUp.title,
      notes: followUp.notes,
      nextStep: followUp.nextStep ?? "",
      resolved: followUp.resolved
    });
  };

  const saveFollowUp = async (): Promise<void> => {
    if (!selectedStudent) {
      return;
    }
    const normalized = normalizeFollowUpDraft(followUpDraft);
    if (!normalized) {
      setNotice("El seguimiento necesita fecha válida, título y notas.");
      return;
    }
    const id = editingFollowUpId || crypto.randomUUID();
    try {
      await db.transaction("rw", db.studentFollowUps, async () => {
        const original = await db.studentFollowUps.get(id);
        if (editingFollowUpId && !original) throw new Error("El seguimiento ya no existe. Crea un registro nuevo.");
        const updated = updateFollowUpDetails(original ?? {
          id, studentId: selectedStudent.id, classId: selectedStudent.classId, ...normalized
        }, followUpDraft);
        if (updated) await db.studentFollowUps.put(updated);
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo guardar el seguimiento. El borrador se conserva.");
      return;
    }
    const rows = await db.studentFollowUps.where("studentId").equals(selectedStudent.id).toArray();
    rows.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
    setFollowUps(rows);
    resetFollowUpForm();
    followUpRecovery.discard();
    setNotice(editingFollowUpId ? "Seguimiento actualizado." : "Seguimiento añadido.");
  };

  const deleteFollowUp = async (followUpId: string): Promise<void> => {
    if (!window.confirm("¿Eliminar este seguimiento? Esta acción no se puede deshacer.")) return;
    await db.studentFollowUps.delete(followUpId);
    setFollowUps((current) => current.filter((item) => item.id !== followUpId));
    if (editingFollowUpId === followUpId) {
      resetFollowUpForm();
    }
    setNotice("Seguimiento eliminado.");
  };

  return (
    <article className="management-card">
      <h1 className="sr-only">Alumnado</h1>
      <DraftRecoveryNotice {...followUpRecovery} />
      <SubnavActions>
        <span role="status" className={`subnav-chip ${studentDirty ? "warning" : "success"}`}>{studentDirty ? "Cambios del alumno pendientes de guardar" : "Datos del alumno guardados"}</span>
      </SubnavActions>
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
            <span className="courses-list-actions">
              <button
                type="button"
                className="btn secondary"
                onClick={async () => {
                  if (followUpDirty && !(await confirmDiscardFollowUp())) return;
                  if (!(await saveIfDirty())) return;
                  const targetCourseId = selectedCourseId || courses[0]?.id;
                  const createdId = await createEmptyStudent(targetCourseId);
                  if (createdId) {
                    if (targetCourseId) {
                      setSelectedCourseId(targetCourseId);
                    }
                    setSelectedStudentId(createdId);
                  }
                }}
              >Añadir alumno</button>
            </span>
          </div>

          <div
            className="courses-list section-tabs"
            role="group"
            aria-label="Secciones de alumnos"
          >
            {filteredStudents.map((student) => {
              const courseName = courses.find((course) => course.id === student.classId)?.name;
              return (
                <div key={student.id} className="courses-list-row">
                  <button
                    type="button"
                    aria-pressed={selectedStudentId === student.id}
                    className={`section-tab ${selectedStudentId === student.id ? "active" : ""}`}
                    onClick={() => {
                      void changeSelectedStudent(student.id);
                    }}
                  >
                    <span className="student-item-name">
                      {student.photoDataUrl ? (
                        <img
                          className="student-avatar"
                          src={student.photoDataUrl}
                          alt={formatName(student)}
                        />
                      ) : (
                        <span className="student-avatar-placeholder">-</span>
                      )}
                      {formatName(student) || "Sin nombre"}
                    </span>
                    <small>{courseName || "Sin curso"}</small>
                  </button>
                  <IconButton
                    icon="delete"
                    label={`Eliminar ${formatName(student) || "alumno"}`}
                    onClick={async () => {
                      const studentName = formatName(student) || "este alumno";
                      if (!window.confirm(`¿Eliminar a “${studentName}”? Esta acción no se puede deshacer.`)) return;
                      if (!(await saveIfDirty())) return;
                      await deleteStudent(student.id);
                    }}
                  />
                </div>
              );
            })}
          </div>
        </aside>

        <section className="course-detail-panel">
          {selectedStudent ? (
            <>
              <div className="course-detail-header">
                <div>
                  <h2>Ficha del alumno</h2>
                </div>
              </div>

              <div className="detail-summary">
                {selectedCourseId ? (
                  <span className="pill">
                    {courses.find((course) => course.id === selectedCourseId)?.name ?? selectedCourseId}
                  </span>
                ) : (
                  <span className="pill warning">
                    Sin curso asignado
                  </span>
                )}
              </div>

              <div className="student-detail-tabs" role="tablist" aria-label="Secciones de la ficha del alumno">
                {STUDENT_DETAIL_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    id={`student-detail-tab-${tab.id}`}
                    aria-controls={`student-detail-panel-${tab.id}`}
                    aria-selected={activeDetailTab === tab.id}
                    tabIndex={activeDetailTab === tab.id ? 0 : -1}
                    className={activeDetailTab === tab.id ? "active" : ""}
                    onClick={() => setActiveDetailTab(tab.id)}
                    onKeyDown={(event) => handleDetailTabKeyDown(event, tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <section
                className="detail-section student-detail-tab-panel"
                role="tabpanel"
                id="student-detail-panel-data"
                aria-labelledby="student-detail-tab-data"
                hidden={activeDetailTab !== "data"}
                tabIndex={0}
              >
                <h3>Datos del alumno</h3>
                <div className="student-detail-top">
                  {/* Foto */}
                  <div className="student-photo-box">
                    <button
                      type="button"
                      className="student-photo-trigger"
                      title={
                        isProcessingPhoto ? "Procesando foto..." : "Pulsa para cambiar la foto"
                      }
                      onClick={() => photoInputRef.current?.click()}
                      disabled={isProcessingPhoto}
                    >
                      {detailPhoto ? (
                        <img
                          className="student-profile-photo"
                          src={detailPhoto}
                          alt="Foto del alumno"
                        />
                      ) : (
                        <div className="student-profile-photo placeholder">Sin foto</div>
                      )}
                    </button>
                    <input
                      ref={photoInputRef}
                      className="student-photo-input-hidden"
                      type="file"
                      aria-label={`Seleccionar foto de ${formatName(selectedStudent)}`}
                      accept="image/*"
                      disabled={isProcessingPhoto}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        setIsProcessingPhoto(true);
                        void resizeImageToMaxSide(file, 200)
                          .then((value) => {
                            setDetailPhoto(value);
                            setStudentDirty(true);
                          })
                          .catch((error) => {
                            const message = error instanceof Error ? error.message : "No se pudo procesar la imagen.";
                            setNotice(message);
                          })
                          .finally(() => {
                            setIsProcessingPhoto(false);
                          });
                      }}
                    />
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => {
                        setDetailPhoto(undefined);
                        setStudentDirty(true);
                      }}
                      disabled={!detailPhoto || isProcessingPhoto}
                    >
                      Eliminar foto
                    </button>
                  </div>

                  <div className="detail-grid">
                    <div className="detail-field compact-field">
                      <label>Nombre</label>
                      <input
                        className="input"
                        placeholder="Nombre"
                        value={detailFirstName}
                        onChange={(event) => {
                          setDetailFirstName(event.target.value);
                          setStudentDirty(true);
                        }}
                      />
                    </div>
                    <div className="detail-field compact-field">
                      <label>Apellidos</label>
                      <input
                        className="input"
                        placeholder="Apellidos"
                        value={detailLastName}
                        onChange={(event) => {
                          setDetailLastName(event.target.value);
                          setStudentDirty(true);
                        }}
                      />
                    </div>
                    <div className="detail-field full compact-field">
                      <label>Email</label>
                      <input
                        className="input"
                        type="email"
                        placeholder="correo@centro.es"
                        value={detailEmail}
                        onChange={(event) => {
                          setDetailEmail(event.target.value);
                          setStudentDirty(true);
                        }}
                      />
                    </div>
                    <div className="detail-field full">
                      <label>Medidas educativas</label>
                      <div className="student-support-options">
                        <label className="chip-toggle">
                          <input
                            type="checkbox"
                            checked={detailHasAcs}
                            onChange={(event) => {
                              setDetailHasAcs(event.target.checked);
                              setStudentDirty(true);
                            }}
                          />
                          <span>ACS</span>
                        </label>
                        <label className="chip-toggle">
                          <input
                            type="checkbox"
                            checked={detailHasReinforcement}
                            onChange={(event) => {
                              setDetailHasReinforcement(event.target.checked);
                              setStudentDirty(true);
                            }}
                          />
                          <span>Refuerzo</span>
                        </label>
                      </div>
                    </div>
                    <div className="detail-field full">
                      <label>Comentarios</label>
                      <textarea
                        className="input"
                        rows={5}
                        placeholder="Comentarios del alumno"
                        value={detailComments}
                        onChange={(event) => {
                          setDetailComments(event.target.value);
                          setStudentDirty(true);
                        }}
                      />
                    </div>
                  </div>
                </div>
              </section>

              <section
                className="detail-section student-detail-tab-panel"
                role="tabpanel"
                id="student-detail-panel-follow-up"
                aria-labelledby="student-detail-tab-follow-up"
                hidden={activeDetailTab !== "follow-up"}
                tabIndex={0}
              >
                <div className="course-detail-header">
                  <h3>Seguimiento tutorial</h3>
                  <button type="button" className="btn secondary" onClick={async () => {
                    if (followUpDirty && !(await confirmDiscardFollowUp())) return;
                    resetFollowUpForm(); followUpRecovery.discard();
                  }}>
                    Nuevo registro
                  </button>
                </div>
                <div className="follow-up-form">
                  <label className="detail-field compact-field">
                    <span>Fecha</span>
                    <input
                      className="input"
                      type="date"
                      value={followUpDraft.date}
                      onChange={(event) => setFollowUpDraft((current) => ({ ...current, date: event.target.value }))}
                    />
                  </label>
                  <label className="detail-field compact-field">
                    <span>Tipo</span>
                    <select
                      className="input"
                      value={followUpDraft.kind}
                      onChange={(event) =>
                        setFollowUpDraft((current) => ({
                          ...current,
                          kind: event.target.value as StudentFollowUpKind
                        }))
                      }
                    >
                      {FOLLOW_UP_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {followUpKindLabel(kind)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="detail-field compact-field">
                    <span>Título</span>
                    <input
                      className="input"
                      value={followUpDraft.title}
                      placeholder="Ej. Entrevista con familia"
                      onChange={(event) => setFollowUpDraft((current) => ({ ...current, title: event.target.value }))}
                    />
                  </label>
                  <label className="chip-toggle follow-up-resolved-toggle">
                    <input
                      type="checkbox"
                      checked={followUpDraft.resolved}
                      onChange={(event) => setFollowUpDraft((current) => ({ ...current, resolved: event.target.checked }))}
                    />
                    <span>Resuelto</span>
                  </label>
                  <label className="detail-field full">
                    <span>Notas</span>
                    <textarea
                      className="input"
                      value={followUpDraft.notes}
                      placeholder="Evidencias, acuerdos, incidencias o medidas observadas"
                      onChange={(event) => setFollowUpDraft((current) => ({ ...current, notes: event.target.value }))}
                    />
                  </label>
                  <label className="detail-field full compact-field">
                    <span>Próximo paso</span>
                    <input
                      className="input"
                      value={followUpDraft.nextStep}
                      placeholder="Ej. Revisar evolución la próxima semana"
                      onChange={(event) => setFollowUpDraft((current) => ({ ...current, nextStep: event.target.value }))}
                    />
                  </label>
                  <div className="inline-form full">
                    <button type="button" className="btn secondary" onClick={() => void saveFollowUp()}>
                      {editingFollowUpId ? "Actualizar seguimiento" : "Añadir seguimiento"}
                    </button>
                    {editingFollowUpId ? (
                      <button type="button" className="btn secondary" onClick={resetFollowUpForm}>
                        Cancelar edición
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="follow-up-list">
                  {followUps.map((followUp) => (
                    <article key={followUp.id} className={`follow-up-card ${followUp.resolved ? "resolved" : ""}`}>
                      <div>
                        <strong>{followUp.title}</strong>
                        <span>
                          {followUp.date} · {followUpKindLabel(followUp.kind)} · {followUp.resolved ? "Resuelto" : "Abierto"}
                        </span>
                      </div>
                      <p>{followUp.notes}</p>
                      {followUp.nextStep ? <small>Próximo paso: {followUp.nextStep}</small> : null}
                      <div className="inline-form tight">
                        <button type="button" className="btn secondary" onClick={async () => {
                          if (followUpDirty && !(await confirmDiscardFollowUp())) return;
                          editFollowUp(followUp);
                        }}>
                          Editar
                        </button>
                        <button
                          type="button"
                          className="btn secondary management-danger-btn"
                          onClick={() => void deleteFollowUp(followUp.id)}
                        >
                          Eliminar
                        </button>
                      </div>
                    </article>
                  ))}
                  {followUps.length === 0 ? (
                    <p className="hint">No hay seguimiento tutorial registrado para este alumno.</p>
                  ) : null}
                </div>
              </section>

              <div
                className="student-detail-tab-panel"
                role="tabpanel"
                id="student-detail-panel-resources"
                aria-labelledby="student-detail-tab-resources"
                hidden={activeDetailTab !== "resources"}
                tabIndex={0}
              >
                <ResourceManager ownerType="student" ownerId={selectedStudent.id} />
              </div>
            </>
          ) : (
            <p className="empty-state">No hay alumnos para mostrar.</p>
          )}
        </section>
      </div>

    </article>
  );
}
