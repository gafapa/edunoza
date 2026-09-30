import type { BehaviorMarkKind } from "../../shared/db/types";

type BehaviorControlsProps = {
  studentName: string;
  counts: { positive: number; negative: number };
  busy: boolean;
  onChange: (kind: BehaviorMarkKind, action: "add" | "remove") => void;
};

export function BehaviorControls({ studentName, counts, busy, onChange }: BehaviorControlsProps) {
  return <div className="today-behavior-taps" role="group" aria-label={`Conducta de ${studentName}`}>
    {(["positive", "negative"] as const).map(kind => {
      const label = kind === "positive" ? "Positivos" : "Negativos";
      const singular = kind === "positive" ? "positivo" : "negativo";
      return <div key={kind} className={`today-behavior-group ${kind}`} role="group" aria-label={`${label} de ${studentName}`}>
        <span className="today-behavior-label">{label} <output className="today-behavior-count" aria-label={`${label} de ${studentName}`}>{counts[kind]}</output></span>
        <button type="button" className={`today-behavior-tap ${kind}`} disabled={busy}
          aria-label={`Añadir ${singular} para ${studentName}`} title={`Añadir ${singular}`}
          onClick={() => onChange(kind, "add")}><span aria-hidden="true">+</span></button>
        <button type="button" className={`today-behavior-tap ${kind}`} disabled={busy || counts[kind] === 0}
          aria-label={`Retirar ${singular} de ${studentName}`} title={`Retirar el último ${singular}`}
          onClick={() => onChange(kind, "remove")}><span aria-hidden="true">−</span></button>
      </div>;
    })}
  </div>;
}
