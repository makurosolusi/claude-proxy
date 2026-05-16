import { useEffect, useState } from "react";
import {
  Stack, Text, Paper, Group, Badge, Button, Select, TextInput, NumberInput,
  Table, Pagination, ActionIcon, Tooltip, Tabs, Switch, Divider, Box, Code,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconRefresh, IconTrash, IconSearch, IconAlertTriangle, IconInfoCircle,
  IconAlertCircle, IconHistory, IconChartBar,
} from "@tabler/icons-react";

interface LogRow {
  id:      number;
  ts:      number;
  age_sec: number;
  level:   "info" | "warn" | "error";
  source:  string;
  message: string;
}

interface StatsData {
  window_hours:  number;
  total_entries: number;
  oldest_ts:     number | null;
  newest_ts:     number | null;
  by_level:      { level: string; count: number }[];
  by_source:     { source: string; count: number }[];
}

interface LogManagementConfig {
  retentionDays:    number;
  pruneIntervalHrs: number;
  flushIntervalMs:  number;
  flushMaxBatch:    number;
  captureLevels:    ("info" | "warn" | "error")[];
}

async function fetchJson(url: string, opts?: RequestInit): Promise<any> {
  const r = await fetch(url, { credentials: "include", ...opts });
  const d = await r.json();
  if (!r.ok) throw new Error((d as any)?.error || `HTTP ${r.status}`);
  return d;
}

function fmtAge(sec: number): string {
  if (sec < 60)    return sec + "s";
  if (sec < 3600)  return Math.floor(sec / 60) + "m";
  if (sec < 86400) return Math.floor(sec / 3600) + "h";
  return Math.floor(sec / 86400) + "d";
}

function levelColor(l: string) {
  return l === "error" ? "red" : l === "warn" ? "orange" : "blue";
}
function levelIcon(l: string) {
  if (l === "error") return <IconAlertCircle    size={12} />;
  if (l === "warn")  return <IconAlertTriangle  size={12} />;
  return <IconInfoCircle size={12} />;
}

