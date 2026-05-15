import { useState, useEffect, useCallback, useRef } from "react";
import { Stack, Text, Box, Group, Badge, ScrollArea, Loader, ActionIcon, useMantineColorScheme, Tooltip, Modal } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconBolt, IconAlertCircle, IconDatabase, IconChevronDown, IconChevronRight, IconCornerDownRight } from "@tabler/icons-react";
import { DetailContent } from "./tables/RequestLog";
import { UserAvatar } from "./UserAvatar";
import type { LogEntry } from "../contexts";
import { useStatus } from "../contexts";

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

interface LogGroup {
  key: string;
  entries: LogEntry[];
  // newest entry (shown as representative)
  head: LogEntry;
  totalTokens: number;
  hasNew: boolean;
}

function groupLogs(logs: LogEntry[], newIds: Set<number>): LogGroup[] {
  // Group by token_key + model + prompt (same prompt = same Claude Code work session)
  const map = new Map<string, LogGroup>();
  const order: string[] = [];

  for (const l of logs) {
    const gk = `${l.token_key}::${l.model}::${l.prompt ?? ""}`;
    if (!map.has(gk)) {
      order.push(gk);
      map.set(gk, { key: `g-${l.id}`, entries: [], head: l, totalTokens: 0, hasNew: false });
    }
    const g = map.get(gk)!;
    g.entries.push(l);
    g.totalTokens += l.input_tokens + l.output_tokens + l.cache_read + l.cache_creation;
    if (newIds.has(l.id)) g.hasNew = true;
  }

  return order.map(gk => map.get(gk)!);
}


// Derive display identity for a log entry: owner takes precedence over token label.
// Orphan logs (no owner) fall back to token_label, then legacy name, then last 8 of key.
function deriveDisplay(l: LogEntry): { primary: string; secondary: string } {
  const owner   = l.owner_name || "";
  const tokLbl  = l.token_label || l.name || l.token_key.slice(-8);
  const primary = owner || tokLbl;
  const secondary = owner && tokLbl && tokLbl !== owner ? tokLbl : "";
  return { primary, secondary };
}

function FeedEntry({
  log: l, isNew, onClick, compact = false, imageUrl,
}: {
  log: LogEntry; isNew: boolean; onClick: () => void; compact?: boolean; imageUrl?: string;
}) {
  const isErr  = l.status >= 400;
  const total  = l.input_tokens + l.output_tokens + l.cache_read + l.cache_creation;
  const model  = modelShort(l.model);
  const mColor = modelColor(l.model);
  const { primary, secondary } = deriveDisplay(l);

  return (
    <Box
      className={`feed-entry${isNew ? " feed-entry-new" : ""}`}
      onClick={onClick}
      style={{
        padding: compact ? "6px 14px 6px 48px" : "9px 14px",
        borderBottom: "1px solid var(--cp-border)",
        cursor: "pointer",
        background: compact ? "var(--cp-surface-2)" : undefined,
        opacity: compact ? 0.85 : 1,
      }}
    >
      <Group gap={10} wrap="nowrap" align="flex-start">
        {!compact && <UserAvatar name={primary} imageUrl={imageUrl} isErr={isErr} />}

        <Box style={{ flex: 1, minWidth: 0 }}>
          {/* Row 1: primary name + timestamp */}
          {!compact && (
            <Group justify="space-between" wrap="nowrap" mb={2}>
              <Text fz={13} fw={600} truncate style={{ letterSpacing: "-0.01em", maxWidth: "78%" }}>
                {primary}
              </Text>
              <Text fz={10} c="dimmed" ff="Geist Mono, monospace" style={{ flexShrink: 0 }}>
                {fmtAge(l.ts)}
              </Text>
            </Group>
          )}

          {/* Row 2: token label (own line, readable) — only when distinct from owner */}
          {!compact && secondary && (
            <Group gap={4} wrap="nowrap" mb={4} style={{ minWidth: 0 }}>
              <IconCornerDownRight size={11} style={{ color: "var(--cp-text-3)", flexShrink: 0 }} />
              <Text fz={11} ff="Geist Mono, monospace" truncate
                style={{ color: "var(--cp-text-2)" }}>
                {secondary}
              </Text>
            </Group>
          )}

          {/* Row 3: model badge + tokens + cache + turns + (timestamp for compact) */}
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
            {compact && (
              <Text fz={10} c="dimmed" ff="Geist Mono, monospace" style={{ marginLeft: "auto" }}>
                {fmtAge(l.ts)}
              </Text>
            )}
          </Group>

          {l.prompt && !isErr && !compact && (
            <Text fz={13} c="dimmed" mt={4} lineClamp={4}
              style={{ lineHeight: 1.5, opacity: 0.9 }}>
              {l.prompt}
            </Text>
          )}
        </Box>
      </Group>
    </Box>
  );
}

