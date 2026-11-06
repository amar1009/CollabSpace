import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { config } from "dotenv";

config({ path: new URL("../../.env", import.meta.url), quiet: true });
const require = createRequire(import.meta.url);
const result = spawnSync(
  process.execPath,
  [require.resolve("prisma/build/index.js"), "migrate", "deploy"],
  { stdio: "inherit", env: process.env },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
