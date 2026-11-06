import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { parse, serialize } from "cookie";
import { db } from "../models/db.js";
import { config } from "../config/index.js";
import { AppError } from "../utils/errors.js";
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const publicUser = { id: true, name: true, email: true } as const;
export const cookieName =
  config.NODE_ENV === "production" ? "__Host-collabspace" : "collabspace";
export function sessionCookie(token: string, expires: Date) {
  return serialize(cookieName, token, {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}
export async function getSession(cookie?: string) {
  const token = parse(cookie ?? "")[cookieName];
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: publicUser } },
  });
  return session && session.expiresAt > new Date() ? session : null;
}
export async function register(input: {
  name: string;
  email: string;
  password: string;
}) {
  const passwordHash = await bcrypt.hash(input.password, 12);
  try {
    return await db.user.create({
      data: { name: input.name, email: input.email, passwordHash },
      select: publicUser,
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002")
      throw new AppError(409, "An account with that email already exists.");
    throw err;
  }
}
export async function login(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email } });
  // Compare even for missing users to reduce account enumeration through timing.
  const valid = await bcrypt.compare(
    password,
    user?.passwordHash ??
      "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW",
  );
  if (!user || !valid)
    throw new AppError(401, "Email or password is incorrect.");
  return { id: user.id, name: user.name, email: user.email };
}
export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + config.SESSION_DAYS * 86400000);
  await db.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt },
  });
  return sessionCookie(token, expiresAt);
}
