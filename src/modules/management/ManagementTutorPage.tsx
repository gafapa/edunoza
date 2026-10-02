import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  decryptBackupPayload,
  encryptBackupPayload,
  isEncryptedBackupEnvelope,
  type EncryptedBackupEnvelope
} from "../../shared/backup/encryption";
import { db } from "../../shared/db/database";
import type {
  FamilyContact,
  FamilyContactChannel,
  FollowUpPriority,
  FollowUpStatus,
  Student,
  StudentFollowUp,
  StudentFollowUpKind,
  SupportGroup,
  SupportGroupMember
} from "../../shared/db/types";
import {
  buildHandoffMergePreview,
  createStudentHandoffPayload,
  HANDOFF_TABLE_NAMES,
  parseStudentHandoffPayload,
  selectHandoffRowsToCreate,
  type HandoffMergePreview,
  type HandoffTables,
  type StudentHandoffPayload
} from "../../shared/handoff/handoff";
import { FOLLOW_UP_KINDS, followUpKindLabel } from "../../shared/students/followUp";
import { toLocalIsoDate } from "../../shared/utils/date";
import { useStudentDisplay } from "../../shared/hooks/useStudentDisplay";
import { useManagement } from "./ManagementContext";
import { useUnsavedChangesGuard } from "../../shared/hooks/useUnsavedChangesGuard";
import { useRecoverableDraft } from "../../shared/hooks/useRecoverableDraft";
import { DraftRecoveryNotice } from "../../shared/ui/DraftRecoveryNotice";

type TutorView = "followUps" | "contacts" | "groups" | "handoff";

type FollowUpDraft = {
  studentId: string;
  date: string;
  kind: StudentFollowUpKind;
  title: string;
  notes: string;
  nextStep: string;
  dueDate: string;
  responsiblePerson: string;
  priority: FollowUpPriority;
  status: FollowUpStatus;
};

type ContactDraft = {
  studentId: string;
  date: string;
  channel: FamilyContactChannel;
  contactName: string;
  relationship: string;
  summary: string;
  agreements: string;
  nextStep: string;
  dueDate: string;
  responsiblePerson: string;
};

type GroupDraft = {
  id: string;
  name: string;
  responsiblePerson: string;
  focus: string;
  memberIds: string[];
};

type TutorRecovery = { followUp: FollowUpDraft; contact: ContactDraft; group: GroupDraft; view: TutorView };
function isTutorRecovery(value: unknown): value is TutorRecovery {
  if (!value || typeof value !== "object") return false;
  const saved = value as TutorRecovery;
  return Boolean(saved.followUp && saved.contact && saved.group) &&
    ["followUps", "contacts", "groups", "handoff"].includes(saved.view) &&
    Object.keys(defaultFollowUpDraft()).every((key) => typeof saved.followUp[key as keyof FollowUpDraft] === "string") &&
    Object.keys(defaultContactDraft()).every((key) => typeof saved.contact[key as keyof ContactDraft] === "string") &&
    [saved.group.id, saved.group.name, saved.group.responsiblePerson, saved.group.focus].every((item) => typeof item === "string") &&
    Array.isArray(saved.group.memberIds) && saved.group.memberIds.every((item) => typeof item === "string");
}

const VIEW_LABELS: Array<{ id: TutorView; label: string }> = [
  { id: "followUps", label: "Seguimientos" },
  { id: "contacts", label: "Familias" },
  { id: "groups", label: "Grupos de apoyo" },
  { id: "handoff", label: "Relevo" }
];

const CONTACT_CHANNELS: FamilyContactChannel[] = ["phone", "email", "meeting", "message", "other"];

function contactChannelLabel(channel: FamilyContactChannel): string {
  if (channel === "phone") return "Teléfono";
  if (channel === "email") return "Correo";
  if (channel === "meeting") return "Reunión";
  if (channel === "message") return "Mensajería";
  return "Otro";
}

function priorityLabel(priority: FollowUpPriority): string {
  if (priority === "high") return "Alta";
  if (priority === "low") return "Baja";
  return "Normal";
}

function statusLabel(status: FollowUpStatus): string {
  if (status === "inProgress") return "En curso";
  if (status === "done") return "Completado";
  return "Pendiente";
}

function defaultFollowUpDraft(): FollowUpDraft {
  const today = toLocalIsoDate();
  return {
    studentId: "",
    date: today,
    kind: "tutorial",
    title: "",
    notes: "",
    nextStep: "",
    dueDate: today,
    responsiblePerson: "",
    priority: "normal",
    status: "open"
  };
}

function defaultContactDraft(): ContactDraft {
  return {
    studentId: "",
    date: toLocalIsoDate(),
    channel: "phone",
    contactName: "",
    relationship: "",
    summary: "",
    agreements: "",
    nextStep: "",
    dueDate: "",
    responsiblePerson: ""
  };
}

