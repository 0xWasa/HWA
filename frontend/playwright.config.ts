import { defineConfig, devices } from "@playwright/test";

const useProductionBuild = process.env.PLAYWRIGHT_USE_PRODUCTION_BUILD === "true";

/**
 * E2E runs entirely in mock data mode: no wallet extension, no RPC.
 * Scenarios are selected per-test through the `?scenario=` query parameter.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    // Keep automated mock journeys isolated from the live testnet dev server
    // that developers use on :3900.
    baseURL: "http://localhost:3901",
    trace: "retain-on-failure",
    colorScheme: "dark",
  },
  projects: [
    {
      name: "e2e",
      testMatch: /.*\.spec\.ts/,
      testIgnore: /screenshots\.capture\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "screenshots",
      testMatch: /screenshots\.capture\.ts/,
      // Serial: parallel captures contend on the dev server and photograph
      // half-loaded pages.
      workers: 1,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: useProductionBuild
      ? "cross-env NEXT_DIST_DIR=.next-e2e next start -p 3901"
      : "cross-env NEXT_DIST_DIR=.next-e2e next dev -p 3901",
    url: "http://localhost:3901",
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_APP_ENV: "development",
      NEXT_PUBLIC_DATA_MODE: "mock",
      NEXT_PUBLIC_HYPEREVM_CHAIN_ID: "998",
      NFT_METADATA_ALLOWED_HOSTS: "127.0.0.1",
    },
  },
});
