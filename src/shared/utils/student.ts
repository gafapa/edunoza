import type { Student } from "../db/types";
import type { StudentNameFormat, StudentSortBy } from "../../app/store";

export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const normalized = fullName.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return { firstName: "", lastName: "" };
  }
  const parts = normalized.split(" ");
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "" };
  }
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.slice(-1).join("")
  };
}


/**
 * Base comparator by last name, then first name.
 */
export function compareStudents(a: Student, b: Student): number {
  const lastA = (a.lastName || a.fullName).trim();
  const lastB = (b.lastName || b.fullName).trim();
  const byLast = lastA.localeCompare(lastB, "es", { sensitivity: "base" });
  if (byLast !== 0) return byLast;
  return (a.firstName || "").localeCompare(b.firstName || "", "es", { sensitivity: "base" });
}

/**
 * Returns a comparator for the selected sorting preference.
 */
export function compareStudentsByField(sortBy: StudentSortBy): (a: Student, b: Student) => number {
  if (sortBy === "lastName") return compareStudents;
  return (a, b) => {
    const firstA = (a.firstName || a.fullName).trim();
    const firstB = (b.firstName || b.fullName).trim();
    const byFirst = firstA.localeCompare(firstB, "es", { sensitivity: "base" });
    if (byFirst !== 0) return byFirst;
    return (a.lastName || "").localeCompare(b.lastName || "", "es", { sensitivity: "base" });
  };
}

/**
 * Formats a student name using the selected display preference.
 *   "firstLast" → "Ana García"
 *   "lastFirst"  → "García, Ana"
 */
export function formatStudentName(student: Student, format: StudentNameFormat): string {
  const first = student.firstName?.trim() ?? "";
  const last = student.lastName?.trim() ?? "";
  if (!first && !last) return student.fullName;
  if (!last) return first;
  if (!first) return last;
  return format === "lastFirst" ? `${last}, ${first}` : `${first} ${last}`;
}