export function AdminLogs() {
  const [tab, setTab] = useState<string>("list");

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <div>
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Logs</Text>
          <Text size="xl" fw={800} ff="monospace">Log Management</Text>
          <Text size="sm" c="dimmed" mt={2}>Persisted console logs with retention. Survives restarts.</Text>
        </div>
      </Group>

      <Tabs value={tab} onChange={v => v && setTab(v)} variant="pills" radius="md">
        <Tabs.List>
          <Tabs.Tab value="list"     leftSection={<IconHistory size={13} />}>Logs</Tabs.Tab>
          <Tabs.Tab value="stats"    leftSection={<IconChartBar size={13} />}>Stats</Tabs.Tab>
          <Tabs.Tab value="settings">Settings</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="list" pt="md"><LogsPanel /></Tabs.Panel>
        <Tabs.Panel value="stats" pt="md"><StatsPanel /></Tabs.Panel>
        <Tabs.Panel value="settings" pt="md"><SettingsPanel /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

function LogsPanel() {
  const [logs, setLogs]       = useState<LogRow[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [loading, setLoading] = useState(false);
  const [level, setLevel]     = useState<string>("");
  const [source, setSource]   = useState<string>("");
  const [q, setQ]             = useState("");
  const [sinceMin, setSinceMin] = useState<number>(0);
  const [sources, setSources] = useState<{ source: string; count: number }[]>([]);

  const PAGE_SIZE = 50;

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (level)    params.set("level", level);
      if (source)   params.set("source", source);
      if (q)        params.set("q", q);
      if (sinceMin) params.set("since_minutes", String(sinceMin));
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String((page - 1) * PAGE_SIZE));
      const d = await fetchJson(`/api/admin/log-management/logs?${params}`);
      setLogs(d.logs || []);
      setTotal(d.total || 0);
    } catch (e: any) {
      notifications.show({ color: "red", title: "Load failed", message: e.message });
    } finally { setLoading(false); }
  };

  const loadSources = async () => {
    try {
      const d = await fetchJson("/api/admin/log-management/sources");
      setSources(d.sources || []);
    } catch {}
  };

  useEffect(() => { void load(); }, [page, level, source, sinceMin]);
  useEffect(() => { void loadSources(); }, []);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Stack gap="md">
      <Paper withBorder p="sm" radius="md">
        <Group gap="xs" wrap="wrap" align="end">
          <Select
            placeholder="All levels" clearable size="xs" w={120}
            data={[
              { value: "error", label: "Error" },
              { value: "warn",  label: "Warn" },
              { value: "info",  label: "Info" },
            ]}
            value={level} onChange={v => { setPage(1); setLevel(v || ""); }}
          />
          <Select
            placeholder="All sources" clearable searchable size="xs" w={180}
            data={sources.map(s => ({ value: s.source, label: `${s.source} (${s.count})` }))}
            value={source} onChange={v => { setPage(1); setSource(v || ""); }}
          />
          <Select
            placeholder="All time" clearable size="xs" w={130}
            data={[
              { value: "5",    label: "Last 5m" },
              { value: "30",   label: "Last 30m" },
              { value: "60",   label: "Last 1h" },
              { value: "360",  label: "Last 6h" },
              { value: "1440", label: "Last 24h" },
            ]}
            value={sinceMin ? String(sinceMin) : ""} onChange={v => { setPage(1); setSinceMin(parseInt(v || "0")); }}
          />
          <TextInput
            placeholder="Search message…" leftSection={<IconSearch size={12} />}
            size="xs" style={{ flex: 1, minWidth: 200 }}
            value={q} onChange={e => setQ(e.currentTarget.value)}
            onKeyDown={e => { if (e.key === "Enter") { setPage(1); void load(); } }}
          />
          <Button size="xs" onClick={() => { setPage(1); void load(); }}>Search</Button>
          <Tooltip label="Refresh"><ActionIcon size="sm" variant="default" onClick={load}><IconRefresh size={13} /></ActionIcon></Tooltip>
        </Group>
      </Paper>

      <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
        <Table.ScrollContainer minWidth={700}>
          <Table highlightOnHover striped fz="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 60 }}>Level</Table.Th>
                <Table.Th style={{ width: 80 }}>Age</Table.Th>
                <Table.Th style={{ width: 120 }}>Source</Table.Th>
                <Table.Th>Message</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {logs.length === 0 && !loading && (
                <Table.Tr><Table.Td colSpan={4} ta="center"><Text size="xs" c="dimmed" py="lg">No logs match the filters.</Text></Table.Td></Table.Tr>
              )}
              {logs.map(l => (
                <Table.Tr key={l.id}>
                  <Table.Td><Badge size="xs" color={levelColor(l.level)} variant="light" leftSection={levelIcon(l.level)}>{l.level}</Badge></Table.Td>
                  <Table.Td><Text size="xs" c="dimmed" ff="monospace">{fmtAge(l.age_sec)}</Text></Table.Td>
                  <Table.Td><Badge size="xs" variant="outline" color="gray">{l.source}</Badge></Table.Td>
                  <Table.Td><Box style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}><Code style={{ background: "transparent", fontSize: 11 }}>{l.message}</Code></Box></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>

      <Group justify="space-between">
        <Text size="xs" c="dimmed">{total} entries · page {page}/{pages}</Text>
        {pages > 1 && <Pagination total={pages} value={page} onChange={setPage} size="sm" />}
      </Group>
    </Stack>
  );
}

function StatsPanel() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setStats(await fetchJson(`/api/admin/log-management/stats?since_hours=${hours}`)); }
    catch (e: any) { notifications.show({ color: "red", message: e.message }); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [hours]);

  if (!stats) return <Text size="sm" c="dimmed">Loading…</Text>;
  return (
    <Stack gap="md">
      <Group gap="xs">
        <Select size="xs" w={140}
          data={[
            { value: "1",   label: "Last 1h" },
            { value: "6",   label: "Last 6h" },
            { value: "24",  label: "Last 24h" },
            { value: "168", label: "Last 7d" },
          ]}
          value={String(hours)} onChange={v => v && setHours(parseInt(v))}
        />
        <Text size="xs" c="dimmed">{stats.total_entries} total in DB</Text>
        {stats.oldest_ts && <Text size="xs" c="dimmed">· oldest {new Date(stats.oldest_ts).toLocaleString()}</Text>}
      </Group>

      <Paper withBorder p="md" radius="md">
        <Text fw={600} mb="xs">By level</Text>
        {stats.by_level.length === 0 && <Text size="xs" c="dimmed">No entries.</Text>}
        {stats.by_level.map(r => (
          <Group key={r.level} justify="space-between">
            <Badge size="sm" color={levelColor(r.level)} variant="light">{r.level}</Badge>
            <Text size="sm" ff="monospace">{r.count}</Text>
          </Group>
        ))}
      </Paper>

      <Paper withBorder p="md" radius="md">
        <Text fw={600} mb="xs">By source (top 20)</Text>
        {stats.by_source.length === 0 && <Text size="xs" c="dimmed">No entries.</Text>}
        {stats.by_source.map(r => (
          <Group key={r.source} justify="space-between">
            <Badge size="sm" variant="outline" color="gray">{r.source}</Badge>
            <Text size="sm" ff="monospace">{r.count}</Text>
          </Group>
        ))}
      </Paper>
    </Stack>
  );
}

