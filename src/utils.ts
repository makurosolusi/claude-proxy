export function fmtCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}
export function fmtResetAt(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "now";
  if (Math.floor(ms / 3_600_000) < 24) return fmtCountdown(ms);
  const d = new Date(iso);
  return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()]
    + " " + String(d.getHours()).padStart(2,"0") + ":" + String(d.getMinutes()).padStart(2,"0");
}
export function fmtRel(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return new Date(ts).toISOString().slice(0,10);
}
export function usageCls(pct: number) {
  return pct > 100 ? "over" : pct >= 80 ? "high" : pct >= 60 ? "warn" : "ok";
}
export function pctColor(pct: number): string {
  return pct >= 90 ? "red" : pct >= 70 ? "orange" : pct >= 50 ? "yellow" : "teal";
}
export function neonColor(pct: number): string {
  if (pct >= 90) return "#ff2222";
  if (pct >= 70) return "#ff7700";
  if (pct >= 50) return "#f5c400";
  return "#14d9c4";
}
export function maskToken(k: string) {
  if (k.startsWith("sk-user-")) return k.slice("sk-user-".length);
  if (k.startsWith("sk-cp-"))   return k.slice("sk-cp-".length);
  return k;
}
export function avatarColor(name: string) {
  const palette = ["blue", "teal", "grape", "orange", "cyan", "pink", "lime", "indigo", "violet"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length] || "blue";
}
export function fmtHour(h: number) { return `${String(h).padStart(2, "0")}:00`; }
export function anomalyScoreColor(s: number) {
  if (s >= 70) return "#e03131";
  if (s >= 40) return "#f76707";
  if (s >= 20) return "#fab005";
  return "#12b886";
}
export async function resolveLoginRedirect(): Promise<string> {
  try {
    const r = await fetch("/api/profile", { credentials: "include" });
    const d = await r.json() as any;
    if (!d?.authenticated) return "/login";
    if (d?.status === "blocked")  return "/diblokir";
    if (d?.status === "pending")  return "/menunggu";
    if (d?.role === "SUPER_ADMIN" || d?.role === "ADMIN") return "/admin";
  } catch {}
  return "/";
}
export async function signInWithGoogle() {
  const r = await fetch("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ provider: "google", callbackURL: "/login/redirect" }),
  });
  const d = await r.json() as any;
  if (d?.url) window.location.href = d.url;
}
export async function adminPost(path: string, fields: Record<string, string> = {}) {
  await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}
