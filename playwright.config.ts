import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://127.0.0.1:5276", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5276 --strictPort",
    url: "http://127.0.0.1:5276",
    reuseExistingServer: false
  }
});
