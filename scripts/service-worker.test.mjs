import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8")
  .replace("/* __EDUNOZA_PRECACHE_ASSETS__ */ []", '["index.html", "assets/app.js"]');

function worker({ offline = false, shell = new Response("installed shell") } = {}) {
  const listeners = {};
  const writes = [];
  const cache = {
    match: async (request) => String(request.url ?? request) === "https://school.example/app/" ? shell : undefined,
    put: async (request) => { writes.push(String(request.url ?? request)); }
  };
  runInNewContext(source, {
    URL, Request, Response, Set,
    self: {
      registration: { scope: "https://school.example/app/" },
      location: { origin: "https://school.example" },
      addEventListener: (name, listener) => { listeners[name] = listener; }
    },
    caches: { open: async () => cache },
    fetch: async () => {
      if (offline) throw new Error("offline");
      return new Response("network response");
    }
  });
  return {
    writes,
    fetch: (path, { navigation = false, ...options } = {}) => {
      let response;
      const request = new Request(new URL(path, "https://school.example"), options);
      if (navigation) Object.defineProperty(request, "mode", { value: "navigate" });
      listeners.fetch({ request, respondWith: (value) => { response = value; } });
      return response;
    }
  };
}

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
