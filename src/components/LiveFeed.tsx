import { useState, useEffect, useCallback, useRef } from "react";
import { Stack, Text, Box, Group, Badge, ScrollArea, Loader, useMantineColorScheme, Tooltip } from "@mantine/core";
import { IconBolt, IconAlertCircle, IconDatabase } from "@tabler/icons-react";
import { avatarColor } from "../utils";
import type { LogEntry } from "../contexts";

const MAX = 80;

function kfmt(n: number) {
  return n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + "M"
       : n >= 1_000     ? (n / 1_000).toFixed(1) + "K"
       : String(n);
}

function fmtAge(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5)    return "now";
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

function modelShort(model: string) {
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

function initials(s: string) {
  return (s || "?").trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? "").join("") || "?";
}

const MODEL_COLORS: Record<string, string> = {
  "opus":   "#7c3aed",
  "sonnet": "#2563eb",
  "haiku":  "#0d9488",
};
function modelColor(model: string): string {
  for (const [k, v] of Object.entries(MODEL_COLORS)) {
    if (model.includes(k)) return v;
  }
  return "#52525b";
}

// Cache hit rate indicator
function CacheBar({ cacheRead, inputTokens }: { cacheRead: number; inputTokens: number }) {
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

function FeedEntry({ log: l, isNew }: { log: LogEntry; isNew: boolean }) {
  const isErr  = l.status >= 400;
  const total  = l.input_tokens + l.output_tokens + l.cache_read + l.cache_creation;
  const model  = modelShort(l.model);
  const mColor = modelColor(l.model);
  const aColor = avatarColor(l.name || l.token_key);
  const name   = l.name || l.token_key.slice(-8);

  return (
    <Box className={`feed-entry${isNew ? " feed-entry-new" : ""}`}
      style={{ padding: "9px 14px", borderBottom: "1px solid var(--cp-border)" }}>
      <Group gap={8} wrap="nowrap" align="flex-start">

        {/* Avatar circle */}
        <Box style={{
          width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
          background: isErr
            ? "var(--cp-red-dim)"
            : `var(--mantine-color-${aColor}-${document.documentElement.getAttribute("data-mantine-color-scheme") === "dark" ? "8" : "1"})`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, fontWeight: 700,
          color: isErr ? "var(--cp-red)" : `var(--mantine-color-${aColor}-6)`,
          fontFamily: "Geist Mono, monospace",
          border: isErr ? "1px solid var(--cp-red-dim)" : "none",
          marginTop: 1,
        }}>
          {isErr ? "!" : initials(name)}
        </Box>

        <Box style={{ flex: 1, minWidth: 0 }}>
          {/* Row 1: name + age */}
          <Group justify="space-between" wrap="nowrap" mb={3}>
            <Text fz={12} fw={600} truncate style={{ letterSpacing: "-0.01em", maxWidth: "65%" }}>
              {name}
            </Text>
            <Text fz={10} c="dimmed" ff="Geist Mono, monospace" style={{ flexShrink: 0 }}>
              {fmtAge(l.ts)}
            </Text>
          </Group>

          {/* Row 2: model badge + tokens + cache */}
          <Group gap={6} wrap="nowrap">
            {isErr ? (
              <Badge size="xs" variant="light" color="red" leftSection={<IconAlertCircle size={8} />}
                style={{ fontSize: 10, fontFamily: "Geist Mono, monospace" }}>
                {l.status}
              </Badge>
            ) : (
              <>
                <Box style={{
                  display: "inline-flex", alignItems: "center", gap: 3,
                  background: mColor + "18", borderRadius: 6,
                  padding: "1px 6px",
                }}>
                  <Box w={5} h={5} style={{ borderRadius: "50%", background: mColor, flexShrink: 0 }} />
                  <Text fz={10} fw={600} style={{ color: mColor, fontFamily: "Geist Mono, monospace" }}>
                    {model}
                  </Text>
                </Box>
                <Group gap={4} wrap="nowrap">
                  <IconBolt size={9} color="var(--cp-text-3)" />
                  <Text fz={10} c="dimmed" ff="Geist Mono, monospace">{kfmt(total)}</Text>
                </Group>
                <CacheBar cacheRead={l.cache_read} inputTokens={l.input_tokens} />
                {l.turns > 0 && (
                  <Text fz={10} c="dimmed">{l.turns}t</Text>
                )}
              </>
            )}
          </Group>

          {/* Row 3: prompt preview */}
          {l.prompt && !isErr && (
            <Text fz={10} c="dimmed" mt={4} lineClamp={1}
              style={{ fontStyle: "italic", lineHeight: 1.4, opacity: 0.75 }}>
              {l.prompt}
            </Text>
          )}
        </Box>
      </Group>
    </Box>
  );
}

interface LiveFeedProps {
  wsSignal?: number;
}

export function LiveFeed({ wsSignal }: LiveFeedProps) {
  const [logs, setLogs]         = useState<LogEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [total, setTotal]       = useState(0);
  const [newIds, setNewIds]     = useState<Set<number>>(new Set());
  const { colorScheme }         = useMantineColorScheme();
  const dark                    = colorScheme === "dark";
  const viewportRef             = useRef<HTMLDivElement>(null);
  const prevIdsRef              = useRef<Set<number>>(new Set());

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/logs?page=1&limit=${MAX}`);
      if (!r.ok) return;
      const d = await r.json();
      const newLogs: LogEntry[] = d.logs || [];

      // Detect new entries
      const incoming = new Set(newLogs.map(l => l.id));
      const fresh    = new Set<number>();
      for (const id of incoming) {
        if (!prevIdsRef.current.has(id)) fresh.add(id);
      }
      prevIdsRef.current = incoming;

      setLogs(newLogs);
      setTotal(d.total || 0);
      if (fresh.size > 0) {
        setNewIds(fresh);
        setTimeout(() => setNewIds(new Set()), 3000);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [load]);
  useEffect(() => {
    if (wsSignal === undefined) return;
    load();
  }, [wsSignal, load]);

  // Scroll to top on new entries
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || newIds.size === 0) return;
    if (el.scrollTop < 60) el.scrollTo({ top: 0, behavior: "smooth" });
  }, [newIds]);

  const bg    = dark ? "var(--cp-surface)" : "var(--cp-surface)";
  const errCount = logs.filter(l => l.status >= 400).length;

  return (
    <Box style={{
      background: bg,
      border: "1px solid var(--cp-border)",
      borderRadius: 20,
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      height: "100%",
      minHeight: 0,
    }}>
      {/* Header */}
      <Box style={{
        padding: "12px 14px 10px",
        borderBottom: "1px solid var(--cp-border)",
        flexShrink: 0,
        background: dark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.01)",
      }}>
        <Group justify="space-between" align="center">
          <Group gap={8}>
            <Box className="live-dot" />
            <Text fz={11} fw={700} tt="uppercase" style={{ letterSpacing: ".09em" }}>
              Live Feed
            </Text>
          </Group>
          <Group gap={6}>
            {loading && <Loader size={10} color="teal" />}
            {errCount > 0 && (
              <Badge size="xs" color="red" variant="light" style={{ fontSize: 10 }}>
                {errCount} err
              </Badge>
            )}
            {total > 0 && (
              <Text fz={10} c="dimmed" ff="Geist Mono, monospace">{total.toLocaleString()}</Text>
            )}
          </Group>
        </Group>
      </Box>

      {/* Feed */}
      <ScrollArea viewportRef={viewportRef} style={{ flex: 1 }} type="scroll" scrollbarSize={3}>
        {logs.length === 0 && !loading ? (
          <Stack align="center" py={40} gap={8}>
            <Box style={{
              width: 40, height: 40, borderRadius: 12,
              background: "var(--cp-surface-2)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <IconBolt size={18} color="var(--cp-text-3)" />
            </Box>
            <Text fz={12} c="dimmed">Belum ada request</Text>
          </Stack>
        ) : (
          logs.map(l => (
            <FeedEntry key={l.id} log={l} isNew={newIds.has(l.id)} />
          ))
        )}
      </ScrollArea>

      {/* Footer */}
      <Box style={{
        padding: "8px 14px",
        borderTop: "1px solid var(--cp-border)",
        flexShrink: 0,
        background: dark ? "rgba(255,255,255,0.01)" : "rgba(0,0,0,0.01)",
      }}>
        <Group gap={6} align="center">
          <Box className="live-dot" style={{ width: 5, height: 5 }} />
          <Text fz={10} c="dimmed" style={{ letterSpacing: ".02em" }}>
            realtime · refresh 10s
          </Text>
        </Group>
      </Box>
    </Box>
  );
}
