import { defineConfig } from "vitest/config";

// Scope vitest to the component unit tests. The pre-existing lib/__tests__ files
// are plain node:assert scripts (run with `node --test`/tsx), not vitest specs —
// don't glob them here or they report as empty suites.
export default defineConfig({
  test: {
    include: ["components/**/*.test.{ts,tsx}"],
  },
});
