import { Text, Box, Group, Tooltip } from "@mantine/core";
import { IconDatabase } from "@tabler/icons-react";

export const MAX_LOGS = 80;

export function kfmt(n: number): string {
  return n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + "M"
       : n >= 1_000     ? (n / 1_000).toFixed(1) + "K"
       : String(n);
}

export function fmtAge(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5)    return "now";
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

export function fmtDuration(ms: number): string {
  if (ms < 1000)    return `${ms}ms`;
  if (ms < 60_000)  return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
}

export function modelShort(model: string): string {
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

const MODEL_COLORS: Record<string, string> = {
  opus:   "#7c3aed",
  sonnet: "#2563eb",
  haiku:  "#0d9488",
};
export function modelColor(model: string): string {
  for (const [k, v] of Object.entries(MODEL_COLORS)) {
    if (model.includes(k)) return v;
  }
  return "#52525b";
}

export type Severity = "normal" | "warning" | "heavy" | "critical";
const SEV_ORDER: Severity[] = ["normal", "warning", "heavy", "critical"];

export function ctxSeverity(input: number): Severity {
  if (input > 100_000) return "critical";
  if (input > 50_000)  return "heavy";
  if (input > 20_000)  return "warning";
  return "normal";
}
export function totalSeverity(total: number): Severity {
  if (total > 300_000) return "critical";
  if (total > 150_000) return "heavy";
  if (total > 50_000)  return "warning";
  return "normal";
}
export function maxSev(a: Severity, b: Severity): Severity {
  return SEV_ORDER[Math.max(SEV_ORDER.indexOf(a), SEV_ORDER.indexOf(b))]!;
}

export const SEV_COLOR: Record<Severity, string> = {
  normal:   "#10b981",
  warning:  "#eab308",
  heavy:    "#f97316",
  critical: "#ef4444",
};
const SEV_LABEL: Record<Severity, string> = {
  normal: "OK", warning: "WARN", heavy: "HEAVY", critical: "CRIT",
};
const SEV_ALPHA: Record<Severity, number> = {
  normal: 0.015, warning: 0.03, heavy: 0.05, critical: 0.08,
};

export function severityGradient(s: Severity, isErr: boolean): string {
  if (isErr) return "linear-gradient(135deg, rgba(239,68,68,0.07) 0%, transparent 60%)";
  if (s === "normal") return "transparent";
  const hex = Math.round(SEV_ALPHA[s] * 255).toString(16).padStart(2, "0");
  return `linear-gradient(135deg, ${SEV_COLOR[s]}${hex} 0%, transparent 70%)`;
}

export function briefExplanation(
  ctx: Severity, tot: Severity, isErr: boolean, status: number, durationMs: number,
): string {
  if (isErr) return `Error ${status}`;
  if (ctx === "critical") return "Context penuh — segera /compact";
  if (tot === "critical") return "Request sangat besar — boros tokens";
  if (ctx === "heavy")    return "Context tinggi — pertimbangkan /compact";
  if (tot === "heavy")    return "Request berat";
  if (durationMs > 30_000) return "Request lambat";
  if (ctx === "warning")  return "Context menengah";
  if (tot === "warning")  return "Request menengah";
  return "Sesi normal";
}

export function anomalyScore(inp: number, out: number, toolUse: number, durationMs: number): number {
  let s = 0;
  if (inp > 100_000) s += 40; else if (inp > 50_000) s += 20; else if (inp > 20_000) s += 8;
  const ratio = inp / Math.max(out, 1);
  if (ratio > 100) s += 25; else if (ratio > 50) s += 12; else if (ratio > 20) s += 5;
  if (toolUse > 20) s += 20; else if (toolUse > 10) s += 10; else if (toolUse > 5) s += 4;
  if (durationMs > 300_000) s += 15; else if (durationMs > 120_000) s += 7;
  return Math.min(s, 100);
}

export function CacheBar({ cacheRead, inputTokens }: { cacheRead: number; inputTokens: number }) {
  const total = inputTokens + cacheRead;
  if (total === 0 || cacheRead === 0) return null;
  const pct = Math.round((cacheRead / total) * 100);
  return (
    <Tooltip label={`Cache hit: ${pct}% (${kfmt(cacheRead)} cached)`} withArrow position="top">
      <Group gap={3} wrap="nowrap" style={{ cursor: "default" }}>
        <IconDatabase size={9} color="var(--cp-teal)" />
        <Text fz={9} c="teal" fw={600}>{pct}%</Text>
      </Group>
    </Tooltip>
  );
}

export function SeverityPill({ sev }: { sev: Severity }) {
  const c = SEV_COLOR[sev];
  return (
    <Box style={{
      display: "inline-flex", alignItems: "center",
      padding: "1px 6px", borderRadius: 4,
      background: c + "22", border: `1px solid ${c}55`,
      fontSize: 9, fontWeight: 700, color: c,
      fontFamily: "Geist Mono, monospace", letterSpacing: ".04em",
      lineHeight: 1.4,
    }}>
      {SEV_LABEL[sev]}
    </Box>
  );
}

export function MetricRow({
  icon, label, value, sev, hint,
}: {
  icon: React.ReactNode; label: string; value: string; sev: Severity; hint?: string;
}) {
  const c = SEV_COLOR[sev];
  return (
    <Tooltip label={hint || `${label}: ${value}`} withArrow position="top" disabled={!hint}>
      <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
        <Box style={{ color: c, flexShrink: 0, display: "flex", alignItems: "center" }}>{icon}</Box>
        <Text fz={10} c="dimmed" ff="Geist Mono, monospace" style={{ flexShrink: 0, minWidth: 46 }}>
          {label}
        </Text>
        <Text fz={11} fw={600} ff="Geist Mono, monospace" style={{ color: c, minWidth: 44 }}>
          {value}
        </Text>
        <SeverityPill sev={sev} />
      </Group>
    </Tooltip>
  );
}
