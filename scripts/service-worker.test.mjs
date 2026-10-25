import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8")
  .replace("/* __EDUNOZA_PRECACHE_ASSETS__ */ []", '["index.html", "assets/app.js"]');

function worker({ offline = false, shell = new Response("installed shell"), asset, cacheNames = [] } = {}) {
  const listeners = {};
  const writes = [];
  const deleted = [];
  const cache = {
    match: async (request, options) => {
      const url = String(request.url ?? request);
      if (url === "https://school.example/app/") return shell;
      if (url === "https://school.example/app/assets/app.js" && asset &&
          (!request.headers.has("Origin") || options?.ignoreVary)) return asset;
      return undefined;
    },
    put: async (request) => { writes.push(String(request.url ?? request)); }
  };
  runInNewContext(source, {
    URL, Request, Response, Set,
    self: {
      registration: { scope: "https://school.example/app/" },
      location: { origin: "https://school.example" },
      addEventListener: (name, listener) => { listeners[name] = listener; },
      clients: { claim: async () => {} }
    },
    encodeURIComponent,
    caches: {
      open: async () => cache,
      keys: async () => cacheNames,
      delete: async (name) => { deleted.push(name); return true; }
    },
    fetch: async () => {
      if (offline) throw new Error("offline");
      return new Response("network response");
    }
  });
  return {
    writes,
    deleted,
    activate: () => {
      let completion;
      listeners.activate({ waitUntil: (value) => { completion = value; } });
      return completion;
    },
    fetch: (path, { navigation = false, ...options } = {}) => {
      let response;
      const request = new Request(new URL(path, "https://school.example"), options);
      if (navigation) Object.defineProperty(request, "mode", { value: "navigate" });
      listeners.fetch({ request, respondWith: (value) => { response = value; } });
      return response;
    }
  };
}

test("activation removes only obsolete caches owned by the current installation", async () => {
  const prefix = `edunoza-scope-${encodeURIComponent("https://school.example/app/")}-`;
  const old = `${prefix}old`;
  const app = worker({ cacheNames: [old, `${prefix}__EDUNOZA_CACHE_NAME__`, "edunoza-legacy", "profeplus-legacy", `edunoza-scope-${encodeURIComponent("https://school.example/other/")}-old`, "another-app"] });
  await app.activate();
  assert.deepEqual(app.deleted, [old]);
});

test("worker does not cache API, authenticated, query, cross-origin or out-of-scope requests", () => {
  const app = worker();
  for (const path of ["/app/api/students", "/app/assets/app.js?token=private", "/other/assets/app.js", "https://external.example/app/assets/app.js"]) {
    assert.equal(app.fetch(path), undefined);
  }
  assert.equal(app.fetch("/app/assets/app.js", { headers: { Authorization: "Bearer private" } }), undefined);
  assert.equal(app.fetch("/app/assets/app.js", { method: "POST" }), undefined);
});

test("worker caches only allowlisted build assets", async () => {
  const app = worker();
  assert.equal(await (await app.fetch("/app/assets/app.js")).text(), "network response");
  assert.deepEqual(app.writes, ["https://school.example/app/assets/app.js"]);
});

test("offline module requests reuse precached public assets despite Vary: Origin", async () => {
  const app = worker({ offline: true, asset: new Response("installed module", { headers: { Vary: "Origin" } }) });
  assert.equal(await (await app.fetch("/app/assets/app.js", { headers: { Origin: "https://school.example" } })).text(), "installed module");
  assert.deepEqual(app.writes, []);
  assert.equal(app.fetch("/app/assets/app.js?private=1", { headers: { Origin: "https://school.example" } }), undefined);
});

test("online navigation never replaces the installed version's offline shell", async () => {
  const app = worker();
  assert.equal(await (await app.fetch("/app/", { navigation: true })).text(), "network response");
  assert.deepEqual(app.writes, []);
});

test("offline deep links use the installed shell and missing shells return HTTP 503", async () => {
  const app = worker({ offline: true });
  assert.equal(await (await app.fetch("/app/gradebook", { navigation: true })).text(), "installed shell");
  const empty = worker({ offline: true, shell: null });
  assert.equal((await empty.fetch("/app/gradebook", { navigation: true })).status, 503);
});
