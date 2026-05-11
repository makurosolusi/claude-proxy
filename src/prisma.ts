import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const tz = process.env.TZ || "Asia/Makassar";

// Inject timezone via PostgreSQL connection parameter — tidak butuh query terpisah,
// sehingga tidak ada race condition dengan pg handshake.
function buildConnString(base: string | undefined, timezone: string): string {
  if (!base) return "";
  try {
    const url = new URL(base);
    // options param: -c TimeZone=Asia/Makassar
    url.searchParams.set("options", `-c TimeZone=${timezone}`);
    return url.toString();
  } catch {
    // Fallback jika URL tidak valid — append langsung
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}options=-c%20TimeZone%3D${encodeURIComponent(timezone)}`;
  }
}

const pool = new Pool({
  connectionString: buildConnString(process.env.DATABASE_URL, tz),
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
