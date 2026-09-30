import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { contentSecurityPolicy } from "./security-policy.mjs";

test("static hosting and Nginx CSP match the policy used by the HTML build", async () => {
  const [headers, nginx, html] = await Promise.all([
    readFile(new URL("../public/_headers", import.meta.url), "utf8"),
    readFile(new URL("../deploy/nginx-security-headers.conf", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8")
  ]);
  const expected = contentSecurityPolicy({ frameAncestors: true });
  assert.equal(headers.match(/Content-Security-Policy: ([^\r\n]+)/)?.[1], expected);
  assert.equal(nginx.match(/add_header Content-Security-Policy "([^"]+)"/)?.[1], expected);
  assert.ok(html.includes('content="__EDUNOZA_CONTENT_SECURITY_POLICY__"'));
  assert.ok(!contentSecurityPolicy().includes("unsafe-inline"));
  assert.ok(contentSecurityPolicy({ development: true }).includes("ws://localhost:*"));
});
