import { useState, useEffect, useCallback } from "react";
import { useDisclosure } from "@mantine/hooks";
import {
  Stack, Group, Text, Button, Select, Badge, Paper, Table, Tooltip,
  Modal, Grid, Code, Pagination, Divider, ThemeIcon, ActionIcon,
} from "@mantine/core";
import { IconSitemap, IconSearch, IconFilter, IconStack2, IconFlag } from "@tabler/icons-react";
import { fmtRel, maskToken, usageCls, pctColor } from "../../utils";
import type { LogEntry } from "../../contexts";

const ALL_COLS = [
  { k: "user", l: "User" }, { k: "time", l: "Time" }, { k: "model", l: "Model" },
  { k: "in", l: "In" }, { k: "out", l: "Out" }, { k: "total", l: "Total" },
  { k: "type", l: "Type" }, { k: "prompt", l: "Prompt" },
];

const STICKY_COL: React.CSSProperties = {
  position: "sticky",
  left: 0,
  zIndex: 2,
  background: "var(--mantine-color-body)",
  borderRight: "1px solid var(--mantine-color-default-border)",
};

// Group consecutive log entries with same user + prompt → returns grouped list with count
function groupDuplicateLogs(logs: LogEntry[]): Array<{ log: LogEntry; count: number }> {
  const out: Array<{ log: LogEntry; count: number }> = [];
  for (const log of logs) {
    const prev = out[out.length - 1];
    const isDup = prev
      && prev.log.token_key === log.token_key
      && prev.log.prompt    === log.prompt
      && prev.log.prompt    !== "";
    if (isDup) { prev.count++; }
    else       { out.push({ log, count: 1 }); }
  }
  return out;
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

export function RequestLog({ isAdmin }: { isAdmin: boolean }) {
  const [logs, setLogs]       = useState<LogEntry[]>([]);
  const [page, setPage]       = useState(1);
  const [pages, setPages]     = useState(1);
  const [total, setTotal]     = useState(0);
  const [user, setUser]       = useState<string | null>(null);
  const [users, setUsers]     = useState<string[]>([]);
  const [groupDups, setGroupDups] = useState(true);
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
      <Stack gap="xl">
        {/* ── Page Header ───────────────────────────────────── */}
        <Paper withBorder p="lg" radius="md">
          <Group justify="space-between" wrap="wrap">
            <div>
              <Text size="sm" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }} mb={4}>Request Logs</Text>
              <Text size="xl" fw={800} ff="monospace">Activity Feed</Text>
              <Text size="sm" c="dimmed" mt={2}>
                {total > 0
                  ? `${total.toLocaleString()} requests · ${users.length} users · page ${page}/${pages}`
                  : "Loading request history…"}
              </Text>
            </div>
            <Group gap="xs">
              <ActionIcon variant="subtle" color="gray" size="lg" component="a" href="/mind">
                <IconSitemap size={18} />
              </ActionIcon>
              <ActionIcon variant="subtle" color="violet" size="lg" component="a" href="/race">
                <IconFlag size={18} />
              </ActionIcon>
            </Group>
          </Group>
        </Paper>

        {/* ── Controls ──────────────────────────────────────── */}
        <Paper withBorder p="sm" radius="md">
          <Stack gap="sm">
            <Group justify="space-between" wrap="wrap">
              <Group gap="xs">
                <ThemeIcon variant="light" color="gray" size="sm" radius="sm">
                  <IconFilter size={12} />
                </ThemeIcon>
                <Select
                  size="xs" w={150}
                  data={["All users", ...users.map(u => ({ value: u, label: u.replace(/^sk-user-/, "") }))]}
                  value={user || "All users"}
                  onChange={v => { const u = v === "All users" ? null : v; setUser(u); fetchLogs(1, u); }}
                  leftSection={<IconSearch size={12} />}
                />
              </Group>
              <Group gap="xs">
                {isAdmin && user && (
                  <Button size="xs" variant="light" color="orange" onClick={() => clearLogs(false)}>
                    Clear {user.replace(/^sk-user-/, "")} logs
                  </Button>
                )}
                {isAdmin && (
                  <Button size="xs" variant="light" color="red" onClick={() => clearLogs(true)}>Clear all</Button>
                )}
              </Group>
            </Group>

            <Divider />

            <Group gap={6}>
              <ThemeIcon variant="light" color="gray" size="sm" radius="sm">
                <IconStack2 size={12} />
              </ThemeIcon>
              {ALL_COLS.map(c => (
                <Badge
                  key={c.k}
                  variant={visible[c.k] ? "filled" : "outline"}
                  color={visible[c.k] ? "dark" : "gray"}
                  size="sm"
                  style={{ cursor: "pointer" }}
                  onClick={() => setVisible(v => ({ ...v, [c.k]: !v[c.k] }))}
                >
                  {c.l}
                </Badge>
              ))}
              <Divider orientation="vertical" mx={2} />
              <Tooltip label={groupDups ? "Showing grouped duplicates — click to show all" : "Click to group consecutive duplicates"} withArrow position="top">
                <Badge
                  variant={groupDups ? "filled" : "outline"}
                  color={groupDups ? "orange" : "gray"}
                  size="sm"
                  style={{ cursor: "pointer" }}
                  onClick={() => setGroupDups(v => !v)}
                  leftSection={groupDups && dupCount > 0 ? <Text size="10px" fw={700}>{dupCount}</Text> : undefined}
                >
                  Dupes
                </Badge>
              </Tooltip>
            </Group>
          </Stack>
        </Paper>

        {/* ── Table ─────────────────────────────────────────── */}
        <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
          <Table.ScrollContainer minWidth={400}>
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  {visibleCols.map(c => (
                    <Table.Th key={c.k} style={c.k === "user" ? { ...STICKY_COL, zIndex: 3 } : undefined}>
                      {c.l}
                    </Table.Th>
                  ))}
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
                    user:  <Table.Td key="user" style={STICKY_COL}><Badge variant="light" color="gray" size="sm" ff="monospace">{u}</Badge></Table.Td>,
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
