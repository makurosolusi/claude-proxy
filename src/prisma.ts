import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  console.error("[db] pool error:", err.message);
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter } as any);

export async function closeDb() {
  await prisma.$disconnect();
  await pool.end();
}
