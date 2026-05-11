import { useState, useEffect } from "react";
import {
  Stack, Paper, Group, Text, Button, Badge, TextInput,
  ThemeIcon, Box, Divider, Alert, Code, Checkbox, SimpleGrid,
  Loader, CopyButton, ActionIcon, Tooltip,
} from "@mantine/core";
import {
  IconDatabase, IconDownload, IconUpload, IconRefresh,
  IconAlertTriangle, IconCheck, IconCopy, IconKey,
  IconTrash, IconInfoCircle, IconShieldCheck,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SyncTokenInfo {
  token: string;  // prefix only (masked)
  expires_at: string;
}

interface SyncStats {
  users?: number; tokens?: number; request_logs?: number;
  daily_usage?: number; upstream_state?: number;
  model_routes?: number; settings?: number;
}

const ALL_TABLES = ["users", "tokens", "request_logs", "daily_usage", "upstream_state", "model_routes", "settings"] as const;
type TableName = typeof ALL_TABLES[number];

const TABLE_LABELS: Record<TableName, { label: string; desc: string; risk: "low" | "med" | "high" }> = {
  users:          { label: "Users",          desc: "User accounts & roles",          risk: "med"  },
  tokens:         { label: "Tokens",         desc: "API keys & quota config",        risk: "high" },
  request_logs:   { label: "Request Logs",   desc: "Up to 10,000 recent requests",   risk: "low"  },
  daily_usage:    { label: "Daily Usage",    desc: "Per-token daily counters",        risk: "low"  },
  upstream_state: { label: "Upstream State", desc: "Claude quota snapshot",          risk: "low"  },
  model_routes:   { label: "Model Routes",   desc: "Fallback routing rules",         risk: "low"  },
  settings:       { label: "Settings",       desc: "App settings (deepseek, etc.)",  risk: "med"  },
};

const RISK_COLOR = { low: "teal", med: "yellow", high: "red" } as const;

// ── Section: Generate sync token (this instance = stg) ───────────────────────

function GenerateTokenSection() {
  const [loading, setLoading]     = useState(false);
  const [token, setToken]         = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [activeTokens, setActiveTokens] = useState<SyncTokenInfo[]>([]);
  const [loadingList, setLoadingList] = useState(false);

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
      const d = await r.json() as { token: string; expires_at: string };
      setToken(d.token);
      setExpiresAt(d.expires_at);
      loadTokens();
    } catch {
      notifications.show({ color: "red", message: "Failed to generate token", autoClose: 3000 });
    } finally { setLoading(false); }
  };

  const fmtExpiry = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + " (1 hour)";
  };

  return (
    <Paper withBorder p="lg" radius="md">
      <Group gap="sm" mb="md">
        <ThemeIcon variant="light" color="blue" size="lg" radius="md"><IconKey size={18} /></ThemeIcon>
        <div>
          <Text fw={700} size="sm">Generate Sync Token</Text>
          <Text size="xs" c="dimmed">Token ini dipakai oleh instance lain untuk pull data dari sini</Text>
        </div>
      </Group>

      <Button leftSection={<IconKey size={14} />} onClick={generate} loading={loading} size="sm" mb="md">
        Generate New Token
      </Button>

      {token && (
        <Alert color="blue" variant="light" icon={<IconShieldCheck size={16} />} mb="md">
          <Text size="xs" fw={600} mb={4}>Token baru — salin sekarang, tidak akan ditampilkan lagi:</Text>
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
          {expiresAt && (
            <Text size="xs" c="dimmed" mt={4}>Expires: {fmtExpiry(expiresAt)}</Text>
          )}
        </Alert>
      )}

      {/* Active tokens list */}
      <Group justify="space-between" mb="xs">
        <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: ".06em" }}>
          Active Tokens
        </Text>
        <ActionIcon variant="subtle" size="sm" onClick={loadTokens} loading={loadingList}>
          <IconRefresh size={13} />
        </ActionIcon>
      </Group>
      {activeTokens.length === 0 ? (
        <Text size="xs" c="dimmed">No active tokens</Text>
      ) : (
        <Stack gap={6}>
          {activeTokens.map((t, i) => (
            <Group key={i} gap="xs" wrap="nowrap">
              <Code style={{ flex: 1, fontSize: 11 }}>{t.token}</Code>
              <Text size="xs" c="dimmed">expires {new Date(t.expires_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
            </Group>
          ))}
        </Stack>
      )}
    </Paper>
  );
}

