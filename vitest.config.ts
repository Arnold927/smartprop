import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Run tests sequentially — integration tests share a DB and can't be parallelised safely
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    // Each test file gets a 30s timeout (DB operations can be slow)
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Collect coverage from server code only
    coverage: {
      provider: "v8",
      include: ["server/routes/**", "server/services/**", "server/middleware/**"],
      exclude: ["server/routes/index.ts"],
      reporter: ["text", "html"],
    },
    // Environment
    environment: "node",
  },
  resolve: {
    alias: {
      "@shared": new URL("./shared", import.meta.url).pathname,
    },
  },
});
