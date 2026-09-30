import { useSyncExternalStore } from "react";
import { hasPreferenceStorageError, PREFERENCE_STORAGE_EVENT } from "../../app/store";

function subscribe(listener: () => void): () => void {
  window.addEventListener(PREFERENCE_STORAGE_EVENT, listener);
  return () => window.removeEventListener(PREFERENCE_STORAGE_EVENT, listener);
}

export function PreferenceStorageNotice() {
  const unavailable = useSyncExternalStore(subscribe, hasPreferenceStorageError, () => false);
  return unavailable ? <p className="notice" role="status">El navegador no permite guardar las preferencias. Se usarán durante esta sesión; revisa los permisos de almacenamiento para conservarlas.</p> : null;
}
