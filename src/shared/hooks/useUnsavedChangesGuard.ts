import { useCallback, useEffect, useRef } from "react";
import { useBeforeUnload, useBlocker } from "react-router-dom";
import { useUnsavedChangesDialog } from "../ui/UnsavedChangesDialog";

const DEFAULT_MESSAGE = "Tienes cambios sin guardar. Si sales ahora, se perderan.";

export function useUnsavedChangesGuard(when: boolean, message = DEFAULT_MESSAGE, beforeLeave?: () => Promise<boolean>): void {
  const dialog = useUnsavedChangesDialog();
  const latest = useRef({ when, beforeLeave, message, dialog });
  const navigating = useRef(false);
  useEffect(() => { latest.current = { when, beforeLeave, message, dialog }; }, [when, beforeLeave, message, dialog]);

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

  const blocker = useBlocker(when);
  const latestBlocker = useRef(blocker);
  useEffect(() => { latestBlocker.current = blocker; }, [blocker]);

  useEffect(() => {
    if (blocker.state !== "blocked" || navigating.current) {
      return;
    }
    navigating.current = true;
    const leave = () => latestBlocker.current.proceed?.();
    const stay = () => latestBlocker.current.reset?.();

    void (async () => {
      try {
        const { when: stillDirty, beforeLeave: save, message: prompt, dialog: confirmDialog } = latest.current;
        if (!stillDirty) {
          leave();
          return;
        }
        if (save) {
          let saved = false;
          try {
            saved = await save();
          } catch {
            // A failed save still requires an explicit decision to discard changes.
          }
          if (saved) {
            leave();
            return;
          }
        }
        const shouldLeave = confirmDialog
          ? await confirmDialog.confirmLeave(prompt)
          : window.confirm(prompt);

        if (shouldLeave) {
          leave();
        } else {
          stay();
        }
      } catch {
        // Stay on the current form if a save fails unexpectedly.
        stay();
      } finally {
        navigating.current = false;
      }
    })();
  }, [blocker.state]);
}