function SettingsPanel() {
  const [cfg, setCfg] = useState<LogManagementConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [pruning, setPruning] = useState(false);

  useEffect(() => {
    void fetchJson("/api/admin/log-management/settings").then(d => setCfg(d.config)).catch(() => {});
  }, []);

  if (!cfg) return <Text size="sm" c="dimmed">Loading…</Text>;

  const save = async () => {
    setSaving(true);
    try {
      const d = await fetchJson("/api/admin/log-management/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      setCfg(d.config);
      notifications.show({ color: "teal", message: "Settings saved" });
    } catch (e: any) { notifications.show({ color: "red", message: e.message }); }
    finally { setSaving(false); }
  };

  const pruneNow = async () => {
    setPruning(true);
    try {
      const d = await fetchJson("/api/admin/log-management/prune", { method: "POST" });
      notifications.show({ color: "teal", message: `Pruned ${d.deleted} old entries` });
    } catch (e: any) { notifications.show({ color: "red", message: e.message }); }
    finally { setPruning(false); }
  };

  const clearAll = async () => {
    if (!confirm("Delete ALL app_logs entries? This cannot be undone.")) return;
    try {
      const d = await fetchJson("/api/admin/log-management/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      notifications.show({ color: "teal", message: `Cleared ${d.deleted} entries` });
    } catch (e: any) { notifications.show({ color: "red", message: e.message }); }
  };

  return (
    <Stack gap="md" maw={520}>
      <Paper withBorder p="md" radius="md">
        <Text fw={600} mb="sm">Retention</Text>
        <Stack gap="sm">
          <NumberInput label="Retention days" min={1} max={90} value={cfg.retentionDays}
            onChange={v => setCfg({ ...cfg, retentionDays: Number(v) || 7 })} />
          <NumberInput label="Prune interval (hours)" min={1} max={168} value={cfg.pruneIntervalHrs}
            onChange={v => setCfg({ ...cfg, pruneIntervalHrs: Number(v) || 24 })} />
        </Stack>
      </Paper>
      <Paper withBorder p="md" radius="md">
        <Text fw={600} mb="sm">Capture</Text>
        <Stack gap="xs">
          {(["info", "warn", "error"] as const).map(lvl => (
            <Switch key={lvl}
              label={`Capture ${lvl}`}
              checked={cfg.captureLevels.includes(lvl)}
              onChange={e => {
                const next = new Set(cfg.captureLevels);
                if (e.currentTarget.checked) next.add(lvl); else next.delete(lvl);
                setCfg({ ...cfg, captureLevels: [...next] });
              }}
            />
          ))}
        </Stack>
      </Paper>
      <Paper withBorder p="md" radius="md">
        <Text fw={600} mb="sm">Batching</Text>
        <Stack gap="sm">
          <NumberInput label="Flush interval (ms)" min={500} max={60_000} step={500} value={cfg.flushIntervalMs}
            onChange={v => setCfg({ ...cfg, flushIntervalMs: Number(v) || 2000 })} />
          <NumberInput label="Flush max batch" min={10} max={2000} value={cfg.flushMaxBatch}
            onChange={v => setCfg({ ...cfg, flushMaxBatch: Number(v) || 200 })} />
        </Stack>
      </Paper>
      <Group>
        <Button onClick={save} loading={saving}>Save settings</Button>
        <Button variant="default" onClick={pruneNow} loading={pruning} leftSection={<IconTrash size={13} />}>Prune now</Button>
        <Divider orientation="vertical" />
        <Button variant="subtle" color="red" onClick={clearAll}>Clear ALL</Button>
      </Group>
    </Stack>
  );
}
