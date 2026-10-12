import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

// The section tab row (rendered by TopTabs) exposes a slot where the active page
// can place its status chips and quick actions, so they share the tab line.
let target: HTMLElement | null = null;
const listeners = new Set<() => void>();

export function setSubnavActionsTarget(element: HTMLElement | null): void {
  if (target === element) return;
  target = element;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function SubnavActions({ children }: { children: ReactNode }) {
  const element = useSyncExternalStore(subscribe, () => target, () => null);
  if (!element) return <div className="subnav-actions-inline">{children}</div>;
  return createPortal(children, element);
}
