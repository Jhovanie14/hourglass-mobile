import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "lib/**/*.test.ts",
      "extension/**/*.test.ts",
      "components/**/*.test.ts",
      "app/**/*.test.ts",
      "scripts/**/*.test.mjs",
    ],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
})
