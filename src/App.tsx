import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Routes, Route } from "react-router-dom";
import {
  Container, Group, Stack, Title, Text, Box, Button, Paper,
  ActionIcon, Tooltip, TextInput, useMantineColorScheme,
  SimpleGrid, Progress, ThemeIcon, Divider, Alert, Badge, Code, Collapse,
} from "@mantine/core";
import {
  IconSun, IconMoon, IconLogout, IconLogin,
  IconRefresh, IconPlayerPause, IconPencil, IconPlus,
  IconUsers, IconActivity, IconClock, IconDatabase,
  IconAlertTriangle, IconAlertHexagon, IconChevronDown, IconChevronUp,
  IconBulb, IconX, IconChartBar,
} from "@tabler/icons-react";
import { StatusCtx, ChatCtx } from "./contexts";
import type { StatusResponse, ChatMsg, ContextAlert } from "./contexts";
import { pctColor, adminPost } from "./utils";
import { useStatus } from "./contexts";
import { LoadingScreen, NotFoundPage, RequireAdmin, UpstreamSection } from "./components/shared";
import { DailyHistory } from "./components/tables/DailyHistory";
import { RequestLog } from "./components/tables/RequestLog";
import { AdminDashboard } from "./components/admin/Dashboard";
import { MindPage } from "./components/MindPage";
import { RacePage } from "./components/RacePage";
import { SessionHistory } from "./components/SessionHistory";
import { Analytics } from "./components/Analytics";
import { FloatingChat } from "./components/FloatingChat";

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const s   = Math.floor(ms / 1000);
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

const nf = new Intl.NumberFormat();

function contextMessage(a: ContextAlert): {
  title: string; what: string; why: string;
  steps: { cmd?: string; label: string; desc: string }[];
} {
  const inp   = nf.format(a.input_tokens);
  const isCrit = a.severity === "critical";
  const highRatio = a.ratio > 80 && a.input_tokens < 50_000;

  if (isCrit) return {
    title: `Context sangat besar — ${inp} tokens/request`,
    what:  `Setiap request dari user ini mengkonsumsi ~${inp} tokens hanya untuk membaca ulang riwayat percakapan. Ini menguras kuota dengan cepat.`,
    why:   "Session Claude Code telah berjalan lama dengan banyak tool call, baca file, atau output panjang yang terus terakumulasi di memory.",
    steps: [
      { cmd: "/clear",   label: "Reset total (tercepat)",    desc: "Hapus seluruh context. Mulai sesi baru dari nol. Gunakan jika task sudah selesai atau ingin ganti topik." },
      { cmd: "/compact", label: "Kompres context (aman)",    desc: "Buat ringkasan dari seluruh percakapan menjadi lebih kecil. Context tetap terjaga tapi lebih hemat." },
      { label: "Buka terminal baru",                         desc: "Buka jendela Claude Code baru untuk task berikutnya. Setara dengan /clear." },
    ],
  };

  if (highRatio) return {
    title: `Overhead besar — rasio ${a.ratio}× (in/out)`,
    what:  `Input tokens ${a.ratio}× lebih banyak dari output. Sebagian besar kuota habis untuk re-read context lama, bukan untuk menghasilkan jawaban baru.`,
    why:   "Percakapan sudah panjang tapi outputnya pendek-pendek. Ini tanda session perlu di-compact.",
    steps: [
      { cmd: "/compact", label: "Kompres context",           desc: "Buat ringkasan percakapan. Ideal untuk sesi panjang yang masih aktif." },
      { cmd: "/clear",   label: "Reset jika task selesai",   desc: "Jika task sudah selesai, lebih baik mulai sesi baru untuk task berikutnya." },
    ],
  };

  return {
    title: `Context mulai besar — ${inp} tokens/request`,
    what:  `Input tokens per request sudah ${inp}. Jika dibiarkan terus, penggunaan kuota akan membengkak di turn-turn berikutnya.`,
    why:   "Riwayat percakapan, hasil tool, dan file yang dibaca menumpuk di context setiap turn baru.",
    steps: [
      { cmd: "/compact", label: "Kompres sekarang (direkomendasikan)", desc: "Kompres riwayat sebelum makin besar. Lebih efektif dilakukan lebih awal." },
      { cmd: "/clear",   label: "Reset jika task sudah selesai",        desc: "Jika pekerjaan sudah selesai, mulai sesi baru untuk task berikutnya." },
      { label: "Hindari cat file besar",                                desc: "Baca file besar dengan targeted search (grep, head) daripada cat seluruh file." },
    ],
  };
}

