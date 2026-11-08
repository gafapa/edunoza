import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, useRouteError } from "react-router-dom";
import { Provider } from "react-redux";
import App from "./App";
import { store } from "./app/store";
import { AppErrorBoundary } from "./shared/ui/AppErrorBoundary";
import { UnsavedChangesDialogProvider } from "./shared/ui/UnsavedChangesDialog";
import { UnsavedChangesBlocker } from "./shared/hooks/useUnsavedChangesGuard";
import { registerServiceWorker } from "./shared/offline/registerServiceWorker";
import "./styles.css";
import "./styles/public.css";
import "./styles/feedback-recovery.css";
import "./styles/workspace.css";
import "./shared/ui/compactForms.css";
import "./styles/redesign.css";

if (import.meta.env.PROD) registerServiceWorker(import.meta.env.BASE_URL);

function resolveRouterBase(): string {
  const rawBase = import.meta.env.BASE_URL || "/";
  const normalized = rawBase.endsWith("/") ? rawBase.slice(0, -1) : rawBase;
  return normalized.length > 0 ? normalized : "/";
}

// Let render errors reach AppErrorBoundary instead of the router's default error page.
function RethrowRouteError(): never {
  throw useRouteError();
}

// App declares its own descendant <Routes>; the data router only enables navigation blocking.
const router = createBrowserRouter(
  [{ path: "*", element: <><UnsavedChangesBlocker /><App /></>, ErrorBoundary: RethrowRouteError }],
  { basename: resolveRouterBase() }
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <Provider store={store}>
        <UnsavedChangesDialogProvider>
          <RouterProvider router={router} />
        </UnsavedChangesDialogProvider>
      </Provider>
    </AppErrorBoundary>
  </StrictMode>
);
