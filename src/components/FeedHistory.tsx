import { useState, useEffect, useCallback, useRef } from "react";
import { Stack, Text, Box, Group, Badge, ScrollArea, Loader, ActionIcon, Tooltip, Modal, Select, Button } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconBolt, IconAlertCircle, IconDatabase, IconChevronDown, IconChevronRight, IconRefresh } from "@tabler/icons-react";
import { DetailContent } from "./tables/RequestLog";
import { UserAvatar } from "./UserAvatar";
import { useStatus } from "../contexts";
import type { LogEntry } from "../contexts";

const PAGE_SIZE = 40;

function kfmt(n: number) {
  return n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + "M"
       : n >= 1_000     ? (n / 1_000).toFixed(1) + "K"
       : String(n);
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function modelShort(model: string) {
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

const MODEL_COLORS: Record<string, string> = {
  opus:   "#7c3aed",
  sonnet: "#2563eb",
  haiku:  "#0d9488",
};
function modelColor(model: string) {
  for (const [k, v] of Object.entries(MODEL_COLORS)) {
    if (model.includes(k)) return v;
  }
  return "#52525b";
}

interface LogGroup {
  key: string;
  entries: LogEntry[];
  head: LogEntry;
  totalTokens: number;
}

function groupLogs(logs: LogEntry[]): LogGroup[] {
  const map = new Map<string, LogGroup>();
  const order: string[] = [];
  for (const l of logs) {
    const gk = `${l.token_key}::${l.model}::${l.prompt ?? ""}`;
    if (!map.has(gk)) {
      order.push(gk);
      map.set(gk, { key: `g-${l.id}`, entries: [], head: l, totalTokens: 0 });
    }
    const g = map.get(gk)!;
    g.entries.push(l);
    g.totalTokens += l.input_tokens + l.output_tokens + l.cache_read + l.cache_creation;
  }
  return order.map(gk => map.get(gk)!);
}

function CacheBar({ cacheRead, inputTokens }: { cacheRead: number; inputTokens: number }) {
  const total = inputTokens + cacheRead;
  if (total === 0 || cacheRead === 0) return null;
  const pct = Math.round((cacheRead / total) * 100);
  return (
    <Tooltip label={`Cache hit: ${pct}%`} withArrow>
      <Group gap={3} wrap="nowrap" style={{ cursor: "default" }}>
        <IconDatabase size={9} color="var(--cp-teal)" />
        <Text fz={9} c="teal" fw={600}>{pct}%</Text>
      </Group>
    </Tooltip>
  );
}

function HistoryEntry({ log: l, imageUrl, onClick, compact = false }: {
  log: LogEntry; imageUrl?: string; onClick: () => void; compact?: boolean;
}) {
  const isErr  = l.status >= 400;
  const total  = l.input_tokens + l.output_tokens + l.cache_read + l.cache_creation;
  const model  = modelShort(l.model);
  const mColor = modelColor(l.model);
  const name   = l.name || l.token_key.slice(-8);

  return (
    <Box onClick={onClick} style={{
      padding: compact ? "6px 14px 6px 48px" : "10px 14px",
      borderBottom: "1px solid var(--cp-border)",
      cursor: "pointer",
      background: compact ? "var(--cp-surface-2)" : undefined,
      opacity: compact ? 0.85 : 1,
    }}>
      <Group gap={8} wrap="nowrap" align="flex-start">
        {!compact && <UserAvatar name={name} imageUrl={imageUrl} isErr={isErr} />}
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Group justify="space-between" wrap="nowrap" mb={compact ? 0 : 3}>
            {!compact && (
              <Text fz={12} fw={600} truncate style={{ letterSpacing: "-0.01em", maxWidth: "60%" }}>{name}</Text>
            )}
            <Text fz={10} c="dimmed" ff="Geist Mono, monospace" style={{ flexShrink: 0, marginLeft: compact ? "auto" : undefined }}>
              {fmtTime(l.ts)}
            </Text>
          </Group>
          <Group gap={6} wrap="nowrap">
            {isErr ? (
              <Badge size="xs" variant="light" color="red" leftSection={<IconAlertCircle size={8} />}>{l.status}</Badge>
            ) : (
              <>
                <Box style={{ display: "inline-flex", alignItems: "center", gap: 3, background: mColor + "18", borderRadius: 6, padding: "1px 6px" }}>
                  <Box w={5} h={5} style={{ borderRadius: "50%", background: mColor, flexShrink: 0 }} />
                  <Text fz={10} fw={600} style={{ color: mColor, fontFamily: "Geist Mono, monospace" }}>{model}</Text>
                </Box>
                <Group gap={4} wrap="nowrap">
                  <IconBolt size={9} color="var(--cp-text-3)" />
                  <Text fz={10} c="dimmed" ff="Geist Mono, monospace">{kfmt(total)}</Text>
                </Group>
                <CacheBar cacheRead={l.cache_read} inputTokens={l.input_tokens} />
                {l.turns > 0 && <Text fz={10} c="dimmed">{l.turns}t</Text>}
              </>
            )}
          </Group>
          {l.prompt && !isErr && !compact && (
            <Text fz={13} c="dimmed" mt={4} lineClamp={3} style={{ lineHeight: 1.5, opacity: 0.9 }}>
              {l.prompt}
            </Text>
          )}
        </Box>
      </Group>
    </Box>
  );
}

function GroupedHistoryEntry({ group, imageUrl, onEntryClick }: {
  group: LogGroup; imageUrl?: string; onEntryClick: (log: LogEntry) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const l     = group.head;
  const isErr = l.status >= 400;
  const model = modelShort(l.model);
  const mColor = modelColor(l.model);
  const name  = l.name || l.token_key.slice(-8);
  const count = group.entries.length;

  return (
    <Box>
      <Box onClick={() => setExpanded(v => !v)} style={{
        padding: "10px 14px", borderBottom: "1px solid var(--cp-border)", cursor: "pointer",
      }}>
        <Group gap={8} wrap="nowrap" align="flex-start">
          <UserAvatar name={name} imageUrl={imageUrl} isErr={isErr} />
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Group justify="space-between" wrap="nowrap" mb={3}>
              <Group gap={6} wrap="nowrap" style={{ maxWidth: "65%" }}>
                <Text fz={12} fw={600} truncate style={{ letterSpacing: "-0.01em" }}>{name}</Text>
                <Badge size="xs" variant="filled" color="gray" style={{ fontSize: 10, fontFamily: "Geist Mono, monospace", flexShrink: 0 }}>×{count}</Badge>
              </Group>
              <Text fz={10} c="dimmed" ff="Geist Mono, monospace" style={{ flexShrink: 0 }}>{fmtTime(l.ts)}</Text>
            </Group>
            <Group gap={6} wrap="nowrap">
              {isErr ? (
                <Badge size="xs" variant="light" color="red" leftSection={<IconAlertCircle size={8} />}>{l.status}</Badge>
              ) : (
                <>
                  <Box style={{ display: "inline-flex", alignItems: "center", gap: 3, background: mColor + "18", borderRadius: 6, padding: "1px 6px" }}>
                    <Box w={5} h={5} style={{ borderRadius: "50%", background: mColor, flexShrink: 0 }} />
                    <Text fz={10} fw={600} style={{ color: mColor, fontFamily: "Geist Mono, monospace" }}>{model}</Text>
                  </Box>
                  <Group gap={4} wrap="nowrap">
                    <IconBolt size={9} color="var(--cp-text-3)" />
                    <Text fz={10} c="dimmed" ff="Geist Mono, monospace">{kfmt(group.totalTokens)}</Text>
                  </Group>
                  <CacheBar cacheRead={l.cache_read} inputTokens={l.input_tokens} />
                </>
              )}
              <ActionIcon size={16} variant="subtle" color="gray" style={{ marginLeft: "auto" }}
                onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}>
                {expanded ? <IconChevronDown size={11} /> : <IconChevronRight size={11} />}
              </ActionIcon>
            </Group>
            {l.prompt && !isErr && (
              <Text fz={13} c="dimmed" mt={4} lineClamp={3} style={{ lineHeight: 1.5, opacity: 0.9 }}>{l.prompt}</Text>
            )}
          </Box>
        </Group>
      </Box>
      {expanded && group.entries.map(entry => (
        <HistoryEntry key={entry.id} log={entry} imageUrl={imageUrl} onClick={() => onEntryClick(entry)} compact />
      ))}
    </Box>
  );
}

export function FeedHistory() {
  const [logs, setLogs]     = useState<LogEntry[]>([]);
  const [page, setPage]     = useState(1);
  const [total, setTotal]   = useState(0);
  const [pages, setPages]   = useState(1);
  const [loading, setLoading] = useState(true);
  const [userFilter, setUserFilter] = useState<string | null>(null);
  const [users, setUsers]   = useState<string[]>([]);
  const [detail, setDetail] = useState<LogEntry | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);

  const status     = useStatus();
  const userImages = status?.userImages ?? {};

  const load = useCallback(async (p: number, u: string | null) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/logs?page=${p}&limit=${PAGE_SIZE}${u ? `&user=${encodeURIComponent(u)}` : ""}`);
      if (!r.ok) return;
      const d = await r.json();
      setLogs(d.logs || []);
      setTotal(d.total || 0);
      setPages(d.pages || 1);
      if (d.users?.length) setUsers(d.users);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(1, null); }, [load]);

  const showDetail = async (log: LogEntry) => {
    setDetail(log);
    setDetailLoading(true);
    openModal();
    try {
      const r = await fetch(`/api/logs/${log.id}`);
      if (r.ok) setDetail(await r.json());
    } finally {
      setDetailLoading(false);
    }
  };

  const groups = groupLogs(logs);

  return (
    <Box style={{ background: "var(--cp-surface)", border: "1px solid var(--cp-border)", borderRadius: 16, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: "calc(100dvh - 220px)" }}>
      {/* Header */}
      <Group justify="space-between" px="md" py="sm" style={{ borderBottom: "1px solid var(--cp-border)" }}>
        <Group gap={8}>
          <Text fz={11} fw={700} tt="uppercase" style={{ letterSpacing: ".09em" }}>History</Text>
          {total > 0 && <Text fz={10} c="dimmed" ff="Geist Mono, monospace">{total.toLocaleString()} requests</Text>}
          {loading && <Loader size={10} color="blue" />}
        </Group>
        <Group gap={8}>
          <Select
            size="xs"
            placeholder="All users"
            data={users.map(u => ({ value: u, label: u }))}
            value={userFilter}
            onChange={v => { setUserFilter(v); setPage(1); load(1, v); }}
            clearable
            w={160}
          />
          <ActionIcon size="sm" variant="subtle" color="gray" onClick={() => load(page, userFilter)}>
            <IconRefresh size={13} />
          </ActionIcon>
        </Group>
      </Group>

      {/* Feed */}
      <ScrollArea style={{ flex: 1 }} type="scroll" scrollbarSize={3}>
        {groups.length === 0 && !loading ? (
          <Stack align="center" py={40} gap={8}>
            <Text fz={12} c="dimmed">Belum ada history</Text>
          </Stack>
        ) : (
          groups.map(group => {
            const name     = group.head.name || group.head.token_key.slice(-8);
            const imageUrl = userImages[name];
            return group.entries.length === 1
              ? <HistoryEntry key={group.key} log={group.head} imageUrl={imageUrl} onClick={() => showDetail(group.head)} />
              : <GroupedHistoryEntry key={group.key} group={group} imageUrl={imageUrl} onEntryClick={showDetail} />;
          })
        )}
      </ScrollArea>

      {/* Pagination footer */}
      {pages > 1 && (
        <Group justify="space-between" px="md" py="xs" style={{ borderTop: "1px solid var(--cp-border)" }}>
          <Group gap={4}>
            <Button size="xs" variant="subtle" disabled={page <= 1}
              onClick={() => { const p = page - 1; setPage(p); load(p, userFilter); }}>
              ← Prev
            </Button>
            <Text fz={11} c="dimmed" ff="Geist Mono, monospace">
              {page} / {pages}
            </Text>
            <Button size="xs" variant="subtle" disabled={page >= pages}
              onClick={() => { const p = page + 1; setPage(p); load(p, userFilter); }}>
              Next →
            </Button>
          </Group>
          <Text fz={10} c="dimmed">{total.toLocaleString()} total</Text>
        </Group>
      )}

      {/* Detail modal */}
      <Modal opened={modalOpened} onClose={closeModal} title="Request Detail" size="lg" centered>
        {detailLoading
          ? <Group justify="center" py="xl"><Loader size="sm" /></Group>
          : detail
          ? <DetailContent log={detail} />
          : <Text size="sm" c="dimmed">Gagal memuat detail.</Text>}
      </Modal>
    </Box>
  );
}