function ContextAlertCard({ alert: a, onDismiss }: { alert: ContextAlert; onDismiss: () => void }) {
  const [open, setOpen] = useState(false);
  const isCrit = a.severity === "critical";
  const color  = isCrit ? "red" : "orange";
  const Icon   = isCrit ? IconAlertHexagon : IconAlertTriangle;
  const msg    = contextMessage(a);

  return (
    <Paper withBorder radius="md" style={{ borderColor: `var(--mantine-color-${color}-6)`, overflow: "hidden" }}>
      {/* Header */}
      <Group justify="space-between" px="md" py="sm"
        style={{ background: `var(--mantine-color-${color}-light)`, cursor: "pointer" }}
        onClick={() => setOpen(o => !o)}>
        <Group gap="sm">
          <Icon size={18} color={`var(--mantine-color-${color}-6)`} />
          <Box>
            <Group gap="xs">
              <Badge color={color} variant="filled" size="xs">{isCrit ? "CRITICAL" : "WARNING"}</Badge>
              <Text size="xs" c="dimmed" ff="monospace">{a.label}</Text>
            </Group>
            <Text size="sm" fw={600} mt={2}>{msg.title}</Text>
          </Box>
        </Group>
        <Group gap="xs">
          <Text size="xs" c="dimmed">{open ? "sembunyikan" : "lihat solusi"}</Text>
          {open ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
          <ActionIcon size="xs" variant="subtle" color="gray" onClick={e => { e.stopPropagation(); onDismiss(); }}>
            <IconX size={12} />
          </ActionIcon>
        </Group>
      </Group>

      <Collapse in={open}>
        <Stack gap="md" p="md">
          {/* Stats */}
          <Group gap="xl" wrap="wrap">
            <Box>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".06em" }}>Input tokens</Text>
              <Text size="lg" fw={700} ff="monospace" c={color}>{nf.format(a.input_tokens)}</Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".06em" }}>Output tokens</Text>
              <Text size="lg" fw={700} ff="monospace">{nf.format(a.output_tokens)}</Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".06em" }}>Rasio in/out</Text>
              <Text size="lg" fw={700} ff="monospace">{a.ratio}×</Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".06em" }}>Turns session</Text>
              <Text size="lg" fw={700} ff="monospace">{a.turns}</Text>
            </Box>
          </Group>

          <Divider />

          {/* What & Why */}
          <Box>
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={4} style={{ letterSpacing: ".06em" }}>Apa yang terjadi</Text>
            <Text size="sm">{msg.what}</Text>
          </Box>
          <Box>
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={4} style={{ letterSpacing: ".06em" }}>Mengapa terjadi</Text>
            <Text size="sm" c="dimmed">{msg.why}</Text>
          </Box>

          <Divider />

          {/* Steps */}
          <Box>
            <Group gap="xs" mb="sm">
              <IconBulb size={14} color="var(--mantine-color-yellow-5)" />
              <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".06em" }}>Yang bisa dilakukan</Text>
            </Group>
            <Stack gap="sm">
              {msg.steps.map((s, i) => (
                <Group key={i} gap="sm" align="flex-start" wrap="nowrap">
                  <Badge variant="outline" color="gray" size="sm" style={{ flexShrink: 0, marginTop: 2 }}>{i + 1}</Badge>
                  <Box style={{ flex: 1 }}>
                    <Group gap="xs" mb={2}>
                      {s.cmd && <Code fz="sm" style={{ fontWeight: 700 }}>{s.cmd}</Code>}
                      <Text size="sm" fw={600}>{s.label}</Text>
                    </Group>
                    <Text size="xs" c="dimmed">{s.desc}</Text>
                  </Box>
                </Group>
              ))}
            </Stack>
          </Box>
        </Stack>
      </Collapse>
    </Paper>
  );
}

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

