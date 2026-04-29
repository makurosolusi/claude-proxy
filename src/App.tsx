import { useState, useEffect, useCallback, useMemo, createContext, useContext, useRef } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import ReactECharts from "echarts-for-react";
import {
  IconLayoutDashboard, IconUsers, IconList, IconChartBar,
  IconSitemap, IconExternalLink, IconSun, IconMoon,
  IconRefresh, IconPencil, IconPlayerPause, IconPlayerPlay, IconTrash,
  IconLogout, IconLogin,
  IconChevronsLeft, IconChevronsRight, IconMenu2,
  IconPlus, IconHistory, IconBrandGithub,
  IconPlugConnected, IconCircleCheck, IconCircleX, IconClock, IconPlayerPlay as IconRun,
  IconWifi, IconKey, IconPlayerStop,
  IconDatabase, IconDownload, IconUpload, IconAlertTriangle,
  IconMessageCircle, IconSend, IconMinus, IconBolt, IconPencil,
  IconBan, IconDotsVertical, IconUserOff, IconTrash,
} from "@tabler/icons-react";
import {
  Container, Group, Stack, Grid, Title, Text, Paper, Box, Center, Loader,
  Table, Badge, Progress, RingProgress, ActionIcon, Button,
  Select, TextInput, Modal, Code, Pagination, Menu,
  AppShell, NavLink, ScrollArea, Divider, Burger, SimpleGrid, NumberFormatter,
  useMantineColorScheme, Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";

// ── Types ─────────────────────────────────────────────────────────────────────
interface TokenStatus {
  label: string; used: number; limit: number | null;
  remaining: number | null; pct: number; paused: boolean; today: number;
}
interface UpstreamPeriod { utilization: number; resets_at: string; }
interface UpstreamData {
  ok: boolean; stale: boolean; error: string | null; email: string | null;
  pollAge: string | null; nextPoll: string | null;
  fiveHour: UpstreamPeriod | null; sevenDay: UpstreamPeriod | null;
  sevenDaySonnet: UpstreamPeriod | null;
}
interface StatusResponse {
  ts: string; pollAge: string; isAdmin: boolean;
  tokens: Record<string, TokenStatus>; upstream: UpstreamData;
}
interface LogEntry {
  id: number; ts: number; token_key: string; model: string;
  input_tokens: number; output_tokens: number; cache_read: number;
  cache_creation: number; stream: boolean; status: number;
  stop_reason: string; tool_use_count: number; duration_ms: number;
  turns: number; prompt: string; system_prompt: string;
}

// ── Status context ─────────────────────────────────────────────────────────────
const StatusCtx = createContext<StatusResponse | null>(null);
function useStatus() { return useContext(StatusCtx); }

interface ChatMsg { id: string; type: "chat" | "system"; nick: string; text: string; ts: number; }
interface ChatCtxType { messages: ChatMsg[]; send: (nick: string, text: string) => void; }
const ChatCtx = createContext<ChatCtxType>({ messages: [], send: () => {} });
function useChat() { return useContext(ChatCtx); }

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}
function fmtResetAt(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "now";
  if (Math.floor(ms / 3_600_000) < 24) return fmtCountdown(ms);
  const d = new Date(iso);
  return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()]
    + " " + String(d.getHours()).padStart(2,"0") + ":" + String(d.getMinutes()).padStart(2,"0");
}
function fmtRel(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return new Date(ts).toISOString().slice(0,10);
}
function usageCls(pct: number) {
  return pct > 100 ? "over" : pct >= 80 ? "high" : pct >= 60 ? "warn" : "ok";
}
function pctColor(pct: number): string {
  return pct >= 90 ? "red" : pct >= 70 ? "orange" : pct >= 50 ? "yellow" : "teal";
}
// CSS hex values for neon glow (drop-shadow needs real colors, not Mantine names)
function neonColor(pct: number): string {
  if (pct >= 90) return "#ff2222";
  if (pct >= 70) return "#ff7700";
  if (pct >= 50) return "#f5c400";
  return "#14d9c4";
}
function maskToken(k: string) {
  return k.startsWith("sk-user-") ? k.slice("sk-user-".length) : k;
}

// ── Loading screen ─────────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <Center mih="100vh">
      <Stack align="center" gap="xs">
        <Loader size="sm" />
        <Text size="sm" c="dimmed">Connecting…</Text>
      </Stack>
    </Center>
  );
}

// ── 404 page ──────────────────────────────────────────────────────────────────
function NotFoundPage() {
  return (
    <Center mih="100vh">
      <Stack align="center" gap="xs">
        <Text size="xl" fw={700} c="dimmed">404</Text>
        <Text size="sm" c="dimmed">Page not found</Text>
        <Button component="a" href="/" variant="subtle" size="xs" mt="xs">Go home</Button>
      </Stack>
    </Center>
  );
}

// ── Protected route ────────────────────────────────────────────────────────────
function RequireAdmin({ children }: { children: React.ReactNode }) {
  const status = useStatus();
  if (!status) return <LoadingScreen />;
  if (!status.isAdmin) {
    // Hard redirect — /admin/login is server-rendered HTML, not in React Router
    window.location.replace("/admin/login");
    return null;
  }
  return <>{children}</>;
}

// ── Period card ───────────────────────────────────────────────────────────────
function PeriodCard({ label, data, size = "sm" }: {
  label: string; data: UpstreamPeriod; size?: "sm" | "lg";
}) {
  // If resets_at has already passed but poll hasn't refreshed yet,
  // the stale % is meaningless — show 0 / dimmed to avoid misleading display.
  const hasReset  = new Date(data.resets_at).getTime() <= Date.now();
  const p         = hasReset ? 0 : data.utilization;
  const ring      = size === "lg" ? 320 : 80;
  const thick     = size === "lg" ? 20  : 7;
  const fzPct     = size === "lg" ? 72  : 14;
  const fzLabel   = size === "lg" ? "sm" : "xs";
  const fzResets  = size === "lg" ? "lg" : "xs";
  const fwLabel   = size === "lg" ? 800  : 700;
  const nc        = neonColor(p);
  const textGlow  = size === "lg" && !hasReset
    ? `0 0 8px ${nc}99, 0 0 20px ${nc}66, 0 0 40px ${nc}44`
    : undefined;

  return (
    <Paper withBorder p={size === "lg" ? "xl" : "sm"}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: size === "lg" ? 14 : 8 }}>
      <Text size={fzLabel} fw={fwLabel} tt="uppercase" c="dimmed" ta="center"
        style={{ letterSpacing: ".08em" }}>{label}</Text>
      <RingProgress
        size={ring} thickness={thick}
        sections={[{ value: p, color: hasReset ? "gray" : pctColor(p) }]}
        label={
          hasReset ? (
            <Text ta="center" fz={size === "lg" ? 18 : 10} c="dimmed" lh={1.2}>
              waiting{"\n"}for poll
            </Text>
          ) : (
            <Text ta="center" fz={fzPct} fw={800} c={pctColor(p)} lh={1}
              style={textGlow ? { textShadow: textGlow } : undefined}>
              {data.utilization.toFixed(0)}%
            </Text>
          )
        }
      />
      <Text size={fzResets} c="dimmed" ta="center" fw={size === "lg" ? 500 : 400}>
        resets {fmtResetAt(data.resets_at)}
      </Text>
    </Paper>
  );
}

// ── Upstream ──────────────────────────────────────────────────────────────────
function UpstreamSection({ upstream, isAdmin }: { upstream: UpstreamData; isAdmin: boolean }) {
  if (!upstream.ok && !upstream.fiveHour) return (
    <Stack gap="xs">
      <Group gap="xs">
        <Box w={8} h={8} style={{ borderRadius: "50%", background: "var(--mantine-color-red-5)", flexShrink: 0 }} />
        <Text size="sm" fw={600} c="red">Upstream unreachable</Text>
      </Group>
      {isAdmin && upstream.error && <Text size="xs" c="dimmed">{upstream.error}</Text>}
      {upstream.nextPoll && <Text size="xs" c="dimmed">Next poll in {upstream.nextPoll}</Text>}
    </Stack>
  );

  const dotColor   = upstream.ok ? (upstream.stale ? "yellow" : "teal") : "orange";
  const secondary  = [
    upstream.sevenDay     && { label: "7-day",        data: upstream.sevenDay },
    upstream.sevenDaySonnet && { label: "7-day Sonnet", data: upstream.sevenDaySonnet },
  ].filter(Boolean) as { label: string; data: UpstreamPeriod }[];

  return (
    <Stack gap="md">
      {!upstream.ok && upstream.fiveHour && (
        <Paper withBorder p="xs" style={{ borderColor: "var(--mantine-color-yellow-5)" }}>
          <Text size="sm" c="yellow">⚠ Poll failed{isAdmin && upstream.error ? ` · ${upstream.error}` : ""}</Text>
        </Paper>
      )}
      <Group justify="space-between">
        <Group gap="sm">
          <Box w={8} h={8} style={{ borderRadius: "50%", background: `var(--mantine-color-${dotColor}-5)`, flexShrink: 0 }} />
          <Text size="sm" fw={600}>Claude Max</Text>
          {isAdmin && upstream.email && <Text size="xs" c="dimmed" ff="monospace">{upstream.email}</Text>}
        </Group>
        {upstream.stale && <Badge color="yellow" variant="light" size="xs">stale</Badge>}
      </Group>

      {/* 5-hour: hero card centered at top */}
      {upstream.fiveHour && (
        <Center>
          <PeriodCard label="5-hour" data={upstream.fiveHour} size="lg" />
        </Center>
      )}

      {/* 7-day cards: smaller, side by side below */}
      {secondary.length > 0 && (
        <Group gap="sm" justify="center">
          {secondary.map(({ label, data }) => (
            <PeriodCard key={label} label={label} data={data} size="sm" />
          ))}
        </Group>
      )}
    </Stack>
  );
}

