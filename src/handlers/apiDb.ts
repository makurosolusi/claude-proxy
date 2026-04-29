import fs   from "fs";
import path from "path";
import { config } from "../config";
import { db }     from "../state";

const SQLITE_MAGIC = "SQLite format 3";

export function handleDbDownload(): Response {
  try {
    // Flush WAL into the main file so the downloaded DB is complete
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");

    const filename = `claude-proxy-${new Date().toISOString().slice(0, 10)}.db`;
    const file = Bun.file(config.dbFile);
    return new Response(file, {
      headers: {
        "Content-Type":        "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function handleDbUpload(req: Request): Promise<Response> {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return Response.json({ error: "No file" }, { status: 400 });

    const buf   = Buffer.from(await file.arrayBuffer());
    const magic = buf.subarray(0, 15).toString("utf-8");
    if (!magic.startsWith(SQLITE_MAGIC)) {
      return Response.json({ error: "Invalid file — not a SQLite database" }, { status: 400 });
    }

    // Write to temp path first
    const tmpPath = config.dbFile + ".upload.tmp";
    fs.writeFileSync(tmpPath, buf);

    // Close DB cleanly (checkpoints WAL into main file)
    db.close();

    // Delete old WAL/SHM — they belong to the old DB and would corrupt the new one
    for (const suffix of ["-wal", "-shm"]) {
      const p = config.dbFile + suffix;
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
    }

    // Atomically replace DB file
    fs.renameSync(tmpPath, config.dbFile);

    console.log("[db] Database replaced, restarting...");
    // Give response time to reach client before exit
    setTimeout(() => process.exit(0), 300);

    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export function handleDbInfo(): Response {
  try {
    const stat = fs.statSync(config.dbFile);
    return Response.json({
      path:     config.dbFile,
      size:     stat.size,
      modified: stat.mtime.toISOString(),
    });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
