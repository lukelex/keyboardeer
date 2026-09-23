import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  use: { baseURL: "http://127.0.0.1:5186" },
  webServer: {
    command: "npm run dev -- --port 5186",
    url: "http://127.0.0.1:5186",
    reuseExistingServer: false,
  },
});
