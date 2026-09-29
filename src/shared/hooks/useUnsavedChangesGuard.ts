import { useCallback, useContext, useEffect, useRef } from "react";
import { UNSAFE_NavigationContext as NavigationContext, useBeforeUnload } from "react-router-dom";
import { useUnsavedChangesDialog } from "../ui/UnsavedChangesDialog";

const DEFAULT_MESSAGE = "Tienes cambios sin guardar. Si sales ahora, se perderan.";

type BlockableNavigator = {
  block?: (blocker: (tx: { retry: () => void }) => void) => () => void;
};

export function useUnsavedChangesGuard(when: boolean, message = DEFAULT_MESSAGE, beforeLeave?: () => Promise<boolean>): void {
  const navigationContext = useContext(NavigationContext) as { navigator?: BlockableNavigator } | null;
  const dialog = useUnsavedChangesDialog();
  const latest = useRef({ when, beforeLeave });
  const navigating = useRef(false);
  useEffect(() => { latest.current = { when, beforeLeave }; }, [when, beforeLeave]);

  const handleBeforeUnload = useCallback(
    (event: BeforeUnloadEvent) => {
      if (!when) {
        return;
      }
      event.preventDefault();
      event.returnValue = message;
    },
    [message, when]
  );

  useBeforeUnload(handleBeforeUnload, { capture: true });

  useEffect(() => {
    if (!when) {
      return;
    }
    const block = navigationContext?.navigator?.block;
    if (typeof block !== "function") {
      return;
    }

    const unblock = block((tx) => {
      void (async () => {
        if (navigating.current) return;
        navigating.current = true;
        try {
          if (!latest.current.when) {
            unblock();
            tx.retry();
            return;
          }
          if (latest.current.beforeLeave) {
            let saved = false;
            try {
              saved = await latest.current.beforeLeave();
            } catch {
              // A failed save still requires an explicit decision to discard changes.
            }
            if (saved) {
              unblock();
              tx.retry();
              return;
            }
          }
          const shouldLeave = dialog
            ? await dialog.confirmLeave(message)
            : window.confirm(message);

          if (!shouldLeave) {
            return;
          }
          unblock();
          tx.retry();
        } catch {
          // Stay on the current form if a save fails unexpectedly.
        } finally {
          navigating.current = false;
        }
      })();
    });

    return unblock;
  }, [dialog, message, navigationContext, when]);
}
