export function registerServiceWorker(baseUrl: string): void {
  if (!("serviceWorker" in navigator)) return;
  let reloading = false;
  let hadController = Boolean(navigator.serviceWorker.controller);
  let updatePromptShown = false;
  const offerUpdate = (worker: ServiceWorker): void => {
    // WebKit can deliver the first installed event after the worker claims this page.
    // Only a different, still-waiting worker represents an available update.
    if (!navigator.serviceWorker.controller || worker === navigator.serviceWorker.controller ||
        worker.state !== "installed" || updatePromptShown) return;
    updatePromptShown = true;
    if (window.confirm("Hay una nueva versión de Edunoza. ¿Quieres recargar ahora?")) {
      worker.postMessage({ type: "SKIP_WAITING" });
    }
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) { hadController = true; return; }
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
  const register = (): void => {
    void navigator.serviceWorker
      .register(`${baseUrl}sw.js`, { scope: baseUrl })
      .then((registration) => {
        const watchedWorkers = new WeakSet<ServiceWorker>();
        const watchInstallingWorker = (): void => {
          const worker = registration.installing;
          if (!worker || watchedWorkers.has(worker)) return;
          watchedWorkers.add(worker);
          worker.addEventListener("statechange", () => offerUpdate(worker));
          offerUpdate(worker);
        };
        registration.addEventListener("updatefound", watchInstallingWorker);
        // Installation may have started before register() resolves.
        watchInstallingWorker();
        if (registration.waiting) offerUpdate(registration.waiting);
      })
      .catch((error: unknown) => {
        console.error("Edunoza could not register its offline worker.", error);
      });
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
