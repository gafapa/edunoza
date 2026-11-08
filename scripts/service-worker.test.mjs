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

function installer({ cacheEntries = {}, failFetch = () => false } = {}) {
  const scope = "https://school.example/app/";
  const prefix = `edunoza-scope-${encodeURIComponent(scope)}-`;
  const installSource = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8")
    .replace("__EDUNOZA_CACHE_NAME__", "new")
    .replace("/* __EDUNOZA_PRECACHE_ASSETS__ */ []", '["assets/app-AAAAAAAA.js", "assets/pdf-BBBBBBBB.js", "fonts/font.ttf", "index.html"]')
    .replace("/* __EDUNOZA_IMMUTABLE_ASSETS__ */ []", '["assets/app-AAAAAAAA.js", "assets/pdf-BBBBBBBB.js", "assets/outside-precache-CCCCCCCC.js"]');
  const stores = new Map(Object.entries(cacheEntries).map(([name, entries]) => [name, new Map(Object.entries(entries))]));
  const fetched = [];
  const cacheFor = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      match: async (request) => {
        const entry = store.get(String(request.url ?? request));
        return entry === undefined ? undefined : entry instanceof Response ? entry : new Response(entry);
      },
      put: async (request, response) => { store.set(String(request.url ?? request), await response.text()); },
      addAll: async (requests) => {
        const responses = await Promise.all(requests.map(async (request) => {
          assert.equal(request.cache, "reload");
          fetched.push(request.url);
          if (failFetch(request.url)) throw new TypeError("network failure");
          return [request.url, `fresh ${new URL(request.url).pathname}`];
        }));
        for (const [url, body] of responses) store.set(url, body);
      }
    };
  };
  const listeners = {};
  runInNewContext(installSource, {
    URL, Request, Response, Set, Boolean,
    self: {
      registration: { scope },
      location: { origin: "https://school.example" },
      addEventListener: (name, listener) => { listeners[name] = listener; }
    },
    encodeURIComponent,
    caches: { open: async (name) => cacheFor(name), keys: async () => [...stores.keys()] },
    fetch: async () => { throw new Error("install must use cache.addAll"); }
  });
  return {
    prefix,
    fetched,
    stores,
    install: () => {
      let completion;
      listeners.install({ waitUntil: (value) => { completion = value; } });
      return completion;
    }
  };
}

test("install copies unchanged hashed assets from this scope's previous cache and downloads the rest", async () => {
  const scope = `edunoza-scope-${encodeURIComponent("https://school.example/app/")}-`;
  const app = installer({
    cacheEntries: {
      [`${scope}old`]: {
        "https://school.example/app/assets/app-AAAAAAAA.js": "installed app",
        "https://school.example/app/fonts/font.ttf": "old font",
        "https://school.example/app/index.html": "old html"
      },
      "edunoza-scope-other-old": { "https://school.example/app/assets/pdf-BBBBBBBB.js": "foreign scope" }
    }
  });
  await app.install();
  assert.deepEqual(app.fetched.sort(), [
    "https://school.example/app/",
    "https://school.example/app/assets/pdf-BBBBBBBB.js",
    "https://school.example/app/fonts/font.ttf",
    "https://school.example/app/index.html"
  ]);
  const installed = app.stores.get(`${scope}new`);
  assert.equal(installed.get("https://school.example/app/assets/app-AAAAAAAA.js"), "installed app");
  assert.equal(installed.get("https://school.example/app/fonts/font.ttf"), "fresh /app/fonts/font.ttf");
  assert.equal(installed.get("https://school.example/app/index.html"), "fresh /app/index.html");
  assert.equal(installed.get("https://school.example/app/assets/pdf-BBBBBBBB.js"), "fresh /app/assets/pdf-BBBBBBBB.js");
  assert.equal(installed.has("https://school.example/app/assets/outside-precache-CCCCCCCC.js"), false);
  // The previous installation stays intact until activation removes it.
  assert.equal(app.stores.get(`${scope}old`).get("https://school.example/app/fonts/font.ttf"), "old font");
});

test("install downloads hashed assets again when the installed copy is an error or redirect", async () => {
  const scope = `edunoza-scope-${encodeURIComponent("https://school.example/app/")}-`;
  const redirected = new Response("redirected copy");
  Object.defineProperty(redirected, "redirected", { value: true });
  const app = installer({
    cacheEntries: {
      [`${scope}old`]: {
        "https://school.example/app/assets/app-AAAAAAAA.js": new Response("missing", { status: 404 }),
        "https://school.example/app/assets/pdf-BBBBBBBB.js": redirected
      }
    }
  });
  await app.install();
  assert.ok(app.fetched.includes("https://school.example/app/assets/app-AAAAAAAA.js"));
  assert.ok(app.fetched.includes("https://school.example/app/assets/pdf-BBBBBBBB.js"));
});

test("install still fails when a required download fails, keeping the active version", async () => {
  const scope = `edunoza-scope-${encodeURIComponent("https://school.example/app/")}-`;
  const app = installer({
    cacheEntries: { [`${scope}old`]: { "https://school.example/app/assets/app-AAAAAAAA.js": "installed app" } },
    failFetch: (url) => url.endsWith("/fonts/font.ttf")
  });
  await assert.rejects(app.install(), /network failure/);
});

test("static hosting long-caches only hashed assets and revalidates the shell and worker", () => {
  const headers = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
  const rules = new Map();
  let path;
  for (const line of headers.split(/\r?\n/)) {
    if (/^\S/.test(line) && !line.startsWith("#")) path = line.trim();
    const cacheControl = line.match(/^\s+Cache-Control:\s*(.+)$/)?.[1];
    if (path && cacheControl) rules.set(path, cacheControl.trim());
  }
  assert.equal(rules.get("/assets/*"), "public, max-age=31536000, immutable");
  for (const stable of ["/", "/index.html", "/sw.js", "/manifest.webmanifest"]) {
    assert.equal(rules.get(stable), "no-cache");
  }
  assert.equal(rules.has("/*"), false, "a catch-all Cache-Control would merge into hashed asset headers");
});
