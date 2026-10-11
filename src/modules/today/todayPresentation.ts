import type { AttendanceEntry, TaskSession } from "../../shared/db/types";
import type { TodaySlot } from "./todaySlots";

export const STATUS_LABELS: Record<AttendanceEntry["status"], string> = {
  present: "Presente",
  late: "Retraso",
  absent: "Ausente"
};

export const STATUS_SHORT_LABELS: Record<AttendanceEntry["status"], string> = {
  present: "P",
  late: "R",
  absent: "A"
};

export const SESSION_STATUS_LABELS: Record<NonNullable<TaskSession["status"]>, string> = {
  planned: "Planificada",
  done: "Hecha",
  moved: "Movida",
  cancelled: "Cancelada"
};

export const DATE_LABEL_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  weekday: "long",
  day: "numeric",
  month: "long"
});

export type ExceptionalSessionDraft = {
  classId: string;
  subjectId: string;
  date: string;
  startTime: string;
  endTime: string;
  title: string;
};

export function toIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function shiftIsoDate(value: string, deltaDays: number): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + deltaDays);
  return toIsoDate(date);
}

export function formatDateLabel(value: string): string {
  return DATE_LABEL_FORMATTER.format(new Date(`${value}T12:00:00`));
}

export function toMinutes(value: string): number {
  const [hourRaw, minuteRaw] = value.split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : 0;
}

export function closestSlotKey(slots: TodaySlot[], date: string): string {
  if (slots.length === 0) return "";
  if (date !== toIsoDate(new Date())) return slots[0].key;

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const activeSlot = slots.find((slot) => toMinutes(slot.startTime) <= nowMinutes && nowMinutes <= toMinutes(slot.endTime));
  if (activeSlot) return activeSlot.key;
  const upcomingSlot = slots.find((slot) => toMinutes(slot.startTime) >= nowMinutes);
  if (upcomingSlot) return upcomingSlot.key;

  return slots.reduce((best, slot) => {
    const bestDistance = Math.abs(toMinutes(best.startTime) - nowMinutes);
    const currentDistance = Math.abs(toMinutes(slot.startTime) - nowMinutes);
    return currentDistance < bestDistance ? slot : best;
  }, slots[0]).key;
}