// ── Section: Sync from remote (this instance = dev) ───────────────────────────

function SyncFromRemoteSection() {
  const [url, setUrl]       = useState(() => { try { return localStorage.getItem("db-sync-url") || ""; } catch { return ""; } });
  const [token, setToken]   = useState("");
  const [tables, setTables] = useState<Set<TableName>>(new Set(ALL_TABLES));
  const [loading, setLoading]    = useState(false);
  const [result, setResult]      = useState<{ ok: boolean; stats?: SyncStats; error?: string; synced_at?: string; source?: string } | null>(null);

  const toggleTable = (t: TableName) => {
    setTables(prev => {
      const next = new Set(prev);
      next.has(t) ? next.delete(t) : next.add(t);
      return next;
    });
  };

  const syncAll = () => setTables(new Set(ALL_TABLES));
  const clearAll = () => setTables(new Set());

  const run = async () => {
    if (!url.trim() || !token.trim()) {
      notifications.show({ color: "orange", message: "URL dan token wajib diisi", autoClose: 3000 });
      return;
    }
    if (tables.size === 0) {
      notifications.show({ color: "orange", message: "Pilih minimal satu tabel", autoClose: 3000 });
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      localStorage.setItem("db-sync-url", url.trim());
    } catch {}
    try {
      const r = await fetch("/api/admin/db/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), token: token.trim(), tables: [...tables] }),
      });
      const d = await r.json() as typeof result;
      setResult(d);
      if (d?.ok) {
        notifications.show({ color: "teal", message: "Sync berhasil!", autoClose: 3000 });
        setToken(""); // clear token setelah sukses
      } else {
        notifications.show({ color: "red", message: d?.error || "Sync failed", autoClose: 5000 });
      }
    } catch (e: any) {
      setResult({ ok: false, error: e.message });
      notifications.show({ color: "red", message: e.message, autoClose: 5000 });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Paper withBorder p="lg" radius="md">
      <Group gap="sm" mb="md">
        <ThemeIcon variant="light" color="teal" size="lg" radius="md"><IconDownload size={18} /></ThemeIcon>
        <div>
          <Text fw={700} size="sm">Sync from Remote</Text>
          <Text size="xs" c="dimmed">Pull data dari instance lain (stg) ke database lokal ini</Text>
        </div>
      </Group>

      <Alert color="orange" variant="light" icon={<IconAlertTriangle size={14} />} mb="md">
        <Text size="xs">
          <b>Peringatan:</b> Sync akan <b>menghapus dan mengganti</b> data lokal sesuai tabel yang dipilih.
          Pastikan ini adalah lingkungan development, bukan production.
        </Text>
      </Alert>

      <Stack gap="sm" mb="md">
        <TextInput
          label="Remote URL"
          placeholder="https://claude-proxy.wibudev.com"
          value={url}
          onChange={e => setUrl(e.currentTarget.value)}
          leftSection={<IconDatabase size={14} />}
          size="sm"
        />
        <TextInput
          label="Sync Token"
          placeholder="sync-xxxxxxxxxxxxxxxx..."
          value={token}
          onChange={e => setToken(e.currentTarget.value)}
          leftSection={<IconKey size={14} />}
          type="password"
          size="sm"
        />
      </Stack>

      {/* Table selector */}
      <Box mb="md">
        <Group justify="space-between" mb="xs">
          <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: ".06em" }}>
            Tabel yang di-sync
          </Text>
          <Group gap="xs">
            <Button variant="subtle" size="xs" onClick={syncAll}>All</Button>
            <Button variant="subtle" size="xs" color="gray" onClick={clearAll}>None</Button>
          </Group>
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
          {ALL_TABLES.map(t => {
            const meta = TABLE_LABELS[t];
            return (
              <Box
                key={t}
                onClick={() => toggleTable(t)}
                style={{
                  cursor: "pointer",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: `1px solid ${tables.has(t) ? "var(--mantine-color-blue-4)" : "var(--mantine-color-default-border)"}`,
                  background: tables.has(t) ? "var(--mantine-color-blue-light)" : undefined,
                  transition: "all 0.15s ease",
                }}
              >
                <Group gap="xs" wrap="nowrap">
                  <Checkbox
                    checked={tables.has(t)}
                    onChange={() => toggleTable(t)}
                    size="xs"
                    onClick={e => e.stopPropagation()}
                  />
                  <Box style={{ flex: 1, minWidth: 0 }}>
                    <Group gap={5}>
                      <Text size="xs" fw={600}>{meta.label}</Text>
                      <Badge size="xs" color={RISK_COLOR[meta.risk]} variant="light">
                        {meta.risk}
                      </Badge>
                    </Group>
                    <Text size="xs" c="dimmed">{meta.desc}</Text>
                  </Box>
                </Group>
              </Box>
            );
          })}
        </SimpleGrid>
      </Box>

      <Button
        leftSection={loading ? undefined : <IconDownload size={14} />}
        onClick={run}
        loading={loading}
        disabled={!url.trim() || !token.trim() || tables.size === 0}
        color="teal"
        size="sm"
        fullWidth
      >
        {loading ? "Syncing…" : `Sync ${tables.size} table${tables.size !== 1 ? "s" : ""} from Remote`}
      </Button>

      {/* Result */}
      {result && (
        <Alert
          mt="md"
          color={result.ok ? "teal" : "red"}
          variant="light"
          icon={result.ok ? <IconCheck size={14} /> : <IconAlertTriangle size={14} />}
        >
          {result.ok ? (
            <>
              <Text size="xs" fw={600} mb={4}>
                Sync berhasil dari {result.source} · {result.synced_at ? new Date(result.synced_at).toLocaleString() : ""}
              </Text>
              <SimpleGrid cols={2} spacing={4}>
                {Object.entries(result.stats || {}).map(([tbl, count]) => (
                  <Group key={tbl} gap={4}>
                    <Text size="xs" c="dimmed">{TABLE_LABELS[tbl as TableName]?.label ?? tbl}:</Text>
                    <Text size="xs" fw={600} ff="monospace">{(count as number).toLocaleString()}</Text>
                  </Group>
                ))}
              </SimpleGrid>
              <Text size="xs" c="dimmed" mt={4}>
                Halaman akan perlu di-refresh untuk melihat data baru.
              </Text>
            </>
          ) : (
            <Text size="xs">{result.error}</Text>
          )}
        </Alert>
      )}
    </Paper>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function AdminDatabase() {
  return (
    <Stack gap="xl">
      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" wrap="wrap">
          <div>
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }} mb={4}>Database</Text>
            <Text size="xl" fw={800} ff="monospace">DB Sync</Text>
            <Text size="sm" c="dimmed" mt={2}>
              Sync data antar instance (stg ↔ dev) untuk pengembangan dengan data akurat
            </Text>
          </div>
          <Badge variant="light" color="blue" leftSection={<IconInfoCircle size={11} />}>
            PostgreSQL
          </Badge>
        </Group>
      </Paper>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <GenerateTokenSection />
        <SyncFromRemoteSection />
      </SimpleGrid>
    </Stack>
  );
}