const DAY_ID = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
const MON_ID = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

function ClockPanel({ isDark }: { isDark: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const hh  = String(now.getHours()).padStart(2, "0");
  const mm  = String(now.getMinutes()).padStart(2, "0");
  const ss  = String(now.getSeconds()).padStart(2, "0");
  const day = DAY_ID[now.getDay()];
  const date= `${now.getDate()} ${MON_ID[now.getMonth()]} ${now.getFullYear()}`;
  const tz  = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const sepColor = isDark ? "#373a40" : "#dee2e6";
  const dimColor = isDark ? "#5c5f66" : "#adb5bd";

  return (
    <Paper withBorder radius="md" mb="lg" py="xl" px="md"
      style={{ textAlign: "center", background: isDark ? "rgba(255,255,255,.02)" : "rgba(0,0,0,.01)" }}>
      <Text size="sm" c="dimmed" ff="monospace" mb={6}>
        {day}, {date}
      </Text>
      <Group justify="center" gap={0} align="baseline">
        <Text fz={72} fw={700} ff="monospace" lh={1} style={{ letterSpacing: "-.02em" }}>{hh}</Text>
        <Text fz={52} fw={300} ff="monospace" lh={1} mx={6} c={sepColor}>:</Text>
        <Text fz={72} fw={700} ff="monospace" lh={1} style={{ letterSpacing: "-.02em" }}>{mm}</Text>
        <Text fz={52} fw={300} ff="monospace" lh={1} mx={6} c={sepColor}>:</Text>
        <Text fz={52} fw={400} ff="monospace" lh={1} c="dimmed" style={{ letterSpacing: "-.01em" }}>{ss}</Text>
      </Group>
      <Text size="xs" c="dimmed" ff="monospace" mt={8} style={{ color: dimColor }}>{tz}</Text>
    </Paper>
  );
}

function Dashboard({ isAdmin }: { isAdmin: boolean }) {
  const status = useStatus()!;
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const { tokens, upstream, contextAlerts = [], thresholdAlerts = [], insights = {} } = status;
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>([]);
  const [dismissedThresh, setDismissedThresh] = useState<string[]>([]);
  const visibleAlerts  = contextAlerts.filter(a => !dismissedAlerts.includes(a.label + a.ts));
  const visibleThresh  = thresholdAlerts.filter(a => !dismissedThresh.includes(a.label + a.type));

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

  const todayTotal   = Object.values(tokens).reduce((sum, tk: any) => sum + (tk.today || 0), 0);
  const activeTokens = Object.values(tokens).filter(tk => tk.used > 0).length;
  const totalTokens  = Object.keys(tokens).length;

  // ── Countdown ticker ────────────────────────────────────────────────────────
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const resetsAtMs   = upstream?.fiveHour?.resets_at ? new Date(upstream.fiveHour.resets_at).getTime() : null;
  const countdownMs  = resetsAtMs ? Math.max(0, resetsAtMs - Date.now()) : null;

  // ── Hourly activity ─────────────────────────────────────────────────────────
  interface HourlyEntry { h: number; tokens: number; requests: number; }
  const [hourly, setHourly] = useState<HourlyEntry[]>([]);
  useEffect(() => {
    fetch("/api/usage/hourly").then(r => r.json()).then(d => setHourly(d.hours || [])).catch(() => {});
  }, []);

  return (
    <Box style={{ minHeight: "100vh", background: pageBg, backgroundAttachment: "fixed", transition: "background 3s ease" }}>
    <Container size="md" py="xl">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <Paper withBorder p="lg" radius="lg" mb="lg"
        style={{ borderColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)" }}>
        <Group justify="space-between" wrap="wrap">
          <Group gap="md">
            <Box style={{ width: 48, height: 48, background: "#228be6", borderRadius: 12,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Text span fz={16} fw={800} c="white" ff="monospace">CP</Text>
            </Box>
            <div>
              <Title order={3} ff="monospace" lh={1.2}>claude-proxy</Title>
              <Text size="sm" c="dimmed" mt={2}>
                Claude Max proxy · multi-user API key with quota management
              </Text>
            </div>
          </Group>
          <Group gap="xs">
            <Tooltip label="Toggle theme" position="bottom" withArrow openDelay={400}>
              <ActionIcon variant="default" size="lg" radius="md" onClick={() => toggleColorScheme()}>
                {colorScheme === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
              </ActionIcon>
            </Tooltip>
{isAdmin
              ? <Button component="a" href="/admin/logout" variant="default" size="xs" radius="md" leftSection={<IconLogout size={13} />}>Sign out</Button>
              : status.isAdmin
              ? <Button component="a" href="/admin" variant="light" size="xs" radius="md" leftSection={<IconLogin size={13} />}>Admin</Button>
              : <Button component="a" href="/admin/login" variant="light" size="xs" radius="md" leftSection={<IconLogin size={13} />}>Sign in</Button>
            }
          </Group>
        </Group>
      </Paper>

      {/* ── Clock ────────────────────────────────────────────── */}
      <ClockPanel isDark={isDark} />

      {/* ── Quick Stats ──────────────────────────────────────── */}
      <SimpleGrid cols={{ base: 2, xs: 4 }} mb="lg">
        <Paper withBorder p="md" radius="md">
          <Group gap="sm" mb={6}>
            <ThemeIcon variant="light" color="blue" size="md" radius="md">
              <IconActivity size={16} />
            </ThemeIcon>
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Today</Text>
          </Group>
          <Text fz={24} fw={700} ff="monospace">{nf.format(todayTotal)}</Text>
          <Text size="xs" c="dimmed" mt={2}>tokens used today</Text>
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Group gap="sm" mb={6}>
            <ThemeIcon variant="light" color="violet" size="md" radius="md">
              <IconDatabase size={16} />
            </ThemeIcon>
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>All-Time</Text>
          </Group>
          <Text fz={24} fw={700} ff="monospace">{nf.format(status.totalAllTime ?? 0)}</Text>
          <Text size="xs" c="dimmed" mt={2}>total tokens processed</Text>
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Group gap="sm" mb={6}>
            <ThemeIcon variant="light" color="teal" size="md" radius="md">
              <IconUsers size={16} />
            </ThemeIcon>
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Active</Text>
          </Group>
          <Text fz={24} fw={700} ff="monospace">{activeTokens}<Text span fz="md" fw={400} c="dimmed"> / {totalTokens}</Text></Text>
          <Text size="xs" c="dimmed" mt={2}>tokens with usage this window</Text>
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Group gap="sm" mb={6}>
            <ThemeIcon variant="light" color="orange" size="md" radius="md">
              <IconClock size={16} />
            </ThemeIcon>
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Resets In</Text>
          </Group>
          <Text fz={24} fw={700} ff="monospace">
            {countdownMs !== null ? fmtCountdown(countdownMs) : "—"}
          </Text>
          <Text size="xs" c="dimmed" mt={2}>
            {resetsAtMs
              ? `at ${new Date(resetsAtMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : "waiting for poll"}
          </Text>
        </Paper>
      </SimpleGrid>

      {/* ── Context Alerts ───────────────────────────────────── */}
      {visibleAlerts.length > 0 && (
        <Stack gap="sm" mb="lg">
          {visibleAlerts.map(a => (
            <ContextAlertCard
              key={a.label + a.ts}
              alert={a}
              onDismiss={() => setDismissedAlerts(d => [...d, a.label + a.ts])}
            />
          ))}
        </Stack>
      )}

      {/* ── Threshold Alerts ─────────────────────────────────── */}
      {visibleThresh.length > 0 && (
        <Stack gap="xs" mb="lg">
          {visibleThresh.map(a => (
            <Alert key={a.label + a.type}
              color={a.type === "quota_95" || a.type === "error_storm" ? "red" : a.type === "upstream_85" ? "orange" : "yellow"}
              icon={<IconAlertTriangle size={14} />}
              withCloseButton
              onClose={() => setDismissedThresh(d => [...d, a.label + a.type])}
              py={6} px="md"
            >
              <Text size="sm">{a.msg}</Text>
            </Alert>
          ))}
        </Stack>
      )}

      {/* ── Upstream Health ──────────────────────────────────── */}
      <Stack gap="xs" mb="lg">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Upstream Health</Text>
        <Paper withBorder p="md" radius="md">
          <UpstreamSection upstream={upstream} isAdmin={isAdmin} />
        </Paper>
      </Stack>

      {/* ── Token Usage Overview ─────────────────────────────── */}
      <Stack gap="xs" mb="lg">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>
          Token Usage
        </Text>
        <Paper withBorder p="md" radius="md" style={{ overflow: "hidden" }}>
          {totalTokens === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="md">No tokens configured</Text>
          ) : (
            <Stack gap="md">
              {Object.entries(tokens).slice(0, isAdmin ? 20 : 6).map(([key, tk]) => {
                const pct    = tk.limit == null ? 0 : Math.min(100, Math.round((tk.used / tk.limit) * 100));
                const color  = tk.paused ? "gray" : pct >= 95 ? "red" : pct >= 75 ? "orange" : pct >= 50 ? "yellow" : "teal";
                const ins    = insights[key];
                const spark  = ins?.sparkline ?? [];
                const spike  = (ins?.burnRate.spikeMultiple ?? 0) >= 2;
                const hoursL = ins?.burnRate.hoursLeft;
                const prof   = ins?.profile ?? "mixed";
                const profColor: Record<string, string> = { agentic: "violet", conversational: "blue", heavy_reader: "orange", efficient: "teal", mixed: "gray" };
                const profLabel: Record<string, string> = { agentic: "Agentic", conversational: "Chat", heavy_reader: "Reader", efficient: "Efisien", mixed: "Mixed" };
                const maxSpark = Math.max(...spark, 1);
                return (
                  <Box key={key}>
                    <Group gap="sm" wrap="nowrap" mb={4}>
                      <Group gap={4} style={{ minWidth: isAdmin ? 140 : 90, maxWidth: isAdmin ? 180 : 110 }}>
                        <Text size="xs" ff="monospace" truncate>{tk.label}</Text>
                        {ins && <Badge size="xs" variant="light" color={profColor[prof]}>{profLabel[prof]}</Badge>}
                      </Group>
                      <Progress value={pct} color={color} size="md" radius="sm" style={{ flex: 1 }} />
                      <Group gap={4} style={{ minWidth: 90, justifyContent: "flex-end" }} wrap="nowrap">
                        {spike && <Tooltip label="Spike hari ini >2× rata-rata" withArrow><IconAlertTriangle size={12} color="var(--mantine-color-orange-5)" /></Tooltip>}
                        <Text size="xs" ff="monospace" c="dimmed" ta="right">
                          {nf.format(tk.used)}{tk.limit != null && ` / ${nf.format(tk.limit)}`}
                        </Text>
                      </Group>
                    </Group>
                    {/* Sparkline + burn rate */}
                    {spark.length === 7 && (
                      <Group gap="sm" wrap="nowrap" pl={isAdmin ? 148 : 98}>
                        <Tooltip label={spark.map((v, i) => `${i === 6 ? "Today" : `-${6-i}d`}: ${nf.format(v)}`).join("\n")} multiline withArrow>
                          <Box style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 20, cursor: "default" }}>
                            {spark.map((v, i) => (
                              <Box key={i} style={{
                                width: 8, height: Math.max(2, Math.round((v / maxSpark) * 18)),
                                borderRadius: 1,
                                background: i === 6 ? (isDark ? "#228be6" : "#1c7ed6") : (isDark ? "#373a40" : "#dee2e6"),
                              }} />
                            ))}
                          </Box>
                        </Tooltip>
                        {hoursL != null && (
                          <Text size="10px" c={hoursL < 4 ? "red" : hoursL < 12 ? "orange" : "dimmed"} ff="monospace">
                            {hoursL < 1 ? "< 1h left" : hoursL < 48 ? `~${hoursL.toFixed(0)}h left` : `~${(hoursL/24).toFixed(0)}d left`}
                          </Text>
                        )}
                      </Group>
                    )}
                  </Box>
                );
              })}
            </Stack>
          )}
        </Paper>
      </Stack>

      {/* ── Today's Activity ─────────────────────────────────── */}
      {hourly.length === 24 && (() => {
        const maxTok = Math.max(...hourly.map(h => h.tokens), 1);
        const curH   = new Date().getHours();
        const dayTotal = hourly.reduce((s, h) => s + h.tokens, 0);
        return (
          <Stack gap="xs" mb="lg">
            <Group justify="space-between">
              <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Today's Activity</Text>
              <Text size="xs" c="dimmed" ff="monospace">{nf.format(dayTotal)} tokens</Text>
            </Group>
            <Paper withBorder p="md" radius="md">
              <Box style={{ display: "flex", alignItems: "flex-end", height: 64, gap: 2 }}>
                {hourly.map(({ h, tokens: tok, requests: req }) => {
                  const barH = Math.round((tok / maxTok) * 56);
                  const bg = h === curH
                    ? (isDark ? "#228be6" : "#1c7ed6")
                    : h > curH
                    ? (isDark ? "#2c2e33" : "#e9ecef")
                    : (isDark ? "#0ca678" : "#12b886");
                  return (
                    <Tooltip key={h}
                      label={`${String(h).padStart(2, "0")}:00 · ${nf.format(tok)} tok · ${req} req`}
                      withArrow position="top" openDelay={80}>
                      <Box style={{
                        flex: 1, height: Math.max(barH, tok > 0 ? 2 : 0),
                        borderRadius: "2px 2px 0 0", background: bg, cursor: "default",
                        opacity: h > curH ? 0.35 : 1, transition: "height 0.3s ease",
                      }} />
                    </Tooltip>
                  );
                })}
              </Box>
              <Box style={{ display: "flex", gap: 2, marginTop: 4 }}>
                {hourly.map(({ h }) => (
                  <Text key={h} size="10px" ff="monospace" c="dimmed"
                    style={{ flex: 1, textAlign: "center" }}>
                    {h % 6 === 0 ? String(h).padStart(2, "0") : ""}
                  </Text>
                ))}
              </Box>
            </Paper>
          </Stack>
        );
      })()}

      {/* ── Today per-user ───────────────────────────────────── */}
      {(() => {
        const entries = Object.entries(tokens)
          .map(([k, tk]) => ({ key: k, val: tk.today || 0, label: tk.label }))
          .filter(e => e.val > 0)
          .sort((a, b) => b.val - a.val);
        if (!entries.length) return null;
        const max = entries[0]!.val;
        const total = entries.reduce((s, e) => s + e.val, 0);
        return (
          <Paper withBorder radius="md" mb="lg" style={{ overflow: "hidden" }}>
            <Group justify="space-between" px="md" py="sm" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
              <Group gap="xs">
                <ThemeIcon variant="light" color="blue" size="sm" radius="sm"><IconActivity size={13} /></ThemeIcon>
                <Text size="sm" fw={700}>Today per User</Text>
              </Group>
              <Text size="xs" c="dimmed" ff="monospace">{nf.format(total)} tokens</Text>
            </Group>
            <Stack gap="sm" p="md">
              {entries.map(({ key, val, label }) => (
                <Group key={key} gap="sm" wrap="nowrap">
                  <Text size="xs" ff="monospace" truncate style={{ minWidth: isAdmin ? 140 : 90, maxWidth: isAdmin ? 180 : 110 }}>{label}</Text>
                  <Progress value={Math.round((val / max) * 100)} color="blue" size="md" radius="sm" style={{ flex: 1 }} />
                  <Text size="xs" ff="monospace" c="dimmed" ta="right" style={{ minWidth: 80 }}>{nf.format(val)}</Text>
                </Group>
              ))}
            </Stack>
          </Paper>
        );
      })()}

      {/* ── All-time per-user ─────────────────────────────────── */}
      {(() => {
        const entries = Object.entries(tokens)
          .map(([k, tk]) => ({ key: k, val: tk.alltime || 0, label: tk.label }))
          .filter(e => e.val > 0)
          .sort((a, b) => b.val - a.val);
        if (!entries.length) return null;
        const max = entries[0]!.val;
        const total = entries.reduce((s, e) => s + e.val, 0);
        return (
          <Paper withBorder radius="md" mb="lg" style={{ overflow: "hidden" }}>
            <Group justify="space-between" px="md" py="sm" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
              <Group gap="xs">
                <ThemeIcon variant="light" color="violet" size="sm" radius="sm"><IconDatabase size={13} /></ThemeIcon>
                <Text size="sm" fw={700}>All-Time per User</Text>
              </Group>
              <Text size="xs" c="dimmed" ff="monospace">{nf.format(total)} tokens</Text>
            </Group>
            <Stack gap="sm" p="md">
              {entries.map(({ key, val, label }) => (
                <Group key={key} gap="sm" wrap="nowrap">
                  <Text size="xs" ff="monospace" truncate style={{ minWidth: isAdmin ? 140 : 90, maxWidth: isAdmin ? 180 : 110 }}>{label}</Text>
                  <Progress value={Math.round((val / max) * 100)} color="violet" size="md" radius="sm" style={{ flex: 1 }} />
                  <Text size="xs" ff="monospace" c="dimmed" ta="right" style={{ minWidth: 80 }}>{nf.format(val)}</Text>
                </Group>
              ))}
            </Stack>
          </Paper>
        );
      })()}

      {/* ── Request Log (public shows compact preview) ───────── */}
      <RequestLog isAdmin={isAdmin} />

      {/* ── Admin-only sections ──────────────────────────────── */}
      {isAdmin && (
        <>
          <Divider my="lg" />

          <Group gap="xs" mb="lg">
            <Button variant="light" color="gray" size="xs" leftSection={<IconRefresh size={13} />}
              onClick={() => { if (confirm("Reset all?")) adminPost("/admin/reset", { all: "true" }); }}>Reset All</Button>
            <Button variant="light" color="orange" size="xs" leftSection={<IconPlayerPause size={13} />}
              onClick={() => adminPost("/admin/token/pause", { all: "true" })}>Pause All</Button>
            <Button variant="light" color="blue" size="xs" leftSection={<IconPencil size={13} />}
              onClick={() => { const v = prompt("New limit for all:"); if (v) adminPost("/admin/token/edit-all", { limit: v }); }}>Edit All Limits</Button>
          </Group>

          <AddTokenInline />

          <Stack gap="xs" mb="xl">
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Daily History</Text>
            <Paper withBorder style={{ overflow: "hidden" }}>
              <DailyHistory isAdmin={isAdmin} />
            </Paper>
          </Stack>
        </>
      )}
    </Container>
    <FloatingChat />
    </Box>
  );
}

export function App() {
  const [status, setStatus]     = useState<StatusResponse | null>(null);
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
          <Route path="/race" element={<RacePage />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/sessions/:user" element={<SessionHistory />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </StatusCtx.Provider>
    </ChatCtx.Provider>
  );
}
