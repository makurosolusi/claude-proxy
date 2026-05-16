import { useEffect, useState } from "react";
import {
  Stack, Group, Text, Title, Paper, Badge, Loader, Center, ThemeIcon, Box,
  SimpleGrid, Tabs, Switch, NumberInput, Select, Button, Table, ScrollArea,
  Alert, ActionIcon, Tooltip, Code,
} from "@mantine/core";
import {
  IconBrain, IconRefresh, IconTrash, IconBolt, IconHistory, IconChartBar,
  IconDatabase, IconAdjustments, IconAlertCircle, IconDownload,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";

interface Overview {
  cache: { hits_7d: number; hit_exact_7d: number; hit_semantic_7d: number; miss_7d: number; hit_rate_7d: number; entries: number; total_hits: number };
  strategies: { total: number; mined_7d: number; injected_7d: number; used_success_7d: number; used_fail_7d: number; top: any[] };
  recent_events: any[];
  event_counts_7d: Record<string, number>;
}

interface Strategy {
  id: string; title: string; when_to_use: string; content: string[]; pitfalls: string[]; tags: string[];
  scope: string; user_id: string; project: string; use_count: number; success_count: number; fail_count: number;
  created_at: number; updated_at: number; similarity?: number;
}

interface CacheEntry {
  id: number; prompt: string; response_preview: string; model: string; provider: string;
  user_id: string; scope: string; hit_count: number; created_at: number; expires_at: number;
}

interface Settings {
  cacheEnabled: boolean; cacheTtlHours: number; cacheSimilarityThreshold: number;
  scope: string; miningEnabled: boolean; miningThrottlePerHour: number; miningModel: string;
  injectionEnabled: boolean; injectionTopK: number;
}

async function fetchJson(url: string, opts?: RequestInit): Promise<any> {
  const r = await fetch(url, { credentials: "include", ...opts });
  const d = await r.json();
  if (!r.ok) throw new Error((d as any)?.error || `HTTP ${r.status}`);
  return d;
}

function ago(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return s + "s";
  if (s < 3600) return Math.floor(s/60) + "m";
  if (s < 86400) return Math.floor(s/3600) + "h";
  return Math.floor(s/86400) + "d";
}

export function AdminBrain() {
  const [tab, setTab] = useState("overview");
  return (
    <Stack gap="lg">
      <Group gap="xs" align="center">
        <ThemeIcon variant="light" radius="md" size="lg" color="grape"><IconBrain size={20} /></ThemeIcon>
        <Title order={3}>Brain</Title>
        <Badge size="xs" variant="light" color="grape">Second Brain extension</Badge>
      </Group>
      <Text size="sm" c="dimmed">
        Observability + control for semantic cache and strategy memory.
        Cache hits skip upstream entirely. Strategies injected into non-Anthropic requests.
      </Text>
      <Tabs value={tab} onChange={v => setTab(v || "overview")} variant="pills">
        <Tabs.List>
          <Tabs.Tab value="overview"   leftSection={<IconChartBar size={14} />}>Overview</Tabs.Tab>
          <Tabs.Tab value="strategies" leftSection={<IconBolt size={14} />}>Strategies</Tabs.Tab>
          <Tabs.Tab value="cache"      leftSection={<IconDatabase size={14} />}>Cache</Tabs.Tab>
          <Tabs.Tab value="settings"   leftSection={<IconAdjustments size={14} />}>Settings</Tabs.Tab>
        </Tabs.List>
        <Box mt="md">
          {tab === "overview"   && <OverviewPanel />}
          {tab === "strategies" && <StrategiesPanel />}
          {tab === "cache"      && <CachePanel />}
          {tab === "settings"   && <SettingsPanel />}
        </Box>
      </Tabs>
    </Stack>
  );
}

function OverviewPanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    try { setData(await fetchJson("/api/admin/second-brain/overview")); setError(null); }
    catch (e: any) { setError(e.message); }
  };
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);
  if (error) return <Alert color="red" icon={<IconAlertCircle size={16} />}>{error}</Alert>;
  if (!data) return <Center py="xl"><Loader size="sm" /></Center>;
  const c = data.cache, s = data.strategies;
  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        <Stat label="Cache hit rate (7d)" value={(c.hit_rate_7d * 100).toFixed(1) + "%"} sub={`${c.hits_7d} hits / ${c.miss_7d} miss`} color="teal" />
        <Stat label="Cache entries" value={c.entries.toLocaleString()} sub={`${c.total_hits.toLocaleString()} total hits`} color="blue" />
        <Stat label="Strategies" value={s.total.toLocaleString()} sub={`+${s.mined_7d} mined (7d)`} color="grape" />
        <Stat label="Injected (7d)" value={s.injected_7d.toLocaleString()} sub={`success ${s.used_success_7d} · fail ${s.used_fail_7d}`} color="violet" />
      </SimpleGrid>
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" mb="sm">
          <Text fw={600}>Top strategies (by use_count)</Text>
          <Button size="xs" variant="default" leftSection={<IconRefresh size={12} />} onClick={load}>Refresh</Button>
        </Group>
        {!s.top.length ? <Text c="dimmed" size="sm">No strategies yet. Run successful sessions to mine them.</Text> : (
          <ScrollArea h={280}>
            <Table striped highlightOnHover withColumnBorders={false} verticalSpacing="xs" fz="xs">
              <Table.Thead>
                <Table.Tr><Table.Th>Title</Table.Th><Table.Th>User</Table.Th><Table.Th>Use</Table.Th><Table.Th>Success</Table.Th><Table.Th>Fail</Table.Th></Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {s.top.map((r: any) => (
                  <Table.Tr key={r.id}>
                    <Table.Td><Text fw={500} size="xs">{r.title}</Text><Text c="dimmed" size="xs">{r.when_to_use?.slice(0, 80)}</Text></Table.Td>
                    <Table.Td><Text size="xs" c="dimmed">{r.user_id || "(shared)"}</Text></Table.Td>
                    <Table.Td>{r.use_count}</Table.Td>
                    <Table.Td><Text c="teal" size="xs">{r.success_count}</Text></Table.Td>
                    <Table.Td><Text c="red" size="xs">{r.fail_count}</Text></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </Paper>
      <Paper withBorder p="md" radius="md">
        <Group gap="xs" mb="sm"><IconHistory size={14} /><Text fw={600}>Recent events (7d)</Text></Group>
        {!data.recent_events.length ? <Text c="dimmed" size="sm">No events yet.</Text> : (
          <ScrollArea h={300}>
            <Stack gap="xs">
              {data.recent_events.map((e, i) => (
                <Group key={i} gap="sm" wrap="nowrap" align="flex-start">
                  <Badge size="xs" variant="light" color={eventColor(e.event_type)}>{e.event_type}</Badge>
                  <Text size="xs" c="dimmed" style={{ minWidth: 40 }}>{ago(e.ts)}</Text>
                  <Text size="xs" c="dimmed" style={{ minWidth: 80 }}>{e.user_id || "-"}</Text>
                  <Code fz="xs" style={{ flex: 1, wordBreak: "break-all" }}>{JSON.stringify(e.detail).slice(0, 200)}</Code>
                </Group>
              ))}
            </Stack>
          </ScrollArea>
        )}
      </Paper>
    </Stack>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <Paper withBorder p="md" radius="md">
      <Text size="xs" c="dimmed" fw={500}>{label}</Text>
      <Text fw={700} size="xl" c={color}>{value}</Text>
      <Text size="xs" c="dimmed">{sub}</Text>
    </Paper>
  );
}

function eventColor(t: string): string {
  if (t.includes("hit")) return "teal";
  if (t.includes("miss")) return "gray";
  if (t.includes("strategy_injected")) return "violet";
  if (t.includes("success")) return "teal";
  if (t.includes("fail")) return "red";
  if (t.startsWith("mine_")) return "grape";
  return "gray";
}

function StrategiesPanel() {
  const [rows, setRows] = useState<Strategy[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try { const d = await fetchJson("/api/admin/second-brain/strategies?q=" + encodeURIComponent(q)); setRows(d.strategies || []); }
    catch (e: any) { notifications.show({ color: "red", message: e.message }); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const del = async (id: string) => {
    if (!confirm("Delete strategy?")) return;
    await fetchJson(`/api/admin/second-brain/strategies/${id}/delete`, { method: "POST" });
    load();
  };
  return (
    <Stack gap="md">
      <Group>
        <input
          placeholder="Semantic search by query..."
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === "Enter" && load()}
          style={{ flex: 1, padding: "8px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 13 }}
        />
        <Button size="xs" onClick={load} loading={loading}>Search</Button>
      </Group>
      {!rows.length && !loading && <Text c="dimmed" ta="center" py="xl">No strategies found.</Text>}
      <Stack gap="sm">
        {rows.map(s => (
          <Paper key={s.id} withBorder p="md" radius="md">
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Box style={{ flex: 1, minWidth: 0 }}>
                <Group gap="xs" mb={4}>
                  <Text fw={600} size="sm">{s.title}</Text>
                  {s.similarity !== undefined && <Badge size="xs" variant="light" color="grape">sim {(s.similarity * 100).toFixed(0)}%</Badge>}
                  <Badge size="xs" variant="light" color="gray">{s.scope}</Badge>
                  <Badge size="xs" variant="light">use {s.use_count}</Badge>
                  <Badge size="xs" variant="light" color="teal">ok {s.success_count}</Badge>
                  <Badge size="xs" variant="light" color="red">fail {s.fail_count}</Badge>
                </Group>
                <Text size="xs" c="dimmed" mb={4}>When: {s.when_to_use}</Text>
                {s.content?.length > 0 && (
                  <Text size="xs" component="div" mt={4}>
                    <b>Steps:</b>
                    <ul style={{ margin: "4px 0", paddingLeft: 20 }}>{s.content.map((step, i) => <li key={i}>{step}</li>)}</ul>
                  </Text>
                )}
                {s.pitfalls?.length > 0 && (
                  <Text size="xs" c="red" component="div">
                    <b>Pitfalls:</b>
                    <ul style={{ margin: "4px 0", paddingLeft: 20 }}>{s.pitfalls.map((p, i) => <li key={i}>{p}</li>)}</ul>
                  </Text>
                )}
                <Group gap={4} mt={6}>{s.tags?.map(t => <Badge key={t} size="xs" variant="dot">{t}</Badge>)}</Group>
              </Box>
              <Tooltip label="Delete">
                <ActionIcon color="red" variant="subtle" onClick={() => del(s.id)}><IconTrash size={14} /></ActionIcon>
              </Tooltip>
            </Group>
          </Paper>
        ))}
      </Stack>
    </Stack>
  );
}

function CachePanel() {
  const [rows, setRows] = useState<CacheEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try { const d = await fetchJson("/api/admin/second-brain/cache"); setRows(d.entries || []); }
    catch (e: any) { notifications.show({ color: "red", message: e.message }); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const clear = async (expiredOnly: boolean) => {
    if (!confirm(expiredOnly ? "Clear expired cache entries?" : "Clear ALL cache entries?")) return;
    await fetchJson("/api/admin/second-brain/cache/clear", { method: "POST", body: JSON.stringify({ expired_only: expiredOnly }), headers: { "Content-Type": "application/json" } });
    notifications.show({ color: "teal", message: "Cache cleared" });
    load();
  };
  const backfill = async () => {
    if (!confirm("Backfill 500 recent request_logs into cache?")) return;
    await fetchJson("/api/admin/second-brain/backfill", { method: "POST", body: JSON.stringify({ limit: 500 }), headers: { "Content-Type": "application/json" } });
    notifications.show({ color: "blue", message: "Backfill scheduled in background — refresh in ~30s" });
  };
  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text fw={600}>{rows.length} cache entries (latest 50)</Text>
        <Group gap="xs">
          <Button size="xs" variant="default" leftSection={<IconRefresh size={12} />} onClick={load} loading={loading}>Refresh</Button>
          <Button size="xs" variant="default" leftSection={<IconDownload size={12} />} onClick={backfill}>Backfill 500</Button>
          <Button size="xs" color="orange" variant="light" onClick={() => clear(true)}>Clear expired</Button>
          <Button size="xs" color="red" variant="light" leftSection={<IconTrash size={12} />} onClick={() => clear(false)}>Clear ALL</Button>
        </Group>
      </Group>
      <ScrollArea h={500}>
        <Table striped highlightOnHover verticalSpacing="xs" fz="xs">
          <Table.Thead>
            <Table.Tr><Table.Th>Prompt</Table.Th><Table.Th>Model</Table.Th><Table.Th>User</Table.Th><Table.Th>Hits</Table.Th><Table.Th>Age</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map(r => (
              <Table.Tr key={r.id}>
                <Table.Td><Text size="xs" lineClamp={2}>{r.prompt}</Text></Table.Td>
                <Table.Td><Badge size="xs" variant="light">{r.model}</Badge></Table.Td>
                <Table.Td><Text size="xs" c="dimmed">{r.user_id || "-"}</Text></Table.Td>
                <Table.Td><Text size="xs">{r.hit_count}</Text></Table.Td>
                <Table.Td><Text size="xs" c="dimmed">{ago(r.created_at)}</Text></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea>
    </Stack>
  );
}

function SettingsPanel() {
  const [cfg, setCfg] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const load = async () => {
    const d = await fetchJson("/api/admin/second-brain/settings");
    setCfg(d.config);
  };
  useEffect(() => { load(); }, []);
  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      await fetchJson("/api/admin/second-brain/settings", { method: "POST", body: JSON.stringify(cfg), headers: { "Content-Type": "application/json" } });
      notifications.show({ color: "teal", message: "Settings saved" });
    } catch (e: any) { notifications.show({ color: "red", message: e.message }); }
    finally { setSaving(false); }
  };
  if (!cfg) return <Center py="xl"><Loader size="sm" /></Center>;
  return (
    <Stack gap="md" maw={600}>
      <Paper withBorder p="md" radius="md">
        <Text fw={600} mb="sm">Cache (Lapis 1)</Text>
        <Stack gap="sm">
          <Switch label="Enabled" checked={cfg.cacheEnabled} onChange={e => setCfg({ ...cfg, cacheEnabled: e.currentTarget.checked })} />
          <NumberInput label="TTL (hours)" min={1} max={2160} value={cfg.cacheTtlHours} onChange={v => setCfg({ ...cfg, cacheTtlHours: Number(v) || 168 })} />
          <NumberInput label="Similarity threshold" min={0.5} max={1} step={0.01} decimalScale={2} value={cfg.cacheSimilarityThreshold} onChange={v => setCfg({ ...cfg, cacheSimilarityThreshold: Number(v) || 0.92 })} />
        </Stack>
      </Paper>
      <Paper withBorder p="md" radius="md">
        <Text fw={600} mb="sm">Strategy mining (Lapis 2)</Text>
        <Stack gap="sm">
          <Switch label="Enabled" checked={cfg.miningEnabled} onChange={e => setCfg({ ...cfg, miningEnabled: e.currentTarget.checked })} />
          <NumberInput label="Throttle: max jobs / hour / user" min={1} max={200} value={cfg.miningThrottlePerHour} onChange={v => setCfg({ ...cfg, miningThrottlePerHour: Number(v) || 20 })} />
          <Select label="Mining model" data={["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-7"]} value={cfg.miningModel} onChange={v => v && setCfg({ ...cfg, miningModel: v })} />
        </Stack>
      </Paper>
      <Paper withBorder p="md" radius="md">
        <Text fw={600} mb="sm">Strategy injection (Lapis 2.5)</Text>
        <Stack gap="sm">
          <Switch label="Inject into non-Anthropic requests" checked={cfg.injectionEnabled} onChange={e => setCfg({ ...cfg, injectionEnabled: e.currentTarget.checked })} />
          <NumberInput label="Top-K strategies" min={1} max={10} value={cfg.injectionTopK} onChange={v => setCfg({ ...cfg, injectionTopK: Number(v) || 3 })} />
        </Stack>
      </Paper>
      <Paper withBorder p="md" radius="md">
        <Text fw={600} mb="sm">Scope</Text>
        <Select label="Strategy + cache scope" data={[
          { value: "user", label: "Per-user (private)" },
          { value: "shared", label: "Shared (all users see all)" },
        ]} value={cfg.scope} onChange={v => v && setCfg({ ...cfg, scope: v })} />
      </Paper>
      <Button onClick={save} loading={saving}>Save settings</Button>
    </Stack>
  );
}