function GroupedEntry({
  group, newIds, onEntryClick, imageUrl,
}: {
  group: LogGroup;
  newIds: Set<number>;
  onEntryClick: (log: LogEntry) => void;
  imageUrl?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const l = group.head;
  const isErr  = l.status >= 400;
  const model  = modelShort(l.model);
  const mColor = modelColor(l.model);
  const { primary, secondary } = deriveDisplay(l);
  const count  = group.entries.length;
  const isNew  = group.hasNew;

  return (
    <Box>
      {/* Group header row — click anywhere to expand */}
      <Box
        className={`feed-entry${isNew ? " feed-entry-new" : ""}`}
        onClick={() => setExpanded(v => !v)}
        style={{ padding: "9px 14px", borderBottom: "1px solid var(--cp-border)", cursor: "pointer" }}
      >
        <Group gap={10} wrap="nowrap" align="flex-start">
          <UserAvatar name={primary} imageUrl={imageUrl} isErr={isErr} />

          <Box style={{ flex: 1, minWidth: 0 }}>
            {/* Row 1: primary name + ×count + timestamp */}
            <Group justify="space-between" wrap="nowrap" mb={2}>
              <Group gap={6} wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                <Text fz={13} fw={600} truncate style={{ letterSpacing: "-0.01em" }}>
                  {primary}
                </Text>
                <Badge
                  size="xs" variant="filled" color="gray"
                  style={{ fontSize: 10, fontFamily: "Geist Mono, monospace", cursor: "default", flexShrink: 0 }}
                >
                  ×{count}
                </Badge>
              </Group>
              <Text fz={10} c="dimmed" ff="Geist Mono, monospace" style={{ flexShrink: 0 }}>
                {fmtAge(l.ts)}
              </Text>
            </Group>

            {/* Row 2: token label (own line) */}
            {secondary && (
              <Group gap={4} wrap="nowrap" mb={4} style={{ minWidth: 0 }}>
                <IconCornerDownRight size={11} style={{ color: "var(--cp-text-3)", flexShrink: 0 }} />
                <Text fz={11} ff="Geist Mono, monospace" truncate
                  style={{ color: "var(--cp-text-2)" }}>
                  {secondary}
                </Text>
              </Group>
            )}

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
                    background: mColor + "18", borderRadius: 6, padding: "1px 6px",
                  }}>
                    <Box w={5} h={5} style={{ borderRadius: "50%", background: mColor, flexShrink: 0 }} />
                    <Text fz={10} fw={600} style={{ color: mColor, fontFamily: "Geist Mono, monospace" }}>
                      {model}
                    </Text>
                  </Box>
                  <Group gap={4} wrap="nowrap">
                    <IconBolt size={9} color="var(--cp-text-3)" />
                    <Text fz={10} c="dimmed" ff="Geist Mono, monospace">{kfmt(group.totalTokens)}</Text>
                  </Group>
                  <CacheBar cacheRead={l.cache_read} inputTokens={l.input_tokens} />
                </>
              )}

              {/* Expand toggle */}
              <ActionIcon
                size={16} variant="subtle" color="gray"
                style={{ marginLeft: "auto" }}
                onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
                aria-label={expanded ? "Collapse" : "Expand"}
              >
                {expanded
                  ? <IconChevronDown size={11} />
                  : <IconChevronRight size={11} />
                }
              </ActionIcon>
            </Group>

            {l.prompt && !isErr && (
              <Text fz={14} c="dimmed" mt={4} lineClamp={4}
                style={{ lineHeight: 1.5, opacity: 0.9 }}>
                {l.prompt}
              </Text>
            )}
          </Box>
        </Group>
      </Box>

      {/* Expanded sub-entries */}
      {expanded && group.entries.map(entry => (
        <FeedEntry
          key={entry.id}
          log={entry}
          isNew={newIds.has(entry.id)}
          onClick={() => onEntryClick(entry)}
          compact
        />
      ))}
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
  const [detail, setDetail]           = useState<LogEntry | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);
  const { colorScheme }         = useMantineColorScheme();
  const dark                    = colorScheme === "dark";
  const viewportRef             = useRef<HTMLDivElement>(null);
  const prevIdsRef              = useRef<Set<number>>(new Set());

  const showDetail = useCallback(async (log: LogEntry) => {
    setDetail(log);
    setDetailLoading(true);
    openModal();
    try {
      const r = await fetch(`/api/logs/${log.id}`);
      if (r.ok) setDetail(await r.json() as LogEntry);
    } finally {
      setDetailLoading(false);
    }
  }, [openModal]);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/logs?page=1&limit=${MAX}`);
      if (!r.ok) return;
      const d = await r.json();
      const newLogs: LogEntry[] = d.logs || [];

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

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || newIds.size === 0) return;
    if (el.scrollTop < 60) el.scrollTo({ top: 0, behavior: "smooth" });
  }, [newIds]);

  const status     = useStatus();
  // userImages dari WS push jika ada, fallback ke fetch HTTP sekali
  const [localUserImages, setLocalUserImages] = useState<Record<string, string>>({});
  useEffect(() => {
    fetch("/api/status").then(r => r.ok ? r.json() : null)
      .then(d => d?.userImages && setLocalUserImages(d.userImages))
      .catch(() => {});
  }, []);
  const userImages = (status?.userImages && Object.keys(status.userImages).length > 0)
    ? status.userImages
    : localUserImages;
  const groups    = groupLogs(logs, newIds);
  const errCount  = logs.filter(l => l.status >= 400).length;

  return (
    <Box style={{
      background: "var(--cp-surface)",
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
        {groups.length === 0 && !loading ? (
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
          groups.map(group => {
            // Image lookup keyed by owner name. Orphan groups (no owner) get no image.
            const imageUrl = group.head.owner_name ? userImages[group.head.owner_name] : undefined;
            return group.entries.length === 1
              ? <FeedEntry
                  key={group.key}
                  log={group.head}
                  isNew={group.hasNew}
                  onClick={() => showDetail(group.head)}
                  imageUrl={imageUrl}
                />
              : <GroupedEntry
                  key={group.key}
                  group={group}
                  newIds={newIds}
                  onEntryClick={showDetail}
                  imageUrl={imageUrl}
                />;
          })
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

      {/* Request detail modal */}
      <Modal opened={modalOpened} onClose={closeModal} title="Request Detail" size="lg" centered>
        {detailLoading
          ? <Group justify="center" py="xl"><Loader size="sm" /></Group>
          : detail
          ? <DetailContent log={detail} />
          : <Text size="sm" c="dimmed">Gagal memuat detail.</Text>
        }
      </Modal>
    </Box>
  );
}
