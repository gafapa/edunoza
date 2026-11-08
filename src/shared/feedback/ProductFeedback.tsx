import { useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { trackAnalyticsEvent } from "../analytics/analytics";
import { Modal } from "../ui/Modal";

type FeedbackKind = "suggestion" | "problem" | "question";

const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  suggestion: "Sugerencia",
  problem: "Problema",
  question: "Pregunta"
};

function safeWorkspaceArea(pathname: string): string {
  if (pathname === "/") return "Presentación";
  if (pathname.startsWith("/today")) return "Hoy";
  if (pathname.startsWith("/agenda")) return "Agenda";
  if (pathname.startsWith("/classroom")) return "Aula";
  if (pathname.startsWith("/planner")) return "Planificador";
  if (pathname.startsWith("/journal/work")) return "Evaluación";
  if (pathname.startsWith("/journal/attendance")) return "Asistencia";
  if (pathname.startsWith("/gradebook")) return "Cuaderno";
  if (pathname.startsWith("/reports")) return "Informes";
  if (pathname.startsWith("/management")) return "Organización";
  if (pathname.startsWith("/config")) return "Configuración";
  return "Otra sección";
}

type ProductFeedbackPlacement = "floating" | "inline" | "status";

export function ProductFeedback({ placement = "floating" }: { placement?: ProductFeedbackPlacement }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<FeedbackKind>("suggestion");
  const [message, setMessage] = useState("");
  const [includeTechnicalContext, setIncludeTechnicalContext] = useState(true);
  const [notice, setNotice] = useState("");

  const feedbackText = useMemo(() => {
    const lines = [
      `Edunoza · ${FEEDBACK_KIND_LABELS[kind]}`,
      "",
      message.trim()
    ];
    if (includeTechnicalContext) {
      lines.push(
        "",
        "Contexto técnico sin datos académicos:",
        `- Versión: ${import.meta.env.VITE_APP_VERSION}`,
        `- Sección: ${safeWorkspaceArea(location.pathname)}`,
        `- Conexión: ${navigator.onLine ? "en línea" : "sin conexión"}`
      );
    }
    return lines.join("\n");
  }, [includeTechnicalContext, kind, location.pathname, message]);

  const openFeedback = (): void => {
    setNotice("");
    setOpen(true);
    trackAnalyticsEvent("feedback_opened");
  };

  const copyFeedback = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(feedbackText);
      setNotice("Mensaje copiado. Pégalo en el canal por el que quieras enviarlo.");
      trackAnalyticsEvent("feedback_shared");
    } catch {
      setNotice("No se pudo copiar automáticamente. Selecciona el texto y cópialo manualmente.");
    }
  };

  const shareFeedback = async (): Promise<void> => {
    if (!navigator.share) {
      await copyFeedback();
      return;
    }
    try {
      await navigator.share({
        title: `Edunoza · ${FEEDBACK_KIND_LABELS[kind]}`,
        text: feedbackText
      });
      setNotice("Mensaje preparado en la aplicación que has elegido.");
      trackAnalyticsEvent("feedback_shared");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setNotice("No se pudo abrir el menú de compartir. Puedes copiar el mensaje.");
    }
  };

  const closeFeedback = (): void => {
    setOpen(false);
    setNotice("");
  };

  return (
    <>
      <button
        type="button"
        className={
          placement === "floating"
            ? "product-feedback-trigger"
            : placement === "status"
              ? "status-bar-button product-feedback-status"
              : "btn secondary"
        }
        onClick={openFeedback}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 5h14v11H9l-4 4zM8 9h8M8 12h5" />
        </svg>
        <span>Enviar sugerencia</span>
      </button>

      <Modal
        open={open}
        title="Ayúdanos a mejorar Edunoza"
        subtitle="Tú decides qué compartes. No se adjuntan alumnado, notas ni contenido académico."
        panelClassName="product-feedback-modal"
        onClose={closeFeedback}
      >
        <form
          className="product-feedback-form"
          onSubmit={(event) => {
            event.preventDefault();
            void shareFeedback();
          }}
        >
          <label className="detail-field compact-field">
            <span>Tipo de mensaje</span>
            <select
              className="input"
              value={kind}
              onChange={(event) => setKind(event.target.value as FeedbackKind)}
            >
              {Object.entries(FEEDBACK_KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <label className="detail-field">
            <span>Mensaje</span>
            <textarea
              className="input"
              minLength={10}
              maxLength={1000}
              required
              value={message}
              placeholder="Cuéntanos qué intentabas hacer, qué ocurrió y qué esperabas. Evita incluir datos del alumnado."
              onChange={(event) => setMessage(event.target.value)}
            />
            <small>{message.length}/1000 caracteres</small>
          </label>

          <label className="product-feedback-context">
            <input
              type="checkbox"
              checked={includeTechnicalContext}
              onChange={(event) => setIncludeTechnicalContext(event.target.checked)}
            />
            <span>Incluir versión, sección y estado de conexión</span>
          </label>

          <details className="product-feedback-preview">
            <summary>Revisar el mensaje antes de compartir</summary>
            <pre>{feedbackText}</pre>
          </details>

          {notice ? <p className="notice" role="status" aria-live="polite">{notice}</p> : null}

          <div className="product-feedback-actions">
            <button
              type="button"
              className="btn secondary"
              disabled={message.trim().length < 10}
              onClick={() => void copyFeedback()}
            >
              Copiar mensaje
            </button>
            <button type="submit" className="btn primary" disabled={message.trim().length < 10}>
              Compartir comentario
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
