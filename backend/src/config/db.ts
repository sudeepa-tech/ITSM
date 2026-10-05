import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "./env";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function create() {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL, max: 20 });
  return new PrismaClient({ adapter, log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });
}

export const prisma = global.__prisma ?? create();
if (env.NODE_ENV !== "production") global.__prisma = prisma;
