import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PICOFLOW_BASE_URL ?? "https://picoflow.qubitpage.com",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
