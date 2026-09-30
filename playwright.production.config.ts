import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-production",
  fullyParallel: true,
  timeout: 90_000,
  forbidOnly: !!process.env.CI,
  workers: 2,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } }
  ],
  use: { baseURL: "http://127.0.0.1:5277", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: "node e2e-production/server.mjs",
    url: "http://127.0.0.1:5277",
    reuseExistingServer: false
  }
});
