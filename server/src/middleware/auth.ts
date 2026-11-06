import type { RequestHandler } from "express";
import { getSession } from "../services/auth.js";
import { AppError } from "../utils/errors.js";
export const requireAuth: RequestHandler = async (req, res, next) => {
  const session = await getSession(req.headers.cookie);
  if (!session) throw new AppError(401, "Please sign in to continue.");
  res.locals.user = session.user;
  next();
};
