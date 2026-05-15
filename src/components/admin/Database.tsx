import { useState, useEffect } from "react";
import {
  Stack, Paper, Group, Text, Button, Badge, TextInput,
  ThemeIcon, Box, Alert, Code, Checkbox, SimpleGrid,
  Loader, CopyButton, ActionIcon, Tooltip, NumberInput, RingProgress,
  Progress,
} from "@mantine/core";
import {
  IconDatabase, IconDownload, IconRefresh,
  IconAlertTriangle, IconCheck, IconCopy, IconKey,
  IconTrash, IconInfoCircle, IconShieldCheck, IconClock, IconScissors,
  IconArrowRight, IconCloudDownload,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SyncTokenInfo { token: string; created_at: string; }
interface SyncStats {
  users?: number; tokens?: number; request_logs?: number;
  daily_usage?: number; upstream_state?: number;
  settings?: number;
}
interface DbStats { rows: number; size_bytes: string; rows_with_messages: number; }

const ALL_TABLES = ["users", "tokens", "request_logs", "daily_usage", "upstream_state", "settings"] as const;
type TableName = typeof ALL_TABLES[number];

const TABLE_LABELS: Record<TableName, { label: string; desc: string; risk: "low" | "med" | "high" }> = {
  users:          { label: "Users",          desc: "User accounts & roles",         risk: "med"  },
  tokens:         { label: "Tokens",         desc: "API keys & quota config",       risk: "high" },
  request_logs:   { label: "Request Logs",   desc: "Up to 10,000 recent requests",  risk: "low"  },
  daily_usage:    { label: "Daily Usage",    desc: "Per-token daily counters",       risk: "low"  },
  upstream_state: { label: "Upstream State", desc: "Claude quota snapshot",         risk: "low"  },
  settings:       { label: "Settings",       desc: "App settings",                  risk: "med"  },
};

const RISK_COLOR = { low: "teal", med: "yellow", high: "red" } as const;

function fmtBytes(bytes: number) {
  if (bytes >= 1_073_741_824) return (bytes / 1_073_741_824).toFixed(2) + " GB";
  if (bytes >= 1_048_576)     return (bytes / 1_048_576).toFixed(1) + " MB";
  return (bytes / 1024).toFixed(0) + " KB";
}

function fmtCreated(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " +
         d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ── Section: Generate sync token ─────────────────────────────────────────────

function GenerateTokenSection() {
  const [loading, setLoading]           = useState(false);
  const [token, setToken]               = useState<string | null>(null);
  const [activeTokens, setActiveTokens] = useState<SyncTokenInfo[]>([]);
  const [loadingList, setLoadingList]   = useState(false);

  const loadTokens = async () => {
    setLoadingList(true);
    try {
      const r = await fetch("/api/admin/db/sync-tokens");
      const d = await r.json() as { tokens: SyncTokenInfo[] };
      setActiveTokens(d.tokens || []);
    } finally { setLoadingList(false); }
  };

  useEffect(() => { loadTokens(); }, []);

  const generate = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/db/generate-sync-token", { method: "POST" });
      const d = await r.json() as { token: string; created_at: string };
      setToken(d.token);
      loadTokens();
    } catch {
      notifications.show({ color: "red", message: "Failed to generate token", autoClose: 3000 });
    } finally { setLoading(false); }
  };

  const revoke = async (tok: string) => {
    try {
      await fetch("/api/admin/db/revoke-sync-token", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tok }),
      });
      if (token === tok) setToken(null);
      loadTokens();
    } catch {
      notifications.show({ color: "red", message: "Failed to revoke token", autoClose: 3000 });
    }
  };

  return (
    <Paper withBorder p="lg" radius="md">
      <Group gap="sm" mb="lg">
        <ThemeIcon variant="light" color="blue" size="lg" radius="md"><IconKey size={18} /></ThemeIcon>
        <div>
          <Text fw={700} size="sm">Generate Sync Token</Text>
          <Text size="xs" c="dimmed">Token untuk instance lain pull data dari sini — persist sampai dihapus manual</Text>
        </div>
      </Group>

      <Button leftSection={<IconKey size={14} />} onClick={generate} loading={loading} size="sm" mb="md" variant="light">
        Generate New Token
      </Button>

      {token && (
        <Alert color="blue" variant="light" icon={<IconShieldCheck size={16} />} mb="md" radius="md">
          <Text size="xs" fw={600} mb={6}>Token baru:</Text>
          <Group gap="xs" wrap="nowrap">
            <Code style={{ flex: 1, wordBreak: "break-all", fontSize: 11 }}>{token}</Code>
            <CopyButton value={token}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? "Copied!" : "Copy"} withArrow>
                  <ActionIcon variant="light" color={copied ? "teal" : "blue"} size="sm" onClick={copy}>
                    {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          </Group>
        </Alert>
      )}

      <Group justify="space-between" mb={6}>
        <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: ".06em" }}>Active Tokens</Text>
        <ActionIcon variant="subtle" size="sm" onClick={loadTokens} loading={loadingList}><IconRefresh size={13} /></ActionIcon>
      </Group>
      {activeTokens.length === 0 ? (
        <Text size="xs" c="dimmed" fs="italic">No active tokens</Text>
      ) : (
        <Stack gap={6}>
          {activeTokens.map((t, i) => (
            <Group key={i} gap="xs" wrap="nowrap" style={{ background: "var(--mantine-color-default-hover)", borderRadius: 6, padding: "6px 10px" }}>
              <Code style={{ flex: 1, fontSize: 11, wordBreak: "break-all" }}>{t.token}</Code>
              <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>{fmtCreated(t.created_at)}</Text>
              <CopyButton value={t.token}>
                {({ copied, copy }) => (
                  <Tooltip label={copied ? "Copied!" : "Copy"} withArrow>
                    <ActionIcon variant="subtle" color={copied ? "teal" : "gray"} size="sm" onClick={copy}>
                      {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
              <Tooltip label="Revoke" withArrow>
                <ActionIcon variant="subtle" color="red" size="sm" onClick={() => revoke(t.token)}>
                  <IconTrash size={13} />
                </ActionIcon>
              </Tooltip>
            </Group>
          ))}
        </Stack>
      )}
    </Paper>
  );
}

// ── Section: Sync from remote ─────────────────────────────────────────────────

function SyncFromRemoteSection() {
  const [url, setUrl]       = useState(() => { try { return localStorage.getItem("db-sync-url") || ""; } catch { return ""; } });
  const [token, setToken]   = useState("");
  const [tables, setTables] = useState<Set<TableName>>(new Set(ALL_TABLES));
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<{ ok: boolean; stats?: SyncStats; error?: string; synced_at?: string; source?: string } | null>(null);

  const toggleTable = (t: TableName) => setTables(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n; });

  const run = async () => {
    if (!url.trim() || !token.trim()) { notifications.show({ color: "orange", message: "URL dan token wajib diisi", autoClose: 3000 }); return; }
    if (tables.size === 0) { notifications.show({ color: "orange", message: "Pilih minimal satu tabel", autoClose: 3000 }); return; }
    setLoading(true); setResult(null);
    try { localStorage.setItem("db-sync-url", url.trim()); } catch {}
    try {
      const r = await fetch("/api/admin/db/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), token: token.trim(), tables: [...tables] }),
      });
      const d = await r.json() as typeof result;
      setResult(d);
      if (d?.ok) { notifications.show({ color: "teal", message: "Sync berhasil!", autoClose: 3000 }); setToken(""); }
      else        { notifications.show({ color: "red",  message: d?.error || "Sync failed", autoClose: 5000 }); }
    } catch (e: any) {
      setResult({ ok: false, error: e.message });
      notifications.show({ color: "red", message: e.message, autoClose: 5000 });
    } finally { setLoading(false); }
  };

  return (
    <Paper withBorder p="lg" radius="md">
      <Group gap="sm" mb="lg">
        <ThemeIcon variant="light" color="teal" size="lg" radius="md"><IconCloudDownload size={18} /></ThemeIcon>
        <div>
          <Text fw={700} size="sm">Sync from Remote</Text>
          <Text size="xs" c="dimmed">Pull data dari instance lain ke database lokal</Text>
        </div>
      </Group>

      <Alert color="orange" variant="light" icon={<IconAlertTriangle size={14} />} mb="md" radius="md">
        <Text size="xs"><b>Peringatan:</b> Sync akan <b>menghapus dan mengganti</b> data lokal sesuai tabel yang dipilih.</Text>
      </Alert>

      <Stack gap="sm" mb="md">
        <TextInput label="Remote URL" placeholder="https://claude-proxy.wibudev.com"
          value={url} onChange={e => setUrl(e.currentTarget.value)}
          leftSection={<IconDatabase size={14} />} size="sm" />
        <TextInput label="Sync Token" placeholder="sync-xxxxxxxx…"
          value={token} onChange={e => setToken(e.currentTarget.value)}
          leftSection={<IconKey size={14} />} type="password" size="sm" />
      </Stack>

      <Box mb="md">
        <Group justify="space-between" mb="xs">
          <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: ".06em" }}>Tabel</Text>
          <Group gap="xs">
            <Button variant="subtle" size="xs" onClick={() => setTables(new Set(ALL_TABLES))}>All</Button>
            <Button variant="subtle" size="xs" color="gray" onClick={() => setTables(new Set())}>None</Button>
          </Group>
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
          {ALL_TABLES.map(t => {
            const meta = TABLE_LABELS[t];
            return (
              <Box key={t} onClick={() => toggleTable(t)} style={{
                cursor: "pointer", padding: "8px 10px", borderRadius: 8,
                border: `1px solid ${tables.has(t) ? "var(--mantine-color-blue-4)" : "var(--mantine-color-default-border)"}`,
                background: tables.has(t) ? "var(--mantine-color-blue-light)" : undefined,
                transition: "all 0.12s ease",
              }}>
                <Group gap="xs" wrap="nowrap">
                  <Checkbox checked={tables.has(t)} onChange={() => toggleTable(t)} size="xs" onClick={e => e.stopPropagation()} />
                  <Box style={{ flex: 1, minWidth: 0 }}>
                    <Group gap={5}>
                      <Text size="xs" fw={600}>{meta.label}</Text>
                      <Badge size="xs" color={RISK_COLOR[meta.risk]} variant="light">{meta.risk}</Badge>
                    </Group>
                    <Text size="xs" c="dimmed">{meta.desc}</Text>
                  </Box>
                </Group>
              </Box>
            );
          })}
        </SimpleGrid>
      </Box>

      <Button leftSection={<IconArrowRight size={14} />} onClick={run} loading={loading}
        disabled={!url.trim() || !token.trim() || tables.size === 0}
        color="teal" size="sm" fullWidth variant="light">
        {loading ? "Syncing…" : `Sync ${tables.size} table${tables.size !== 1 ? "s" : ""}`}
      </Button>

      {result && (
        <Alert mt="md" color={result.ok ? "teal" : "red"} variant="light"
          icon={result.ok ? <IconCheck size={14} /> : <IconAlertTriangle size={14} />} radius="md">
          {result.ok ? (
            <>
              <Text size="xs" fw={600} mb={6}>Sync berhasil dari {result.source}</Text>
              <SimpleGrid cols={2} spacing={4}>
                {Object.entries(result.stats || {}).map(([tbl, count]) => (
                  <Group key={tbl} gap={4}>
                    <Text size="xs" c="dimmed">{TABLE_LABELS[tbl as TableName]?.label ?? tbl}:</Text>
                    <Text size="xs" fw={600} ff="monospace">{(count as number).toLocaleString()}</Text>
                  </Group>
                ))}
              </SimpleGrid>
            </>
          ) : (
            <Text size="xs">{result.error}</Text>
          )}
        </Alert>
      )}
    </Paper>
  );
}

