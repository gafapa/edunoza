import { describe, expect, it } from "vitest";
import { normalizePrecacheAssetPaths, selectImmutableAssetPaths } from "./vite.config";

describe("offline precache manifest", () => {
  it("normalizes, deduplicates, and sorts emitted assets", () => {
    expect(
      normalizePrecacheAssetPaths([
        "manifest.webmanifest",
        ".\\assets\\TodayPage-def456.js",
        "./assets/index-abc123.js",
        "assets/index-abc123.js",
        "pwa-icon.svg",
        "index.html"
      ])
    ).toEqual([
      "assets/TodayPage-def456.js",
      "assets/index-abc123.js",
      "index.html",
      "manifest.webmanifest",
      "pwa-icon.svg"
    ]);
  });

  it("excludes the worker itself and unsafe paths", () => {
    expect(
      normalizePrecacheAssetPaths([
        "sw.js",
        "_headers",
        "../outside.js",
        "/absolute.js",
        "assets/../outside.js",
        ""
      ])
    ).toEqual([]);
  });

  it("marks only content-hashed build assets as reusable across deployments", () => {
    expect(
      selectImmutableAssetPaths(
        [
          "assets/index-Ej2SSLwC.js",
          "assets/pdfExport.worker-Cd9rJznn.js",
          "assets/ReportsPage-Cl513wq-.js",
          "assets/index-EDraJ2BZ.css",
          "assets/logo-from-public-AbCdEfGh.svg",
          "assets/unhashed.js",
          "fonts/NotoSans-Regular.ttf",
          "index.html",
          "manifest.webmanifest"
        ],
        [".\\assets\\logo-from-public-AbCdEfGh.svg", "fonts/NotoSans-Regular.ttf", "sw.js"]
      )
    ).toEqual([
      "assets/index-Ej2SSLwC.js",
      "assets/pdfExport.worker-Cd9rJznn.js",
      "assets/ReportsPage-Cl513wq-.js",
      "assets/index-EDraJ2BZ.css"
    ]);
  });

  it("honors a custom assets directory and never treats the output root as immutable", () => {
    expect(selectImmutableAssetPaths(["static/app-Ej2SSLwC.js", "assets/app-Ej2SSLwC.js"], [], "static/")).toEqual([
      "static/app-Ej2SSLwC.js"
    ]);
    expect(selectImmutableAssetPaths(["app-Ej2SSLwC.js"], [], "")).toEqual([]);
  });
});
