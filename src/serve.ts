import fs from "node:fs";
import path from "node:path";

// Prevent dual-instance split traffic on `bun --hot` restart (SO_REUSEPORT)
const PID_FILE = "./state/server.pid";

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
if (fs.existsSync(PID_FILE)) {
  const prev = Number(fs.readFileSync(PID_FILE, "utf-8").trim());
  if (Number.isFinite(prev) && prev !== process.pid && isAlive(prev)) {
    process.kill(prev, "SIGTERM");
    Bun.sleepSync(80);
  }
}
fs.writeFileSync(PID_FILE, String(process.pid));
process.on("exit", () => { try { fs.unlinkSync(PID_FILE); } catch {} });

// Dynamic import delays one microtask — lets kernel release the old socket
await import("./index.tsx");
