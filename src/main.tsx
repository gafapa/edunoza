import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { unstable_HistoryRouter as HistoryRouter } from "react-router-dom";
import type { HistoryRouterProps, To } from "react-router-dom";
import { createBrowserHistory } from "history";
import { Provider } from "react-redux";
import App from "./App";
import { store } from "./app/store";
import { AppErrorBoundary } from "./shared/ui/AppErrorBoundary";
import { UnsavedChangesDialogProvider } from "./shared/ui/UnsavedChangesDialog";
import "./styles.css";
import "./styles/public.css";
import "./styles/feedback-recovery.css";
import "./styles/workspace.css";
import "./shared/ui/compactForms.css";

function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  let reloading = false;
  let hadController = Boolean(navigator.serviceWorker.controller);
  let updatePromptShown = false;
  const offerUpdate = (worker: ServiceWorker): void => {
    if (!navigator.serviceWorker.controller || updatePromptShown) return;
    updatePromptShown = true;
    const shouldReload = window.confirm(
      "Hay una nueva versión de Edunoza. ¿Quieres recargar ahora?"
    );
    if (shouldReload) {
      worker.postMessage({ type: "SKIP_WAITING" });
    }
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // The first claim already uses this build; reload only when a worker replaces it.
    if (!hadController) { hadController = true; return; }
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then((registration) => {
        if (registration.waiting) {
          offerUpdate(registration.waiting);
        }
        registration.addEventListener("updatefound", () => {
          const installingWorker = registration.installing;
          if (!installingWorker) return;
          installingWorker.addEventListener("statechange", () => {
            if (installingWorker.state !== "installed" || !navigator.serviceWorker.controller) return;
            offerUpdate(registration.waiting ?? installingWorker);
          });
        });
      })
      .catch((error: unknown) => {
        console.error("Edunoza could not register its offline worker.", error);
      });
  });
}

registerServiceWorker();
const rawHistory = createBrowserHistory();
type RouterHistory = HistoryRouterProps["history"];
type BlockableRouterHistory = RouterHistory & {
  block: (blocker: (tx: { retry: () => void }) => void) => () => void;
};

const appHistory: BlockableRouterHistory = {
  get action() {
    return rawHistory.action as RouterHistory["action"];
  },
  get location() {
    return rawHistory.location as RouterHistory["location"];
  },
  createHref(to: To) {
    return rawHistory.createHref(to as any);
  },
  createURL(to: To) {
    const href = rawHistory.createHref(to as any);
    return new URL(href, window.location.origin);
  },
  encodeLocation(to: To) {
    const url = this.createURL(to);
    return {
      pathname: url.pathname,
      search: url.search,
      hash: url.hash
    };
  },
  push(to: To, state?: any) {
    rawHistory.push(to as any, state);
  },
  replace(to: To, state?: any) {
    rawHistory.replace(to as any, state);
  },
  go(delta: number) {
    rawHistory.go(delta);
  },
  listen(listener) {
    return rawHistory.listen((update) => {
      listener({
        action: update.action as RouterHistory["action"],
        location: update.location as RouterHistory["location"],
        delta: null
      });
    });
  },
  block(blocker) {
    return rawHistory.block((tx) => blocker({ retry: tx.retry }));
  }
};

function resolveRouterBase(): string {
  const rawBase = import.meta.env.BASE_URL || "/";
  const normalized = rawBase.endsWith("/") ? rawBase.slice(0, -1) : rawBase;
  return normalized.length > 0 ? normalized : "/";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <Provider store={store}>
        <UnsavedChangesDialogProvider>
          <HistoryRouter history={appHistory} basename={resolveRouterBase()}>
            <App />
          </HistoryRouter>
        </UnsavedChangesDialogProvider>
      </Provider>
    </AppErrorBoundary>
  </StrictMode>
);
