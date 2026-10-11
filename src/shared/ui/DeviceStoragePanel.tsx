import { useCallback, useEffect, useRef, useState } from "react";
import { readDeviceStorage, requestPersistentStorage, type DeviceStorageState } from "../storage/deviceStorage";
import { formatFileSize } from "../resources/resources";

export function DeviceStoragePanel() {
  const [state, setState] = useState<DeviceStorageState | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const refresh = useCallback(async () => {
    try {
      const next = await readDeviceStorage();
      if (mounted.current) setState(next);
    } catch {
      if (mounted.current) setMessage("No se pudo consultar el almacenamiento. Puedes seguir creando copias de seguridad.");
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { mounted.current = false; window.removeEventListener("focus", onFocus); };
  }, [refresh]);
  const protect = async () => {
    setBusy(true);
    try {
      const granted = await requestPersistentStorage();
      if (mounted.current) setMessage(granted ? "El navegador ha concedido almacenamiento persistente." : "El navegador no ha concedido almacenamiento persistente. Mantén tus copias al día.");
      await refresh();
    } catch {
      if (mounted.current) setMessage("No se pudo solicitar la protección. Mantén tus copias al día.");
    } finally { if (mounted.current) setBusy(false); }
  };
  const nearlyFull = state?.usage !== null && state?.quota != null && state.quota > 0 && state.usage != null && state.usage / state.quota >= 0.8;
  return <section aria-labelledby="device-storage-title">
    <h3 id="device-storage-title">Almacenamiento de este dispositivo</h3>
    <p>{state?.usage != null && state.quota != null ? `Uso aproximado: ${formatFileSize(state.usage)} de ${formatFileSize(state.quota)} disponibles para esta aplicación.` : "El navegador puede limitar la información sobre el espacio disponible."}</p>
    <p>{state?.persistent === true ? "Almacenamiento persistente concedido." : state?.persistent === false ? "El almacenamiento todavía no es persistente." : "No se ha podido confirmar la persistencia del almacenamiento."}</p>
    {nearlyFull && <p role="alert">El almacenamiento se acerca a su límite. Descarga y comprueba una copia antes de añadir más archivos.</p>}
    <p className="hint">Esta protección reduce el borrado automático por falta de espacio. Borrar los datos del navegador o perder el dispositivo sigue eliminando el trabajo local: conserva una copia cifrada aparte.</p>
    {state && !state.supported && <p>Este navegador no permite solicitar almacenamiento persistente.</p>}
    <div className="database-action-buttons">
      {state?.supported && state.persistent !== true && <button type="button" className="btn" disabled={busy} onClick={() => void protect()}>{busy ? "Solicitando protección…" : "Proteger almacenamiento local"}</button>}
      <button type="button" className="btn" disabled={busy} onClick={() => void refresh()}>Actualizar espacio disponible</button>
    </div>
    <p role="status" aria-live="polite">{message}</p>
  </section>;
}
