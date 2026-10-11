import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default defineConfig((configEnvironment) => {
  const baseConfig = typeof viteConfig === "function" ? viteConfig(configEnvironment) : viteConfig;
  return mergeConfig(baseConfig, {
    test: {
      maxWorkers: 2,
      exclude: ["**/node_modules/**", "**/e2e/**", "**/e2e-production/**", "**/scripts/**", "**/artifacts/**"],
      coverage: {
        provider: "v8",
        reporter: ["text", "html"],
        include: ["src/**/*.{ts,tsx}"],
        exclude: ["src/**/*.test.{ts,tsx}", "src/vite-env.d.ts"],
        thresholds: {
          statements: 25,
          branches: 23,
          functions: 19,
          lines: 26,
          "src/shared/backup/database.ts": { statements: 75, branches: 65, functions: 75, lines: 75 },
          "src/shared/resources/storage.ts": { statements: 60, branches: 50, functions: 60, lines: 65 },
          "src/shared/security/appLock.ts": { statements: 70, branches: 60, functions: 80, lines: 75 },
          "src/shared/backup/compression.ts": { statements: 85, branches: 80, functions: 100, lines: 95 },
          "src/shared/backup/encryption.ts": { statements: 85, branches: 85, functions: 100, lines: 95 },
          "src/shared/reports/pdfExport.ts": { statements: 85, branches: 90, functions: 100, lines: 90 },
          "src/shared/storage/deviceStorage.ts": { statements: 95, branches: 90, functions: 100, lines: 95 }
        }
      }
    }
  });
});
