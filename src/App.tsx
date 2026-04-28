import { useState, useEffect, useCallback, useMemo, createContext, useContext } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import ReactECharts from "echarts-for-react";
import {
  IconLayoutDashboard, IconUsers, IconList, IconChartBar,
  IconSitemap, IconExternalLink, IconSun, IconMoon,
  IconRefresh, IconPencil, IconPlayerPause, IconPlayerPlay, IconTrash,
  IconLogout, IconLogin,
  IconChevronsLeft, IconChevronsRight, IconMenu2,
  IconPlus, IconHistory, IconBrandGithub,
} from "@tabler/icons-react";
import {
  Container, Group, Stack, Grid, Title, Text, Paper, Box, Center, Loader,
  Table, Badge, Progress, RingProgress, ActionIcon, Button,
  Select, TextInput, Modal, Code, Pagination,
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
function PeriodCard({ label, data }: { label: string; data: UpstreamPeriod }) {
  const p = data.utilization;
  return (
    <Paper withBorder p="sm" style={{ flex: 1, minWidth: 120, maxWidth: 160, display:"flex", flexDirection:"column", alignItems:"center", gap: 8 }}>
      <Text size="xs" fw={700} tt="uppercase" c="dimmed" ta="center">{label}</Text>
      <RingProgress
        size={80} thickness={7}
        sections={[{ value: p, color: pctColor(p) }]}
        label={<Text ta="center" fz="sm" fw={700} c={pctColor(p)}>{p.toFixed(0)}%</Text>}
      />
      <Text size="xs" c="dimmed" ta="center">resets {fmtResetAt(data.resets_at)}</Text>
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

  const dotColor = upstream.ok ? (upstream.stale ? "yellow" : "teal") : "orange";
  const periods = [
    upstream.fiveHour && { label: "5-hour", data: upstream.fiveHour },
    upstream.sevenDay && { label: "7-day", data: upstream.sevenDay },
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
      <Group gap="sm" style={{ overflowX: "auto", paddingBottom: 4 }}>
        {periods.map(({ label, data }) => <PeriodCard key={label} label={label} data={data} />)}
      </Group>
    </Stack>
  );
}

// ── Users table ───────────────────────────────────────────────────────────────
function UsersTable({ tokens, isAdmin }: { tokens: Record<string, TokenStatus>; isAdmin: boolean }) {
  return (
    <Table className="users-table" highlightOnHover withColumnBorders={false} withRowBorders>
      <Table.Thead>
        <Table.Tr>
          {["Token","Used","Today","Limit","Remaining","Usage",...(isAdmin?["Actions"]:[])].map(h => (
            <Table.Th key={h} style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>{h}</Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody id="token-rows">
        {Object.entries(tokens).map(([k, tk]) => {
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
                  <Progress value={pct} color={pctColor(pct)} size="sm" style={{ flex: 1 }} animated={false} />
                  <Text component="span" size="xs" className={`pct-${usageCls(pct)}`}>{pct}%</Text>
                </Group>
              </Table.Td>
              {isAdmin && (
                <Table.Td data-label="Actions">
                  <Group gap={4}>
                    <form method="POST" action="/admin/reset">
                      <input type="hidden" name="token" value={k} />
                      <Tooltip label="Reset usage"><ActionIcon variant="subtle" color="gray" type="submit"><IconRefresh size={14} /></ActionIcon></Tooltip>
                    </form>
                    <form method="POST" action="/admin/token/edit" onSubmit={e => { const v = prompt("New limit:", lim); if (!v) { e.preventDefault(); return; } (e.currentTarget.querySelector('[name=limit]') as HTMLInputElement).value = v; }}>
                      <input type="hidden" name="token" value={k} />
                      <input type="hidden" name="limit" value={lim} />
                      <Tooltip label="Edit limit"><ActionIcon variant="subtle" color="gray" type="submit"><IconPencil size={14} /></ActionIcon></Tooltip>
                    </form>
                    <form method="POST" action="/admin/token/pause">
                      <input type="hidden" name="token" value={k} />
                      <Tooltip label={tk.paused ? "Resume" : "Pause"}>
                        <ActionIcon variant="light" color={tk.paused ? "teal" : "orange"} type="submit">
                          {tk.paused ? <IconPlayerPlay size={14} /> : <IconPlayerPause size={14} />}
                        </ActionIcon>
                      </Tooltip>
                    </form>
                    <form method="POST" action="/admin/token/delete" onSubmit={e => { if (!confirm(`Delete ${k}?`)) e.preventDefault(); }}>
                      <input type="hidden" name="token" value={k} />
                      <Tooltip label="Delete"><ActionIcon variant="light" color="red" type="submit"><IconTrash size={14} /></ActionIcon></Tooltip>
                    </form>
                  </Group>
                </Table.Td>
              )}
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
}

// ── Daily history ─────────────────────────────────────────────────────────────
function DailyHistory({ isAdmin }: { isAdmin: boolean }) {
  const [data, setData] = useState<{ date: string; total: number; by_user: Record<string, number> }[]>([]);
  const [users, setUsers] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/stats").then(r => r.json()).then(d => { setData(d.daily || []); setUsers(d.users || []); }).catch(() => {});
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const dates = [...data].reverse().slice(0, 14);

  if (!dates.length) return <Text size="sm" c="dimmed" ta="center" p="xl">No data yet.</Text>;

  const cc = (v: number) => !v ? "dimmed" : v > 20000 ? "red" : v > 10000 ? "orange" : v > 5000 ? "yellow" : "teal";

  return (
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
            const row = d.by_user || {};
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
  );
}

// ── Request log ───────────────────────────────────────────────────────────────
const ALL_COLS = [
  { k: "time", l: "Time" }, { k: "user", l: "User" }, { k: "model", l: "Model" },
  { k: "in", l: "In" }, { k: "out", l: "Out" }, { k: "total", l: "Total" },
  { k: "type", l: "Type" }, { k: "prompt", l: "Prompt" },
];

function RequestLog({ isAdmin }: { isAdmin: boolean }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [user, setUser] = useState<string | null>(null);
  const [users, setUsers] = useState<string[]>([]);
  const [visible, setVisible] = useState<Record<string, boolean>>(
    Object.fromEntries(ALL_COLS.map(c => [c.k, c.k === "time" || c.k === "user" || c.k === "prompt"]))
  );
  const [detail, setDetail] = useState<LogEntry | null>(null);
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

  const visibleCols = ALL_COLS.filter(c => visible[c.k]);
  const totCls = (tot: number) => tot > 20000 ? "pct-over" : tot > 10000 ? "pct-high" : tot > 5000 ? "pct-warn" : "";

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

        {/* Column toggles */}
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
                {!logs.length ? (
                  <Table.Tr><Table.Td colSpan={visibleCols.length}><Text ta="center" size="sm" c="dimmed" p="xl">No requests found.</Text></Table.Td></Table.Tr>
                ) : logs.map(l => {
                  const tot = l.input_tokens + l.output_tokens;
                  const model = l.model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
                  const u = l.token_key.replace(/^sk-user-/, "");
                  const cells: Record<string, React.ReactNode> = {
                    time: <Table.Td key="time"><Text size="xs" ff="monospace" c="dimmed">{fmtRel(l.ts)}</Text></Table.Td>,
                    user: <Table.Td key="user"><Badge variant="light" color="gray" size="sm" ff="monospace">{u}</Badge></Table.Td>,
                    model: <Table.Td key="model"><Text size="xs" ff="monospace" c="dimmed">{model}</Text></Table.Td>,
                    in: <Table.Td key="in"><Text size="xs" ff="monospace" c="dimmed">{l.input_tokens.toLocaleString()}</Text></Table.Td>,
                    out: <Table.Td key="out"><Text size="xs" ff="monospace" c="dimmed">{l.output_tokens.toLocaleString()}</Text></Table.Td>,
                    total: <Table.Td key="total"><Text size="xs" ff="monospace" fw={700} className={totCls(tot)}>{tot.toLocaleString()}</Text></Table.Td>,
                    type: <Table.Td key="type">{l.stream ? <Badge color="blue" size="xs">stream</Badge> : <Text size="xs" c="dimmed">sync</Text>}</Table.Td>,
                    prompt: <Table.Td key="prompt" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <Text size="xs" c="dimmed" truncate title={l.prompt}>{l.prompt || "—"}</Text>
                    </Table.Td>,
                  };
                  return (
                    <Table.Tr key={l.id} style={{ cursor: "pointer", background: l.status >= 400 ? "light-dark(rgba(239,68,68,.05),rgba(239,68,68,.1))" : undefined }} onClick={() => showDetail(l)}>
                      {visibleCols.map(c => cells[c.k])}
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>

          <Group justify="space-between" p="sm" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
            <Pagination total={pages} value={page} onChange={p => { setPage(p); fetchLogs(p, user); }} size="sm" />
            <Text size="xs" c="dimmed">{total === 0 ? "No results" : `Showing ${(page-1)*LIMIT+1}–${Math.min(page*LIMIT,total)} of ${total}`}</Text>
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
        <Paper withBorder p="md">
          <UpstreamSection upstream={upstream} isAdmin={true} />
        </Paper>
      </Stack>

      {/* Quick actions */}
      <Stack gap="xs">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Quick Actions</Text>
        <Paper withBorder p="md">
          <Group gap="sm" wrap="wrap">
            <form method="POST" action="/admin/reset" onSubmit={e => { if (!confirm("Reset all token usage?")) e.preventDefault(); }}>
              <input type="hidden" name="all" value="true" />
              <Button type="submit" variant="light" color="gray" size="sm" leftSection={<IconRefresh size={15} />}>Reset All Usage</Button>
            </form>
            <form method="POST" action="/admin/token/pause">
              <input type="hidden" name="all" value="true" />
              <Button type="submit" variant="light" color="orange" size="sm" leftSection={<IconPlayerPause size={15} />}>Pause All Tokens</Button>
            </form>
            <form method="POST" action="/admin/token/edit-all" onSubmit={e => {
              const v = prompt("New limit for all tokens:");
              if (!v) { e.preventDefault(); return; }
              (e.currentTarget.querySelector('[name=limit]') as HTMLInputElement).value = v;
            }}>
              <input type="hidden" name="limit" value="" />
              <Button type="submit" variant="light" color="blue" size="sm" leftSection={<IconPencil size={15} />}>Edit All Limits</Button>
            </form>
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

  const handleAdd = (e: React.FormEvent) => {
    if (!newKey.trim()) { e.preventDefault(); }
  };

  return (
    <Stack gap="xl">
      {/* Users table */}
      <Stack gap="xs">
        <Group justify="space-between">
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Token Management</Text>
          <Group gap="xs">
            <form method="POST" action="/admin/reset" onSubmit={e => { if (!confirm("Reset all?")) e.preventDefault(); }}>
              <input type="hidden" name="all" value="true" />
              <Button type="submit" size="xs" variant="subtle" color="gray" leftSection={<IconRefresh size={13} />}>Reset All</Button>
            </form>
            <form method="POST" action="/admin/token/pause">
              <input type="hidden" name="all" value="true" />
              <Button type="submit" size="xs" variant="subtle" color="orange" leftSection={<IconPlayerPause size={13} />}>Pause All</Button>
            </form>
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
          <form method="POST" action="/admin/token/add" onSubmit={handleAdd}>
            <Group align="flex-end" gap="sm" wrap="wrap">
              <TextInput
                label="Token key"
                name="token"
                placeholder="sk-user-name"
                required
                size="sm"
                w={240}
                value={newKey}
                onChange={e => setNewKey(e.currentTarget.value)}
                description="Must start with sk-user-"
              />
              <TextInput
                label="Limit"
                name="limit"
                size="sm"
                w={140}
                value={newLimit}
                onChange={e => setNewLimit(e.currentTarget.value)}
                description="Token quota (tokens)"
              />
              <Button type="submit" color="teal" size="sm" mb={20} leftSection={<IconPlus size={15} />}>Add Token</Button>
            </Group>
          </form>
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

// ── Admin Dashboard (AppShell layout) ─────────────────────────────────────────
type AdminSection = "overview" | "users" | "logs" | "stats";

function AdminDashboard() {
  const status = useStatus()!;
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const [section,   setSection]   = useState<AdminSection>("overview");
  const [mobileOpen, { toggle: toggleMobile, close }] = useDisclosure(false);
  const [collapsed,  { toggle: toggleCollapse }]      = useDisclosure(false);

  const { tokens, upstream } = status;
  const nav = (s: AdminSection) => { setSection(s); close(); };

  const SZ = 17;
  const navItems: { id: AdminSection; label: string; icon: React.ReactNode; desc: string }[] = [
    { id: "overview", label: "Overview",    icon: <IconLayoutDashboard size={SZ} />, desc: "Upstream & quick stats" },
    { id: "users",    label: "Users",       icon: <IconUsers           size={SZ} />, desc: "Token management"       },
    { id: "logs",     label: "Request Logs",icon: <IconList            size={SZ} />, desc: "Activity & history"     },
    { id: "stats",    label: "Stats",       icon: <IconChartBar        size={SZ} />, desc: "Daily usage history"    },
  ];
  const footerItems: { icon: React.ReactNode; label: string; href: string; target?: string }[] = [
    { icon: <IconSitemap      size={SZ} />, label: "Mind Map",    href: "/mind", target: "_blank" },
    { icon: <IconExternalLink size={SZ} />, label: "Public View", href: "/",     target: undefined },
  ];

  const utilPct = upstream.fiveHour?.utilization ?? null;
  const sectionTitles: Record<AdminSection, string> = {
    overview: "Overview", users: "Users", logs: "Request Logs", stats: "Stats",
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
            <Tooltip
              label={`${upstream.email ?? "no credential"} · poll ${status.pollAge}`}
              position="right"
              withArrow
              multiline
              w={200}
            >
              <Box style={{ display: "flex", justifyContent: "center", padding: "4px 0" }}>
                <Box
                  w={10} h={10}
                  style={{ borderRadius: "50%", cursor: "default",
                    background: `var(--mantine-color-${statusColor}-5)` }}
                />
              </Box>
            </Tooltip>
          ) : (
            <Box px="xs" py={4}>
              <Group gap="xs" mb={2}>
                <Box w={7} h={7} style={{ borderRadius: "50%", flexShrink: 0, background: `var(--mantine-color-${statusColor}-5)` }} />
                <Text size="xs" c="dimmed" ff="monospace" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {upstream.email ?? "no credential"}
                </Text>
              </Group>
              <Text size="10px" c="dimmed" pl={15}>poll {status.pollAge}</Text>
            </Box>
          )}
        </AppShell.Section>
      </AppShell.Navbar>

      {/* ── Main content ── */}
      <AppShell.Main>
        <Box p="lg">
          {section === "overview" && <AdminOverview tokens={tokens} upstream={upstream} />}
          {section === "users"    && <AdminUsers tokens={tokens} />}
          {section === "logs"     && <RequestLog isAdmin={true} />}
          {section === "stats"    && <AdminStats />}
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}

// ── Dashboard (shared layout) ──────────────────────────────────────────────────
function Dashboard({ isAdmin }: { isAdmin: boolean }) {
  const status = useStatus()!;
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const { tokens, upstream } = status;
  const title = isAdmin ? "claude-proxy · admin" : "claude-proxy";

  return (
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
        <Paper withBorder p="md"><UpstreamSection upstream={upstream} isAdmin={isAdmin} /></Paper>
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
            <form method="POST" action="/admin/reset" onSubmit={e => { if (!confirm("Reset all?")) e.preventDefault(); }}>
              <input type="hidden" name="all" value="true" />
              <Button type="submit" variant="light" color="gray" size="xs" leftSection={<IconRefresh size={13} />}>Reset All</Button>
            </form>
            <form method="POST" action="/admin/token/pause">
              <input type="hidden" name="all" value="true" />
              <Button type="submit" variant="light" color="orange" size="xs" leftSection={<IconPlayerPause size={13} />}>Pause All</Button>
            </form>
            <form method="POST" action="/admin/token/edit-all" onSubmit={e => { const v = prompt("New limit for all:"); if (!v) { e.preventDefault(); return; } (e.currentTarget.querySelector('[name=limit]') as HTMLInputElement).value = v; }}>
              <input type="hidden" name="limit" value="" />
              <Button type="submit" variant="light" color="blue" size="xs" leftSection={<IconPencil size={13} />}>Edit All Limits</Button>
            </form>
          </Group>
        )}
      </Stack>

      {/* Add token */}
      {isAdmin && (
        <Stack gap="xs" mb="xl">
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Add Token</Text>
          <Paper withBorder p="md">
            <form method="POST" action="/admin/token/add">
              <Group align="flex-end" gap="sm">
                <TextInput label="Token Key" name="token" placeholder="sk-user-name" required size="xs" w={220} />
                <TextInput label="Limit" name="limit" defaultValue="40000" size="xs" w={120} />
                <Button type="submit" color="teal" size="xs">+ Add Token</Button>
              </Group>
            </form>
          </Paper>
        </Stack>
      )}

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

// ── Main App ──────────────────────────────────────────────────────────────────
export function App() {
  const [status, setStatus] = useState<StatusResponse | null>(null);

  useEffect(() => {
    let ws: WebSocket, dead = false;
    function connect() {
      if (dead) return;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${location.host}/ws`);
      ws.onmessage = e => { try { setStatus(JSON.parse(e.data)); } catch {} };
      ws.onclose = () => { if (!dead) setTimeout(connect, 3000); };
    }
    connect();
    return () => { dead = true; ws?.close(); };
  }, []);

  return (
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
  );
}
