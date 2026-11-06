import { PrismaClient } from "@prisma/client";
export const db = new PrismaClient({
  transactionOptions: { maxWait: 15000, timeout: 15000 },
});
