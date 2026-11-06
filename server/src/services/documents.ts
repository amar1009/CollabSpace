import type { Prisma, Role } from "@prisma/client";
import { db } from "../models/db.js";
import { AppError } from "../utils/errors.js";
type Database = Prisma.TransactionClient;
export async function access(
  documentId: string,
  userId: string,
  allowed?: Role[],
  database: Database = db,
) {
  const document = await database.document.findUnique({
    where: { id: documentId },
    include: { permissions: { where: { userId } } },
  });
  const role =
    document?.ownerId === userId ? "OWNER" : document?.permissions[0]?.role;
  if (!document || !role) throw new AppError(404, "Document not found.");
  if (allowed && !allowed.includes(role))
    throw new AppError(403, "You do not have permission to do that.");
  return { document, role };
}
export async function listDocuments(userId: string) {
  const documents = await db.document.findMany({
    where: { OR: [{ ownerId: userId }, { permissions: { some: { userId } } }] },
    include: {
      owner: { select: { id: true, name: true } },
      permissions: { where: { userId } },
    },
    orderBy: { updatedAt: "desc" },
  });
  return documents.map(({ permissions, ...d }) => ({
    ...d,
    role: d.ownerId === userId ? "OWNER" : permissions[0]!.role,
  }));
}
export async function share(
  documentId: string,
  ownerId: string,
  email: string,
  role: "EDITOR" | "VIEWER",
) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${documentId}, 0))`;
    await access(documentId, ownerId, ["OWNER"], tx);
    const user = await tx.user.findUnique({ where: { email } });
    if (!user) throw new AppError(404, "No registered user has that email.");
    if (user.id === ownerId)
      throw new AppError(400, "The owner already has full access.");
    return tx.documentPermission.upsert({
      where: { documentId_userId: { documentId, userId: user.id } },
      update: { role },
      create: { documentId, userId: user.id, role },
    });
  });
}
