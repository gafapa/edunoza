import { toLocalIsoDate as toIsoDate } from "../utils/date";
import type { WeekStartsOn } from "../../app/store";
import type { ScheduleDay } from "../db/types";

const DEFAULT_DAY_LABELS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

export type PlannerWeekDate = {
  date: Date;
  iso: string;
  dayOfWeek: number;
  label: string;
};

export { toIsoDate };

function fromIsoDate(value: string): Date {
  const [year, month, day] = value.split("-").map((item) => Number(item));
  return new Date(year, month - 1, day);
}

export function addDays(value: Date, amount: number): Date {
  const next = new Date(value);
  next.setDate(value.getDate() + amount);
  return next;
}

export function isoDayOfWeek(isoDate: string): number {
  const day = fromIsoDate(isoDate).getDay();
  return day === 0 ? 7 : day;
}

export function startOfWeek(value: Date, weekStartsOn: WeekStartsOn): Date {
  const jsDay = value.getDay();
  const offset = weekStartsOn === "sunday" ? jsDay : (jsDay + 6) % 7;
  return addDays(value, -offset);
}

export function formatWeekRange(weekStart: Date): string {
  const weekEnd = addDays(weekStart, 6);
  const startDay = weekStart.getDate();
  const endDay = weekEnd.getDate();
  const startMonth = new Intl.DateTimeFormat("es-ES", { month: "long" }).format(weekStart);
  const endMonth = new Intl.DateTimeFormat("es-ES", { month: "long" }).format(weekEnd);
  const startYear = weekStart.getFullYear();
  const endYear = weekEnd.getFullYear();

  if (startYear !== endYear) {
    return `${startDay} de ${startMonth} de ${startYear}–${endDay} de ${endMonth} de ${endYear}`;
  }
  if (weekStart.getMonth() !== weekEnd.getMonth()) {
    return `${startDay} de ${startMonth}–${endDay} de ${endMonth} de ${endYear}`;
  }
  return `${startDay}–${endDay} de ${endMonth} de ${endYear}`;
}

export function formatPlannerDate(value: string | Date, compact = false): string {
  const date = typeof value === "string" ? fromIsoDate(value) : value;
  return new Intl.DateTimeFormat("es-ES", compact
    ? { day: "numeric", month: "short" }
    : { day: "numeric", month: "long", year: "numeric" }
  ).format(date);
}

export function buildVisiblePlannerWeekDates(weekStart: Date, scheduleDays: ScheduleDay[]): PlannerWeekDate[] {
  const activeScheduleDays = new Map(
    scheduleDays
      .filter((day) => day.enabled)
      .map((day) => [day.dayOfWeek, day.dayName || DEFAULT_DAY_LABELS[day.dayOfWeek - 1]])
  );

  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);
    const iso = toIsoDate(date);
    const dayOfWeek = isoDayOfWeek(iso);
    const label = activeScheduleDays.get(dayOfWeek);
    if (!label) {
      return null;
    }
    return {
      date,
      iso,
      dayOfWeek,
      label
    };
  }).filter((day): day is PlannerWeekDate => day !== null);
}
