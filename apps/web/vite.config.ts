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
        "src/api/poll.ts",
        "src/hooks/useCamera.ts",
      ],
      thresholds: { lines: 70, functions: 70, branches: 65, statements: 70 },
    },
  },
});
