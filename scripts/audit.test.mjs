import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(new URL("./audit.mjs", import.meta.url), "utf8")
  .replace('import { spawnSync } from "node:child_process";', "");

function auditResult(result) {
  let exitCode = 0;
  let output = "";
  const exit = new Error("exit");
  try {
    runInNewContext(source, {
      spawnSync: () => result,
      process: {
        env: { npm_execpath: "npm-cli.js" }, execPath: "node", cwd: () => ".",
        stdout: { write: (text) => { output += text; } },
        stderr: { write: (text) => { output += text; } },
        exit: (code) => { exitCode = code; throw exit; }
      }
    });
  } catch (error) {
    if (error !== exit) throw error;
  }
  return { exitCode, output };
}

test("audit fails closed on registry errors, timeouts and incomplete reports", () => {
  for (const result of [
    { status: 1, stdout: JSON.stringify({ error: { code: "ENOTFOUND" } }) },
    { status: null, error: new Error("ETIMEDOUT"), stdout: "" },
    { status: 0, stdout: "{}" },
    { status: 0, stdout: "null" }
  ]) {
    const outcome = auditResult(result);
    assert.equal(outcome.exitCode, 1);
    assert.doesNotMatch(outcome.output, /audit passed/);
  }
});

test("audit accepts a complete clean report and rejects an unreviewed advisory", () => {
  const report = { auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } };
  assert.equal(auditResult({ status: 0, stdout: JSON.stringify(report) }).exitCode, 0);
  report.vulnerabilities.example = { via: [{ url: "https://example.com/unreviewed" }] };
  assert.equal(auditResult({ status: 1, stdout: JSON.stringify(report) }).exitCode, 1);
});

test("audit rejects the previously exempt React Router advisory if it returns", () => {
  const report = {
    auditReportVersion: 2,
    vulnerabilities: { "react-router": { via: [{ url: "https://github.com/advisories/GHSA-qwww-vcr4-c8h2" }] } },
    metadata: { vulnerabilities: { total: 1 } }
  };
  assert.equal(auditResult({ status: 1, stdout: JSON.stringify(report) }).exitCode, 1);
});
