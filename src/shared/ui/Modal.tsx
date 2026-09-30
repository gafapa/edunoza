import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./IconButton";

const openPanels: HTMLElement[] = [];
const originalInert = new Map<HTMLElement, boolean>();
function updateModalBackground(): void {
  for (const [element, inert] of originalInert) element.inert = inert;
  originalInert.clear();
  const active = openPanels[openPanels.length - 1]?.parentElement;
  if (!active) return;
  for (const child of document.body.children) {
    if (child instanceof HTMLElement && child !== active && !["SCRIPT", "STYLE"].includes(child.tagName)) {
      originalInert.set(child, child.inert);
      child.inert = true;
    }
  }
}

type ModalProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  panelClassName?: string;
  form?: boolean;
  onClose: () => void;
  children: ReactNode;
};

export function Modal({
  open,
  title,
  subtitle,
  panelClassName = "",
  form = false,
  onClose,
  children
}: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openPanels.push(panel);
    updateModalBackground();
    const focusTimer = window.setTimeout(() => panel.focus(), 0);
    const keepFocusInside = (event: FocusEvent) => {
      if (openPanels[openPanels.length - 1] === panel && event.target instanceof Node && !panel.contains(event.target)) panel.focus();
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (openPanels[openPanels.length - 1] !== panel) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key === "Tab" && panelRef.current) {
        const focusableElements = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") && !element.closest('[hidden], [inert], [aria-hidden="true"]') && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
        if (focusableElements.length === 0) {
          event.preventDefault();
          panelRef.current.focus();
          return;
        }
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        const activeElement = document.activeElement;
        const outsideControls = !focusableElements.includes(activeElement as HTMLElement);
        if (event.shiftKey && (activeElement === firstElement || outsideControls)) {
          event.preventDefault();
          lastElement.focus();
        } else if (!event.shiftKey && (activeElement === lastElement || outsideControls)) {
          event.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", keepFocusInside);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", keepFocusInside);
      const wasTop = openPanels[openPanels.length - 1] === panel;
      const index = openPanels.indexOf(panel);
      if (index >= 0) openPanels.splice(index, 1);
      updateModalBackground();
      if (wasTop) {
        if (previousActiveElement?.isConnected && !previousActiveElement.closest("[inert]")) previousActiveElement.focus();
        else openPanels[openPanels.length - 1]?.focus();
      }
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={panelRef}
        className={`modal-panel ${panelClassName}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? descriptionId : undefined}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p id={descriptionId}>{subtitle}</p> : null}
          </div>
          <IconButton icon="close" label="Cerrar" onClick={onClose} />
        </div>
        {form ? <form className="modal-body" onSubmit={(event) => event.preventDefault()}>{children}</form> : <div className="modal-body">{children}</div>}
      </div>
    </div>,
    document.body,
  );
}
