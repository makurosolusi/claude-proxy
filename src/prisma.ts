import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const tz = process.env.TZ || "Asia/Makassar";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Set timezone di setiap koneksi baru — semua EXTRACT(HOUR), to_char(), dsb
// otomatis pakai timezone yang benar tanpa perlu AT TIME ZONE di setiap query.
pool.on("connect", (client) => {
  client.query(`SET TIME ZONE '${tz}'`).catch(e =>
    console.error("[db] SET TIME ZONE error:", e.message)
  );
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
