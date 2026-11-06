import * as Y from "yjs";
import type { Prisma } from "@prisma/client";
import { db } from "../models/db.js";
import { access } from "./documents.js";
import { AppError } from "../utils/errors.js";
export async function lockDocument(tx: Prisma.TransactionClient, id: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
}
export async function loadState(
  id: string,
  tx: Prisma.TransactionClient = db,
): Promise<{ doc: Y.Doc; watermark: bigint }> {
  if (tx === db)
    return db.$transaction((inner) => loadState(id, inner), {
      isolationLevel: "RepeatableRead",
    });
  const doc = new Y.Doc();
  try {
    const snapshot = await tx.documentSnapshot.findFirst({
      where: { documentId: id },
      orderBy: [{ watermark: "desc" }, { createdAt: "desc" }],
    });
    if (snapshot) Y.applyUpdate(doc, snapshot.snapshotData);
    const updates = await tx.documentUpdate.findMany({
      where: { documentId: id, id: { gt: snapshot?.watermark ?? 0n } },
      orderBy: { id: "asc" },
    });
    for (const update of updates) Y.applyUpdate(doc, update.updateData);
    return { doc, watermark: updates.at(-1)?.id ?? snapshot?.watermark ?? 0n };
  } catch (err) {
    doc.destroy();
    throw err;
  }
}
export async function persistUpdate(
  id: string,
  userId: string,
  data: Uint8Array,
) {
  return db.$transaction(async (tx) => {
    await lockDocument(tx, id);
    await access(id, userId, ["OWNER", "EDITOR"], tx);
    const row = await tx.documentUpdate.create({
      data: { documentId: id, updateData: Buffer.from(data) },
    });
    await tx.document.update({
      where: { id },
      data: { updatedAt: new Date() },
    });
    return row.id;
  });
}
export async function snapshotDocument(id: string, userId?: string) {
  return db.$transaction(
    async (tx) => {
      await lockDocument(tx, id);
      if (userId) await access(id, userId, ["OWNER", "EDITOR"], tx);
      else if (!(await tx.document.findUnique({ where: { id } }))) return null;
      const { doc, watermark } = await loadState(id, tx);
      try {
        const latest = await tx.documentSnapshot.findFirst({
          where: { documentId: id },
          orderBy: { watermark: "desc" },
        });
        if (latest && latest.watermark === watermark)
          return {
            id: latest.id,
            createdAt: latest.createdAt,
            watermark: String(watermark),
          };
        const snapshot = await tx.documentSnapshot.create({
          data: {
            documentId: id,
            snapshotData: Buffer.from(Y.encodeStateAsUpdate(doc)),
            watermark,
          },
        });
        await tx.documentUpdate.deleteMany({
          where: { documentId: id, id: { lte: watermark } },
        });
        return {
          id: snapshot.id,
          createdAt: snapshot.createdAt,
          watermark: String(watermark),
        };
      } finally {
        doc.destroy();
      }
    },
    { timeout: 15000 },
  );
}
// A restore is deliberately a fork. The original room and all offline edits stay valid.
export async function restoreVersion(
  id: string,
  versionId: string,
  userId: string,
) {
  return db.$transaction(async (tx) => {
    const { document } = await access(id, userId, ["OWNER", "EDITOR"], tx);
    const version = await tx.documentSnapshot.findFirst({
      where: { id: versionId, documentId: id },
    });
    if (!version) throw new AppError(404, "Version not found.");
    const restored = await tx.document.create({
      data: {
        title: `${document.title} (restored)`.slice(0, 160),
        ownerId: userId,
      },
    });
    await tx.documentSnapshot.create({
      data: {
        documentId: restored.id,
        snapshotData: version.snapshotData,
        watermark: 0n,
      },
    });
    return restored;
  });
}
