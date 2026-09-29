import { spawnSync } from "node:child_process";

// No advisory exceptions are currently needed by the locked dependency versions.
const allowedAdvisories = new Map();

const npmCliPath = process.env.npm_execpath;
if (!npmCliPath) {
  process.stderr.write("Run this audit through the npm script so npm_execpath is available.\n");
  process.exit(1);
}

const result = spawnSync(process.execPath, [npmCliPath, "audit", "--json"], {
  cwd: process.cwd(),
  encoding: "utf8",
  timeout: 60_000
});

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  process.stderr.write(result.stderr || result.stdout || "npm audit did not return valid JSON.\n");
  process.exit(1);
}

if (
  result.error || result.signal || ![0, 1].includes(result.status) ||
  !report || report.error || report.auditReportVersion !== 2 ||
  !report.vulnerabilities || typeof report.vulnerabilities !== "object" ||
  Array.isArray(report.vulnerabilities) || !report.metadata?.vulnerabilities ||
  (result.status !== 0 && Object.keys(report.vulnerabilities).length === 0)
) {
  process.stderr.write("Dependency audit could not complete. Check registry connectivity and retry.\n");
  process.exit(1);
}

const vulnerabilities = report.vulnerabilities;
const allowedPackages = new Set();

for (const [packageName, vulnerability] of Object.entries(vulnerabilities)) {
  const directAdvisories = vulnerability.via.filter((item) => typeof item === "object");
  const referencedPackages = vulnerability.via.filter((item) => typeof item === "string");
  const allDirectAdvisoriesAllowed =
    directAdvisories.length > 0 &&
    directAdvisories.every((advisory) => allowedAdvisories.has(advisory.url));
  if (allDirectAdvisoriesAllowed && referencedPackages.length === 0) {
    allowedPackages.add(packageName);
  }
}

let changed = true;
while (changed) {
  changed = false;
  for (const [packageName, vulnerability] of Object.entries(vulnerabilities)) {
    if (allowedPackages.has(packageName)) continue;
    const directAdvisories = vulnerability.via.filter((item) => typeof item === "object");
    const referencedPackages = vulnerability.via.filter((item) => typeof item === "string");
    const directAllowed = directAdvisories.every((advisory) => allowedAdvisories.has(advisory.url));
    const referencesAllowed =
      referencedPackages.length > 0 &&
      referencedPackages.every((dependency) => allowedPackages.has(dependency));
    if (directAllowed && referencesAllowed) {
      allowedPackages.add(packageName);
      changed = true;
    }
  }
}

const blockedPackages = Object.keys(vulnerabilities).filter(
  (packageName) => !allowedPackages.has(packageName)
);

if (blockedPackages.length > 0) {
  process.stderr.write(`Dependency audit failed: ${blockedPackages.join(", ")}.\n`);
  process.exit(1);
}

if (allowedPackages.size > 0) {
  process.stdout.write(
    `Dependency audit passed with reviewed exception: ${Array.from(allowedPackages).join(", ")}.\n`
  );
  for (const [url, reason] of allowedAdvisories) {
    process.stdout.write(`- ${url}: ${reason}\n`);
  }
} else {
  process.stdout.write("Dependency audit passed with no known vulnerabilities.\n");
}
