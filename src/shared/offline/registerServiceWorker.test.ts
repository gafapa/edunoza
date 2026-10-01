import { afterEach, describe, expect, it, vi } from "vitest";
import { registerServiceWorker } from "./registerServiceWorker";

function createWorker(state: ServiceWorkerState = "installing") {
  return Object.assign(new EventTarget(), { state, postMessage: vi.fn() });
}

function createEnvironment({ controlled = false, loaded = true } = {}) {
  const active = createWorker("activated");
  const registration = Object.assign(new EventTarget(), {
    installing: null as ReturnType<typeof createWorker> | null,
    waiting: null as ReturnType<typeof createWorker> | null
  });
  const serviceWorker = Object.assign(new EventTarget(), {
    controller: controlled ? active : null,
    register: vi.fn().mockResolvedValue(registration)
  });
  const windowTarget = Object.assign(new EventTarget(), {
    confirm: vi.fn().mockReturnValue(true),
    location: { reload: vi.fn() }
  });
  vi.stubGlobal("navigator", { serviceWorker });
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("document", { readyState: loaded ? "complete" : "loading" });
  return { active, registration, serviceWorker, windowTarget };
}

afterEach(() => vi.unstubAllGlobals());

describe("offline worker registration", () => {
  it("does not mistake a late first-install event for an update or suppress the next update", async () => {
    const { registration, serviceWorker, windowTarget } = createEnvironment();
    const firstWorker = createWorker();
    registration.installing = firstWorker;
    registerServiceWorker("/");
    await Promise.resolve();
    serviceWorker.controller = firstWorker;
    serviceWorker.dispatchEvent(new Event("controllerchange"));
    firstWorker.state = "installed";
    firstWorker.dispatchEvent(new Event("statechange"));
    firstWorker.state = "activated";
    firstWorker.dispatchEvent(new Event("statechange"));
    expect(windowTarget.confirm).not.toHaveBeenCalled();
    expect(windowTarget.location.reload).not.toHaveBeenCalled();

    const update = createWorker();
    registration.installing = update;
    registration.dispatchEvent(new Event("updatefound"));
    update.state = "installed";
    update.dispatchEvent(new Event("statechange"));
    expect(windowTarget.confirm).toHaveBeenCalledOnce();
    expect(update.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    serviceWorker.controller = update;
    serviceWorker.dispatchEvent(new Event("controllerchange"));
    serviceWorker.dispatchEvent(new Event("controllerchange"));
    expect(windowTarget.location.reload).toHaveBeenCalledOnce();
  });

  it("observes an update already installing before registration resolves", async () => {
    const { registration, windowTarget } = createEnvironment({ controlled: true });
    const update = createWorker();
    registration.installing = update;
    registerServiceWorker("/app/");
    await Promise.resolve();
    update.state = "installed";
    update.dispatchEvent(new Event("statechange"));
    expect(windowTarget.confirm).toHaveBeenCalledOnce();
    expect(update.postMessage).toHaveBeenCalledOnce();
  });

  it("offers a waiting update once and leaves it waiting when declined", async () => {
    const { registration, windowTarget } = createEnvironment({ controlled: true });
    const update = createWorker("installed");
    registration.waiting = update;
    registration.installing = update;
    windowTarget.confirm.mockReturnValue(false);
    registerServiceWorker("/");
    await Promise.resolve();
    registration.dispatchEvent(new Event("updatefound"));
    update.dispatchEvent(new Event("statechange"));
    expect(windowTarget.confirm).toHaveBeenCalledOnce();
    expect(update.postMessage).not.toHaveBeenCalled();
    expect(windowTarget.location.reload).not.toHaveBeenCalled();
  });

  it("ignores an already activated worker and offers a subsequent waiting worker", async () => {
    const { registration, windowTarget } = createEnvironment({ controlled: true });
    registration.waiting = createWorker("activated");
    registerServiceWorker("/");
    await Promise.resolve();
    expect(windowTarget.confirm).not.toHaveBeenCalled();
    const update = createWorker("installed");
    registration.installing = update;
    registration.dispatchEvent(new Event("updatefound"));
    expect(update.postMessage).toHaveBeenCalledOnce();
  });

  it("registers once after load using the deployment base path", async () => {
    const { serviceWorker, windowTarget } = createEnvironment({ loaded: false });
    registerServiceWorker("/app/");
    expect(serviceWorker.register).not.toHaveBeenCalled();
    windowTarget.dispatchEvent(new Event("load"));
    windowTarget.dispatchEvent(new Event("load"));
    await Promise.resolve();
    expect(serviceWorker.register).toHaveBeenCalledExactlyOnceWith("/app/sw.js", { scope: "/app/" });
  });
});
