import "dotenv/config";
import { z } from "zod";
export const config = z
  .object({
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.url(),
    APP_ORIGIN: z.url(),
    PORT: z.coerce.number().int().positive().default(3001),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    SESSION_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    SNAPSHOT_INTERVAL_MS: z.coerce.number().int().min(1000).default(60000),
  })
  .parse(process.env);
