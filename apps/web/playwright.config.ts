import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run build && npm exec vite preview -- --host 127.0.0.1",
    port: 4173,
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_API_ORIGIN: "http://127.0.0.1:8000",
      VITE_UPLOAD_ORIGIN: "https://example-bucket.s3.us-east-1.amazonaws.com",
      VITE_COGNITO_AUTHORITY: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test",
      VITE_COGNITO_CLIENT_ID: "playwright-public-client",
      VITE_COGNITO_REDIRECT_URI: "http://127.0.0.1:4173/auth/callback",
      VITE_COGNITO_LOGOUT_URI: "http://127.0.0.1:4173/sign-in",
      VITE_COGNITO_DOMAIN: "https://test.auth.us-east-1.amazoncognito.com"
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