// ── Users table ───────────────────────────────────────────────────────────────
// Shared AJAX helper — no page reload, WebSocket pushes updated state
async function adminPost(path: string, fields: Record<string, string> = {}) {
  await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

const USERS_PER_PAGE = 10;
const ACT_SZ = 15; // consistent icon size for all action buttons

function UsersTable({ tokens, isAdmin }: { tokens: Record<string, TokenStatus>; isAdmin: boolean }) {
  const [page, setPage] = useState(1);
  const entries  = Object.entries(tokens);
  const pages    = Math.max(1, Math.ceil(entries.length / USERS_PER_PAGE));
  const visible  = entries.slice((page - 1) * USERS_PER_PAGE, page * USERS_PER_PAGE);

  return (
    <Stack gap={0}>
    <Table className="users-table" highlightOnHover withColumnBorders={false} withRowBorders>
      <Table.Thead>
        <Table.Tr>
          {["Token","Used","Today","Limit","Remaining","Usage",...(isAdmin?["Actions"]:[])].map(h => (
            <Table.Th key={h} style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>{h}</Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody id="token-rows">
        {visible.map(([k, tk]) => {
          const pct = tk.limit === null ? 0 : tk.pct;
          const cls = tk.paused ? "" : `u-${usageCls(pct)}`;
          const todayCls = tk.today > 20000 ? "pct-over" : tk.today > 10000 ? "pct-high" : tk.today > 5000 ? "pct-warn" : tk.today > 0 ? "pct-ok" : "";
          const label = isAdmin ? k : maskToken(k);
          const lim = tk.limit === null ? "unlimited" : String(tk.limit);
          return (
            <Table.Tr key={k} id={`row-${k}`} className={cls} style={tk.paused ? { opacity: 0.45 } : {}}>
              <Table.Td data-label="Token" pl="md">
                <Group gap="xs">
                  <Text size="sm" ff="monospace" id={`lbl-${k}`}>{label}</Text>
                  {tk.paused && <Badge color="gray" size="xs">paused</Badge>}
                </Group>
              </Table.Td>
              <Table.Td data-label="Used">
                <Text size="sm" ff="monospace" c="dimmed">{tk.used.toLocaleString()}</Text>
              </Table.Td>
              <Table.Td data-label="Today">
                <Text size="sm" ff="monospace" fw={600} className={todayCls}>
                  {tk.today ? tk.today.toLocaleString() : <Text span c="dimmed">—</Text>}
                </Text>
              </Table.Td>
              <Table.Td data-label="Limit">
                <Text size="sm" ff="monospace" c="dimmed">{tk.limit === null ? "∞" : tk.limit.toLocaleString()}</Text>
              </Table.Td>
              <Table.Td data-label="Remaining">
                <Text size="sm" ff="monospace" c="dimmed">{tk.remaining === null ? "∞" : tk.remaining.toLocaleString()}</Text>
              </Table.Td>
              <Table.Td data-label="Usage" style={{ minWidth: 140 }}>
                <Group gap="xs" className="bar-cell">
                  <Progress value={Math.min(pct, 100)} color={pctColor(pct)} size="sm" style={{ flex: 1 }} animated={false} />
                  <Group gap={3} wrap="nowrap">
                    <Text component="span" size="xs" className={`pct-${usageCls(pct)}`}>{pct}%</Text>
                    {pct > 100 && <Badge size="xs" color="red" variant="filled" p="2px 4px">OVER</Badge>}
                  </Group>
                </Group>
              </Table.Td>
              {isAdmin && (
                <Table.Td data-label="Actions">
                  <Group gap={4}>
                    <Tooltip label="Reset usage" withArrow>
                      <ActionIcon variant="subtle" color="gray" size="sm"
                        onClick={() => adminPost("/admin/reset", { token: k })}>
                        <IconRefresh size={ACT_SZ} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Edit limit" withArrow>
                      <ActionIcon variant="subtle" color="gray" size="sm"
                        onClick={() => { const v = prompt("New limit:", lim); if (v) adminPost("/admin/token/edit", { token: k, limit: v }); }}>
                        <IconPencil size={ACT_SZ} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label={tk.paused ? "Resume" : "Pause"} withArrow>
                      <ActionIcon variant="subtle" color={tk.paused ? "teal" : "orange"} size="sm"
                        onClick={() => adminPost("/admin/token/pause", { token: k })}>
                        {tk.paused ? <IconPlayerPlay size={ACT_SZ} /> : <IconPlayerPause size={ACT_SZ} />}
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Delete" withArrow>
                      <ActionIcon variant="subtle" color="red" size="sm"
                        onClick={() => { if (confirm(`Delete ${k}?`)) adminPost("/admin/token/delete", { token: k }); }}>
                        <IconTrash size={ACT_SZ} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
              )}
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>

    {pages > 1 && (
      <Group justify="space-between" p="sm" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
        <Pagination total={pages} value={page} onChange={setPage} size="sm" />
        <Text size="xs" c="dimmed">
          {`${(page - 1) * USERS_PER_PAGE + 1}–${Math.min(page * USERS_PER_PAGE, entries.length)} of ${entries.length} tokens`}
        </Text>
      </Group>
    )}
    </Stack>
  );
}

// ── Daily history ─────────────────────────────────────────────────────────────
const DAILY_PER_PAGE = 7; // one week per page

function DailyHistory({ isAdmin }: { isAdmin: boolean }) {
  const [data, setData]   = useState<{ date: string; total: number; by_user: Record<string, number> }[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [page, setPage]   = useState(1);

  useEffect(() => {
    fetch("/api/stats").then(r => r.json()).then(d => {
      setData(d.daily || []);
      setUsers(d.users || []);
      setPage(1);
    }).catch(() => {});
  }, []);

  const today    = new Date().toISOString().slice(0, 10);
  const allDates = [...data].reverse();             // newest first
  const pages    = Math.max(1, Math.ceil(allDates.length / DAILY_PER_PAGE));
  const dates    = allDates.slice((page - 1) * DAILY_PER_PAGE, page * DAILY_PER_PAGE);

  if (!allDates.length) return <Text size="sm" c="dimmed" ta="center" p="xl">No data yet.</Text>;

  const cc = (v: number) => !v ? "dimmed" : v > 20000 ? "red" : v > 10000 ? "orange" : v > 5000 ? "yellow" : "teal";

  return (
    <Stack gap={0}>
      <Table.ScrollContainer minWidth={400}>
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Date</Table.Th>
              {users.map(k => <Table.Th key={k}>{isAdmin ? k : maskToken(k)}</Table.Th>)}
              <Table.Th>Total</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {dates.map(d => {
              const row   = d.by_user || {};
              const total = d.total;
              return (
                <Table.Tr key={d.date} style={d.date === today ? { background: "light-dark(rgba(59,130,246,.05),rgba(59,130,246,.1))" } : {}}>
                  <Table.Td pl="md" ff="monospace">
                    {d.date}
                    {d.date === today && <Badge color="blue" size="xs" ml="xs">today</Badge>}
                  </Table.Td>
                  {users.map(k => (
                    <Table.Td key={k}>
                      <Text size="sm" ff="monospace" fw={600} c={cc(row[k] || 0)}>
                        {row[k] ? row[k].toLocaleString() : "—"}
                      </Text>
                    </Table.Td>
                  ))}
                  <Table.Td>
                    <Text size="sm" ff="monospace" fw={700} c={cc(total)}>{total ? total.toLocaleString() : "—"}</Text>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      {pages > 1 && (
        <Group justify="space-between" p="sm" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
          <Pagination total={pages} value={page} onChange={setPage} size="sm" />
          <Text size="xs" c="dimmed">
            {`${(page - 1) * DAILY_PER_PAGE + 1}–${Math.min(page * DAILY_PER_PAGE, allDates.length)} of ${allDates.length} days`}
          </Text>
        </Group>
      )}
    </Stack>
  );
}

// ── Request log ───────────────────────────────────────────────────────────────
const ALL_COLS = [
  { k: "time", l: "Time" }, { k: "user", l: "User" }, { k: "model", l: "Model" },
  { k: "in", l: "In" }, { k: "out", l: "Out" }, { k: "total", l: "Total" },
  { k: "type", l: "Type" }, { k: "prompt", l: "Prompt" },
];

// Group consecutive log entries with same user + prompt → returns grouped list with count
function groupDuplicateLogs(logs: LogEntry[]): Array<{ log: LogEntry; count: number }> {
  const out: Array<{ log: LogEntry; count: number }> = [];
  for (const log of logs) {
    const prev = out[out.length - 1];
    const isDup = prev
      && prev.log.token_key === log.token_key
      && prev.log.prompt    === log.prompt
      && prev.log.prompt    !== "";  // don't group empty prompts
    if (isDup) { prev.count++; }
    else       { out.push({ log, count: 1 }); }
  }
  return out;
}

function RequestLog({ isAdmin }: { isAdmin: boolean }) {
  const [logs, setLogs]       = useState<LogEntry[]>([]);
  const [page, setPage]       = useState(1);
  const [pages, setPages]     = useState(1);
  const [total, setTotal]     = useState(0);
  const [user, setUser]       = useState<string | null>(null);
  const [users, setUsers]     = useState<string[]>([]);
  const [groupDups, setGroupDups] = useState(true);   // on by default
  const [visible, setVisible] = useState<Record<string, boolean>>(
    Object.fromEntries(ALL_COLS.map(c => [c.k, c.k === "time" || c.k === "user" || c.k === "prompt"]))
  );
  const [detail, setDetail]   = useState<LogEntry | null>(null);
  const [modalOpen, { open: openModal, close: closeModal }] = useDisclosure(false);
  const LIMIT = 25;

  const fetchLogs = useCallback(async (p: number, u: string | null) => {
    const r = await fetch(`/api/logs?page=${p}&limit=${LIMIT}${u ? `&user=${encodeURIComponent(u)}` : ""}`);
    if (!r.ok) return;
    const d = await r.json();
    setLogs(d.logs || []); setPages(d.pages || 1); setTotal(d.total || 0);
    if (d.users?.length) setUsers(d.users);
  }, []);

  useEffect(() => { fetchLogs(1, null); }, [fetchLogs]);

  const showDetail = (l: LogEntry) => { setDetail(l); openModal(); };

  const clearLogs = async (all: boolean) => {
    if (!confirm(all ? "Clear ALL logs?" : `Clear logs for ${user}?`)) return;
    await fetch("/admin/logs/clear", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: all ? "" : `user=${encodeURIComponent(user || "")}` });
    fetchLogs(1, user);
  };

  const visibleCols    = ALL_COLS.filter(c => visible[c.k]);
  const totCls         = (tot: number) => tot > 20000 ? "pct-over" : tot > 10000 ? "pct-high" : tot > 5000 ? "pct-warn" : "";
  const displayEntries = groupDups ? groupDuplicateLogs(logs) : logs.map(l => ({ log: l, count: 1 }));
  const uniqueCount    = displayEntries.length;
  const dupCount       = logs.length - uniqueCount;

  return (
    <>
      <Stack gap="sm">
        <Group justify="space-between">
          <Group gap="xs" align="center">
            <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: ".08em" }} c="dimmed">Request Log</Text>
            <Button component="a" href="/mind" variant="subtle" size="xs" color="cyan" leftSection={<IconSitemap size={13} />}>
              mind map
            </Button>
          </Group>
          <Group gap="xs">
            <Select
              size="xs" w={140}
              data={["All users", ...users.map(u => ({ value: u, label: u.replace(/^sk-user-/, "") }))]}
              value={user || "All users"}
              onChange={v => { const u = v === "All users" ? null : v; setUser(u); fetchLogs(1, u); }}
            />
            {isAdmin && user && <Button size="xs" variant="light" color="orange" onClick={() => clearLogs(false)}>Clear {user.replace(/^sk-user-/, "")} logs</Button>}
            {isAdmin && <Button size="xs" variant="light" color="red" onClick={() => clearLogs(true)}>Clear all</Button>}
          </Group>
        </Group>

        {/* Column toggles + group dupes toggle */}
        <Group gap={6}>
          {ALL_COLS.map(c => (
            <Badge
              key={c.k}
              variant={visible[c.k] ? "filled" : "outline"}
              color={visible[c.k] ? "dark" : "gray"}
              style={{ cursor: "pointer" }}
              onClick={() => setVisible(v => ({ ...v, [c.k]: !v[c.k] }))}
            >
              {c.l}
            </Badge>
          ))}
          <Divider orientation="vertical" />
          <Tooltip label={groupDups ? "Showing grouped duplicates — click to show all" : "Click to group consecutive duplicates"} withArrow position="top">
            <Badge
              variant={groupDups ? "filled" : "outline"}
              color={groupDups ? "orange" : "gray"}
              style={{ cursor: "pointer" }}
              onClick={() => setGroupDups(v => !v)}
              leftSection={groupDups && dupCount > 0 ? <Text size="10px" fw={700}>{dupCount} hidden</Text> : undefined}
            >
              Group Dupes
            </Badge>
          </Tooltip>
        </Group>

        <Paper withBorder style={{ overflow: "hidden" }}>
          <Table.ScrollContainer minWidth={400}>
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  {visibleCols.map(c => <Table.Th key={c.k}>{c.l}</Table.Th>)}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {!displayEntries.length ? (
                  <Table.Tr><Table.Td colSpan={visibleCols.length}><Text ta="center" size="sm" c="dimmed" p="xl">No requests found.</Text></Table.Td></Table.Tr>
                ) : displayEntries.map(({ log: l, count }) => {
                  const tot = l.input_tokens + l.output_tokens;
                  const model = l.model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
                  const u = l.token_key.replace(/^sk-user-/, "");
                  const cells: Record<string, React.ReactNode> = {
                    time: (
                      <Table.Td key="time">
                        <Group gap={4} wrap="nowrap">
                          <Text size="xs" ff="monospace" c="dimmed">{fmtRel(l.ts)}</Text>
                          {count > 1 && (
                            <Tooltip label={`${count} identical requests grouped`} withArrow position="top">
                              <Badge size="xs" color="orange" variant="light" style={{ cursor: "default" }}>×{count}</Badge>
                            </Tooltip>
                          )}
                        </Group>
                      </Table.Td>
                    ),
                    user:  <Table.Td key="user"><Badge variant="light" color="gray" size="sm" ff="monospace">{u}</Badge></Table.Td>,
                    model: <Table.Td key="model"><Text size="xs" ff="monospace" c="dimmed">{model}</Text></Table.Td>,
                    in:    <Table.Td key="in"><Text size="xs" ff="monospace" c="dimmed">{l.input_tokens.toLocaleString()}</Text></Table.Td>,
                    out:   <Table.Td key="out"><Text size="xs" ff="monospace" c="dimmed">{l.output_tokens.toLocaleString()}</Text></Table.Td>,
                    total: <Table.Td key="total"><Text size="xs" ff="monospace" fw={700} className={totCls(tot)}>{tot.toLocaleString()}</Text></Table.Td>,
                    type:  <Table.Td key="type">{l.stream ? <Badge color="blue" size="xs">stream</Badge> : <Text size="xs" c="dimmed">sync</Text>}</Table.Td>,
                    prompt: (
                      <Table.Td key="prompt" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <Text size="xs" c="dimmed" truncate title={l.prompt}>{l.prompt || "—"}</Text>
                      </Table.Td>
                    ),
                  };
                  return (
                    <Table.Tr
                      key={l.id}
                      style={{ cursor: "pointer", background: l.status >= 400 ? "light-dark(rgba(239,68,68,.05),rgba(239,68,68,.1))" : undefined }}
                      onClick={() => showDetail(l)}
                    >
                      {visibleCols.map(c => cells[c.k])}
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>

          <Group justify="space-between" p="sm" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
            <Pagination total={pages} value={page} onChange={p => { setPage(p); fetchLogs(p, user); }} size="sm" />
            <Text size="xs" c="dimmed">
              {total === 0 ? "No results" : groupDups && dupCount > 0
                ? `${uniqueCount} unique · ${dupCount} grouped · page ${page}/${pages}`
                : `Showing ${(page-1)*LIMIT+1}–${Math.min(page*LIMIT,total)} of ${total}`
              }
            </Text>
          </Group>
        </Paper>
      </Stack>

      <Modal opened={modalOpen} onClose={closeModal} title="Request Detail" size="lg" centered>
        {detail && <DetailContent log={detail} />}
      </Modal>
    </>
  );
}

function DetailContent({ log: l }: { log: LogEntry }) {
  const tot = l.input_tokens + l.output_tokens;
  return (
    <Stack gap="md">
      <Text size="xs" c="dimmed" ff="monospace">{new Date(l.ts).toISOString()}</Text>
      <Grid>
        <Grid.Col span={6}><Paper withBorder p="xs"><Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={4}>User</Text><Text size="sm" ff="monospace">{l.token_key}</Text></Paper></Grid.Col>
        <Grid.Col span={6}><Paper withBorder p="xs"><Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={4}>Model</Text><Text size="sm" ff="monospace">{l.model.replace(/^claude-/, "")}</Text></Paper></Grid.Col>
        <Grid.Col span={6}><Paper withBorder p="xs"><Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={4}>Tokens</Text><Text size="sm" ff="monospace"><b>{tot.toLocaleString()}</b> total · {l.input_tokens.toLocaleString()} in · {l.output_tokens.toLocaleString()} out{l.cache_read ? <Text span c="blue"> +{l.cache_read.toLocaleString()} cached</Text> : ""}</Text></Paper></Grid.Col>
        <Grid.Col span={6}><Paper withBorder p="xs"><Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={4}>Status</Text><Group gap="xs"><Badge color={l.status >= 400 ? "red" : "teal"}>HTTP {l.status}</Badge>{l.stream && <Badge color="blue" size="xs">stream</Badge>}{l.stop_reason && <Badge color={l.stop_reason === "max_tokens" ? "yellow" : "teal"} size="xs">{l.stop_reason}</Badge>}</Group></Paper></Grid.Col>
        {!!l.duration_ms && <Grid.Col span={6}><Paper withBorder p="xs"><Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={4}>Latency</Text><Text size="sm" ff="monospace">{l.duration_ms.toLocaleString()} ms</Text></Paper></Grid.Col>}
        {!!l.turns && <Grid.Col span={6}><Paper withBorder p="xs"><Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={4}>Turns</Text><Text size="sm" ff="monospace">{l.turns}</Text></Paper></Grid.Col>}
      </Grid>
      {l.system_prompt && <><Text size="xs" c="dimmed" tt="uppercase" fw={700}>System Prompt</Text><Code block maw="100%" style={{ maxHeight: 150, overflow: "auto" }}>{l.system_prompt}</Code></>}
      {l.prompt && <><Text size="xs" c="dimmed" tt="uppercase" fw={700}>User Prompt</Text><Code block maw="100%" style={{ maxHeight: 280, overflow: "auto" }}>{l.prompt}</Code></>}
    </Stack>
  );
}

// ── Admin stat card ───────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color, suffix }: {
  label: string; value: string | number; sub?: string; color?: string; suffix?: string;
}) {
  return (
    <Paper withBorder p="md" h="100%">
      <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={6} style={{ letterSpacing: ".07em" }}>{label}</Text>
      <Group gap={4} align="baseline">
        <Text size="xl" fw={800} c={color ?? "inherit"}>
          {typeof value === "number" ? <NumberFormatter value={value} thousandSeparator /> : value}
        </Text>
        {suffix && <Text size="sm" c="dimmed">{suffix}</Text>}
      </Group>
      {sub && <Text size="xs" c="dimmed" mt={4}>{sub}</Text>}
    </Paper>
  );
}

// ── Admin Overview section ─────────────────────────────────────────────────────
function AdminOverview({ tokens, upstream }: {
  tokens: Record<string, TokenStatus>; upstream: UpstreamData;
}) {
  const totalToday  = Object.values(tokens).reduce((s, t) => s + (t.today ?? 0), 0);
  const totalUsed   = Object.values(tokens).reduce((s, t) => s + t.used, 0);
  const activeUsers = Object.values(tokens).filter(t => (t.today ?? 0) > 0).length;
  const utilPct     = upstream.fiveHour?.utilization ?? null;
  const resetsIn    = upstream.fiveHour ? fmtResetAt(upstream.fiveHour.resets_at) : null;

  return (
    <Stack gap="xl">
      {/* Stat cards */}
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
        <StatCard
          label="Tokens today"
          value={totalToday}
          sub="across all users"
          color={totalToday > 50000 ? "red" : totalToday > 20000 ? "orange" : "teal"}
        />
        <StatCard
          label="Upstream 5h"
          value={utilPct !== null ? `${utilPct.toFixed(1)}` : "—"}
          suffix="%"
          sub={resetsIn ? `resets ${resetsIn}` : undefined}
          color={utilPct !== null ? pctColor(utilPct) : undefined}
        />
        <StatCard
          label="Active users"
          value={activeUsers}
          sub={`of ${Object.keys(tokens).length} total`}
          color="blue"
        />
        <StatCard
          label="Window usage"
          value={totalUsed}
          sub="current window"
        />
      </SimpleGrid>

      {/* Upstream detail */}
      <Stack gap="xs">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Upstream Health</Text>
        <UpstreamSection upstream={upstream} isAdmin={true} />
      </Stack>

      {/* Quick actions */}
      <Stack gap="xs">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Quick Actions</Text>
        <Paper withBorder p="md">
          <Group gap="sm" wrap="wrap">
            <Button variant="light" color="gray" size="sm" leftSection={<IconRefresh size={15} />}
              onClick={() => { if (confirm("Reset all token usage?")) adminPost("/admin/reset", { all: "true" }); }}>
              Reset All Usage
            </Button>
            <Button variant="light" color="orange" size="sm" leftSection={<IconPlayerPause size={15} />}
              onClick={() => adminPost("/admin/token/pause", { all: "true" })}>
              Pause All Tokens
            </Button>
            <Button variant="light" color="blue" size="sm" leftSection={<IconPencil size={15} />}
              onClick={() => { const v = prompt("New limit for all tokens:"); if (v) adminPost("/admin/token/edit-all", { limit: v }); }}>
              Edit All Limits
            </Button>
            <Button component="a" href="/admin/logout" variant="subtle" color="gray" size="sm" leftSection={<IconLogout size={15} />}>Sign out</Button>
          </Group>
        </Paper>
      </Stack>
    </Stack>
  );
}

// ── Admin Users section ────────────────────────────────────────────────────────
function AdminUsers({ tokens }: { tokens: Record<string, TokenStatus> }) {
  const [newKey, setNewKey]     = useState("");
  const [newLimit, setNewLimit] = useState("40000");

  const handleAdd = async () => {
    if (!newKey.trim()) return;
    await adminPost("/admin/token/add", { token: newKey.trim(), limit: newLimit });
    setNewKey(""); setNewLimit("40000");
  };

  return (
    <Stack gap="xl">
      {/* Users table */}
      <Stack gap="xs">
        <Group justify="space-between">
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Token Management</Text>
          <Group gap="xs">
            <Button size="xs" variant="subtle" color="gray" leftSection={<IconRefresh size={13} />}
              onClick={() => { if (confirm("Reset all?")) adminPost("/admin/reset", { all: "true" }); }}>
              Reset All
            </Button>
            <Button size="xs" variant="subtle" color="orange" leftSection={<IconPlayerPause size={13} />}
              onClick={() => adminPost("/admin/token/pause", { all: "true" })}>
              Pause All
            </Button>
          </Group>
        </Group>
        <Paper withBorder style={{ overflow: "hidden" }}>
          <Table.ScrollContainer minWidth={500}>
            <UsersTable tokens={tokens} isAdmin={true} />
          </Table.ScrollContainer>
        </Paper>
      </Stack>

      {/* Add token */}
      <Stack gap="xs">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Add New Token</Text>
        <Paper withBorder p="lg">
          <Group align="flex-end" gap="sm" wrap="wrap">
            <TextInput
              label="Token key"
              placeholder="sk-user-name"
              required
              size="sm"
              w={240}
              value={newKey}
              onChange={e => setNewKey(e.currentTarget.value)}
              onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
              description="Must start with sk-user-"
            />
            <TextInput
              label="Limit"
              size="sm"
              w={140}
              value={newLimit}
              onChange={e => setNewLimit(e.currentTarget.value)}
              description="Token quota (tokens)"
            />
            <Button color="teal" size="sm" mb={20} leftSection={<IconPlus size={15} />} onClick={handleAdd}>
              Add Token
            </Button>
          </Group>
        </Paper>
      </Stack>
    </Stack>
  );
}

// ── Admin Stats section ───────────────────────────────────────────────────────
function AdminStats() {
  return (
    <Stack gap="xs">
      <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Daily Usage History</Text>
      <Paper withBorder style={{ overflow: "hidden" }}>
        <DailyHistory isAdmin={true} />
      </Paper>
    </Stack>
  );
}

// ── Admin Test Connection ─────────────────────────────────────────────────────
interface TestResult { ok: boolean; latency: number; detail: string; error?: string; }
interface TestResponse {
  ok: boolean; mode: string; ts: string;
  results: { credential: TestResult; usage: TestResult; messages: TestResult; };
}

function AdminTest() {
  const [result,  setResult]  = useState<TestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState<string | null>(null);

  const run = async () => {
    setLoading(true); setErr(null); setResult(null);
    try {
      const r = await fetch("/api/admin/test");
      if (!r.ok) { setErr(`HTTP ${r.status}`); return; }
      setResult(await r.json());
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const steps: { key: keyof TestResponse["results"]; label: string; desc: string }[] = [
    { key: "credential", label: "OAuth Credential",    desc: "Read claude-*.json from CLIPROXY_AUTH_DIR" },
    { key: "usage",      label: "Usage Endpoint",      desc: "GET api.anthropic.com/api/oauth/usage" },
    { key: "messages",   label: "Messages API",        desc: "POST /v1/messages — minimal test request" },
  ];

  return (
    <Stack gap="xl" maw={640}>
      <Stack gap={4}>
        <Title order={4}>Connection Test</Title>
        <Text size="sm" c="dimmed">
          Verify the full pipeline: credential file → usage API → messages API.
        </Text>
      </Stack>

      {result && (
        <Paper withBorder p="xs" style={{
          borderColor: `var(--mantine-color-${result.ok ? "teal" : "red"}-5)`,
          background:  `light-dark(var(--mantine-color-${result.ok ? "teal" : "red"}-0), var(--mantine-color-${result.ok ? "teal" : "red"}-9))`,
        }}>
          <Group gap="xs">
            {result.ok
              ? <IconCircleCheck size={16} color="var(--mantine-color-teal-5)" />
              : <IconCircleX    size={16} color="var(--mantine-color-red-5)"  />}
            <Text size="sm" fw={600} c={result.ok ? "teal" : "red"}>
              {result.ok ? "All checks passed" : "One or more checks failed"}
            </Text>
            <Badge variant="outline" size="xs" color="gray" ml="auto">
              mode: {result.mode}
            </Badge>
          </Group>
        </Paper>
      )}

      {/* Result rows */}
      {result && (
        <Stack gap="xs">
          {steps.map(({ key, label, desc }) => {
            const r = result.results[key];
            return (
              <Paper key={key} withBorder p="md">
                <Group justify="space-between" mb={r.error ? 6 : 0}>
                  <Group gap="sm">
                    {r.ok
                      ? <IconCircleCheck size={18} color="var(--mantine-color-teal-5)" />
                      : <IconCircleX    size={18} color="var(--mantine-color-red-5)"  />}
                    <Stack gap={0}>
                      <Text size="sm" fw={600}>{label}</Text>
                      <Text size="xs" c="dimmed">{desc}</Text>
                    </Stack>
                  </Group>
                  <Group gap="xs">
                    {r.latency > 0 && (
                      <Group gap={4}>
                        <IconClock size={12} color="var(--mantine-color-dimmed)" />
                        <Text size="xs" c="dimmed" ff="monospace">{r.latency} ms</Text>
                      </Group>
                    )}
                    <Badge color={r.ok ? "teal" : "red"} variant="light" size="sm">
                      {r.ok ? "OK" : "FAIL"}
                    </Badge>
                  </Group>
                </Group>
                <Text size="xs" ff="monospace" c={r.ok ? "dimmed" : "red"} mt={4}>
                  {r.error ?? r.detail}
                </Text>
              </Paper>
            );
          })}
        </Stack>
      )}

      {err && (
        <Paper withBorder p="md" style={{ borderColor: "var(--mantine-color-red-5)" }}>
          <Group gap="xs">
            <IconCircleX size={16} color="var(--mantine-color-red-5)" />
            <Text size="sm" c="red">{err}</Text>
          </Group>
        </Paper>
      )}

      <Group>
        <Button
          leftSection={loading ? <Loader size={14} color="white" /> : <IconWifi size={16} />}
          loading={loading}
          onClick={run}
          color="blue"
          size="sm"
        >
          {loading ? "Running tests…" : result ? "Run Again" : "Run Connection Test"}
        </Button>
        {result && (
          <Text size="xs" c="dimmed" ff="monospace">
            last run: {new Date(result.ts).toLocaleTimeString()}
          </Text>
        )}
      </Group>
    </Stack>
  );
}

// ── Admin Accounts section ────────────────────────────────────────────────────
interface CredentialInfo { file: string; email: string; disabled: boolean; active: boolean; }
type ConnectStep = "idle" | "authorizing" | "done";

function AdminAccounts() {
  const [creds, setCreds]       = useState<CredentialInfo[] | null>(null);
  const [loading, setLoading]   = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [err, setErr]           = useState<string | null>(null);

  // Connect flow state
  const [step, setStep]           = useState<ConnectStep>("idle");
  const [authUrl, setAuthUrl]     = useState("");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [exchanging, setExchanging]   = useState(false);
  const [connectErr, setConnectErr]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch("/api/admin/credentials");
      const d = await r.json() as any;
      setCreds(d.credentials ?? []);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const remove = async (file: string) => {
    setRemoving(file);
    try {
      const r = await fetch("/api/admin/credentials/remove", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file }),
      });
      const d = await r.json() as any;
      if (d.ok) load(); else setErr(d.error || "Failed");
    } catch (e: any) { setErr(e.message); }
    finally { setRemoving(null); }
  };

  const startConnect = async () => {
    setConnectErr(null); setCallbackUrl("");
    try {
      const r = await fetch("/admin/auth/start");
      const d = await r.json() as any;
      if (!d.authUrl) throw new Error("No authUrl returned");
      setAuthUrl(d.authUrl);
      setStep("authorizing");
    } catch (e: any) { setConnectErr(e.message); }
  };

  const completeExchange = async () => {
    if (!callbackUrl.trim()) return;
    setExchanging(true); setConnectErr(null);
    try {
      const r = await fetch("/admin/auth/exchange", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callbackUrl: callbackUrl.trim() }),
      });
      const d = await r.json() as any;
      if (d.ok) {
        setStep("done");
        load();
      } else {
        setConnectErr(d.error || "Exchange failed");
      }
    } catch (e: any) { setConnectErr(e.message); }
    finally { setExchanging(false); }
  };

  const resetConnect = () => {
    setStep("idle"); setAuthUrl(""); setCallbackUrl(""); setConnectErr(null);
  };

  return (
    <Stack gap="lg" maw={640}>
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={3} fw={600}>OAuth Accounts</Title>
          <Text size="sm" c="dimmed" mt={4}>
            Claude Max accounts used to forward API requests.
          </Text>
        </div>
        {step === "idle" && (
          <Button leftSection={<IconLogin size={16} />} onClick={startConnect} size="sm">
            Connect Account
          </Button>
        )}
      </Group>

      {/* ── Connect flow ── */}
      {step === "authorizing" && (
        <Paper withBorder p="md">
          <Stack gap="md">
            <Text size="sm" fw={600}>Step 1 — Authorize on Claude.ai</Text>
            <Group gap="xs">
              <Button
                size="xs"
                leftSection={<IconExternalLink size={14} />}
                onClick={() => window.open(authUrl, "_blank", "noopener")}
              >
                Open Claude.ai
              </Button>
              <Text size="xs" c="dimmed">Click to open, then authorize access.</Text>
            </Group>

            <Text size="sm" fw={600}>Step 2 — Paste the callback URL</Text>
            <Text size="xs" c="dimmed">
              After authorizing, your browser will try to load{" "}
              <Code size="xs">localhost:54545/callback?code=…</Code> and show an error — that's expected.
              Copy that URL from the address bar and paste it below.
            </Text>
            <TextInput
              placeholder="http://localhost:54545/callback?code=...&state=..."
              value={callbackUrl}
              onChange={e => setCallbackUrl(e.currentTarget.value)}
              ff="monospace"
              size="sm"
            />
            {connectErr && <Text size="xs" c="red">{connectErr}</Text>}
            <Group gap="xs">
              <Button
                size="sm"
                loading={exchanging}
                disabled={!callbackUrl.trim()}
                onClick={completeExchange}
              >
                Complete
              </Button>
              <Button size="sm" variant="subtle" color="gray" onClick={resetConnect}>
                Cancel
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}

      {step === "done" && (
        <Paper withBorder p="md" style={{ borderColor: "var(--mantine-color-teal-6)" }}>
          <Group justify="space-between">
            <Group gap="sm">
              <IconCircleCheck size={18} color="var(--mantine-color-teal-5)" />
              <Text size="sm" c="teal">Account connected successfully.</Text>
            </Group>
            <Button size="xs" variant="subtle" onClick={resetConnect}>Connect another</Button>
          </Group>
        </Paper>
      )}

      {err && (
        <Paper withBorder p="sm" style={{ borderColor: "var(--mantine-color-red-6)" }}>
          <Text size="sm" c="red">{err}</Text>
        </Paper>
      )}

      {loading && <Center py="xl"><Loader size="sm" /></Center>}

      {!loading && creds !== null && creds.length === 0 && step === "idle" && (
        <Paper withBorder p="xl">
          <Center>
            <Stack align="center" gap="xs">
              <IconKey size={32} color="var(--mantine-color-dimmed)" />
              <Text c="dimmed" size="sm">No credentials found.</Text>
              <Text c="dimmed" size="xs">Click "Connect Account" to authenticate a Claude Max account via OAuth.</Text>
            </Stack>
          </Center>
        </Paper>
      )}

      {!loading && creds && creds.length > 0 && (
        <Stack gap="xs">
          {creds.map(c => (
            <Paper key={c.file} withBorder p="sm" style={{ opacity: c.active ? 1 : 0.6 }}>
              <Group justify="space-between" wrap="nowrap">
                <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                  <IconKey size={18} color={c.active ? "var(--mantine-color-teal-5)" : "var(--mantine-color-dimmed)"} />
                  <div style={{ minWidth: 0 }}>
                    <Text fw={500} size="sm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.email}
                    </Text>
                    <Text size="xs" c="dimmed" ff="monospace">{c.file}</Text>
                  </div>
                </Group>
                <Group gap="xs" wrap="nowrap">
                  <Badge size="sm" color={c.active ? "teal" : "gray"} variant="light">
                    {c.active ? "active" : "disabled"}
                  </Badge>
                  {c.active && (
                    <Tooltip label="Disable credential" withArrow>
                      <ActionIcon
                        size="sm" variant="subtle" color="red"
                        loading={removing === c.file}
                        onClick={() => remove(c.file)}
                      >
                        <IconPlayerStop size={14} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Group>
              </Group>
            </Paper>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

// ── Admin Database section ────────────────────────────────────────────────────
type DbPhase = "idle" | "selected" | "uploading" | "restarting" | "error";

function AdminDb() {
  const [info, setInfo]         = useState<{ path: string; size: number; modified: string } | null>(null);
  const [phase, setPhase]       = useState<DbPhase>("idle");
  const [file, setFile]         = useState<File | null>(null);
  const [errMsg, setErrMsg]     = useState("");
  const [countdown, setCountdown] = useState(5);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [downloaded, setDownloaded]   = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/admin/db/info")
      .then(r => r.json()).then(d => setInfo(d as any)).catch(() => {});
  }, []);

  // Countdown during restart phase
  useEffect(() => {
    if (phase !== "restarting") return;
    if (countdown <= 0) { window.location.reload(); return; }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, countdown]);

  const fmt = (bytes: number) => {
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1024 / 1024).toFixed(2) + " MB";
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setPhase(f ? "selected" : "idle");
    setErrMsg("");
  };

  const doUpload = async () => {
    if (!file) return;
    setConfirmOpen(false);
    setPhase("uploading");
    setErrMsg("");
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch("/api/admin/db/upload", { method: "POST", body: form });
      const d = await r.json() as any;
      if (d.ok) {
        setPhase("restarting");
        setCountdown(5);
      } else {
        setErrMsg(d.error || "Upload failed");
        setPhase("error");
      }
    } catch (e: any) {
      setErrMsg(e.message);
      setPhase("error");
    }
  };

  const reset = () => {
    setPhase("idle"); setFile(null); setErrMsg("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const onDownload = () => {
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 3000);
  };

  return (
    <Stack gap="lg" maw={560}>
      <div>
        <Title order={3} fw={600}>Database</Title>
        <Text size="sm" c="dimmed" mt={4}>Backup and restore the SQLite database.</Text>
      </div>

      {/* Current DB info */}
      <Paper withBorder p="md">
        <Stack gap="xs">
          <Text size="xs" fw={600} c="dimmed" tt="uppercase" lts={1}>Current Database</Text>
          {info ? (
            <>
              <Group gap="xs">
                <IconDatabase size={15} color="var(--mantine-color-dimmed)" />
                <Text size="sm" ff="monospace" c="dimmed">{info.path}</Text>
              </Group>
              <Group gap="xl">
                <Text size="sm">Size: <Text span fw={600}>{fmt(info.size)}</Text></Text>
                <Text size="sm">Last modified: <Text span fw={600}>{new Date(info.modified).toLocaleString()}</Text></Text>
              </Group>
            </>
          ) : (
            <Group gap="xs"><Loader size="xs" /><Text size="sm" c="dimmed">Loading...</Text></Group>
          )}
        </Stack>
      </Paper>

      {/* Download / Backup */}
      <Paper withBorder p="md">
        <Stack gap="sm">
          <Group gap="xs">
            <IconDownload size={16} />
            <Text size="sm" fw={600}>Backup — Download</Text>
          </Group>
          <Text size="xs" c="dimmed">Download a copy of the active database file before making changes.</Text>
          <Group gap="xs" align="center">
            <Button
              component="a"
              href="/api/admin/db/download"
              download
              onClick={onDownload}
              leftSection={<IconDownload size={15} />}
              size="sm"
              variant="light"
            >
              Download Database
            </Button>
            {downloaded && (
              <Group gap={4}>
                <IconCircleCheck size={15} color="var(--mantine-color-teal-5)" />
                <Text size="xs" c="teal">Download started</Text>
              </Group>
            )}
          </Group>
        </Stack>
      </Paper>

      {/* Restore / Upload */}
      <Paper withBorder p="md" style={{
        borderColor: phase === "restarting" ? "var(--mantine-color-teal-6)"
          : phase === "error" ? "var(--mantine-color-red-6)"
          : phase === "uploading" ? "var(--mantine-color-blue-6)"
          : phase === "selected" ? "var(--mantine-color-orange-6)" : undefined,
      }}>
        <Stack gap="md">
          <Group gap="xs">
            <IconUpload size={16} />
            <Text size="sm" fw={600}>Restore — Upload</Text>
          </Group>

          {/* ── idle / selected ── */}
          {(phase === "idle" || phase === "selected") && (
            <Stack gap="sm">
              <Paper p="xs" style={{ background: "var(--mantine-color-orange-light)", borderRadius: 6 }}>
                <Group gap="xs" align="flex-start" wrap="nowrap">
                  <IconAlertTriangle size={14} color="var(--mantine-color-orange-6)" style={{ marginTop: 2, flexShrink: 0 }} />
                  <Text size="xs" c="orange">
                    Replaces the active database and restarts the server. All in-flight requests will be dropped.
                    Download a backup first.
                  </Text>
                </Group>
              </Paper>

              <input ref={fileRef} type="file" accept=".db" style={{ display: "none" }} onChange={onFileChange} />

              {phase === "idle" && (
                <div>
                  <Button size="sm" variant="default" leftSection={<IconUpload size={15} />}
                    onClick={() => fileRef.current?.click()}>
                    Choose .db file
                  </Button>
                </div>
              )}

              {phase === "selected" && file && (
                <Paper p="sm" withBorder style={{ borderStyle: "dashed" }}>
                  <Group justify="space-between" wrap="nowrap">
                    <Group gap="sm" wrap="nowrap">
                      <IconDatabase size={20} color="var(--mantine-color-orange-5)" />
                      <div>
                        <Text size="sm" fw={500}>{file.name}</Text>
                        <Text size="xs" c="dimmed">{fmt(file.size)}</Text>
                      </div>
                    </Group>
                    <Button size="xs" variant="subtle" color="gray" onClick={reset}>Change</Button>
                  </Group>
                </Paper>
              )}

              {phase === "selected" && (
                <Group gap="xs">
                  <Button size="sm" color="orange" leftSection={<IconUpload size={15} />}
                    onClick={() => setConfirmOpen(true)}>
                    Upload & Restore
                  </Button>
                  <Button size="sm" variant="subtle" color="gray" onClick={reset}>Cancel</Button>
                </Group>
              )}
            </Stack>
          )}

          {/* ── uploading ── */}
          {phase === "uploading" && (
            <Stack gap="sm" align="center" py="md">
              <Loader size="md" />
              <Text size="sm" fw={500}>Uploading database...</Text>
              <Text size="xs" c="dimmed">Please wait, do not close this page.</Text>
            </Stack>
          )}

          {/* ── restarting ── */}
          {phase === "restarting" && (
            <Stack gap="sm">
              <Group gap="sm">
                <IconCircleCheck size={22} color="var(--mantine-color-teal-5)" />
                <Text size="sm" fw={600} c="teal">Database replaced successfully!</Text>
              </Group>
              <Text size="xs" c="dimmed">Server is restarting. Page will reload automatically in <Text span fw={700}>{countdown}s</Text>.</Text>
              <Progress value={(5 - countdown) / 5 * 100} color="teal" size="sm" animated />
            </Stack>
          )}

          {/* ── error ── */}
          {phase === "error" && (
            <Stack gap="sm">
              <Group gap="sm">
                <IconCircleX size={20} color="var(--mantine-color-red-5)" />
                <Text size="sm" fw={500} c="red">Upload failed</Text>
              </Group>
              <Paper p="xs" withBorder style={{ borderColor: "var(--mantine-color-red-4)" }}>
                <Text size="xs" ff="monospace" c="red">{errMsg}</Text>
              </Paper>
              <div>
                <Button size="sm" variant="light" onClick={reset}>Try again</Button>
              </div>
            </Stack>
          )}
        </Stack>
      </Paper>

      {/* Confirm Modal */}
      <Modal
        opened={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={<Group gap="xs"><IconAlertTriangle size={18} color="var(--mantine-color-orange-5)" /><Text fw={600}>Confirm Database Replace</Text></Group>}
        centered
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">
            You are about to replace the current database with:
          </Text>
          <Paper p="xs" withBorder>
            <Text size="sm" ff="monospace" fw={500}>{file?.name}</Text>
            <Text size="xs" c="dimmed">{file ? fmt(file.size) : ""}</Text>
          </Paper>
          <Text size="sm" c="orange">
            The server will restart (~2–5s downtime). All current sessions and in-flight requests will be dropped.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" size="sm" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button color="orange" size="sm" leftSection={<IconUpload size={15} />} onClick={doUpload}>
              Yes, Replace & Restart
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

// ── Admin Dashboard (AppShell layout) ─────────────────────────────────────────
type AdminSection = "overview" | "users" | "logs" | "stats" | "test" | "accounts" | "database";

function AdminDashboard() {
  const status = useStatus()!;
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const [section, setSection] = useState<AdminSection>(() => {
    try { return (localStorage.getItem("admin-section") as AdminSection) || "overview"; }
    catch { return "overview"; }
  });
  const [mobileOpen, { toggle: toggleMobile, close }] = useDisclosure(false);
  const [collapsed,  { toggle: toggleCollapse }]      = useDisclosure(false);

  const { tokens, upstream } = status;
  const nav = (s: AdminSection) => {
    setSection(s);
    try { localStorage.setItem("admin-section", s); } catch {}
    close();
  };

  const SZ = 17;
  const navItems: { id: AdminSection; label: string; icon: React.ReactNode; desc: string }[] = [
    { id: "overview", label: "Overview",       icon: <IconLayoutDashboard size={SZ} />, desc: "Upstream & quick stats" },
    { id: "users",    label: "Users",          icon: <IconUsers           size={SZ} />, desc: "Token management"       },
    { id: "logs",     label: "Request Logs",   icon: <IconList            size={SZ} />, desc: "Activity & history"     },
    { id: "stats",    label: "Stats",          icon: <IconChartBar        size={SZ} />, desc: "Daily usage history"    },
    { id: "test",     label: "Test Connection",icon: <IconPlugConnected   size={SZ} />, desc: "Verify API connectivity" },
    { id: "accounts", label: "Accounts",       icon: <IconKey             size={SZ} />, desc: "OAuth Claude accounts"   },
    { id: "database", label: "Database",       icon: <IconDatabase        size={SZ} />, desc: "Backup & restore DB"     },
  ];
  const footerItems: { icon: React.ReactNode; label: string; href: string; target?: string }[] = [
    { icon: <IconSitemap      size={SZ} />, label: "Mind Map",    href: "/mind", target: "_blank" },
    { icon: <IconExternalLink size={SZ} />, label: "Public View", href: "/",     target: undefined },
  ];

  const utilPct = upstream.fiveHour?.utilization ?? null;
  const sectionTitles: Record<AdminSection, string> = {
    overview: "Overview", users: "Users", logs: "Request Logs", stats: "Stats", test: "Test Connection", accounts: "Accounts", database: "Database",
  };
  const statusColor = upstream.ok ? "teal" : "red";
  const SIDEBAR_W   = collapsed ? 56 : 220;

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: SIDEBAR_W, breakpoint: "sm", collapsed: { mobile: !mobileOpen } }}
      padding={0}
      transitionDuration={200}
    >
      {/* ── Header ── */}
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Burger opened={mobileOpen} onClick={toggleMobile} hiddenFrom="sm" size="sm" />
            {/* Collapse toggle — desktop only */}
            <Tooltip label={collapsed ? "Expand sidebar" : "Collapse sidebar"} position="bottom" withArrow openDelay={400}>
              <ActionIcon variant="subtle" size="sm" onClick={toggleCollapse} visibleFrom="sm">
                {collapsed ? <IconChevronsRight size={16} /> : <IconChevronsLeft size={16} />}
              </ActionIcon>
            </Tooltip>
            {!collapsed && (
              <Text fw={800} ff="monospace" size="sm" style={{ letterSpacing: ".06em" }} visibleFrom="sm">
                claude-proxy
              </Text>
            )}
            <Text fw={800} ff="monospace" size="sm" style={{ letterSpacing: ".06em" }} hiddenFrom="sm">
              claude-proxy
            </Text>
            <Badge variant="dot" color="teal" size="sm" visibleFrom="sm">admin</Badge>
          </Group>
          <Text size="sm" fw={600} visibleFrom="sm">{sectionTitles[section]}</Text>
          <Group gap="xs">
            {utilPct !== null && (
              <Badge color={pctColor(utilPct)} variant="light" size="sm" visibleFrom="xs">
                {utilPct.toFixed(0)}% upstream
              </Badge>
            )}
            <Tooltip label="Toggle theme" position="bottom" withArrow openDelay={400}>
              <ActionIcon variant="default" size="md" onClick={() => toggleColorScheme()}>
                {colorScheme === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </AppShell.Header>

      {/* ── Sidebar ── */}
      <AppShell.Navbar style={{ overflow: "hidden", transition: "width 200ms ease" }}>

        {/* ── Main nav items ── */}
        <AppShell.Section grow component={ScrollArea} p="xs" pt="md">
          {!collapsed && (
            <Box px="xs" mb="xs">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700} style={{ letterSpacing: ".1em" }}>Navigation</Text>
            </Box>
          )}
          <Stack gap={2} align={collapsed ? "center" : "stretch"}>
            {navItems.map(item => collapsed ? (
              <Tooltip key={item.id} label={item.label} position="right" withArrow openDelay={100}>
                <ActionIcon
                  size={40}
                  variant={section === item.id ? "filled" : "subtle"}
                  color={section === item.id ? "blue" : "gray"}
                  onClick={() => nav(item.id)}
                  style={{ borderRadius: 8 }}
                >
                  <Text size="md" style={{ lineHeight: 1 }}>{item.icon}</Text>
                </ActionIcon>
              </Tooltip>
            ) : (
              <NavLink
                key={item.id}
                active={section === item.id}
                label={item.label}
                description={item.desc}
                leftSection={item.icon}
                onClick={() => nav(item.id)}
                style={{ borderRadius: 6 }}
              />
            ))}
          </Stack>
        </AppShell.Section>

        {/* ── Footer links + status ── */}
        <AppShell.Section p="xs" pb="md">
          <Divider mb="xs" />
          <Stack gap={2} align={collapsed ? "center" : "stretch"}>
            {footerItems.map(fi => collapsed ? (
              <Tooltip key={fi.label} label={fi.label} position="right" withArrow openDelay={100}>
                <ActionIcon
                  size={40}
                  variant="subtle"
                  color="gray"
                  component="a"
                  href={fi.href}
                  target={fi.target}
                  style={{ borderRadius: 8 }}
                >
                  <Text size="md" style={{ lineHeight: 1 }}>{fi.icon}</Text>
                </ActionIcon>
              </Tooltip>
            ) : (
              <NavLink
                key={fi.label}
                label={fi.label}
                description={fi.label === "Mind Map" ? "Graph visualization" : "User dashboard"}
                leftSection={fi.icon}
                component="a"
                href={fi.href}
                target={fi.target}
                style={{ borderRadius: 6 }}
              />
            ))}
          </Stack>
          <Divider my="xs" />
          {collapsed ? (
            <Stack gap={4} align="center" py={4}>
              <Tooltip label={`${upstream.email ?? "no credential"} · poll ${status.pollAge}`} position="right" withArrow multiline w={200}>
                <Box w={10} h={10} style={{ borderRadius: "50%", cursor: "default", background: `var(--mantine-color-${statusColor}-5)` }} />
              </Tooltip>
              <Tooltip label="Sign out" position="right" withArrow>
                <ActionIcon variant="subtle" color="gray" size="sm" component="a" href="/admin/logout">
                  <IconLogout size={14} />
                </ActionIcon>
              </Tooltip>
            </Stack>
          ) : (
            <Box px="xs" py={4}>
              <Group gap="xs" mb={2} justify="space-between">
                <Group gap="xs" style={{ minWidth: 0, flex: 1 }}>
                  <Box w={7} h={7} style={{ borderRadius: "50%", flexShrink: 0, background: `var(--mantine-color-${statusColor}-5)` }} />
                  <Text size="xs" c="dimmed" ff="monospace" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {upstream.email ?? "no credential"}
                  </Text>
                </Group>
                <Tooltip label="Sign out" position="top" withArrow>
                  <ActionIcon variant="subtle" color="gray" size="sm" component="a" href="/admin/logout">
                    <IconLogout size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
              <Text size="10px" c="dimmed" pl={15}>poll {status.pollAge}</Text>
            </Box>
          )}
        </AppShell.Section>
      </AppShell.Navbar>

      {/* ── Main content ── */}
      <AppShell.Main>
        <Box p="lg">
          {section === "overview"  && <AdminOverview tokens={tokens} upstream={upstream} />}
          {section === "users"     && <AdminUsers tokens={tokens} />}
          {section === "logs"      && <RequestLog isAdmin={true} />}
          {section === "stats"     && <AdminStats />}
          {section === "test"      && <AdminTest />}
          {section === "accounts"  && <AdminAccounts />}
          {section === "database"  && <AdminDb />}
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}

// ── Dashboard (shared layout) ──────────────────────────────────────────────────
function AddTokenInline() {
  const [k, setK] = useState(""); const [l, setL] = useState("40000");
  return (
    <Stack gap="xs" mb="xl">
      <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Add Token</Text>
      <Paper withBorder p="md">
        <Group align="flex-end" gap="sm">
          <TextInput label="Token Key" placeholder="sk-user-name" size="xs" w={220} value={k} onChange={e => setK(e.currentTarget.value)} />
          <TextInput label="Limit" size="xs" w={120} value={l} onChange={e => setL(e.currentTarget.value)} />
          <Button color="teal" size="xs" leftSection={<IconPlus size={13} />}
            onClick={() => { if (k.trim()) { adminPost("/admin/token/add", { token: k.trim(), limit: l }); setK(""); setL("40000"); } }}>
            Add Token
          </Button>
        </Group>
      </Paper>
    </Stack>
  );
}

function Dashboard({ isAdmin }: { isAdmin: boolean }) {
  const status = useStatus()!;
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const { tokens, upstream } = status;
  const title = isAdmin ? "claude-proxy · admin" : "claude-proxy";

  // Dynamic background: radial gradient from bottom grows more intense as
  // upstream 5h utilization rises. Starts at 20%, full intensity at 90%.
  const utilPct = upstream?.fiveHour?.utilization ?? 0;
  const t       = Math.max(0, Math.min(1, (utilPct - 20) / 70));
  const isDark  = colorScheme === "dark" ||
    (colorScheme === "auto" && typeof window !== "undefined" &&
     window.matchMedia("(prefers-color-scheme: dark)").matches);
  const pageBg  = useMemo(() => {
    if (t <= 0) return undefined;
    if (isDark) {
      // Dark: red dominates bottom 80%, fades to transparent only at very top
      const a1 = (t * 0.95).toFixed(3);
      const a2 = (t * 0.75).toFixed(3);
      const a3 = (t * 0.30).toFixed(3);
      return [
        `radial-gradient(ellipse 150% 90% at 50% 100%,`,
        ` rgba(100,6,6,${a1}) 0%,`,
        ` rgba(70,5,5,${a2}) 45%,`,
        ` rgba(40,4,4,${a3}) 70%,`,
        ` transparent 90%)`,
      ].join("");
    } else {
      // Light: strong warm-red tint covers most of the page
      const a1 = (t * 0.30).toFixed(3);
      const a2 = (t * 0.18).toFixed(3);
      const a3 = (t * 0.07).toFixed(3);
      return [
        `radial-gradient(ellipse 150% 90% at 50% 100%,`,
        ` rgba(220,40,40,${a1}) 0%,`,
        ` rgba(200,30,30,${a2}) 45%,`,
        ` rgba(180,20,20,${a3}) 70%,`,
        ` transparent 90%)`,
      ].join("");
    }
  }, [t, isDark]);

  return (
    <Box style={{ minHeight: "100vh", background: pageBg, backgroundAttachment: "fixed", transition: "background 3s ease" }}>
    <Container size="lg" py="lg">
      {/* Header */}
      <Group justify="space-between" mb="xl">
        <Stack gap={2}>
          <Title order={2} ff="monospace">{title}</Title>
          <Text size="xs" c="dimmed" ff="monospace">
            Updated {status.ts} · poll {status.pollAge}
          </Text>
        </Stack>
        <Group gap="xs">
          <Tooltip label="Toggle theme" position="bottom" withArrow openDelay={400}>
            <ActionIcon variant="default" size="lg" onClick={() => toggleColorScheme()}>
              {colorScheme === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
            </ActionIcon>
          </Tooltip>
          {isAdmin
            ? <Button component="a" href="/admin/logout" variant="default" size="xs" leftSection={<IconLogout size={13} />}>Sign out</Button>
            : <Button component="a" href="/admin" variant="subtle" size="xs" c="dimmed" leftSection={<IconLogin size={13} />}>Admin</Button>
          }
        </Group>
      </Group>

      {/* Upstream */}
      <Stack gap="xs" mb="xl">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Upstream</Text>
        <UpstreamSection upstream={upstream} isAdmin={isAdmin} />
      </Stack>

      {/* Users */}
      <Stack gap="xs" mb="xl">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Users</Text>
        <Paper withBorder style={{ overflow: "hidden" }}>
          <Table.ScrollContainer minWidth={500}>
            <UsersTable tokens={tokens} isAdmin={isAdmin} />
          </Table.ScrollContainer>
        </Paper>
        {isAdmin && (
          <Group gap="xs">
            <Button variant="light" color="gray" size="xs" leftSection={<IconRefresh size={13} />}
              onClick={() => { if (confirm("Reset all?")) adminPost("/admin/reset", { all: "true" }); }}>Reset All</Button>
            <Button variant="light" color="orange" size="xs" leftSection={<IconPlayerPause size={13} />}
              onClick={() => adminPost("/admin/token/pause", { all: "true" })}>Pause All</Button>
            <Button variant="light" color="blue" size="xs" leftSection={<IconPencil size={13} />}
              onClick={() => { const v = prompt("New limit for all:"); if (v) adminPost("/admin/token/edit-all", { limit: v }); }}>Edit All Limits</Button>
          </Group>
        )}
      </Stack>

      {/* Add token */}
      {isAdmin && <AddTokenInline />}

      {/* Daily history */}
      <Stack gap="xs" mb="xl">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Daily History</Text>
        <Paper withBorder style={{ overflow: "hidden" }}>
          <DailyHistory isAdmin={isAdmin} />
        </Paper>
      </Stack>

      {/* Request log */}
      <RequestLog isAdmin={isAdmin} />
    </Container>
    <FloatingChat />
    </Box>
  );
}

// ── Mind page ─────────────────────────────────────────────────────────────────
interface MindNode {
  id: string; name: string; category: number;
  // 0 = user, 1 = date, 2 = hour, 3 = request
  requests?: number; tokens?: number;
  fullDate?: string;
  tools?: number; duration?: number; status?: number;
  stream?: number; ts?: number; model?: string; prompt?: string;
}
interface MindLink {
  source: string; target: string; value: number; tokens: number; type: string;
}
interface MindData {
  nodes: MindNode[];
  links: MindLink[];
  totalRequests: number;
  totalTokens: number;
}

function MindPage() {
  const [data, setData] = useState<MindData | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetch("/api/mind").then(r => r.json()).then(setData).catch(() => setErr(true));
  }, []);

  const option = useMemo(() => {
    if (!data || !data.nodes.length) return {};

    const userNodes = data.nodes.filter(n => n.category === 0);
    const dateNodes = data.nodes.filter(n => n.category === 1);
    const hourNodes = data.nodes.filter(n => n.category === 2);
    const reqNodes  = data.nodes.filter(n => n.category === 3);
    const maxUser   = Math.max(...userNodes.map(n => n.requests ?? 1), 1);
    const maxDate   = Math.max(...dateNodes.map(n => n.requests ?? 1), 1);
    const maxHour   = Math.max(...hourNodes.map(n => n.requests ?? 1), 1);
    const maxTok    = Math.max(...reqNodes.map(n => n.tokens ?? 1), 1);

    return {
      tooltip: {
        trigger: "item",
        confine: true,
        padding: [8, 12],
        textStyle: { fontFamily: "monospace", fontSize: 11 },
        extraCssText: "max-width:280px;word-break:break-word;overflow-wrap:break-word;white-space:normal;line-height:1.7",
        formatter: (p: any) => {
          if (p.dataType !== "node") {
            const tok = p.data.tokens ? `<br/>tokens: <b>${Number(p.data.tokens).toLocaleString()}</b>` : "";
            const label = { ud: "user → date", dh: "date → hour", hr: "hour → req" }[p.data.type as string] ?? "→";
            return `${label}<br/>count: <b>${p.data.value}</b>${tok}`;
          }
          const d = p.data;
          if (d.category === 0) {
            return `<b>${d.name}</b> <span style="color:#888">user</span>`
              + `<br/>requests: <b>${(d.requests||0).toLocaleString()}</b>`
              + `<br/>tokens: <b>${(d.tokens||0).toLocaleString()}</b>`;
          }
          if (d.category === 1) {
            return `<b>${d.fullDate ?? d.name}</b> <span style="color:#888">date</span>`
              + `<br/>requests: <b>${(d.requests||0).toLocaleString()}</b>`
              + `<br/>tokens: <b>${(d.tokens||0).toLocaleString()}</b>`;
          }
          if (d.category === 2) {
            return `<b>${d.name}</b> <span style="color:#888">hour</span>`
              + `<br/>requests: <b>${(d.requests||0).toLocaleString()}</b>`
              + `<br/>tokens: <b>${(d.tokens||0).toLocaleString()}</b>`;
          }
          const t = new Date(d.ts ?? 0);
          const ts = `${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}:${String(t.getSeconds()).padStart(2,"0")}`;
          const prompt = d.prompt ? `<div style="margin-top:5px;color:#666;font-size:10px;overflow-wrap:break-word;word-break:break-word;white-space:normal">${d.prompt}${d.prompt.length >= 80 ? "…" : ""}</div>` : "";
          return `<b>${d.model}</b> <span style="color:#888">${ts}</span>`
            + `<br/>tokens: <b>${(d.tokens||0).toLocaleString()}</b>`
            + (d.tools ? `<br/>tools: <b>${d.tools}</b>` : "")
            + (d.duration ? `<br/>duration: <b>${d.duration} ms</b>` : "")
            + prompt;
        },
      },

      legend: [{
        data: ["User", "Date", "Hour", "Request"],
        bottom: 16,
        orient: "horizontal",
        textStyle: { fontSize: 11, fontFamily: "monospace" },
        icon: "circle",
        itemWidth: 10, itemHeight: 10,
      }],

      series: [{
        type: "graph",
        layout: "force",
        animation: false,

        label: {
          show: true,
          position: "right",
          formatter: "{b}",
          fontSize: 11,
          fontFamily: "monospace",
        },

        labelLayout: { hideOverlap: true },

        data: data.nodes.map(n => {
          if (n.category === 0) {
            const ratio = Math.sqrt((n.requests ?? 1) / maxUser);
            return {
              id: n.id, name: n.name, category: 0,
              requests: n.requests ?? 0, tokens: n.tokens ?? 0,
              value: 200 + ratio * 800,
              symbolSize: Math.round(20 + ratio * 46),
              label: { fontSize: 13, fontWeight: "bold" },
            };
          }
          if (n.category === 1) {
            const ratio = Math.sqrt((n.requests ?? 1) / maxDate);
            return {
              id: n.id, name: n.name, category: 1,
              requests: n.requests ?? 0, tokens: n.tokens ?? 0,
              fullDate: (n as any).fullDate,
              value: 60 + ratio * 80,
              symbolSize: Math.round(10 + ratio * 14),
              label: { fontSize: 10 },
            };
          }
          if (n.category === 2) {
            const ratio = Math.sqrt((n.requests ?? 1) / maxHour);
            return {
              id: n.id, name: n.name, category: 2,
              requests: n.requests ?? 0, tokens: n.tokens ?? 0,
              value: 20 + ratio * 30,
              symbolSize: Math.round(7 + ratio * 9),
              label: { fontSize: 9 },
            };
          }
          const tRatio = Math.sqrt((n.tokens ?? 0) / maxTok);
          return {
            id: n.id, name: n.name, category: 3,
            tokens: n.tokens ?? 0, tools: n.tools ?? 0,
            duration: (n as any).duration ?? 0,
            status: (n as any).status ?? 200,
            stream: (n as any).stream ?? 0,
            ts: (n as any).ts ?? 0,
            model: (n as any).model ?? "",
            prompt: (n as any).prompt ?? "",
            value: 5,
            symbolSize: Math.round(3 + tRatio * 9),
            label: { fontSize: 9 },
          };
        }),

        links: data.links.map(l => ({
          source: l.source, target: l.target, value: l.value, tokens: l.tokens, type: l.type,
          lineStyle: {
            width: l.type === "ud" ? Math.max(0.8, Math.min(3, Math.log2(l.value + 1) * 0.7))
                 : l.type === "dh" ? Math.max(0.5, Math.min(2, Math.log2(l.value + 1) * 0.5))
                 : 0.4,
            opacity: l.type === "ud" ? 0.55 : l.type === "dh" ? 0.4 : 0.25,
            curveness: l.type === "ud" ? 0.2 : l.type === "dh" ? 0.1 : 0,
          },
        })),

        categories: [
          { name: "User" },
          { name: "Date" },
          { name: "Hour" },
          { name: "Request" },
        ],

        roam: true,
        roamTrigger: "global",
        scaleLimit: { max: 10, min: 0.3 },
        draggable: true,
        lineStyle: { color: "source", curveness: 0.3, opacity: 0.5 },
        // no focus to avoid white-flash dimming of non-adjacent nodes
        emphasis: {
          lineStyle: { opacity: 0.9, width: 2 },
        },
        // keep blurred nodes visible, not washed out
        blur: {
          itemStyle: { opacity: 0.4 },
          label: { opacity: 0.4 },
          lineStyle: { opacity: 0.15 },
        },
        force: {
          repulsion: [30, 700],  // request: ~30, user: ~700 (value-based)
          gravity: 0.1,
          edgeLength: [35, 140],
          friction: 0.6,
          layoutAnimation: false,
        },
      }],
    };
  }, [data]);

  const isEmpty = data && data.nodes.length === 0;
  const userCount = data?.nodes.filter(n => n.category === 0).length ?? 0;
  const dateCount = data?.nodes.filter(n => n.category === 1).length ?? 0;
  const hourCount = data?.nodes.filter(n => n.category === 2).length ?? 0;
  const reqCount  = data?.nodes.filter(n => n.category === 3).length ?? 0;

  return (
    <Box style={{ background: "#fff", minHeight: "100vh", position: "relative", overflow: "hidden" }}>
      {/* Back */}
      <Box style={{ position: "absolute", top: 16, left: 16, zIndex: 10 }}>
        <Button component="a" href="/" variant="subtle" size="xs"
          style={{ color: "#555", fontFamily: "monospace", letterSpacing: ".04em" }}>
          ← home
        </Button>
      </Box>

      {/* Title */}
      <Box style={{ position: "absolute", top: 18, left: "50%", transform: "translateX(-50%)", zIndex: 10, textAlign: "center", pointerEvents: "none" }}>
        <Text ff="monospace" fw={700} size="sm" style={{ color: "#333", letterSpacing: ".18em", textTransform: "uppercase" }}>
          Request Mind Map
        </Text>
      </Box>

      {/* Stats */}
      {data && !isEmpty && (
        <Box style={{ position: "absolute", top: 12, right: 16, zIndex: 10, textAlign: "right" }}>
          <Text size="xs" ff="monospace" style={{ color: "#555" }}>
            {userCount} users · {dateCount} dates · {hourCount} hours · {reqCount} requests
          </Text>
          <Text size="xs" ff="monospace" style={{ color: "#888" }}>
            {data.totalRequests.toLocaleString()} total · {data.totalTokens.toLocaleString()} tokens
          </Text>
        </Box>
      )}

      {/* States */}
      {!data && !err && <LoadingScreen />}
      {err && (
        <Center mih="100vh">
          <Text c="dimmed" ff="monospace">failed to load</Text>
        </Center>
      )}
      {isEmpty && (
        <Center mih="100vh">
          <Stack align="center" gap="xs">
            <Text size="xl" fw={700} style={{ color: "#1e3a5f" }}>no data</Text>
            <Text size="sm" style={{ color: "#4a5568" }} ff="monospace">make some requests first</Text>
          </Stack>
        </Center>
      )}

      {data && !isEmpty && (
        <ReactECharts
          option={option}
          style={{ height: "100vh", width: "100%" }}
          opts={{ renderer: "canvas" }}
          notMerge
        />
      )}
    </Box>
  );
}

// ── Floating Chat ─────────────────────────────────────────────────────────────
function nickColor(nick: string): string {
  const palette = ["blue","teal","grape","violet","cyan","green","orange","pink"];
  let h = 0;
  for (let i = 0; i < nick.length; i++) h = nick.charCodeAt(i) + ((h << 5) - h);
  return palette[Math.abs(h) % palette.length];
}

function FloatingChat() {
  const { messages, send } = useChat();
  const isAdmin = useStatus()?.isAdmin ?? false;
  const [open, setOpen]         = useState(false);
  const [unread, setUnread]     = useState(0);
  const [nick, setNick]         = useState(() => {
    try { return localStorage.getItem("chat-nick") || ""; } catch { return ""; }
  });
  const [editingNick, setEditingNick] = useState(false);
  const [nickDraft, setNickDraft]     = useState("");
  const [text, setText]               = useState("");
  const [hoveredId, setHoveredId]     = useState<string | null>(null);
  const [blocked, setBlocked]         = useState<string[]>([]);
  const [showBlocked, setShowBlocked] = useState(false);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLInputElement>(null);
  const prevLen    = useRef(0);

  const loadBlocked = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const r = await fetch("/admin/chat/blocked");
      const d = await r.json() as any;
      setBlocked(d.blocked ?? []);
    } catch {}
  }, [isAdmin]);

  useEffect(() => { if (open && isAdmin) loadBlocked(); }, [open, isAdmin, loadBlocked]);

  const adminClear = async () => {
    await fetch("/admin/chat/clear", { method: "POST" });
  };

  const adminBlock = async (blockNick: string) => {
    await fetch("/admin/chat/block", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nick: blockNick }),
    });
    setBlocked(prev => [...prev, blockNick.toLowerCase()]);
  };

  const adminUnblock = async (blockNick: string) => {
    await fetch("/admin/chat/unblock", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nick: blockNick }),
    });
    setBlocked(prev => prev.filter(b => b !== blockNick.toLowerCase()));
  };

  // Unread tracking + browser notification
  useEffect(() => {
    if (messages.length <= prevLen.current) { prevLen.current = messages.length; return; }
    const newMsgs = messages.slice(prevLen.current);
    prevLen.current = messages.length;
    const chatMsgs = newMsgs.filter(m => m.type === "chat");
    if (chatMsgs.length === 0) return;
    if (!open) {
      setUnread(u => u + chatMsgs.length);
      if (Notification.permission === "granted" && document.hidden) {
        const last = chatMsgs[chatMsgs.length - 1];
        new Notification(last.nick, { body: last.text.slice(0, 120) });
      }
    }
  }, [messages, open]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (open) setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, [messages, open]);

  // Request notification permission when opening for first time
  useEffect(() => {
    if (open && Notification.permission === "default") Notification.requestPermission();
  }, [open]);

  const toggle = () => setOpen(o => { if (!o) setUnread(0); return !o; });

  const saveNick = (draft: string) => {
    const n = draft.trim().slice(0, 20);
    if (!n) return;
    setNick(n);
    setEditingNick(false);
    try { localStorage.setItem("chat-nick", n); } catch {}
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const onSend = () => {
    const t = text.trim();
    if (!t || !nick) return;
    send(nick, t);
    setText("");
    inputRef.current?.focus();
  };

  const fmtTs = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  };

  const showNickSetup = !nick || editingNick;

  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 1000, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>

      {/* ── Expanded panel ── */}
      {open && (
        <Paper withBorder shadow="xl" mb={10}
          style={{ width: 320, height: 420, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Header */}
          <Group justify="space-between" px="sm" py={8}
            style={{ borderBottom: "1px solid var(--mantine-color-default-border)", flexShrink: 0 }}>
            <Group gap={6}>
              <IconMessageCircle size={15} />
              <Text size="sm" fw={600}>Team Chat</Text>
              {messages.length > 0 && (
                <Text size="xs" c="dimmed">· {messages.filter(m => m.type === "chat").length}</Text>
              )}
            </Group>
            <Group gap={4}>
              {isAdmin && (
                <>
                  <Tooltip label="Clear chat" withArrow position="left">
                    <ActionIcon size="sm" variant="subtle" color="red" onClick={adminClear}>
                      <IconTrash size={13} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={showBlocked ? "Hide blocked" : `Blocked users${blocked.length > 0 ? ` (${blocked.length})` : ""}`} withArrow position="left">
                    <ActionIcon
                      size="sm" variant={showBlocked ? "filled" : "subtle"} color="orange"
                      onClick={() => { setShowBlocked(v => !v); loadBlocked(); }}
                    >
                      <IconBan size={13} />
                    </ActionIcon>
                  </Tooltip>
                </>
              )}
              <ActionIcon size="sm" variant="subtle" color="gray" onClick={toggle}>
                <IconMinus size={13} />
              </ActionIcon>
            </Group>
          </Group>

          {/* Messages */}
          <ScrollArea style={{ flex: 1 }} px="xs" py={6}>
            {messages.length === 0 && (
              <Text size="xs" c="dimmed" ta="center" mt="xl">No messages yet. Say hi! 👋</Text>
            )}
            {messages.map(msg => {
              const isMine = msg.type === "chat" && msg.nick === nick;

              // System message — centered pill
              if (msg.type === "system") return (
                <div key={msg.id} style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4,
                    background: "var(--mantine-color-dark-6)", borderRadius: 20, padding: "3px 10px" }}>
                    <IconBolt size={10} color="var(--mantine-color-yellow-4)" />
                    <Text size="xs" c="dimmed" fs="italic">{msg.text}</Text>
                    <Text size="xs" c="dimmed" style={{ opacity: 0.6 }}>{fmtTs(msg.ts)}</Text>
                  </div>
                </div>
              );

              // Chat bubble
              const isBlocked = blocked.includes(msg.nick.toLowerCase());
              return (
                <div key={msg.id}
                  style={{ display: "flex", flexDirection: "column",
                    alignItems: isMine ? "flex-end" : "flex-start", marginBottom: 10 }}
                  onMouseEnter={() => setHoveredId(msg.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  {/* Nick + block button row — only for others */}
                  {!isMine && (
                    <Group gap={4} mb={2} align="center" style={{ paddingLeft: 4 }}>
                      <Text size="xs" fw={700} c={isBlocked ? "dimmed" : nickColor(msg.nick)}>
                        {msg.nick}{isBlocked && " 🚫"}
                      </Text>
                      {isAdmin && hoveredId === msg.id && (
                        <Tooltip label={isBlocked ? "Unblock" : "Block user"} withArrow position="top">
                          <ActionIcon
                            size="xs" variant="subtle" color={isBlocked ? "teal" : "red"}
                            onClick={() => isBlocked ? adminUnblock(msg.nick) : adminBlock(msg.nick)}
                          >
                            <IconUserOff size={11} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </Group>
                  )}

                  {/* Bubble */}
                  <div style={{
                    maxWidth: "78%", padding: "7px 11px",
                    borderRadius: isMine ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                    background: isMine ? "var(--mantine-color-blue-6)" : "var(--mantine-color-dark-5)",
                    opacity: isBlocked ? 0.5 : 1,
                  }}>
                    <Text size="xs" style={{ wordBreak: "break-word", lineHeight: 1.55,
                      color: isMine ? "#fff" : "var(--mantine-color-text)" }}>
                      {msg.text}
                    </Text>
                  </div>

                  {/* Timestamp */}
                  <Text size="xs" c="dimmed" mt={2} style={{ paddingInline: 4, opacity: 0.7 }}>
                    {fmtTs(msg.ts)}
                  </Text>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </ScrollArea>

          {/* Blocked list panel — admin only */}
          {isAdmin && showBlocked && (
            <div style={{ borderTop: "1px solid var(--mantine-color-default-border)",
              padding: "8px", flexShrink: 0, maxHeight: 120, overflowY: "auto" }}>
              <Text size="xs" fw={600} c="dimmed" mb={4}>Blocked users</Text>
              {blocked.length === 0 ? (
                <Text size="xs" c="dimmed">No blocked users</Text>
              ) : (
                <Stack gap={4}>
                  {blocked.map(b => (
                    <Group key={b} justify="space-between">
                      <Group gap={4}>
                        <IconBan size={11} color="var(--mantine-color-red-5)" />
                        <Text size="xs" ff="monospace">{b}</Text>
                      </Group>
                      <Button size="xs" variant="subtle" color="teal" compact
                        onClick={() => adminUnblock(b)}>
                        Unblock
                      </Button>
                    </Group>
                  ))}
                </Stack>
              )}
            </div>
          )}

          {/* Nick setup */}
          {showNickSetup && (
            <div style={{ borderTop: "1px solid var(--mantine-color-default-border)", padding: "8px 8px", flexShrink: 0 }}>
              <Text size="xs" c="dimmed" mb={4}>
                {editingNick ? "Change your nickname:" : "Set your nickname to start chatting:"}
              </Text>
              <Group gap="xs">
                <TextInput
                  placeholder="Your name…"
                  value={nickDraft}
                  onChange={e => setNickDraft(e.currentTarget.value)}
                  onKeyDown={e => { if (e.key === "Enter") saveNick(nickDraft); if (e.key === "Escape") { setEditingNick(false); setNickDraft(""); } }}
                  size="xs"
                  style={{ flex: 1 }}
                  maxLength={20}
                  autoFocus
                />
                <Button size="xs" disabled={!nickDraft.trim()} onClick={() => saveNick(nickDraft)}>
                  {editingNick ? "Save" : "Set"}
                </Button>
                {editingNick && (
                  <Button size="xs" variant="subtle" color="gray" onClick={() => { setEditingNick(false); setNickDraft(""); }}>
                    Cancel
                  </Button>
                )}
              </Group>
            </div>
          )}

          {/* Message input */}
          {!showNickSetup && (
            <div style={{ borderTop: "1px solid var(--mantine-color-default-border)", padding: "6px 8px", flexShrink: 0 }}>
              <Group gap={4} mb={4} align="center">
                <Text size="xs" c="dimmed">as <Text span fw={600} c={nickColor(nick)}>{nick}</Text></Text>
                <Tooltip label="Change nickname" withArrow position="top">
                  <ActionIcon size="xs" variant="subtle" color="gray"
                    onClick={() => { setNickDraft(nick); setEditingNick(true); }}>
                    <IconPencil size={10} />
                  </ActionIcon>
                </Tooltip>
              </Group>
              <Group gap="xs">
                <TextInput
                  ref={inputRef}
                  placeholder="Message…"
                  value={text}
                  onChange={e => setText(e.currentTarget.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }}
                  size="xs"
                  style={{ flex: 1 }}
                  maxLength={500}
                />
                <ActionIcon size="md" variant="filled" disabled={!text.trim()} onClick={onSend}>
                  <IconSend size={14} />
                </ActionIcon>
              </Group>
            </div>
          )}
        </Paper>
      )}

      {/* ── Toggle button ── */}
      <div style={{ position: "relative" }}>
        <ActionIcon size={48} radius="xl" variant="filled" color="blue" onClick={toggle}>
          <IconMessageCircle size={22} />
        </ActionIcon>
        {unread > 0 && (
          <Badge size="xs" color="red" circle
            style={{ position: "absolute", top: -2, right: -2, minWidth: 18, height: 18, padding: 0, fontSize: 10 }}>
            {unread > 9 ? "9+" : unread}
          </Badge>
        )}
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export function App() {
  const [status, setStatus]   = useState<StatusResponse | null>(null);
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const sendChat = useCallback((nick: string, text: string) => {
    wsRef.current?.send(JSON.stringify({ type: "chat", nick, text }));
  }, []);

  useEffect(() => {
    let ws: WebSocket, dead = false;
    function connect() {
      if (dead) return;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${location.host}/ws`);
      wsRef.current = ws;
      ws.onmessage = e => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === "chat_history")  { setChatMsgs(data.messages); return; }
          if (data.type === "chat_message")  { setChatMsgs(prev => [...prev.slice(-99), data.message]); return; }
          if (data.type === "chat_clear")    { setChatMsgs([]); return; }
          setStatus(data);
        } catch {}
      };
      ws.onclose = () => { if (!dead) setTimeout(connect, 3000); };
    }
    connect();
    return () => { dead = true; ws?.close(); };
  }, []);

  return (
    <ChatCtx.Provider value={{ messages: chatMsgs, send: sendChat }}>
      <StatusCtx.Provider value={status}>
        <Routes>
          <Route path="/" element={
            status ? <Dashboard isAdmin={false} /> : <LoadingScreen />
          } />
          <Route path="/admin" element={
            <RequireAdmin>
              <AdminDashboard />
            </RequireAdmin>
          } />
          <Route path="/mind" element={<MindPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </StatusCtx.Provider>
    </ChatCtx.Provider>
  );
}
