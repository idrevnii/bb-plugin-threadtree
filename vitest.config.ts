import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // BB provides these at runtime and `bb plugin build` shims them, so the
      // plugin's own imports point at the tsconfig-mapped names. Tests need
      // the real package behind those names.
      "@bb/plugin-sdk/app": "@get-bb/plugin-sdk/app",
      "@bb/plugin-sdk": "@get-bb/plugin-sdk",
      "@": root,
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
