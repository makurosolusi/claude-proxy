import { useEffect, useState } from "react";
import {
  Stack, Group, Text, Title, Paper, Badge, Loader, Center, ThemeIcon, Box,
  SimpleGrid, Tabs, Switch, NumberInput, Select, Button, Table, ScrollArea,
  Alert, ActionIcon, Tooltip, Code,
} from "@mantine/core";
import {
  IconBrain, IconRefresh, IconTrash, IconBolt, IconHistory, IconChartBar,
  IconAdjustments, IconAlertCircle,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";

interface Overview {
  strategies: { total: number; mined_7d: number; injected_7d: number; used_success_7d: number; used_fail_7d: number; top: any[] };
  recent_events: any[];
  event_counts_7d: Record<string, number>;
}

interface Strategy {
  id: string; title: string; when_to_use: string; content: string[]; pitfalls: string[]; tags: string[];
  scope: string; user_id: string; project: string; use_count: number; success_count: number; fail_count: number;
  created_at: number; updated_at: number; similarity?: number;
}

interface Settings {
  scope: string; miningEnabled: boolean; miningThrottlePerHour: number; miningModel: string;
  miningProvider?: "auto" | "anthropic" | "openrouter" | "deepseek";
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
        Mines strategies from successful sessions and injects relevant ones into non-Anthropic requests.
      </Text>
      <Tabs value={tab} onChange={v => setTab(v || "overview")} variant="pills">
        <Tabs.List>
          <Tabs.Tab value="overview"   leftSection={<IconChartBar size={14} />}>Overview</Tabs.Tab>
          <Tabs.Tab value="strategies" leftSection={<IconBolt size={14} />}>Strategies</Tabs.Tab>
          <Tabs.Tab value="settings"   leftSection={<IconAdjustments size={14} />}>Settings</Tabs.Tab>
        </Tabs.List>
        <Box mt="md">
          {tab === "overview"   && <OverviewPanel />}
          {tab === "strategies" && <StrategiesPanel />}
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
  const s = data.strategies;
  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        <Stat label="Strategies"    value={s.total.toLocaleString()}        sub={`+${s.mined_7d} mined (7d)`} color="grape" />
        <Stat label="Injected (7d)" value={s.injected_7d.toLocaleString()}  sub={`success ${s.used_success_7d} · fail ${s.used_fail_7d}`} color="violet" />
        <Stat label="Mined (7d)"    value={s.mined_7d.toLocaleString()}     sub="strategies distilled" color="teal" />
        <Stat label="Success rate"  value={s.used_success_7d + s.used_fail_7d ? ((s.used_success_7d / (s.used_success_7d + s.used_fail_7d)) * 100).toFixed(0) + "%" : "—"} sub="injected outcomes" color="blue" />
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
        <Text fw={600} mb="sm">Strategy mining</Text>
        <Stack gap="sm">
          <Switch label="Enabled" checked={cfg.miningEnabled} onChange={e => setCfg({ ...cfg, miningEnabled: e.currentTarget.checked })} />
          <NumberInput label="Throttle: max jobs / hour / user" min={1} max={200} value={cfg.miningThrottlePerHour} onChange={v => setCfg({ ...cfg, miningThrottlePerHour: Number(v) || 20 })} />
          <Select
            label="Mining provider"
            description="Auto = prefer Anthropic, fall through to OpenRouter then DeepSeek"
            data={[
              { value: "auto", label: "Auto (recommended)" },
              { value: "anthropic", label: "Anthropic / Claude" },
              { value: "openrouter", label: "OpenRouter" },
              { value: "deepseek", label: "DeepSeek" },
            ]}
            value={cfg.miningProvider || "auto"}
            onChange={v => v && setCfg({ ...cfg, miningProvider: v as any })}
          />
          <Select
            label="Mining model hint"
            description="Used when the provider matches the model's namespace; otherwise provider default applies"
            data={[
              "claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-7",
              "deepseek-v4-pro[1m]",
              "anthropic/claude-sonnet-4", "anthropic/claude-haiku-4-5",
            ]}
            value={cfg.miningModel}
            onChange={v => v && setCfg({ ...cfg, miningModel: v })}
          />
        </Stack>
      </Paper>
      <Paper withBorder p="md" radius="md">
        <Text fw={600} mb="sm">Strategy injection</Text>
        <Stack gap="sm">
          <Switch label="Inject into non-Anthropic requests" checked={cfg.injectionEnabled} onChange={e => setCfg({ ...cfg, injectionEnabled: e.currentTarget.checked })} />
          <NumberInput label="Top-K strategies" min={1} max={10} value={cfg.injectionTopK} onChange={v => setCfg({ ...cfg, injectionTopK: Number(v) || 3 })} />
        </Stack>
      </Paper>
      <Paper withBorder p="md" radius="md">
        <Text fw={600} mb="sm">Scope</Text>
        <Select label="Strategy scope" data={[
          { value: "user", label: "Per-user (private)" },
          { value: "shared", label: "Shared (all users see all)" },
        ]} value={cfg.scope} onChange={v => v && setCfg({ ...cfg, scope: v })} />
      </Paper>
      <Button onClick={save} loading={saving}>Save settings</Button>
    </Stack>
  );
}
