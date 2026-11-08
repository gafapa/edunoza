import type { ChecklistItem, RubricCriterion, RubricLevel } from "../../shared/db/types";

export type GeneratedRubric = {
  name?: string;
  description?: string;
  criteria?: Array<{
    name?: string;
    description?: string;
    levels?: Array<{
      name?: string;
      score?: number;
    }>;
  }>;
};

export type GeneratedChecklist = {
  name?: string;
  title?: string;
  description?: string;
  items?: Array<string | { text?: string; name?: string; item?: string }>;
  checklist?: {
    name?: string;
    title?: string;
    description?: string;
    items?: Array<string | { text?: string; name?: string; item?: string }>;
  };
};

const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 600;
const MAX_CRITERIA = 8;
const MAX_LEVELS = 6;
const MAX_CHECKLIST_ITEMS = 20;

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function scoreValue(value: unknown): number | null {
  const score = Number(value);
  if (!Number.isFinite(score)) {
    return null;
  }
  return Number(Math.max(0, Math.min(10, score)).toFixed(2));
}

function extractFirstBalancedJSONObject(text: string): string | null {
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let end = start; end < text.length; end += 1) {
      const ch = text[end];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === "\"") inString = false;
        continue;
      }
      if (ch === "\"") {
        inString = true;
        continue;
      }
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) return text.slice(start, end + 1);
      }
    }
  }
  return null;
}

export function parseFirstJsonObject<T>(raw: string): T | null {
  const cleaned = raw
    .trim()
    .replace(/<think>[\s\S]*?(<\/think>|$)/gi, "")
    .replace(/```json/gi, "```")
    .replace(/```([\s\S]*?)```/g, "$1")
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/[\u201C\u201D]/g, "\"")
    .replace(/[\u2018\u2019]/g, "'");

  const candidates = [cleaned, extractFirstBalancedJSONObject(cleaned)].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export function defaultRubric(taskTitle: string): { name: string; description: string; criteria: RubricCriterion[] } {
  const levelNames = ["Excelente", "Notable", "Básico", "Inicial"];
  const scores = [4, 3, 2, 1];
  const criteria = ["Contenido", "Proceso", "Presentación"].map((name) => ({
    id: crypto.randomUUID(),
    name,
    levels: levelNames.map((levelName, index) => ({
      id: crypto.randomUUID(),
      name: levelName,
      score: scores[index]
    }))
  }));
  return {
    name: `Rúbrica: ${taskTitle || "tarea"}`,
    description: "",
    criteria
  };
}

export function defaultChecklist(taskTitle: string): { name: string; description: string; items: ChecklistItem[] } {
  const items = [
    "Completa todos los apartados solicitados",
    "Usa los contenidos trabajados en clase",
    "Explica el procedimiento o razonamiento",
    "Presenta el trabajo de forma clara y ordenada",
    "Entrega en el plazo indicado"
  ].map((text) => ({ id: crypto.randomUUID(), text }));
  return {
    name: `Lista de cotejo: ${taskTitle || "tarea"}`,
    description: "",
    items
  };
}

export function normalizeGeneratedRubric(
  generated: GeneratedRubric,
  fallbackTitle: string
): { name: string; description: string; criteria: RubricCriterion[] } | null {
  const criteria = (generated.criteria ?? [])
    .slice(0, MAX_CRITERIA)
    .map((criterion) => {
      const levels = (criterion.levels ?? [])
        .slice(0, MAX_LEVELS)
        .map((level): RubricLevel | null => {
          const name = cleanText(level.name, MAX_NAME_LENGTH);
          const score = scoreValue(level.score);
          return name && score !== null ? { id: crypto.randomUUID(), name, score } : null;
        })
        .filter((level): level is RubricLevel => Boolean(level))
        .sort((a, b) => b.score - a.score);

      return {
        id: crypto.randomUUID(),
        name: cleanText(criterion.name, MAX_NAME_LENGTH),
        description: cleanText(criterion.description, MAX_DESCRIPTION_LENGTH) || undefined,
        levels
      };
    })
    .filter((criterion) => criterion.name.length > 0 && (criterion.levels?.length ?? 0) >= 4);

  if (criteria.length < 3) return null;
  return {
    name: cleanText(generated.name, MAX_NAME_LENGTH) || `Rúbrica: ${fallbackTitle || "tarea"}`,
    description: cleanText(generated.description, MAX_DESCRIPTION_LENGTH),
    criteria
  };
}

export function normalizeGeneratedChecklist(
  generated: GeneratedChecklist,
  fallbackTitle: string
): { name: string; description: string; items: ChecklistItem[] } | null {
  const source = generated.checklist ?? generated;
  const seen = new Set<string>();
  const items = (source.items ?? [])
    .map((item): ChecklistItem | null => {
      const text =
        typeof item === "string"
          ? cleanText(item, MAX_DESCRIPTION_LENGTH)
          : cleanText(item.text ?? item.name ?? item.item, MAX_DESCRIPTION_LENGTH);
      const key = text.toLocaleLowerCase();
      if (!text || seen.has(key)) {
        return null;
      }
      seen.add(key);
      return { id: crypto.randomUUID(), text };
    })
    .filter((item): item is ChecklistItem => Boolean(item))
    .slice(0, MAX_CHECKLIST_ITEMS);

  if (items.length < 5) return null;
  return {
    name: cleanText(source.name ?? source.title, MAX_NAME_LENGTH) || `Lista de cotejo: ${fallbackTitle || "tarea"}`,
    description: cleanText(source.description, MAX_DESCRIPTION_LENGTH),
    items
  };
}
