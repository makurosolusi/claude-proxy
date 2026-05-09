import { config } from "../config";

// SQLite download/upload tidak relevan setelah migrasi ke PostgreSQL.
// Endpoint ini sekarang hanya return info koneksi DB.

export function handleDbDownload(): Response {
  return Response.json({ error: "SQLite download not available — using PostgreSQL" }, { status: 410 });
}

export async function handleDbUpload(_req: Request): Promise<Response> {
  return Response.json({ error: "SQLite upload not available — using PostgreSQL" }, { status: 410 });
}

export function handleDbInfo(): Response {
  const url = config.databaseUrl;
  const safe = url ? url.replace(/:\/\/[^@]+@/, "://***@") : "(not set)";
  return Response.json({ engine: "postgresql", url: safe });
}
