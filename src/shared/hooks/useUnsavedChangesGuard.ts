import { useCallback, useEffect, useRef } from "react";
import { useBeforeUnload, useBlocker } from "react-router-dom";
import { useUnsavedChangesDialog } from "../ui/UnsavedChangesDialog";

const DEFAULT_MESSAGE = "Tienes cambios sin guardar. Si sales ahora, se perderan.";

type Guard = { when: boolean; message: string; beforeLeave?: () => Promise<boolean> };

// React Router supports a single active blocker, but nested pages (e.g. the tutor panel inside
// the students page) can each have unsaved changes. Pages register here and one blocker decides.
const guards = new Set<{ current: Guard }>();

function dirtyGuards(): { current: Guard }[] {
  return [...guards].filter((guard) => guard.current.when);
}

export function useUnsavedChangesGuard(when: boolean, message = DEFAULT_MESSAGE, beforeLeave?: () => Promise<boolean>): void {
  const latest = useRef<Guard>({ when, message, beforeLeave });
  useEffect(() => { latest.current = { when, message, beforeLeave }; }, [when, message, beforeLeave]);
  useEffect(() => {
    guards.add(latest);
    return () => { guards.delete(latest); };
  }, []);

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
}

/** The app's only navigation blocker; mount once inside the data router. */
export function UnsavedChangesBlocker(): null {
  const dialog = useUnsavedChangesDialog();
  const blocker = useBlocker(() => dirtyGuards().length > 0);
  const latestBlocker = useRef(blocker);
  const navigating = useRef(false);
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
        // Pages that can save on their own do so first; any page left dirty needs a decision.
        const pending: { current: Guard }[] = [];
        for (const guard of dirtyGuards()) {
          let saved = false;
          const save = guard.current.beforeLeave;
          if (save) {
            try {
              saved = await save();
            } catch {
              // A failed save still requires an explicit decision to discard changes.
            }
          }
          if (!saved) pending.push(guard);
        }
        const stillDirty = pending.filter((guard) => guard.current.when);
        if (stillDirty.length === 0) {
          leave();
          return;
        }
        const prompt = stillDirty[0].current.message;
        const shouldLeave = dialog ? await dialog.confirmLeave(prompt) : window.confirm(prompt);
        if (shouldLeave) leave();
        else stay();
      } catch {
        // Stay on the current form if a save fails unexpectedly.
        stay();
      } finally {
        navigating.current = false;
      }
    })();
  }, [blocker.state, dialog]);
  return null;
}
