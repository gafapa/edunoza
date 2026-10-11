import { describe, expect, it } from "vitest";
import { buildOrderedGroupRows, parseWeight } from "./gradebookPresentation";

describe("gradebook presentation boundaries", () => {
  it.each(["Infinity", "-Infinity", "NaN", "-1"])("rejects invalid weight %s", value => {
    expect(parseWeight(value)).toBeNull();
  });
  it("accepts localized numeric weights and preserves the empty default", () => {
    expect(parseWeight(" 1,25 ")).toBe(1.25);
    expect(parseWeight("")).toBe(0);
  });
  it("keeps hierarchy order and readable paths with missing parents", () => {
    const rows = buildOrderedGroupRows([
      { id: "child", classId: "c", subjectId: "s", name: "Tests", weight: 1, position: 0, parentId: "root" },
      { id: "root", classId: "c", subjectId: "s", name: "Term", weight: 1, position: 0 },
      { id: "orphan", classId: "c", subjectId: "s", name: "Other", weight: 1, position: 1, parentId: "missing" }
    ]);
    expect(rows.map(row => row.id)).toEqual(["root", "child", "orphan"]);
    expect(rows[1]).toMatchObject({ depth: 1, pathLabel: "Term / Tests" });
  });
});
