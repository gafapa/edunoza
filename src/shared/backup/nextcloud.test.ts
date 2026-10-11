import { afterEach, describe, expect, it, vi } from "vitest";
import { createNextcloudClient, nextcloudFolder, proxyFetch, proxyMessage, type ProxyRequest, type ProxyTransport } from "./nextcloud";
import { encryptBackupPayload, estimateEncryptedBackupBytes } from "./encryption";

const credentials = { server: "https://cloud.example/school", username: "teacher", password: "app-password" };
const secret = "a separate encryption password";
const payload = { students: [{ name: "Synthetic Student" }] };

describe("Nextcloud backup safety", () => {
  it("transfers and verifies a compressible snapshot that exceeds the old 10 MiB envelope limit", async () => {
    const largePayload = { text: "Synthetic local backup data. ".repeat(350_000) };
    expect(estimateEncryptedBackupBytes(largePayload)).toBeGreaterThan(10 * 1024 * 1024);
    let body = "";
    const transport: ProxyTransport = async request => {
      if (request.method === "PUT") body = request.body!;
      return { status: request.method === "GET" ? 200 : 201, bodyText: request.method === "GET" ? body : "", finalUrl: request.url };
    };
    const client = createNextcloudClient(credentials, transport);
    const backup = await client.upload(largePayload, secret, vi.fn(), vi.fn());
    expect(JSON.parse(body)).toMatchObject({ version: 2, compression: "gzip" });
    expect(new TextEncoder().encode(body).length).toBeLessThan(10 * 1024 * 1024);
    await expect(client.retrieve(backup, secret, vi.fn())).resolves.toEqual(largePayload);
  }, 20_000);
  it("retrieves older uncompressed remote backups", async () => {
    const body = JSON.stringify(await encryptBackupPayload(payload, secret));
    const name = "edunoza-backup-2026-10-11T12-00-00.000Z-00000000-0000-0000-0000-000000000000.json";
    const url = new URL(name, nextcloudFolder(credentials.server, credentials.username)).href;
    const transport: ProxyTransport = async request => ({ status: 200, bodyText: body, finalUrl: request.url });
    await expect(createNextcloudClient(credentials, transport).retrieve({ name, url }, secret, vi.fn())).resolves.toEqual(payload);
  });
  it("builds installation-relative DAV paths and encodes usernames", () => {
    expect(nextcloudFolder(credentials.server, "tést@example.org").href).toBe("https://cloud.example/school/remote.php/dav/files/t%C3%A9st%40example.org/Edunoza/");
  });
  it.each(["http://cloud.example", "https://user:secret@cloud.example", "https://cloud.example/?token=a", "https://cloud.example/#fragment", "https://cloud.example/remote.php/dav/files/user"])("rejects unsafe installation URL %s", (server) => {
    expect(() => nextcloudFolder(server, "teacher")).toThrow();
  });
  it.each(["", " .. ", ".", "a/b", "a\\b", "a:b", "a\nb"])("rejects unsafe username %s", (username) => {
    expect(() => nextcloudFolder(credentials.server, username)).toThrow();
  });
  it("encrypts before transport, prevents overwrite and verifies a round trip", async () => {
    const requests: ProxyRequest[] = [];
    let body = "";
    const transport: ProxyTransport = async (request) => {
      requests.push(request);
      if (request.method === "PUT") body = request.body!;
      return { status: request.method === "GET" ? 200 : 201, bodyText: request.method === "GET" ? body : "", finalUrl: request.url };
    };
    const validate = vi.fn();
    const backup = await createNextcloudClient(credentials, transport).upload(payload, secret, validate, vi.fn());
    expect(requests.map((request) => request.method)).toEqual(["MKCOL", "PUT", "GET"]);
    expect(requests[1].headers["If-None-Match"]).toBe("*");
    expect(body).not.toContain("Synthetic Student");
    expect(JSON.stringify(requests)).not.toContain(secret);
    expect(validate).toHaveBeenLastCalledWith(payload);
    expect(backup.name).toMatch(/^edunoza-backup-/);
    await expect(createNextcloudClient(credentials, transport).download(backup, secret, validate)).resolves.toBe(body);
    await expect(createNextcloudClient(credentials, transport).download(backup, "wrong password", validate)).rejects.toThrow("descifrar");
  });
  it.each([401, 403, 412, 413, 507])("does not verify or retry a rejected upload (%s)", async (status) => {
    const transport = vi.fn<ProxyTransport>(async (request) => ({ status: request.method === "MKCOL" ? 201 : status, bodyText: "", finalUrl: request.url }));
    await expect(createNextcloudClient(credentials, transport).upload(payload, secret, vi.fn(), vi.fn())).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("never reports a corrupt readback as verified", async () => {
    const transport: ProxyTransport = async (request) => ({ status: request.method === "GET" ? 200 : 201, bodyText: "{}", finalUrl: request.url });
    await expect(createNextcloudClient(credentials, transport).upload(payload, secret, vi.fn(), vi.fn())).rejects.toThrow("no se pudo verificar");
  });
  it("does not send a snapshot rejected by the database validator", async () => {
    const transport = vi.fn<ProxyTransport>();
    await expect(createNextcloudClient(credentials, transport).upload(payload, secret, () => { throw new Error("Invalid database"); }, vi.fn())).rejects.toThrow("Invalid database");
    expect(transport).not.toHaveBeenCalled();
  });
  it("rejects untrusted download URLs before sending credentials", async () => {
    const transport = vi.fn<ProxyTransport>();
    await expect(createNextcloudClient(credentials, transport).download({ name: "edunoza-backup-2026-09-09T10-00-00.000Z-00000000-0000-0000-0000-000000000000.json", url: "https://evil.example/file" }, secret, vi.fn())).rejects.toThrow("no pertenece");
    expect(transport).not.toHaveBeenCalled();
  });
  it("rejects using the account secret as the encryption password", async () => {
    const transport = vi.fn<ProxyTransport>();
    await expect(createNextcloudClient(credentials, transport).upload(payload, credentials.password, vi.fn(), vi.fn())).rejects.toThrow("distinta");
    expect(transport).not.toHaveBeenCalled();
  });
  it("reports an uncertain PUT without retrying or deleting", async () => {
    const transport = vi.fn<ProxyTransport>(async (request) => {
      if (request.method === "PUT") throw new Error("Transport disconnected");
      return { status: 201, bodyText: "", finalUrl: request.url };
    });
    await expect(createNextcloudClient(credentials, transport).upload(payload, secret, vi.fn(), vi.fn())).rejects.toThrow("Podría haberse guardado");
    expect(transport).toHaveBeenCalledTimes(2);
  });
});

describe("Proxy message boundary", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  function browser() {
    const listeners = new Set<(event: unknown) => void>();
    const fakeWindow = {
      location: { origin: "https://edunoza.com" },
      addEventListener: (_type: string, listener: (event: unknown) => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: unknown) => void) => listeners.delete(listener),
      setTimeout, postMessage: vi.fn()
    };
    vi.stubGlobal("window", fakeWindow);
    return { fakeWindow, listeners, send: (data: unknown, origin = fakeWindow.location.origin, source: unknown = fakeWindow) => {
      for (const listener of listeners) listener({ data, origin, source });
    } };
  }
  const envelope = { source: "proxy-extension", protocol: "proxy-extension-bridge", version: 1 };
  it("ignores other origins, sources and protocol versions and cleans up after ping", async () => {
    const fixture = browser();
    const waiting = proxyMessage("bridge-ping");
    const reply = { ...envelope, type: "bridge-available", extensionVersion: "0.2.7" };
    fixture.send(reply, "https://evil.example");
    fixture.send(reply, "https://edunoza.com", {});
    fixture.send({ ...reply, version: 2 });
    expect(fixture.listeners.size).toBe(1);
    fixture.send(reply);
    await expect(waiting).resolves.toBe("0.2.7");
    expect(fixture.listeners.size).toBe(0);
  });
  it("requires the matching request ID and rejects redirected results", async () => {
    const fixture = browser();
    const waiting = proxyFetch({ url: "https://cloud.example/file", method: "GET", headers: {}, responseType: "text" });
    const requestId = fixture.fakeWindow.postMessage.mock.calls[0][0].requestId;
    const reply = { ...envelope, type: "bridge-response", requestId, ok: true, result: { status: 200, bodyText: "{}", finalUrl: "https://evil.example/file" } };
    fixture.send({ ...reply, requestId: "other" });
    expect(fixture.listeners.size).toBe(1);
    fixture.send(reply);
    await expect(waiting).rejects.toThrow("redirigió");
    expect(fixture.listeners.size).toBe(0);
  });
  it("cleans up when the view is aborted", async () => {
    const fixture = browser();
    const controller = new AbortController();
    const waiting = proxyMessage("bridge-ping", undefined, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toThrow("interrumpida");
    expect(fixture.listeners.size).toBe(0);
  });
  it("times out a missing extension without leaving a message listener", async () => {
    vi.useFakeTimers();
    const fixture = browser();
    const waiting = expect(proxyMessage("bridge-ping")).rejects.toThrow("No se detecta");
    await vi.advanceTimersByTimeAsync(3000);
    await waiting;
    expect(fixture.listeners.size).toBe(0);
  });
});
