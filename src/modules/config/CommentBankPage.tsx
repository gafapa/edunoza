import { useEffect, useState } from "react";
import { db } from "../../shared/db/database";
import type { FeedbackComment, FeedbackCommentCategory } from "../../shared/db/types";
import {
  FEEDBACK_COMMENT_CATEGORIES,
  feedbackCategoryLabel,
  normalizeFeedbackComment
} from "../../shared/feedback/comments";

export function CommentBankPage() {
  const [feedbackComments, setFeedbackComments] = useState<FeedbackComment[]>([]);
  const [feedbackCategory, setFeedbackCategory] = useState<FeedbackCommentCategory>("general");
  const [feedbackText, setFeedbackText] = useState("");
  const [editingFeedbackId, setEditingFeedbackId] = useState("");
  const [feedbackNotice, setFeedbackNotice] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<FeedbackCommentCategory | "all">("all");

  const loadFeedbackComments = async (): Promise<void> => {
    const rows = await db.feedbackComments.toArray();
    setFeedbackComments(rows.sort((left, right) => left.category.localeCompare(right.category) || left.text.localeCompare(right.text)));
  };

  useEffect(() => {
    void loadFeedbackComments().catch(() => setFeedbackNotice("No se pudo cargar el banco de comentarios."));
  }, []);

  const resetFeedbackForm = (): void => {
    setEditingFeedbackId("");
    setFeedbackCategory("general");
    setFeedbackText("");
  };

  const saveFeedbackComment = async (): Promise<void> => {
    try {
      const text = normalizeFeedbackComment(feedbackText);
      const duplicate = feedbackComments.some(
        (comment) => comment.id !== editingFeedbackId && comment.category === feedbackCategory && comment.text.toLocaleLowerCase("es") === text.toLocaleLowerCase("es")
      );
      if (duplicate) throw new Error("Ya existe ese comentario en la categoría seleccionada.");
      const now = new Date().toISOString();
      const current = feedbackComments.find((comment) => comment.id === editingFeedbackId);
      await db.feedbackComments.put({
        id: current?.id ?? crypto.randomUUID(),
        category: feedbackCategory,
        text,
        createdAt: current?.createdAt ?? now,
        updatedAt: now
      });
      resetFeedbackForm();
      await loadFeedbackComments();
      setFeedbackNotice(current ? "Comentario actualizado." : "Comentario añadido al banco.");
    } catch (error) {
      setFeedbackNotice(error instanceof Error ? error.message : "No se pudo guardar el comentario.");
    }
  };

  const deleteFeedbackComment = async (comment: FeedbackComment): Promise<void> => {
    await db.feedbackComments.delete(comment.id);
    if (editingFeedbackId === comment.id) resetFeedbackForm();
    await loadFeedbackComments();
    setFeedbackNotice("Comentario eliminado.");
  };

  const usedCategories = FEEDBACK_COMMENT_CATEGORIES.filter((category) =>
    feedbackComments.some((comment) => comment.category === category)
  );
  // Fall back to every category once the filtered one has no comments left.
  const activeFilter = categoryFilter !== "all" && usedCategories.length > 1 && usedCategories.includes(categoryFilter)
    ? categoryFilter
    : "all";
  const visibleComments = activeFilter === "all"
    ? feedbackComments
    : feedbackComments.filter((comment) => comment.category === activeFilter);

  return (
    <article className="management-card">
      <section className="detail-section" aria-labelledby="feedback-bank-title">
        <h1 id="feedback-bank-title">Banco de comentarios</h1>
        <p className="hint">
          Guarda frases reutilizables. Siempre se insertan como borrador para que puedas revisarlas antes de guardar la clase o la nota.
        </p>
        <div className="feedback-bank-form">
          <label className="detail-field compact-field">
            <span>Categoría</span>
            <select className="input" value={feedbackCategory} onChange={(event) => setFeedbackCategory(event.target.value as FeedbackCommentCategory)}>
              {FEEDBACK_COMMENT_CATEGORIES.map((category) => (
                <option key={category} value={category}>{feedbackCategoryLabel(category)}</option>
              ))}
            </select>
          </label>
          <label className="detail-field feedback-bank-text">
            <span>Comentario</span>
            <textarea
              className="input"
              rows={2}
              maxLength={500}
              value={feedbackText}
              onChange={(event) => setFeedbackText(event.target.value)}
              placeholder="Ej. Participa de forma activa y argumenta sus respuestas."
            />
          </label>
          <div className="feedback-bank-actions">
            <button type="button" className="btn primary" onClick={() => void saveFeedbackComment()}>
              {editingFeedbackId ? "Actualizar comentario" : "Añadir comentario"}
            </button>
            {editingFeedbackId ? <button type="button" className="btn secondary" onClick={resetFeedbackForm}>Cancelar</button> : null}
          </div>
        </div>
        <p className="feedback-bank-notice" role="status" aria-live="polite">{feedbackNotice}</p>
        {usedCategories.length > 1 ? (
          <div className="feedback-bank-filters" role="group" aria-label="Filtrar por categoría">
            {(["all", ...usedCategories] as const).map((category) => (
              <button
                key={category}
                type="button"
                className={`feedback-bank-filter${activeFilter === category ? " active" : ""}`}
                aria-pressed={activeFilter === category}
                onClick={() => setCategoryFilter(category)}
              >
                {category === "all" ? "Todas" : feedbackCategoryLabel(category)}
              </button>
            ))}
          </div>
        ) : null}
        {visibleComments.length > 0 ? (
          <ul className="feedback-bank-list">
            {visibleComments.map((comment) => (
              <li key={comment.id}>
                <div>
                  <span>{feedbackCategoryLabel(comment.category)}</span>
                  <strong>{comment.text}</strong>
                </div>
                <div className="feedback-bank-row-actions">
                  <button type="button" className="btn secondary" onClick={() => {
                    setEditingFeedbackId(comment.id);
                    setFeedbackCategory(comment.category);
                    setFeedbackText(comment.text);
                    setFeedbackNotice("");
                  }}>Editar</button>
                  <button type="button" className="btn secondary management-danger-btn" onClick={() => void deleteFeedbackComment(comment)}>Eliminar</button>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="empty-state">Todavía no hay comentarios guardados.</p>}
      </section>

    </article>
  );
}
