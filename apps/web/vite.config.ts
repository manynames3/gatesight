import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: true,
    target: "es2022",
  },
  server: {
    headers: {
      "Permissions-Policy": "camera=(self), microphone=()",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    exclude: ["tests/e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: [
        "src/camera/capture.ts",
        "src/camera/motion.ts",
        "src/camera/plateGate.ts",
        "src/api/client.ts",
        "src/api/poll.ts",
        "src/auth/roles.ts",
        "src/hooks/useCamera.ts",
        "src/pages/DataPage.tsx",
        "src/pages/FacilitiesPage.tsx",
        "src/pages/OperationalRecordPanel.tsx",
        "src/pages/SystemPage.tsx",
      ],
      thresholds: { lines: 70, functions: 70, branches: 65, statements: 70 },
    },
  },
});
