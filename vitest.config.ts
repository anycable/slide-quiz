import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // Needs a real anycable-go; run with `npm run test:integration`
    exclude: ["tests/integration/**", "**/node_modules/**"],
  },
});
