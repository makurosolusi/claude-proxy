// Local-timezone date helpers — no imports, no circular dependency risk.
// new Date() getters (getFullYear, getMonth, getDate, getHours, setHours)
// respects TZ env variable in Bun/Node, sehingga otomatis benar setelah
// ENV TZ=Asia/Makassar di-set di Dockerfile/compose.

/** Format Date sebagai "YYYY-MM-DD" dalam local timezone (TZ env). */
export function localDateStr(d = new Date()): string {
  const y  = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${dy}`;
}

/** Epoch ms untuk awal hari ini dalam local timezone. */
export function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
