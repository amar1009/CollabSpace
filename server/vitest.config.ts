import { defineConfig } from "vitest/config";
import { config } from "dotenv";
config({ path: "../.env", quiet: true });
process.env.NODE_ENV = "test";
export default defineConfig({
  test: { fileParallelism: false, maxWorkers: 1, hookTimeout: 30000 },
});