// ── Section: Retention ────────────────────────────────────────────────────────

function RetentionSection() {
  const [logDays, setLogDays]         = useState<number>(30);
  const [msgDays, setMsgDays]         = useState<number>(7);
  const [loading, setLoading]         = useState(false);
  const [pruning, setPruning]         = useState(false);
  const [result, setResult]           = useState<{ deleted: number; stripped: number } | null>(null);
  const [stats, setStats]             = useState<DbStats | null>(null);
  const [statsBefore, setStatsBefore] = useState<DbStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const loadStats = async () => {
    setStatsLoading(true);
    try {
      const r = await fetch("/api/admin/db/stats");
      if (r.ok) setStats(await r.json());
    } finally { setStatsLoading(false); }
  };

  useEffect(() => {
    fetch("/api/admin/db/retention").then(r => r.json())
      .then((d: any) => { setLogDays(d.log_retention_days); setMsgDays(d.msg_retention_days); })
      .catch(() => {});
    loadStats();
  }, []);

  const save = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/db/retention", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ log_retention_days: logDays, msg_retention_days: msgDays }),
      });
      const d = await r.json() as any;
      if (d.ok) notifications.show({ color: "teal", message: "Retention settings saved", autoClose: 3000 });
      else       notifications.show({ color: "red",  message: "Failed to save", autoClose: 3000 });
    } finally { setLoading(false); }
  };

  const prune = async () => {
    if (!confirm("Jalankan prune sekarang? Rows lama akan dihapus permanen.")) return;
    setPruning(true); setResult(null); setStatsBefore(stats);
    try {
      const r = await fetch("/api/admin/db/prune", { method: "POST" });
      const d = await r.json() as any;
      setResult(d);
      await loadStats();
      notifications.show({ color: "teal", message: `Pruned: ${d.deleted} deleted, ${d.stripped} stripped`, autoClose: 5000 });
    } finally { setPruning(false); }
  };

  const sizeBytes  = stats ? parseInt(stats.size_bytes) : 0;
  // Gauge: 0–500MB range for ring
  const gaugeMax   = 500 * 1_048_576;
  const gaugePct   = Math.min(100, Math.round((sizeBytes / gaugeMax) * 100));
  const gaugeColor = gaugePct >= 80 ? "red" : gaugePct >= 50 ? "orange" : "teal";
  const msgPct     = stats && stats.rows > 0
    ? Math.round((stats.rows_with_messages / stats.rows) * 100) : 0;

  return (
    <Paper withBorder p="lg" radius="md">
      <Group gap="sm" mb="lg">
        <ThemeIcon variant="light" color="orange" size="lg" radius="md"><IconClock size={18} /></ThemeIcon>
        <div>
          <Text fw={700} size="sm">Log Retention</Text>
          <Text size="xs" c="dimmed">Atur berapa lama data request log disimpan</Text>
        </div>
        <ActionIcon size="sm" variant="subtle" color="gray" onClick={loadStats} loading={statsLoading} ml="auto">
          <IconRefresh size={13} />
        </ActionIcon>
      </Group>

      {/* ── DB Stats ── */}
      {stats ? (
        <Box mb="md" style={{ background: "var(--mantine-color-default-hover)", borderRadius: 10, padding: "14px 16px" }}>
          <Group justify="space-between" align="flex-start" wrap="nowrap">
            {/* Ring gauge */}
            <Group gap="md" align="center" wrap="nowrap">
              <RingProgress size={80} thickness={7} roundCaps
                sections={[{ value: gaugePct, color: gaugeColor }]}
                label={
                  <Text fz={11} fw={700} ta="center" ff="monospace" c={gaugeColor}>
                    {fmtBytes(sizeBytes)}
                  </Text>
                }
              />
              <Stack gap={4}>
                <Box>
                  <Text size="xs" c="dimmed">Total rows</Text>
                  <Text size="sm" fw={700} ff="monospace">{stats.rows.toLocaleString()}</Text>
                </Box>
                <Box>
                  <Text size="xs" c="dimmed">Size on disk</Text>
                  <Text size="sm" fw={700} ff="monospace">{fmtBytes(sizeBytes)}</Text>
                </Box>
              </Stack>
            </Group>
            {/* Message detail */}
            <Stack gap={6} style={{ minWidth: 140 }}>
              <Box>
                <Group justify="space-between" mb={4}>
                  <Text size="xs" c="dimmed">With conversation</Text>
                  <Text size="xs" fw={600} ff="monospace">{msgPct}%</Text>
                </Group>
                <Progress value={msgPct} color={msgPct > 60 ? "orange" : "blue"} size="sm" radius="xl" />
                <Text size="xs" c="dimmed" mt={4}>{stats.rows_with_messages.toLocaleString()} / {stats.rows.toLocaleString()} rows</Text>
              </Box>
            </Stack>
          </Group>
        </Box>
      ) : (
        <Box mb="md" style={{ background: "var(--mantine-color-default-hover)", borderRadius: 10, padding: "14px 16px" }}>
          <Group gap={8}><Loader size={12} /><Text size="xs" c="dimmed">Loading stats…</Text></Group>
        </Box>
      )}

      <Stack gap="md">
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <NumberInput
            label="Simpan log (hari)"
            description={`${logDays} hari terakhir dipertahankan — lebih lama dihapus`}
            value={logDays} onChange={v => setLogDays(Number(v) || 30)}
            min={1} max={365} leftSection={<IconTrash size={14} />} size="sm"
          />
          <NumberInput
            label="Simpan conversation (hari)"
            description={`messages_json di-strip setelah ${msgDays} hari`}
            value={msgDays} onChange={v => setMsgDays(Number(v) || 7)}
            min={1} max={90} leftSection={<IconScissors size={14} />} size="sm"
          />
        </SimpleGrid>

        <Alert color="blue" variant="light" icon={<IconInfoCircle size={14} />} radius="md">
          <Text size="xs">
            Auto-prune berjalan tiap <b>24 jam</b>. Data hari ini selalu aman — prune hanya menghapus data <b>di luar window</b> yang dikonfigurasi.
          </Text>
        </Alert>

        <Group gap="sm">
          <Button size="sm" onClick={save} loading={loading} leftSection={<IconCheck size={14} />}>
            Simpan
          </Button>
          <Button size="sm" variant="light" color="orange" onClick={prune} loading={pruning}
            leftSection={<IconScissors size={14} />}>
            Prune Sekarang
          </Button>
        </Group>

        {result && (
          <Alert color="teal" variant="light" icon={<IconCheck size={14} />} radius="md">
            <Text size="xs" fw={600} mb={8}>Prune selesai</Text>
            <SimpleGrid cols={2} spacing="xs">
              <Box>
                <Text size="xs" c="dimmed">Rows dihapus</Text>
                <Text size="sm" fw={700} ff="monospace" c="red">{result.deleted.toLocaleString()}</Text>
              </Box>
              <Box>
                <Text size="xs" c="dimmed">Conversation di-strip</Text>
                <Text size="sm" fw={700} ff="monospace" c="orange">{result.stripped.toLocaleString()}</Text>
              </Box>
              {statsBefore && stats && (
                <>
                  <Box>
                    <Text size="xs" c="dimmed">Rows</Text>
                    <Group gap={4} align="center">
                      <Text size="sm" fw={600} ff="monospace">{statsBefore.rows.toLocaleString()}</Text>
                      <IconArrowRight size={12} color="var(--mantine-color-dimmed)" />
                      <Text size="sm" fw={700} ff="monospace" c="teal">{stats.rows.toLocaleString()}</Text>
                    </Group>
                  </Box>
                  <Box>
                    <Text size="xs" c="dimmed">Size</Text>
                    <Group gap={4} align="center">
                      <Text size="sm" fw={600} ff="monospace">{fmtBytes(parseInt(statsBefore.size_bytes))}</Text>
                      <IconArrowRight size={12} color="var(--mantine-color-dimmed)" />
                      <Text size="sm" fw={700} ff="monospace" c="teal">{fmtBytes(parseInt(stats.size_bytes))}</Text>
                    </Group>
                  </Box>
                </>
              )}
            </SimpleGrid>
          </Alert>
        )}
      </Stack>
    </Paper>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function AdminDatabase() {
  return (
    <Stack gap="xl">
      {/* Page header */}
      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" wrap="wrap" gap="sm">
          <div>
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }} mb={4}>Database</Text>
            <Text size="xl" fw={800} ff="monospace">DB Management</Text>
            <Text size="sm" c="dimmed" mt={2}>Sync antar instance · retention & pruning · storage monitoring</Text>
          </div>
          <Group gap="xs">
            <Badge variant="light" color="blue" leftSection={<IconDatabase size={11} />}>PostgreSQL</Badge>
            <Badge variant="light" color="gray" leftSection={<IconInfoCircle size={11} />}>stg ↔ dev</Badge>
          </Group>
        </Group>
      </Paper>

      {/* Sync section */}
      <Box>
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }} mb="sm">DB Sync</Text>
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
          <GenerateTokenSection />
          <SyncFromRemoteSection />
        </SimpleGrid>
      </Box>

      {/* Retention section */}
      <Box>
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }} mb="sm">Storage & Retention</Text>
        <RetentionSection />
      </Box>
    </Stack>
  );
}
