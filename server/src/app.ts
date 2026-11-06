import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { ZodError } from "zod";
import { config } from "./config/index.js";
import { db } from "./models/db.js";
import { authRouter } from "./routes/auth.js";
import { documentRouter } from "./routes/documents.js";
import { AppError } from "./utils/errors.js";
import { logger } from "./utils/logger.js";
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Too many requests." },
    }),
  );
  app.use(express.json({ limit: "32kb" }));
  app.use((req, _res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin !== config.APP_ORIGIN
    )
      throw new AppError(403, "Request origin is not allowed.");
    next();
  });
  app.get("/api/health", async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: "ok" });
  });
  app.use("/api/auth", authRouter);
  app.use("/api/documents", documentRouter);
  app.use((_req, res) =>
    res.status(404).json({ error: "Endpoint not found." }),
  );
  const errorHandler: ErrorRequestHandler = (
    err: unknown,
    _req,
    res,
    _next,
  ) => {
    if (err instanceof ZodError) {
      res
        .status(400)
        .json({ error: err.issues.map((i) => i.message).join(". ") });
      return;
    }
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: "Invalid JSON body." });
      return;
    }
    logger.error(
      { error: err instanceof Error ? err.message : "unknown" },
      "Request failed",
    );
    res.status(500).json({ error: "Something went wrong. Please try again." });
  };
  app.use(errorHandler);
  return app;
}