function defaultGroupDraft(): GroupDraft {
  return { id: "", name: "", responsiblePerson: "", focus: "", memberIds: [] };
}

function downloadJson(payload: unknown, label: string): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = `edunoza-${label}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ManagementTutorPage() {
  const { courses, students, setNotice } = useManagement();
  const { formatName, compareFn } = useStudentDisplay();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [view, setView] = useState<TutorView>("followUps");
  const [followUps, setFollowUps] = useState<StudentFollowUp[]>([]);
  const [contacts, setContacts] = useState<FamilyContact[]>([]);
  const [supportGroups, setSupportGroups] = useState<SupportGroup[]>([]);
  const [supportMembers, setSupportMembers] = useState<SupportGroupMember[]>([]);
  const [followUpDraft, setFollowUpDraft] = useState<FollowUpDraft>(defaultFollowUpDraft);
  const [contactDraft, setContactDraft] = useState<ContactDraft>(defaultContactDraft);
  const [groupDraft, setGroupDraft] = useState<GroupDraft>(defaultGroupDraft);
  const [studentGroupFilter, setStudentGroupFilter] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const existingGroup = supportGroups.find((item) => item.id === groupDraft.id);
  const groupBaseline = existingGroup ? {
    id: existingGroup.id, name: existingGroup.name, responsiblePerson: existingGroup.responsiblePerson,
    focus: existingGroup.focus ?? "", memberIds: supportMembers.filter((item) => item.supportGroupId === existingGroup.id).map((item) => item.studentId)
  } : defaultGroupDraft();
  const hasTutorDraft = JSON.stringify(followUpDraft) !== JSON.stringify(defaultFollowUpDraft()) ||
    JSON.stringify(contactDraft) !== JSON.stringify(defaultContactDraft()) || JSON.stringify(groupDraft) !== JSON.stringify(groupBaseline);
  useUnsavedChangesGuard(hasTutorDraft, "Hay un registro tutorial sin guardar. Puedes recuperar su borrador al volver.");
  const tutorRecovery = useRecoverableDraft<TutorRecovery>("tutor", { followUp: followUpDraft, contact: contactDraft, group: groupDraft, view }, hasTutorDraft, isTutorRecovery,
    (saved) => { setFollowUpDraft(saved.followUp); setContactDraft(saved.contact); setGroupDraft(saved.group); setView(saved.view); });
  const [isSaving, setIsSaving] = useState(false);
  const [selectedHandoffStudentIds, setSelectedHandoffStudentIds] = useState<string[]>([]);
  const [exportPassword, setExportPassword] = useState("");
  const [exportPasswordConfirmation, setExportPasswordConfirmation] = useState("");
  const [encryptedImport, setEncryptedImport] = useState<EncryptedBackupEnvelope | null>(null);
  const [importPassword, setImportPassword] = useState("");
  const [incomingHandoff, setIncomingHandoff] = useState<StudentHandoffPayload | null>(null);
  const [mergePreview, setMergePreview] = useState<HandoffMergePreview | null>(null);

  const loadTutorData = useCallback(async (): Promise<void> => {
    const [followUpRows, contactRows, groupRows, memberRows] = await Promise.all([
      db.studentFollowUps.toArray(),
      db.familyContacts.toArray(),
      db.supportGroups.toArray(),
      db.supportGroupMembers.toArray()
    ]);
    setFollowUps(followUpRows);
    setContacts(contactRows);
    setSupportGroups(groupRows.sort((left, right) => left.name.localeCompare(right.name)));
    setSupportMembers(memberRows);
  }, []);

  useEffect(() => {
    void loadTutorData().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Error desconocido";
      setNotice(`No se pudo cargar la tutoría: ${message}.`);
    });
  }, [loadTutorData, setNotice]);

  const studentById = useMemo(
    () => new Map(students.map((student) => [student.id, student])),
    [students]
  );
  const courseById = useMemo(
    () => new Map(courses.map((course) => [course.id, course])),
    [courses]
  );
  const sortedStudents = useMemo(() => [...students].sort(compareFn), [compareFn, students]);
  const selectableStudents = sortedStudents.filter((student) =>
    student.id === followUpDraft.studentId || student.id === contactDraft.studentId ||
    ((!studentGroupFilter || student.classId === studentGroupFilter) && formatName(student).toLocaleLowerCase("es").includes(studentSearch.trim().toLocaleLowerCase("es")))
  );
  const today = toLocalIsoDate();
  const normalizedFollowUps = useMemo(
    () =>
      followUps
        .map((followUp) => ({
          ...followUp,
          priority: followUp.priority ?? "normal",
          status: followUp.status ?? (followUp.resolved ? "done" : "open")
        }))
        .sort(
          (left, right) =>
            (left.status === "done" ? 1 : 0) - (right.status === "done" ? 1 : 0) ||
            (left.dueDate ?? "9999-12-31").localeCompare(right.dueDate ?? "9999-12-31") ||
            right.date.localeCompare(left.date)
        ),
    [followUps]
  );
  const openFollowUps = normalizedFollowUps.filter((item) => item.status !== "done");
  const overdueFollowUps = openFollowUps.filter((item) => item.dueDate && item.dueDate < today);
  const overdueContacts = contacts.filter((item) => item.dueDate && item.dueDate < today);
  const overdueCount = overdueFollowUps.length + overdueContacts.length;
  const highPriorityFollowUps = openFollowUps.filter((item) => item.priority === "high");

  const groupMemberIds = useCallback(
    (groupId: string): string[] =>
      supportMembers.filter((member) => member.supportGroupId === groupId).map((member) => member.studentId),
    [supportMembers]
  );

  const saveFollowUp = async (): Promise<void> => {
    const student = studentById.get(followUpDraft.studentId);
    if (
      !student ||
      followUpDraft.title.trim().length < 2 ||
      followUpDraft.notes.trim().length < 2 ||
      !followUpDraft.dueDate ||
      followUpDraft.responsiblePerson.trim().length < 2
    ) {
      setNotice("Completa alumno, título, notas, fecha límite y responsable.");
      return;
    }
    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      await db.studentFollowUps.add({
        id: crypto.randomUUID(),
        studentId: student.id,
        classId: student.classId,
        date: followUpDraft.date,
        kind: followUpDraft.kind,
        title: followUpDraft.title.trim(),
        notes: followUpDraft.notes.trim(),
        nextStep: followUpDraft.nextStep.trim() || undefined,
        dueDate: followUpDraft.dueDate,
        responsiblePerson: followUpDraft.responsiblePerson.trim(),
        priority: followUpDraft.priority,
        status: followUpDraft.status,
        resolved: followUpDraft.status === "done",
        createdAt: now,
        updatedAt: now
      });
      setFollowUpDraft(defaultFollowUpDraft());
      tutorRecovery.discard();
      await loadTutorData();
      setNotice("Seguimiento añadido.");
    } finally {
      setIsSaving(false);
    }
  };

  const setFollowUpStatus = async (followUp: StudentFollowUp, status: FollowUpStatus): Promise<void> => {
    await db.studentFollowUps.put({
      ...followUp,
      status,
      resolved: status === "done",
      updatedAt: new Date().toISOString()
    });
    await loadTutorData();
    setNotice(`Seguimiento marcado como ${statusLabel(status).toLowerCase()}.`);
  };

  const deleteFollowUp = async (followUp: StudentFollowUp): Promise<void> => {
    if (!window.confirm(`¿Eliminar el seguimiento "${followUp.title}"? Esta acción no se puede deshacer.`)) return;
    await db.studentFollowUps.delete(followUp.id);
    await loadTutorData();
    setNotice("Seguimiento eliminado.");
  };

  const saveContact = async (): Promise<void> => {
    const student = studentById.get(contactDraft.studentId);
    if (
      !student ||
      contactDraft.contactName.trim().length < 2 ||
      contactDraft.relationship.trim().length < 2 ||
      contactDraft.summary.trim().length < 2
    ) {
      setNotice("Completa alumno, contacto, relación y resumen.");
      return;
    }
    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      await db.familyContacts.add({
        id: crypto.randomUUID(),
        studentId: student.id,
        classId: student.classId,
        date: contactDraft.date,
        channel: contactDraft.channel,
        contactName: contactDraft.contactName.trim(),
        relationship: contactDraft.relationship.trim(),
        summary: contactDraft.summary.trim(),
        agreements: contactDraft.agreements.trim() || undefined,
        nextStep: contactDraft.nextStep.trim() || undefined,
        dueDate: contactDraft.dueDate || undefined,
        responsiblePerson: contactDraft.responsiblePerson.trim() || undefined,
        createdAt: now,
        updatedAt: now
      });
      setContactDraft(defaultContactDraft());
      tutorRecovery.discard();
      await loadTutorData();
      setNotice("Contacto familiar registrado.");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteContact = async (contact: FamilyContact): Promise<void> => {
    if (!window.confirm(`¿Eliminar el contacto con ${contact.contactName}? Esta acción no se puede deshacer.`)) return;
    await db.familyContacts.delete(contact.id);
    await loadTutorData();
    setNotice("Contacto familiar eliminado.");
  };

  const editSupportGroup = (group: SupportGroup): void => {
    setGroupDraft({
      id: group.id,
      name: group.name,
      responsiblePerson: group.responsiblePerson,
      focus: group.focus ?? "",
      memberIds: groupMemberIds(group.id)
    });
  };

  const toggleGroupMember = (studentId: string): void => {
    setGroupDraft((current) => ({
      ...current,
      memberIds: current.memberIds.includes(studentId)
        ? current.memberIds.filter((id) => id !== studentId)
        : [...current.memberIds, studentId]
    }));
  };

  const saveSupportGroup = async (): Promise<void> => {
    if (
      groupDraft.name.trim().length < 2 ||
      groupDraft.responsiblePerson.trim().length < 2 ||
      groupDraft.memberIds.length === 0
    ) {
      setNotice("El grupo necesita nombre, responsable y al menos un alumno.");
      return;
    }
    setIsSaving(true);
    try {
      const id = groupDraft.id || crypto.randomUUID();
      const existing = supportGroups.find((group) => group.id === id);
      const now = new Date().toISOString();
      await db.transaction("rw", db.supportGroups, db.supportGroupMembers, async () => {
        await db.supportGroups.put({
          id,
          name: groupDraft.name.trim(),
          responsiblePerson: groupDraft.responsiblePerson.trim(),
          focus: groupDraft.focus.trim() || undefined,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now
        });
        const existingMemberIds = await db.supportGroupMembers.where("supportGroupId").equals(id).primaryKeys();
        await db.supportGroupMembers.bulkDelete(existingMemberIds);
        await db.supportGroupMembers.bulkAdd(
          groupDraft.memberIds.map((studentId) => ({
            id: crypto.randomUUID(),
            supportGroupId: id,
            studentId,
            createdAt: now
          }))
        );
      });
      setGroupDraft(defaultGroupDraft());
      await loadTutorData();
      setNotice(existing ? "Grupo de apoyo actualizado." : "Grupo de apoyo creado.");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteSupportGroup = async (group: SupportGroup): Promise<void> => {
    if (!window.confirm(`¿Eliminar el grupo de apoyo "${group.name}"? Se quitará también su alumnado asociado. Esta acción no se puede deshacer.`)) return;
    await db.transaction("rw", db.supportGroups, db.supportGroupMembers, async () => {
      const memberIds = await db.supportGroupMembers.where("supportGroupId").equals(group.id).primaryKeys();
      await db.supportGroupMembers.bulkDelete(memberIds);
      await db.supportGroups.delete(group.id);
    });
    if (groupDraft.id === group.id) setGroupDraft(defaultGroupDraft());
    await loadTutorData();
    setNotice("Grupo de apoyo eliminado.");
  };

  const selectSupportGroupForHandoff = (groupId: string): void => {
    const ids = groupMemberIds(groupId);
    setSelectedHandoffStudentIds((current) => [...new Set([...current, ...ids])]);
  };

  const toggleHandoffStudent = (studentId: string): void => {
    setSelectedHandoffStudentIds((current) =>
      current.includes(studentId)
        ? current.filter((id) => id !== studentId)
        : [...current, studentId]
    );
  };

  const readHandoffTables = async (): Promise<HandoffTables> => {
    const [
      classGroups,
      studentRows,
      followUpRows,
      familyContactRows,
      supportGroupRows,
      supportMemberRows
    ] = await Promise.all([
      db.classGroups.toArray(),
      db.students.toArray(),
      db.studentFollowUps.toArray(),
      db.familyContacts.toArray(),
      db.supportGroups.toArray(),
      db.supportGroupMembers.toArray()
    ]);
    return {
      classGroups,
      students: studentRows,
      studentFollowUps: followUpRows,
      familyContacts: familyContactRows,
      supportGroups: supportGroupRows,
      supportGroupMembers: supportMemberRows
    };
  };

  const exportHandoff = async (): Promise<void> => {
    if (
      selectedHandoffStudentIds.length === 0 ||
      exportPassword.length < 12 ||
      exportPassword !== exportPasswordConfirmation
    ) {
      setNotice("Selecciona alumnado y usa dos contraseñas iguales de al menos 12 caracteres.");
      return;
    }
    setIsSaving(true);
    try {
      const payload = createStudentHandoffPayload(
        await readHandoffTables(),
        selectedHandoffStudentIds
      );
      downloadJson(await encryptBackupPayload(payload, exportPassword), "relevo-cifrado");
      setExportPassword("");
      setExportPasswordConfirmation("");
      setNotice(`Paquete cifrado creado para ${payload.tables.students.length} alumnos.`);
    } finally {
      setIsSaving(false);
    }
  };

  const prepareEncryptedImport = async (file: File): Promise<void> => {
    if (file.size > 10 * 1024 * 1024) {
      setNotice("El paquete de relevo supera el límite de 10 MB.");
      return;
    }
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      if (!isEncryptedBackupEnvelope(parsed)) {
        throw new Error("El archivo no es un paquete cifrado de Edunoza.");
      }
      setEncryptedImport(parsed);
      setImportPassword("");
      setIncomingHandoff(null);
      setMergePreview(null);
      setNotice("Paquete cifrado preparado. Introduce su contraseña.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Archivo no válido";
      setNotice(message);
    }
  };

  const decryptAndPreview = async (): Promise<void> => {
    if (!encryptedImport || !importPassword) return;
    setIsSaving(true);
    try {
      const payload = parseStudentHandoffPayload(
        await decryptBackupPayload(encryptedImport, importPassword)
      );
      const preview = buildHandoffMergePreview(payload.tables, await readHandoffTables());
      setIncomingHandoff(payload);
      setMergePreview(preview);
      setNotice(
        preview.conflictCount > 0
          ? "Hay conflictos de identidad. No se modificará ningún dato."
          : "Previsualización lista. Revisa los cambios antes de combinar."
      );
    } finally {
      setIsSaving(false);
    }
  };

  const mergeHandoff = async (): Promise<void> => {
    if (!incomingHandoff || !mergePreview || mergePreview.conflictCount > 0) return;
    setIsSaving(true);
    try {
      const rows = selectHandoffRowsToCreate(incomingHandoff.tables, mergePreview);
      await db.transaction(
        "rw",
        [
          db.classGroups,
          db.students,
          db.studentFollowUps,
          db.familyContacts,
          db.supportGroups,
          db.supportGroupMembers
        ],
        async () => {
          if (rows.classGroups.length) await db.classGroups.bulkAdd(rows.classGroups);
          if (rows.students.length) await db.students.bulkAdd(rows.students);
          if (rows.studentFollowUps.length) await db.studentFollowUps.bulkAdd(rows.studentFollowUps);
          if (rows.familyContacts.length) await db.familyContacts.bulkAdd(rows.familyContacts);
          if (rows.supportGroups.length) await db.supportGroups.bulkAdd(rows.supportGroups);
          if (rows.supportGroupMembers.length) await db.supportGroupMembers.bulkAdd(rows.supportGroupMembers);
        }
      );
      await loadTutorData();
      setEncryptedImport(null);
      setIncomingHandoff(null);
      setMergePreview(null);
      setImportPassword("");
      setNotice(`Relevo combinado: ${mergePreview.createCount} registros añadidos sin sobrescrituras.`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <article className="management-card tutor-page">
      <DraftRecoveryNotice {...tutorRecovery} />
      <header className="tutor-hero">
        <h1 className="sr-only">Tutoría y apoyos</h1>
        <div className="tutor-hero-metrics" aria-label="Resumen tutorial">
          <span><strong>{openFollowUps.length}</strong> pendientes</span>
          <span className={overdueCount ? "urgent" : ""} title="Seguimientos y próximos pasos de contacto con fecha límite pasada"><strong>{overdueCount}</strong> vencidos</span>
          <span><strong>{supportGroups.length}</strong> grupos</span>
        </div>
      </header>

      <fieldset className="tutor-form-grid">
        <legend>Filtrar opciones de alumnado</legend>
        <label className="compact-field"><span>Grupo del alumno</span><select value={studentGroupFilter} onChange={(event) => setStudentGroupFilter(event.target.value)}>
          <option value="">Todos los grupos</option>
          {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
        </select></label>
        <label className="compact-field"><span>Buscar alumno</span><input type="search" value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} /></label>
        <p className="hint">Filtra las opciones de los formularios. El alumno ya seleccionado se conserva.</p>
      </fieldset>
      <div className="tutor-tabs" role="tablist" aria-label="Áreas de tutoría">
        {VIEW_LABELS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`tutor-tab-${item.id}`}
            aria-controls={`tutor-panel-${item.id}`}
            aria-selected={view === item.id}
            className={view === item.id ? "active" : ""}
            onClick={() => setView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {view === "followUps" ? (
        <section
          className="tutor-panel"
          role="tabpanel"
          id="tutor-panel-followUps"
          aria-labelledby="tutor-tab-followUps"
        >
          <div className="tutor-panel-heading">
            <div>
              <h2>Próximos pasos</h2>
              <p>{highPriorityFollowUps.length} de prioridad alta.</p>
            </div>
          </div>
          <div className="tutor-form-grid">
            <label className="compact-field">
              <span>Alumno</span>
              <select value={followUpDraft.studentId} onChange={(event) => setFollowUpDraft((current) => ({ ...current, studentId: event.target.value }))}>
                <option value="">Seleccionar</option>
                {selectableStudents.map((student) => <option key={student.id} value={student.id}>{formatName(student)} · {courseById.get(student.classId)?.name}</option>)}
              </select>
            </label>
            <label className="compact-field"><span>Fecha</span><input type="date" value={followUpDraft.date} onChange={(event) => setFollowUpDraft((current) => ({ ...current, date: event.target.value }))} /></label>
            <label className="compact-field">
              <span>Tipo</span>
              <select value={followUpDraft.kind} onChange={(event) => setFollowUpDraft((current) => ({ ...current, kind: event.target.value as StudentFollowUpKind }))}>
                {FOLLOW_UP_KINDS.map((kind) => <option key={kind} value={kind}>{followUpKindLabel(kind)}</option>)}
              </select>
            </label>
            <label className="compact-field"><span>Fecha límite</span><input type="date" value={followUpDraft.dueDate} onChange={(event) => setFollowUpDraft((current) => ({ ...current, dueDate: event.target.value }))} /></label>
            <label className="compact-field"><span>Responsable</span><input value={followUpDraft.responsiblePerson} onChange={(event) => setFollowUpDraft((current) => ({ ...current, responsiblePerson: event.target.value }))} placeholder="Tutor, PT, AL…" /></label>
            <label className="compact-field">
              <span>Prioridad</span>
              <select value={followUpDraft.priority} onChange={(event) => setFollowUpDraft((current) => ({ ...current, priority: event.target.value as FollowUpPriority }))}>
                <option value="low">Baja</option><option value="normal">Normal</option><option value="high">Alta</option>
              </select>
            </label>
            <label className="wide compact-field"><span>Título</span><input value={followUpDraft.title} onChange={(event) => setFollowUpDraft((current) => ({ ...current, title: event.target.value }))} /></label>
            <label className="wide"><span>Notas</span><textarea value={followUpDraft.notes} onChange={(event) => setFollowUpDraft((current) => ({ ...current, notes: event.target.value }))} /></label>
            <label className="wide compact-field"><span>Próximo paso</span><input value={followUpDraft.nextStep} onChange={(event) => setFollowUpDraft((current) => ({ ...current, nextStep: event.target.value }))} /></label>
          </div>
          <button type="button" className="btn primary" disabled={isSaving} onClick={() => void saveFollowUp()}>Añadir seguimiento</button>

          <div className="tutor-card-list" aria-live="polite">
            {normalizedFollowUps.map((followUp) => {
              const student = studentById.get(followUp.studentId);
              const overdue = followUp.status !== "done" && Boolean(followUp.dueDate && followUp.dueDate < today);
              return (
                <article key={followUp.id} className={`tutor-case-card priority-${followUp.priority} ${followUp.status === "done" ? "done" : ""}`}>
                  <div className="tutor-case-main">
                    <div className="tutor-case-kicker">
                      <span>{student ? formatName(student) : "Alumno no disponible"}</span>
                      <span>{student ? courseById.get(student.classId)?.name : ""}</span>
                    </div>
                    <h3>{followUp.title}</h3>
                    <p>{followUp.notes}</p>
                    {followUp.nextStep ? <small>Próximo paso: {followUp.nextStep}</small> : null}
                  </div>
                  <dl className="tutor-case-meta">
                    <div><dt>Responsable</dt><dd>{followUp.responsiblePerson ?? "Sin asignar"}</dd></div>
                    <div><dt>Fecha límite</dt><dd className={overdue ? "overdue" : ""}>{followUp.dueDate ?? "Sin fecha"}</dd></div>
                    <div><dt>Prioridad</dt><dd>{priorityLabel(followUp.priority)}</dd></div>
                    <div><dt>Estado</dt><dd>{statusLabel(followUp.status)}</dd></div>
                  </dl>
                  <div className="tutor-card-actions">
                    {followUp.status !== "done" ? <>
                      {followUp.status === "open" ? <button type="button" className="btn secondary" onClick={() => void setFollowUpStatus(followUp, "inProgress")}>Empezar</button> : null}
                      <button type="button" className="btn secondary" onClick={() => void setFollowUpStatus(followUp, "done")}>Completar</button>
                    </> : null}
                    <button type="button" className="btn secondary management-danger-btn" onClick={() => void deleteFollowUp(followUp)}>Eliminar</button>
                  </div>
                </article>
              );
            })}
            {normalizedFollowUps.length === 0 ? <p className="empty-state">No hay seguimientos registrados.</p> : null}
          </div>
        </section>
      ) : null}

      {view === "contacts" ? (
        <section className="tutor-panel" role="tabpanel" id="tutor-panel-contacts" aria-labelledby="tutor-tab-contacts">
          <div className="tutor-panel-heading"><div><h2>Contactos con familias</h2><p>Registro estructurado de comunicaciones y acuerdos.</p></div></div>
          <div className="tutor-form-grid">
            <label className="compact-field"><span>Alumno</span><select value={contactDraft.studentId} onChange={(event) => setContactDraft((current) => ({ ...current, studentId: event.target.value }))}><option value="">Seleccionar</option>{selectableStudents.map((student) => <option key={student.id} value={student.id}>{formatName(student)} · {courseById.get(student.classId)?.name}</option>)}</select></label>
            <label className="compact-field"><span>Fecha</span><input type="date" value={contactDraft.date} onChange={(event) => setContactDraft((current) => ({ ...current, date: event.target.value }))} /></label>
            <label className="compact-field"><span>Canal</span><select value={contactDraft.channel} onChange={(event) => setContactDraft((current) => ({ ...current, channel: event.target.value as FamilyContactChannel }))}>{CONTACT_CHANNELS.map((channel) => <option key={channel} value={channel}>{contactChannelLabel(channel)}</option>)}</select></label>
            <label className="compact-field"><span>Persona contactada</span><input value={contactDraft.contactName} onChange={(event) => setContactDraft((current) => ({ ...current, contactName: event.target.value }))} /></label>
            <label className="compact-field"><span>Relación</span><input value={contactDraft.relationship} onChange={(event) => setContactDraft((current) => ({ ...current, relationship: event.target.value }))} placeholder="Madre, padre, tutor legal…" /></label>
            <label className="compact-field"><span>Responsable del próximo paso</span><input value={contactDraft.responsiblePerson} onChange={(event) => setContactDraft((current) => ({ ...current, responsiblePerson: event.target.value }))} /></label>
            <label className="wide"><span>Resumen</span><textarea value={contactDraft.summary} onChange={(event) => setContactDraft((current) => ({ ...current, summary: event.target.value }))} /></label>
            <label className="wide"><span>Acuerdos</span><textarea value={contactDraft.agreements} onChange={(event) => setContactDraft((current) => ({ ...current, agreements: event.target.value }))} /></label>
            <label className="compact-field"><span>Próximo paso</span><input value={contactDraft.nextStep} onChange={(event) => setContactDraft((current) => ({ ...current, nextStep: event.target.value }))} /></label>
            <label className="compact-field"><span>Fecha límite</span><input type="date" value={contactDraft.dueDate} onChange={(event) => setContactDraft((current) => ({ ...current, dueDate: event.target.value }))} /></label>
          </div>
          <button type="button" className="btn primary" disabled={isSaving} onClick={() => void saveContact()}>Registrar contacto</button>
          <div className="tutor-card-list">
            {[...contacts].sort((left, right) => right.date.localeCompare(left.date)).map((contact) => {
              const student = studentById.get(contact.studentId);
              const contactOverdue = Boolean(contact.dueDate && contact.dueDate < today);
              return (
                <article key={contact.id} className="tutor-contact-card">
                  <div><span className="eyebrow">{contact.date} · {contactChannelLabel(contact.channel)}</span><h3>{student ? formatName(student) : "Alumno no disponible"}</h3><p>{contact.summary}</p></div>
                  <dl className="tutor-case-meta"><div><dt>Contacto</dt><dd>{contact.contactName} · {contact.relationship}</dd></div>{contact.agreements ? <div><dt>Acuerdos</dt><dd>{contact.agreements}</dd></div> : null}{contact.nextStep ? <div><dt>Próximo paso</dt><dd className={contactOverdue ? "overdue" : ""}>{contact.nextStep}{contact.dueDate ? ` · ${contact.dueDate}` : ""}</dd></div> : null}</dl>
                  <div className="tutor-card-actions">
                    <button type="button" className="btn secondary management-danger-btn" onClick={() => void deleteContact(contact)}>Eliminar</button>
                  </div>
                </article>
              );
            })}
            {contacts.length === 0 ? <p className="empty-state">No hay contactos familiares registrados.</p> : null}
          </div>
        </section>
      ) : null}

      {view === "groups" ? (
        <section className="tutor-panel" role="tabpanel" id="tutor-panel-groups" aria-labelledby="tutor-tab-groups">
          <div className="tutor-panel-heading"><div><h2>Grupos de apoyo transversales</h2><p>Un mismo expediente de alumno puede participar en apoyos con compañeros de otros cursos.</p></div><button type="button" className="btn secondary" onClick={() => setGroupDraft(defaultGroupDraft())}>Nuevo grupo</button></div>
          <div className="tutor-form-grid">
            <label className="compact-field"><span>Nombre</span><input value={groupDraft.name} onChange={(event) => setGroupDraft((current) => ({ ...current, name: event.target.value }))} /></label>
            <label className="compact-field"><span>Responsable</span><input value={groupDraft.responsiblePerson} onChange={(event) => setGroupDraft((current) => ({ ...current, responsiblePerson: event.target.value }))} /></label>
            <label className="wide compact-field"><span>Foco de intervención</span><input value={groupDraft.focus} onChange={(event) => setGroupDraft((current) => ({ ...current, focus: event.target.value }))} placeholder="Lectoescritura, comunicación, funciones ejecutivas…" /></label>
          </div>
          <fieldset className="tutor-student-picker">
            <legend>Alumnado del grupo</legend>
            {courses.map((course) => (
              <section key={course.id}>
                <h3>{course.name}</h3>
                <div>
                  {sortedStudents.filter((student) => student.classId === course.id).map((student) => (
                    <label key={student.id}><input type="checkbox" checked={groupDraft.memberIds.includes(student.id)} onChange={() => toggleGroupMember(student.id)} /><span>{formatName(student)}</span></label>
                  ))}
                </div>
              </section>
            ))}
          </fieldset>
          <button type="button" className="btn primary" disabled={isSaving} onClick={() => void saveSupportGroup()}>{groupDraft.id ? "Actualizar grupo" : "Crear grupo"}</button>
          <div className="tutor-group-grid">
            {supportGroups.map((group) => {
              const memberIds = groupMemberIds(group.id);
              const representedCourses = new Set(memberIds.map((id) => studentById.get(id)?.classId).filter(Boolean));
              return (
                <article key={group.id} className="tutor-group-card">
                  <span className="eyebrow">{representedCourses.size} cursos · {memberIds.length} alumnos</span>
                  <h3>{group.name}</h3>
                  <p>{group.focus || "Sin foco descrito"}</p>
                  <small>Responsable: {group.responsiblePerson}</small>
                  <div className="tutor-group-members">{memberIds.map((id) => <span key={id}>{studentById.get(id) ? formatName(studentById.get(id) as Student) : id}</span>)}</div>
                  <div className="tutor-card-actions">
                    <button type="button" className="btn secondary" onClick={() => editSupportGroup(group)}>Editar</button>
                    <button type="button" className="btn secondary management-danger-btn" onClick={() => void deleteSupportGroup(group)}>Eliminar</button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {view === "handoff" ? (
        <section className="tutor-panel" role="tabpanel" id="tutor-panel-handoff" aria-labelledby="tutor-tab-handoff">
          <div className="tutor-panel-heading"><div><h2>Relevo cifrado y selectivo</h2><p>Comparte solo expedientes, seguimientos, contactos y grupos seleccionados. Nunca incluye notas ni asistencia.</p></div></div>
          <form className="handoff-layout" onSubmit={(event) => event.preventDefault()}>
            <section className="handoff-card">
              <h3>1. Seleccionar alcance</h3>
              <div className="handoff-group-shortcuts">{supportGroups.map((group) => <button type="button" className="btn secondary" key={group.id} onClick={() => selectSupportGroupForHandoff(group.id)}>Añadir {group.name}</button>)}</div>
              <div className="handoff-student-list">{sortedStudents.map((student) => <label key={student.id}><input type="checkbox" checked={selectedHandoffStudentIds.includes(student.id)} onChange={() => toggleHandoffStudent(student.id)} /><span>{formatName(student)}<small>{courseById.get(student.classId)?.name}</small></span></label>)}</div>
            </section>
            <section className="handoff-card">
              <h3>2. Proteger y descargar</h3>
              <label className="compact-field"><span>Contraseña</span><input type="password" autoComplete="new-password" minLength={12} value={exportPassword} onChange={(event) => setExportPassword(event.target.value)} /></label>
              <label className="compact-field"><span>Repetir contraseña</span><input type="password" autoComplete="new-password" minLength={12} value={exportPasswordConfirmation} onChange={(event) => setExportPasswordConfirmation(event.target.value)} /></label>
              <button type="button" className="btn primary" disabled={isSaving || selectedHandoffStudentIds.length === 0 || exportPassword.length < 12 || exportPassword !== exportPasswordConfirmation} onClick={() => void exportHandoff()}>Descargar relevo cifrado</button>
            </section>
            <section className="handoff-card">
              <h3>Importar sin sobrescribir</h3>
              <input ref={importInputRef} className="student-photo-input-hidden" type="file" accept=".json,application/json" aria-label="Seleccionar paquete de relevo cifrado" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void prepareEncryptedImport(file); }} />
              <button type="button" className="btn secondary" onClick={() => importInputRef.current?.click()}>Seleccionar paquete</button>
              {encryptedImport ? <><label className="compact-field"><span>Contraseña del paquete</span><input type="password" autoComplete="current-password" value={importPassword} onChange={(event) => setImportPassword(event.target.value)} /></label><button type="button" className="btn secondary" disabled={isSaving || !importPassword} onClick={() => void decryptAndPreview()}>Descifrar y previsualizar</button></> : null}
            </section>
          </form>
          {mergePreview && incomingHandoff ? (
            <section className={`handoff-preview ${mergePreview.conflictCount ? "has-conflicts" : ""}`} aria-live="polite">
              <div><h3>Previsualización de mezcla</h3><p>{mergePreview.createCount} nuevos · {mergePreview.unchangedCount} ya presentes · {mergePreview.conflictCount} conflictos</p></div>
              <div className="handoff-preview-grid">
                {HANDOFF_TABLE_NAMES.map((tableName) => <div key={tableName}><strong>{tableName}</strong><span>+{mergePreview.tables[tableName].createIds.length}</span><span>={mergePreview.tables[tableName].unchangedIds.length}</span><span>!{mergePreview.tables[tableName].conflictIds.length}</span></div>)}
              </div>
              {mergePreview.conflictCount ? <p role="alert">Hay IDs que representan datos diferentes. Por seguridad no se combinará nada; solicita un paquete corregido.</p> : <button type="button" className="btn primary" disabled={isSaving} onClick={() => void mergeHandoff()}>Combinar sin sobrescrituras</button>}
            </section>
          ) : null}
        </section>
      ) : null}
    </article>
  );
}
