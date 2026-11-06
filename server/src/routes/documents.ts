import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { db } from "../models/db.js";
import { access, listDocuments, share } from "../services/documents.js";
import {
  restoreVersion,
  snapshotDocument,
  lockDocument,
} from "../services/persistence.js";
import { emailSchema } from "./auth.js";
import { AppError } from "../utils/errors.js";
export const documentRouter = Router();
documentRouter.use(requireAuth);
const title = z.object({ title: z.string().trim().min(1).max(160) });
const idOf = (value: unknown) => z.uuid().parse(value);
documentRouter.get("/", async (_req, res) =>
  res.json(await listDocuments(res.locals.user.id)),
);
documentRouter.post("/", async (req, res) =>
  res.status(201).json(
    await db.document.create({
      data: { ...title.parse(req.body), ownerId: res.locals.user.id },
    }),
  ),
);
documentRouter.get("/:id", async (req, res) => {
  const { document, role } = await access(
    idOf(req.params.id),
    res.locals.user.id,
  );
  const { permissions: _, ...data } = document;
  res.json({ ...data, role });
});
documentRouter.patch("/:id", async (req, res) => {
  const id = idOf(req.params.id);
  const input = title.parse(req.body);
  const document = await db.$transaction(async (tx) => {
    await lockDocument(tx, id);
    await access(id, res.locals.user.id, ["OWNER", "EDITOR"], tx);
    return tx.document.update({
      where: { id },
      data: { title: input.title, updatedAt: new Date() },
    });
  });
  res.json(document);
});
documentRouter.delete("/:id", async (req, res) => {
  const id = idOf(req.params.id);
  await db.$transaction(async (tx) => {
    await lockDocument(tx, id);
    await access(id, res.locals.user.id, ["OWNER"], tx);
    await tx.document.delete({ where: { id } });
  });
  res.sendStatus(204);
});
documentRouter.get("/:id/permissions", async (req, res) => {
  const id = idOf(req.params.id);
  await access(id, res.locals.user.id, ["OWNER"]);
  const owner = await db.document.findUniqueOrThrow({
    where: { id },
    select: { owner: { select: { id: true, name: true, email: true } } },
  });
  const permissions = await db.documentPermission.findMany({
    where: { documentId: id },
    select: {
      id: true,
      role: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });
  res.json([{ id: "owner", role: "OWNER", user: owner.owner }, ...permissions]);
});
documentRouter.post("/:id/permissions", async (req, res) => {
  const input = z
    .object({ email: emailSchema, role: z.enum(["EDITOR", "VIEWER"]) })
    .parse(req.body);
  res.json(
    await share(
      idOf(req.params.id),
      res.locals.user.id,
      input.email,
      input.role,
    ),
  );
});
documentRouter.delete("/:id/permissions/:userId", async (req, res) => {
  const id = idOf(req.params.id);
  const userId = idOf(req.params.userId);
  await db.$transaction(async (tx) => {
    await lockDocument(tx, id);
    await access(id, res.locals.user.id, ["OWNER"], tx);
    await tx.documentPermission.deleteMany({
      where: { documentId: id, userId },
    });
  });
  res.sendStatus(204);
});
documentRouter.get("/:id/versions", async (req, res) => {
  const id = idOf(req.params.id);
  await access(id, res.locals.user.id);
  res.json(
    await db.documentSnapshot
      .findMany({
        where: { documentId: id },
        select: { id: true, createdAt: true, watermark: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      })
      .then((rows) =>
        rows.map((row) => ({ ...row, watermark: String(row.watermark) })),
      ),
  );
});
documentRouter.get("/:id/versions/:versionId", async (req, res) => {
  const id = idOf(req.params.id);
  await access(id, res.locals.user.id);
  const version = await db.documentSnapshot.findFirst({
    where: { id: idOf(req.params.versionId), documentId: id },
  });
  if (!version) throw new AppError(404, "Version not found.");
  res.type("application/octet-stream").send(Buffer.from(version.snapshotData));
});
documentRouter.post("/:id/versions", async (req, res) =>
  res
    .status(201)
    .json(await snapshotDocument(idOf(req.params.id), res.locals.user.id)),
);
documentRouter.post("/:id/versions/:versionId/restore", async (req, res) => {
  res
    .status(201)
    .json(
      await restoreVersion(
        idOf(req.params.id),
        idOf(req.params.versionId),
        res.locals.user.id,
      ),
    );
});
