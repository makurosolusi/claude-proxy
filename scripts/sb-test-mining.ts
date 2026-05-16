// Manual integration test for strategy mining pipeline.
// Requires: extension enabled, OAuth credential available, DATABASE_URL set.
// Run: bun scripts/sb-test-mining.ts

import { loadFromDb } from "../src/state";
import { startWorker, stopWorker, enqueueMining } from "../src/extensions/second-brain/worker";
import { onEnable } from "../src/extensions/second-brain/lifecycle";
import { prisma } from "../src/prisma";

await loadFromDb();
const enableRes = await onEnable();
if (!enableRes.ok) { console.error("onEnable failed:", enableRes.error); process.exit(1); }
await startWorker();

const SAMPLE_USER = "_sb_test_" + Date.now();

const traj = `[user]
Tambah feature WebSocket real-time untuk push notifikasi ke client di project Bun + Mantine. Existing sudah pakai broadcast pattern via WebSocket.

[assistant]
Saya cek dulu broadcast pattern yang sudah ada di project. Berdasarkan src/broadcast.ts dan src/index.tsx, project pakai Bun native WebSocket di endpoint /ws.

[user]
ok lanjutkan implementasinya

[assistant]
Untuk menambah push notifikasi real-time:

1. Wire broadcast helper di file yang trigger event (mis. setelah token update)
2. Di client React, useEffect setup WebSocket listener dengan cleanup
3. Auto-reconnect 3 detik kalau disconnect
4. Format payload JSON dengan type field untuk routing handler

Hindari socket.io — project pakai Bun native. Auth pakai cookie session Better Auth, bukan header.`;

const responseText = `Implementation steps for WebSocket realtime push:
1. Use existing /ws endpoint with Bun.serve() websocket handler
2. Push from any handler via triggerBroadcast() in broadcast.ts
3. Client: useEffect with reconnect-3s cleanup
4. JSON payload with 'type' field for handler routing
Avoid socket.io library — Bun has native WS support. Auth via Better Auth cookie session.`;

console.log("Enqueuing mining job...");
const jobId = await enqueueMining({
  request_log_id: 0,
  prompt: "Tambah feature WebSocket real-time untuk push notifikasi",
  response_text: responseText,
  trajectory: traj,
  model: "claude-haiku-4-5-20251001",
  user_id: SAMPLE_USER,
  project: "claude-proxy",
});
console.log("Enqueued job:", jobId);

console.log("Waiting up to 45s for distillation + insert...");
const t0 = Date.now();
let found: any[] = [];
while (Date.now() - t0 < 45000) {
  found = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, title, when_to_use, content, pitfalls, tags FROM sb_strategies WHERE user_id = $1`,
    SAMPLE_USER,
  );
  if (found.length) break;
  await new Promise(r => setTimeout(r, 2000));
}

if (found.length) {
  console.log("✅ Strategy mined:");
  for (const s of found) {
    console.log("  id:", s.id);
    console.log("  title:", s.title);
    console.log("  when_to_use:", s.when_to_use);
    console.log("  steps:", s.content);
    console.log("  pitfalls:", s.pitfalls);
    console.log("  tags:", s.tags);
  }
} else {
  console.log("❌ Timeout — no strategy created. Check sb_extension_logs for mine_* events.");
  const logs = await prisma.$queryRawUnsafe<any[]>(
    `SELECT ts, event_type, detail FROM sb_extension_logs WHERE user_id = $1 ORDER BY ts DESC LIMIT 5`,
    SAMPLE_USER,
  );
  console.log("Recent logs:", logs);
}

console.log("Cleaning up...");
await prisma.$executeRawUnsafe(`DELETE FROM sb_strategies WHERE user_id = $1`, SAMPLE_USER);
await prisma.$executeRawUnsafe(`DELETE FROM sb_extension_logs WHERE user_id = $1`, SAMPLE_USER);
await stopWorker();
console.log("Done.");
process.exit(0);
