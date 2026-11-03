import { readdir, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedDirectories = new Set([
  "coverage", "dist", ".vite", "test-results", "playwright-report",
  "artifacts", ".playwright-mcp", ".impeccable"
]);
const generatedFilePatterns = [
  /\.log$/i,
  /\.tsbuildinfo$/i,
  /^nul$/i
];

function isSafeRootEntry(targetPath) {
  const relativePath = relative(projectRoot, targetPath);
  return (
    relativePath.length > 0 &&
    !relativePath.startsWith("..") &&
    !relativePath.includes("/") &&
    !relativePath.includes("\\")
  );
}

const entries = await readdir(projectRoot, { withFileTypes: true });
const targets = entries
  .filter((entry) =>
    entry.isSymbolicLink() ? false : entry.isDirectory()
      ? generatedDirectories.has(entry.name)
      : generatedFilePatterns.some((pattern) => pattern.test(entry.name))
  )
  .map((entry) => join(projectRoot, entry.name))
  .filter(isSafeRootEntry);

for (const targetPath of targets) {
  await rm(targetPath, { force: true, recursive: true });
  console.log(`Removed ${relative(projectRoot, targetPath)}`);
}

if (targets.length === 0) {
  console.log("No generated project artifacts found.");
}
