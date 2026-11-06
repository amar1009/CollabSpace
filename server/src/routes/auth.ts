import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { db } from "../models/db.js";
import {
  createSession,
  getSession,
  login,
  register,
  sessionCookie,
} from "../services/auth.js";
import { AppError } from "../utils/errors.js";
export const authRouter = Router();
export const emailSchema = z.email().trim().toLowerCase().max(254);
const credentials = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(10)
    .max(72)
    .refine(
      (value) => Buffer.byteLength(value, "utf8") <= 72,
      "Password must be at most 72 UTF-8 bytes",
    ),
});
const sensitive = rateLimit({
  windowMs: 15 * 60000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." },
});
authRouter.post("/register", sensitive, async (req, res) => {
  const input = credentials
    .extend({ name: z.string().trim().min(1).max(80) })
    .parse(req.body);
  const user = await register(input);
  res.setHeader("Set-Cookie", await createSession(user.id));
  res.status(201).json(user);
});
authRouter.post("/login", sensitive, async (req, res) => {
  const input = credentials.parse(req.body);
  const user = await login(input.email, input.password);
  const old = await getSession(req.headers.cookie);
  if (old) await db.session.deleteMany({ where: { tokenHash: old.tokenHash } });
  res.setHeader("Set-Cookie", await createSession(user.id));
  res.json(user);
});
authRouter.get("/me", async (req, res) => {
  const session = await getSession(req.headers.cookie);
  if (!session) throw new AppError(401, "Please sign in.");
  res.json(session.user);
});
authRouter.post("/logout", async (req, res) => {
  const session = await getSession(req.headers.cookie);
  if (session)
    await db.session.deleteMany({ where: { tokenHash: session.tokenHash } });
  res.setHeader("Set-Cookie", sessionCookie("", new Date(0)));
  res.sendStatus(204);
});
