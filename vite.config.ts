import { contentSecurityPolicy } from "./scripts/security-policy.mjs";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import type { Plugin, ResolvedConfig } from "vite";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const PRECACHE_ASSETS_MARKER = "/* __EDUNOZA_PRECACHE_ASSETS__ */ []";
const CACHE_NAME_MARKER = "__EDUNOZA_CACHE_NAME__";
const IMMUTABLE_ASSETS_MARKER = "/* __EDUNOZA_IMMUTABLE_ASSETS__ */ []";
// Vite/Rolldown emit `[name]-[hash].[ext]` with an 8-character base64url content hash.
const CONTENT_HASHED_FILE_NAME = /-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/;

export function normalizePrecacheAssetPaths(paths: string[]): string[] {
  return Array.from(
    new Set(
      paths
        .map((path) => path.replace(/\\/g, "/"))
        .filter((path) => !path.startsWith("/"))
        .map((path) => path.replace(/^\.\//, ""))
        .filter(
          (path) =>
            path.length > 0 &&
            path !== "sw.js" &&
            path !== "_headers" &&
            !path.split("/").includes("..")
        )
    )
  ).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/**
 * Selects precached build files that are safe to reuse across deployments: emitted into
 * the build assets directory with a content hash in the name and not copied from the
 * public directory, whose files keep stable names while their bytes may change.
 */
export function selectImmutableAssetPaths(
  precachePaths: string[],
  publicPaths: string[],
  assetsDirectory = "assets"
): string[] {
  const prefix = `${assetsDirectory.replace(/\\/g, "/").replace(/^\.?\/+|\/+$/g, "")}/`;
  const publicFiles = new Set(normalizePrecacheAssetPaths(publicPaths));
  return precachePaths.filter(
    (path) =>
      prefix !== "/" &&
      path.startsWith(prefix) &&
      !publicFiles.has(path) &&
      CONTENT_HASHED_FILE_NAME.test(path.slice(path.lastIndexOf("/") + 1))
  );
}

async function listOutputFiles(outputDirectory: string, currentDirectory = outputDirectory): Promise<string[]> {
  const entries = await readdir(currentDirectory, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        return listOutputFiles(outputDirectory, absolutePath);
      }
      return [relative(outputDirectory, absolutePath)];
    })
  );
  return paths.flat();
}

function offlinePrecachePlugin(): Plugin {
  let resolvedConfig: ResolvedConfig;

  return {
    name: "edunoza-offline-precache",
    apply: "build",
    configResolved(config) {
      resolvedConfig = config;
    },
    async closeBundle() {
      const outputDirectory = resolve(resolvedConfig.root, resolvedConfig.build.outDir);
      const serviceWorkerPath = join(outputDirectory, "sw.js");
      const assetPaths = normalizePrecacheAssetPaths(await listOutputFiles(outputDirectory));

      if (
        !assetPaths.includes("index.html") ||
        !assetPaths.includes("manifest.webmanifest") ||
        !assetPaths.includes("pwa-icon.svg") ||
        !assetPaths.some((path) => path.endsWith(".js"))
      ) {
        throw new Error("The offline precache manifest is missing required production assets.");
      }

      const publicDirectory = resolvedConfig.publicDir;
      const publicPaths = publicDirectory && existsSync(publicDirectory) ? await listOutputFiles(publicDirectory) : [];
      const immutableAssetPaths = selectImmutableAssetPaths(assetPaths, publicPaths, resolvedConfig.build.assetsDir);

      const revisionHash = createHash("sha256");
      for (const assetPath of assetPaths) {
        revisionHash.update(assetPath);
        revisionHash.update("\0");
        revisionHash.update(await readFile(join(outputDirectory, assetPath)));
      }
      const cacheName = `edunoza-${revisionHash.digest("hex").slice(0, 16)}`;

      const serviceWorkerSource = await readFile(serviceWorkerPath, "utf8");
      if (
        !serviceWorkerSource.includes(PRECACHE_ASSETS_MARKER) ||
        !serviceWorkerSource.includes(CACHE_NAME_MARKER) ||
        !serviceWorkerSource.includes(IMMUTABLE_ASSETS_MARKER)
      ) {
        throw new Error("The service worker precache markers are missing.");
      }

      const generatedSource = serviceWorkerSource
        .replace(CACHE_NAME_MARKER, () => cacheName)
        .replace(PRECACHE_ASSETS_MARKER, () => JSON.stringify(assetPaths, null, 2))
        .replace(IMMUTABLE_ASSETS_MARKER, () => JSON.stringify(immutableAssetPaths, null, 2));
      await writeFile(serviceWorkerPath, generatedSource, "utf8");
    }
  };
}

function normalizeBasePath(rawBase?: string): string {
  const candidate = (rawBase || "/").trim();
  const withLeading = candidate.startsWith("/") ? candidate : `/${candidate}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

function contentSecurityPolicyPlugin(isDevelopment: boolean): Plugin {
  return {
    name: "edunoza-content-security-policy",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return html
          .replace("__EDUNOZA_CONTENT_SECURITY_POLICY__", contentSecurityPolicy({ development: isDevelopment }));
      }
    }
  };
}

// Expose only the version to the app instead of bundling the whole package.json.
process.env.VITE_APP_VERSION ??= JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8")).version;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const base = normalizeBasePath(env.VITE_BASE_PATH);

  const serverPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 5274;

  return {
    base,
    server: { port: serverPort, host: "127.0.0.1" },
    worker: { format: "es" },
    build: {
      rollupOptions: {
        output: {
          manualChunks(moduleId) {
            if (/[\\/]node_modules[\\/](@reduxjs[\\/]toolkit|react-redux)[\\/]/.test(moduleId)) {
              return "state-vendor";
            }
            if (/[\\/]node_modules[\\/]dexie[\\/]/.test(moduleId)) {
              return "db-vendor";
            }
            if (
              /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom)[\\/]/.test(
                moduleId
              )
            ) {
              return "react-vendor";
            }
            return undefined;
          }
        }
      }
    },
    plugins: [
      contentSecurityPolicyPlugin(mode === "development"),
      react(),
      offlinePrecachePlugin()
    ]
  };
});
