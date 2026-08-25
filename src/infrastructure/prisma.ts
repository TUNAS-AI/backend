import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

let prisma: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for database access");
  }

  prisma ??= new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  return prisma;
}
