import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useDisclosure } from "@mantine/hooks";
import { Routes, Route } from "react-router-dom";
import ReactECharts from "echarts-for-react";
import {
  Container, Group, Stack, Title, Text, Box, Button, Paper,
  ActionIcon, Tooltip, TextInput, useMantineColorScheme,
  SimpleGrid, Progress, ThemeIcon, Divider, Alert, Badge, Code, Collapse, Loader, Transition,
  Table, Pagination, Modal, Anchor,
} from "@mantine/core";
import {
  IconSun, IconMoon, IconLogout, IconLogin,
  IconRefresh, IconPlayerPause, IconPencil, IconPlus,
  IconUsers, IconActivity, IconClock, IconDatabase,
  IconAlertTriangle, IconAlertHexagon, IconChevronDown, IconChevronUp,
  IconBulb, IconX, IconChartBar, IconArrowUp, IconHeartbeat, IconKey,
  IconChartHistogram, IconList, IconFlame, IconChartPie, IconBolt,
  IconTrophy, IconBrain,
} from "@tabler/icons-react";
import { StatusCtx, ChatCtx } from "./contexts";
import type { StatusResponse, ChatMsg, ContextAlert } from "./contexts";
import { pctColor, adminPost, maskToken, avatarColor } from "./utils";
import { useStatus } from "./contexts";
import { LoadingScreen, NotFoundPage, RequireAdmin, RequireAuth, WaitingPage, BlockedPage, UpstreamSection } from "./components/shared";
import { DailyHistory } from "./components/tables/DailyHistory";
import { RequestLog, DetailContent } from "./components/tables/RequestLog";
import { AdminDashboard } from "./components/admin/Dashboard";
import { MindPage } from "./components/MindPage";
import { RacePage } from "./components/RacePage";
import { SessionHistory } from "./components/SessionHistory";
import { FloatingChat } from "./components/FloatingChat";

async function resolveLoginRedirect(): Promise<string> {
  try {
    const r = await fetch("/api/profile", { credentials: "include" });
    const d = await r.json() as any;
    if (!d?.authenticated) return "/login";
    if (d?.status === "blocked")  return "/diblokir";
    if (d?.status === "pending")  return "/menunggu";
    if (d?.role === "SUPER_ADMIN" || d?.role === "ADMIN") return "/admin";
  } catch {}
  return "/";
}

async function signInWithGoogle() {
  const r = await fetch("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ provider: "google", callbackURL: "/login/redirect" }),
  });
  const d = await r.json() as any;
  if (d?.url) window.location.href = d.url;
}

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

      <Collapse expanded={open}>
        <Stack gap="md" p="md">
          {/* Stats */}
          <Group gap="xl" wrap="wrap">
            <Box style={{ maxWidth: "100%", overflow: "hidden" }}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".06em" }}>Input tokens</Text>
              <Text size="lg" fw={700} ff="monospace" c={color} style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{nf.format(a.input_tokens)}</Text>
            </Box>
            <Box style={{ maxWidth: "100%", overflow: "hidden" }}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".06em" }}>Output tokens</Text>
              <Text size="lg" fw={700} ff="monospace" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{nf.format(a.output_tokens)}</Text>
            </Box>
            <Box style={{ maxWidth: "100%", overflow: "hidden" }}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".06em" }}>Rasio in/out</Text>
              <Text size="lg" fw={700} ff="monospace" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{a.ratio}×</Text>
            </Box>
            <Box style={{ maxWidth: "100%", overflow: "hidden" }}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".06em" }}>Turns session</Text>
              <Text size="lg" fw={700} ff="monospace" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{a.turns}</Text>
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


const DAY_ID = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
const MON_ID = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

function ClockInline() {
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

  return (
    <Group justify="space-between" wrap="nowrap" gap="md">
      <Group gap="xs" wrap="nowrap">
        <IconClock size={14} color="var(--mantine-color-dimmed)" />
        <Text size="sm" c="dimmed">{day}, {date}</Text>
      </Group>
      <Group gap={6} align="baseline" wrap="nowrap">
        <Text fz={22} fw={700} ff="monospace" lh={1} style={{ letterSpacing: "-.02em" }}>{hh}:{mm}</Text>
        <Text fz={14} fw={400} ff="monospace" lh={1} c="dimmed">:{ss}</Text>
        <Text size="xs" c="dimmed" ml={6}>{tz}</Text>
      </Group>
    </Group>
  );
}

interface AnalyticsData {
  modelDist:      { model: string; requests: number; tokens: number; pct: number }[];
  cacheHitRate:   { label: string; hitRate: number; totalInput: number; totalCached: number; requests: number }[];
  peakHours:      { h: number; requests: number; tokens: number }[];
  peakHour:       number;
  leaderboard:    { label: string; today: number; alltime: number; peakHour: number | null; paused: boolean }[];
  anomalyScores:  { id: number; ts: number; label: string; input_tokens: number; output_tokens: number; turns: number; tool_use: number; duration_ms: number; score: number }[];
  stopReasonDist: { stop_reason: string; n: number }[];
  dailyByUser:    { date: string; by_user: Record<string, number> }[];
  dailyUsers:     string[];
  allTimeByUser:  { user: string; total: number }[];
}

function fmtHour(h: number) { return `${String(h).padStart(2, "0")}:00`; }
function anomalyScoreColor(s: number) {
  if (s >= 70) return "#e03131";
  if (s >= 40) return "#f76707";
  if (s >= 20) return "#fab005";
  return "#12b886";
}

function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <Transition mounted={show} transition="slide-up" duration={200}>
      {styles => (
        <ActionIcon
          variant="filled" color="blue" size="lg" radius="xl"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label="Back to top"
          style={{ ...styles, position: "fixed", right: 16, bottom: "max(80px, calc(env(safe-area-inset-bottom, 0px) + 80px))", zIndex: 50, boxShadow: "0 4px 12px rgba(0,0,0,.25)" }}
        >
          <IconArrowUp size={18} />
        </ActionIcon>
      )}
    </Transition>
  );
}


function SonnetCriticalAlert({ pct }: { pct: number }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || pct < 95) return null;
  const isFull = pct >= 100;
  return (
    <Alert
      color="red" variant="filled"
      icon={<IconFlame size={18} />}
      withCloseButton
      onClose={() => setDismissed(true)}
      mb="lg"
      title={isFull ? "Sonnet quota exhausted" : "Sonnet quota nearly exhausted"}
    >
      <Text size="sm">
        Rolling 7-day Sonnet usage is at <b>{pct}%</b>.
        {isFull
          ? " New Sonnet requests will be rejected until the window resets."
          : " Consider routing new Sonnet requests to a smaller model or wait for the window to reset."}
      </Text>
    </Alert>
  );
}

function TokenDetailModal({ tokenKey, tk, ins, opened, onClose }: {
  tokenKey: string;
  tk: import("./contexts").TokenStatus;
  ins: import("./contexts").UserInsight | undefined;
  opened: boolean;
  onClose: () => void;
}) {
  const nfm = new Intl.NumberFormat();
  const pct = tk.limit == null ? 0 : Math.min(100, Math.round((tk.used / tk.limit) * 100));
  const color = tk.paused ? "gray" : pct >= 95 ? "red" : pct >= 75 ? "orange" : pct >= 50 ? "yellow" : "teal";
  const maxSpark = Math.max(...(ins?.sparkline ?? [0]), 1);

  const profColor: Record<string, string> = { agentic: "violet", conversational: "blue", heavy_reader: "orange", efficient: "teal", mixed: "gray" };
  const profLabel: Record<string, string> = { agentic: "Agentic", conversational: "Chat", heavy_reader: "Heavy Reader", efficient: "Efisien", mixed: "Mixed" };
  const prof = ins?.profile ?? "mixed";

  const stopTotal = Object.values(ins?.stopReasons ?? {}).reduce((s, v) => s + v, 0) || 1;
  const stopColors: Record<string, string> = { end_turn: "teal", max_tokens: "orange", stop_sequence: "blue", tool_use: "violet" };

  const qs = ins?.quotaSuggestion;
  const qsColor = qs?.action === "increase" ? "red" : qs?.action === "decrease" ? "blue" : "teal";

  const providerName = tk.activeProvider === "deepseek" ? "DeepSeek"
    : tk.activeProvider === "openrouter" ? "OpenRouter" : "Claude Max";
  const providerColor = tk.activeProvider === "deepseek" ? "violet"
    : tk.activeProvider === "openrouter" ? "orange" : "blue";

  return (
    <Modal opened={opened} onClose={onClose} title={
      <Group gap="sm">
        <Text fw={700} ff="monospace">{maskToken(tk.label)}</Text>
        {tk.paused && <Badge color="gray" size="xs">paused</Badge>}
        <Badge color={providerColor} variant="light" size="xs">{providerName}</Badge>
      </Group>
    } size="md" centered>
      <Stack gap="md">

        {/* ── Usage ─────────────────────────────────────── */}
        <Stack gap={6}>
          <Group justify="space-between">
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".07em" }}>Window Usage</Text>
            <Text size="xs" ff="monospace" c="dimmed">
              {nfm.format(tk.used)}{tk.limit != null ? ` / ${nfm.format(tk.limit)}` : " / ∞"}
              {tk.limit != null && ` · ${pct}%`}
            </Text>
          </Group>
          <Progress value={pct} color={color} size="lg" radius="sm" />
          <Group gap="xl">
            <Box>
              <Text size="xs" c="dimmed">Today</Text>
              <Text size="sm" fw={600} ff="monospace">{nfm.format(tk.today)}</Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed">All-time</Text>
              <Text size="sm" fw={600} ff="monospace">{nfm.format(tk.alltime)}</Text>
            </Box>
            {tk.remaining != null && (
              <Box>
                <Text size="xs" c="dimmed">Remaining</Text>
                <Text size="sm" fw={600} ff="monospace" c={tk.remaining < 5000 ? "red" : undefined}>
                  {nfm.format(tk.remaining)}
                </Text>
              </Box>
            )}
          </Group>
        </Stack>

        {/* ── Sparkline 7 days ──────────────────────────── */}
        {ins && ins.sparkline.length === 7 && (
          <Stack gap={6}>
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".07em" }}>7-Day History</Text>
            <Group gap={4} align="flex-end" style={{ height: 48 }}>
              {ins.sparkline.map((v, i) => {
                const label = i === 6 ? "Today" : `-${6 - i}d`;
                return (
                  <Tooltip key={i} label={`${label}: ${nfm.format(v)}`} withArrow>
                    <Box style={{
                      flex: 1,
                      height: Math.max(4, Math.round((v / maxSpark) * 44)),
                      borderRadius: 3,
                      background: i === 6 ? "var(--mantine-color-blue-5)" : "var(--mantine-color-default-border)",
                      cursor: "default",
                    }} />
                  </Tooltip>
                );
              })}
            </Group>
            <Group gap="xs" justify="space-between">
              {ins.sparkline.map((_, i) => (
                <Text key={i} size="10px" c="dimmed" style={{ flex: 1, textAlign: "center" }}>
                  {i === 6 ? "T" : `-${6 - i}`}
                </Text>
              ))}
            </Group>
          </Stack>
        )}

        {/* ── Burn rate + Profile ────────────────────────── */}
        {ins && (
          <SimpleGrid cols={2} spacing="sm">
            <Paper withBorder p="sm" radius="md">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={6} style={{ letterSpacing: ".06em" }}>Burn Rate</Text>
              <Stack gap={4}>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Avg daily</Text>
                  <Text size="xs" ff="monospace">{nfm.format(Math.round(ins.burnRate.avgDaily))}</Text>
                </Group>
                {ins.burnRate.hoursLeft != null && (
                  <Group justify="space-between">
                    <Text size="xs" c="dimmed">Est. left</Text>
                    <Text size="xs" ff="monospace"
                      c={ins.burnRate.hoursLeft < 4 ? "red" : ins.burnRate.hoursLeft < 12 ? "orange" : undefined}>
                      {ins.burnRate.hoursLeft < 1 ? "< 1h" : ins.burnRate.hoursLeft < 48
                        ? `~${ins.burnRate.hoursLeft.toFixed(0)}h`
                        : `~${(ins.burnRate.hoursLeft / 24).toFixed(0)}d`}
                    </Text>
                  </Group>
                )}
                {ins.burnRate.spikeMultiple >= 2 && (
                  <Text size="xs" c="orange">⚠ Spike {ins.burnRate.spikeMultiple}× rata-rata</Text>
                )}
              </Stack>
            </Paper>
            <Paper withBorder p="sm" radius="md">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={6} style={{ letterSpacing: ".06em" }}>Profile</Text>
              <Badge color={profColor[prof]} variant="light" size="sm" mb={6}>{profLabel[prof]}</Badge>
              <Text size="xs" c="dimmed" style={{ lineHeight: 1.5 }}>{ins.profileReason}</Text>
            </Paper>
          </SimpleGrid>
        )}

        {/* ── Cache + Stop reasons ──────────────────────── */}
        {ins && (
          <SimpleGrid cols={2} spacing="sm">
            <Paper withBorder p="sm" radius="md">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={6} style={{ letterSpacing: ".06em" }}>Cache Hit Rate</Text>
              <Text size="xl" fw={700} ff="monospace" c={ins.cacheHitRate > 0.5 ? "teal" : undefined}>
                {(ins.cacheHitRate * 100).toFixed(0)}%
              </Text>
              <Text size="xs" c="dimmed" mt={2}>avg {nfm.format(ins.avgInputTokens)} in/req</Text>
            </Paper>
            {Object.keys(ins.stopReasons).length > 0 && (
              <Paper withBorder p="sm" radius="md">
                <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={6} style={{ letterSpacing: ".06em" }}>Stop Reasons</Text>
                <Stack gap={4}>
                  {Object.entries(ins.stopReasons).map(([k, v]) => (
                    <Group key={k} justify="space-between">
                      <Badge size="xs" color={stopColors[k] ?? "gray"} variant="light">{k.replace(/_/g, " ")}</Badge>
                      <Text size="xs" ff="monospace" c="dimmed">{((v / stopTotal) * 100).toFixed(0)}%</Text>
                    </Group>
                  ))}
                </Stack>
              </Paper>
            )}
          </SimpleGrid>
        )}

        {/* ── Quota suggestion ──────────────────────────── */}
        {qs && (
          <Paper withBorder p="sm" radius="md" style={{ borderColor: `var(--mantine-color-${qsColor}-4)` }}>
            <Group gap="sm" mb={4}>
              <Badge color={qsColor} variant="light" size="sm">
                {qs.action === "increase" ? "Perlu naik" : qs.action === "decrease" ? "Bisa turun" : "Limit OK"}
              </Badge>
              {qs.suggested != null && (
                <Text size="xs" ff="monospace" c="dimmed">Saran: {nfm.format(qs.suggested)}</Text>
              )}
            </Group>
            <Text size="xs" c="dimmed">{qs.reason}</Text>
          </Paper>
        )}

      </Stack>
    </Modal>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <Tooltip label={copied ? "Copied!" : "Copy"} withArrow position="top">
      <ActionIcon variant={copied ? "filled" : "default"} color={copied ? "teal" : undefined} size="sm" radius="sm" onClick={copy}>
        {copied ? <IconActivity size={12} /> : <IconDatabase size={12} />}
      </ActionIcon>
    </Tooltip>
  );
}

function ProfilePage() {
  const [profile, setProfile] = useState<import("./contexts").ProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const nfm = new Intl.NumberFormat();
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";
  const baseUrl = window.location.origin;

  useEffect(() => {
    fetch("/api/profile", { credentials: "include" })
      .then(r => r.json())
      .then(d => { setProfile(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return (
    <Box style={{ minHeight: "100vh", background: isDark ? "#0f1012" : "#f0f2f5" }}>
      <Container size="sm" py={{ base: "md", sm: "xl" }} px={{ base: "sm", sm: "md" }}>
        <Group justify="center" py="xl"><Loader size="md" /></Group>
      </Container>
    </Box>
  );

  if (!profile?.authenticated) return (
    <Box style={{ minHeight: "100vh", background: isDark ? "#0f1012" : "#f0f2f5" }}>
      <Container size="sm" py={{ base: "md", sm: "xl" }} px={{ base: "sm", sm: "md" }}>
        <Paper withBorder p="lg" radius="md" ta="center">
          <Stack gap="md" align="center">
            <ThemeIcon variant="light" color="gray" size="xl" radius="xl"><IconKey size={22} /></ThemeIcon>
            <Text size="lg" fw={700}>Not signed in</Text>
            <Button onClick={() => signInWithGoogle()} color="blue" size="sm" radius="md" leftSection={<IconLogin size={16} />}>
              Sign in with Google
            </Button>
            <Anchor href="/" size="xs" c="dimmed">← Dashboard</Anchor>
          </Stack>
        </Paper>
      </Container>
    </Box>
  );

  const tkEntries = Object.entries(profile.tokens ?? {});
  const totalToday   = tkEntries.reduce((s, [, t]) => s + (t.today   ?? 0), 0);
  const totalAlltime = tkEntries.reduce((s, [, t]) => s + (t.alltime ?? 0), 0);
  const roleColor = profile.role === "SUPER_ADMIN" ? "red" : profile.role === "ADMIN" ? "orange" : "blue";
  const roleLabel = profile.role === "SUPER_ADMIN" ? "Super Admin" : profile.role === "ADMIN" ? "Admin" : "User";
  const initials = (profile.name || profile.email || "?").slice(0, 2).toUpperCase();

  const codeBg  = isDark ? "#1a1b1e" : "#f1f3f5";
  const codeFg  = isDark ? "#c9cace" : "#2c2e33";

  return (
    <Box style={{ minHeight: "100vh", background: isDark ? "#0f1012" : "#f0f2f5" }}>
      <Container size="sm" py={{ base: "md", sm: "xl" }} px={{ base: "sm", sm: "md" }}>
        <Stack gap="lg">

          {/* ── Header ───────────────────────────────────────────── */}
          <Paper withBorder p="lg" radius="md">
            <Group justify="space-between" wrap="wrap" gap="sm">
              <Group gap="md">
                <Box style={{
                  width: 46, height: 46, borderRadius: "50%", flexShrink: 0,
                  background: `var(--mantine-color-${avatarColor(profile.name || profile.email || "")}-5)`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Text span fz={15} fw={700} c="white">{initials}</Text>
                </Box>
                <div>
                  <Group gap={6} align="center">
                    <Text size="md" fw={700}>{profile.name}</Text>
                    <Badge size="xs" color={roleColor} variant="light" radius="sm">{roleLabel}</Badge>
                  </Group>
                  <Text size="xs" c="dimmed">{profile.email}</Text>
                </div>
              </Group>
              <Group gap="xs">
                <ActionIcon variant="default" size="lg" radius="md" onClick={() => toggleColorScheme()}>
                  {colorScheme === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
                </ActionIcon>
                <Button component="a" href="/" variant="default" size="xs" radius="md">Dashboard</Button>
                <Button component="a" href="/auth/logout" variant="subtle" color="red" size="xs" radius="md" leftSection={<IconLogout size={13} />}>Sign out</Button>
              </Group>
            </Group>
          </Paper>

          {/* ── Stats ────────────────────────────────────────────── */}
          <SimpleGrid cols={3} spacing="sm">
            {[
              { label: "API Keys", value: tkEntries.length },
              { label: "Today", value: nfm.format(totalToday) },
              { label: "All-Time", value: nfm.format(totalAlltime) },
            ].map(s => (
              <Paper key={s.label} withBorder p="md" radius="md">
                <Text size="xs" c="dimmed" tt="uppercase" fw={700} style={{ letterSpacing: ".06em" }}>{s.label}</Text>
                <Text size="xl" fw={700} ff="monospace" mt={2}>{s.value}</Text>
              </Paper>
            ))}
          </SimpleGrid>

          {/* ── API Keys ─────────────────────────────────────────── */}
          {tkEntries.length === 0 ? (
            <Paper withBorder p="xl" radius="md" ta="center">
              <Text size="sm" c="dimmed">No API key assigned yet. Please contact the admin.</Text>
            </Paper>
          ) : (
            <Stack gap="sm">
              <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>API Keys</Text>
              {tkEntries.map(([key, tk]) => {
                const pct   = tk.limit == null ? 0 : Math.min(100, tk.pct);
                const color = tk.paused ? "gray" : pct >= 95 ? "red" : pct >= 75 ? "orange" : pct >= 50 ? "yellow" : "teal";
                const pn    = tk.provider === "deepseek" ? "DeepSeek" : tk.provider === "openrouter" ? "OpenRouter" : tk.provider === "anthropic" ? "Claude Max" : "Auto";
                const pc    = tk.provider === "deepseek" ? "violet" : tk.provider === "openrouter" ? "orange" : tk.provider === "anthropic" ? "blue" : "gray";
                return (
                  <Paper key={key} withBorder p="md" radius="md"
                    style={{ borderColor: tk.paused ? "var(--mantine-color-orange-4)" : undefined, opacity: tk.paused ? 0.85 : 1 }}>
                    <Stack gap="sm">
                      {/* Pending banner */}
                      {tk.paused && (
                        <Group gap="xs" p="xs" style={{ background: isDark ? "rgba(255,140,0,.08)" : "rgba(255,140,0,.06)", borderRadius: 6 }}>
                          <Text size="xs" c="orange" fw={600}>Pending activation — contact the admin to enable this key.</Text>
                        </Group>
                      )}
                      {/* Key row */}
                      <Group justify="space-between" wrap="nowrap" gap="sm">
                        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                          <ThemeIcon variant="light" color={tk.paused ? "orange" : "blue"} size="sm" radius="sm">
                            <IconKey size={12} />
                          </ThemeIcon>
                          <Text size="xs" ff="monospace" c="dimmed">
                            {key.slice(0, 6)}{"•".repeat(20)}{key.slice(-4)}
                          </Text>
                        </Group>
                        <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
                          <CopyButton value={key} />
                          <Badge size="xs" color={pc} variant="light">{pn}</Badge>
                          <Badge size="xs" color={tk.paused ? "orange" : "teal"} variant="light">
                            {tk.paused ? "Inactive" : "Active"}
                          </Badge>
                        </Group>
                      </Group>
                      {/* Quota — only meaningful when active */}
                      {!tk.paused && (
                        <div>
                          <Group justify="space-between" mb={4}>
                            <Text size="xs" c="dimmed">Quota this window</Text>
                            <Text size="xs" ff="monospace">
                              {nfm.format(tk.used)} / {tk.limit == null ? "∞" : nfm.format(tk.limit)} tokens
                              {tk.limit != null && <> · <Text span c={color}>{pct}%</Text></>}
                            </Text>
                          </Group>
                          <Progress value={pct} color={color} size="sm" radius="xl" />
                        </div>
                      )}
                      {/* Today / All-time */}
                      <Group gap="xl">
                        <div>
                          <Text size="xs" c="dimmed">Today</Text>
                          <Text size="xs" ff="monospace" fw={600}>{nfm.format(tk.today)} tokens</Text>
                        </div>
                        <div>
                          <Text size="xs" c="dimmed">All-time</Text>
                          <Text size="xs" ff="monospace" fw={600}>{nfm.format(tk.alltime)} tokens</Text>
                        </div>
                      </Group>
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>
          )}

          {/* ── Usage Guide — Claude Code ────────────────────────── */}
          {tkEntries.length > 0 && (() => {
            const firstKey = tkEntries[0]![0];
            const envExample =
`export ANTHROPIC_API_KEY="${firstKey}"
export ANTHROPIC_BASE_URL="${baseUrl}"`;
            const configExample =
`claude config set apiKey "${firstKey}"
claude config set baseUrl "${baseUrl}"`;
            const border = `1px solid var(--mantine-color-default-border)`;
            return (
              <Stack gap="sm">
                <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Claude Code — Setup</Text>
                <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
                  <Stack gap={0}>

                    {/* Option 1: env vars */}
                    <Box px="md" py="sm" style={{ borderBottom: border }}>
                      <Group justify="space-between" mb={6}>
                        <div>
                          <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: ".06em" }}>Option 1 — Environment variables</Text>
                          <Text size="xs" c="dimmed" mt={2}>Add to your <Text span ff="monospace">.bashrc</Text> / <Text span ff="monospace">.zshrc</Text></Text>
                        </div>
                        <CopyButton value={envExample} />
                      </Group>
                      <Box style={{ background: codeBg, borderRadius: 6, padding: "10px 12px" }}>
                        <Text size="xs" ff="monospace" style={{ color: codeFg, whiteSpace: "pre" }}>{envExample}</Text>
                      </Box>
                    </Box>

                    {/* Option 2: claude config */}
                    <Box px="md" py="sm">
                      <Group justify="space-between" mb={6}>
                        <div>
                          <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: ".06em" }}>Option 2 — Claude Code config</Text>
                          <Text size="xs" c="dimmed" mt={2}>Run once in your terminal</Text>
                        </div>
                        <CopyButton value={configExample} />
                      </Group>
                      <Box style={{ background: codeBg, borderRadius: 6, padding: "10px 12px" }}>
                        <Text size="xs" ff="monospace" style={{ color: codeFg, whiteSpace: "pre" }}>{configExample}</Text>
                      </Box>
                    </Box>

                  </Stack>
                </Paper>
                <Text size="xs" c="dimmed">After setup, run <Text span ff="monospace">claude</Text> as usual — requests will be routed through this proxy.</Text>
              </Stack>
            );
          })()}

        </Stack>
      </Container>
    </Box>
  );
}

function LoginRedirect() {
  useEffect(() => {
    resolveLoginRedirect().then(url => { window.location.replace(url); });
  }, []);
  return <LoadingScreen />;
}

function LoginPage() {
  const isDark = useMantineColorScheme().colorScheme === "dark";

  return (
    <Box style={{ minHeight: "100vh", background: isDark ? "#0f1012" : "#f0f2f5", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <Paper withBorder p="xl" radius="md" style={{ width: "100%", maxWidth: 380 }}>
        <Stack gap="lg" align="center">
          <Box style={{ width: 44, height: 44, background: "#228be6", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Text span fz={13} fw={800} c="white" ff="monospace">CP</Text>
          </Box>
          <div style={{ textAlign: "center" }}>
            <Text fw={700} size="lg">claude-proxy</Text>
            <Text size="sm" c="dimmed" mt={2}>Sign in to continue</Text>
          </div>

          <Button fullWidth onClick={() => signInWithGoogle()} color="blue" leftSection={<IconLogin size={16} />}>
            Sign in with Google
          </Button>

          <Anchor href="/" size="xs" c="dimmed">← Back to dashboard</Anchor>
        </Stack>
      </Paper>
    </Box>
  );
}

function Dashboard({ isAdmin, profile }: { isAdmin: boolean; profile?: import("./contexts").ProfileResponse }) {
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

  // ── Analytics (model dist, leaderboard, anomalies, …) ──────────────────────
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  useEffect(() => {
    fetch("/api/analytics").then(r => r.json()).then(setAnalytics).catch(() => {});
  }, []);


  const [anomalyPage, setAnomalyPage] = useState(1);
  const [selectedToken, setSelectedToken] = useState<{ key: string; tk: import("./contexts").TokenStatus } | null>(null);
  const [anomalyDetail, setAnomalyDetail] = useState<import("./contexts").LogEntry | null>(null);
  const [anomalyDetailLoading, setAnomalyDetailLoading] = useState(false);
  const [anomalyModalOpen, { open: openAnomalyModal, close: closeAnomalyModal }] = useDisclosure(false);

  // Persist scroll across navigations. Async content (hourly, ws status) keeps
  // resizing the page after mount, so we keep nudging scrollTo until the page
  // is tall enough or 2s have passed.
  useEffect(() => {
    const KEY = "scroll:dashboard";
    const saved = parseInt(sessionStorage.getItem(KEY) || "", 10);
    let raf = 0;
    if (Number.isFinite(saved) && saved > 0) {
      const start = performance.now();
      const restore = () => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo(0, Math.min(max, saved));
        if (max < saved && performance.now() - start < 2000) {
          raf = requestAnimationFrame(restore);
        }
      };
      raf = requestAnimationFrame(restore);
    }
    let timer = 0 as unknown as ReturnType<typeof setTimeout>;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => sessionStorage.setItem(KEY, String(window.scrollY)), 150);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <Box style={{ minHeight: "100vh", background: pageBg, backgroundAttachment: "fixed", transition: "background 3s ease" }}>
    <Container size="md" py={{ base: "md", sm: "xl" }} px={{ base: "sm", sm: "md" }}>
      {/* ── Hero ─────────────────────────────────────────────── */}
      {(() => {
        const ap = upstream?.activeProvider;
        const isFallback = !!ap;
        const provName  = ap === "deepseek" ? "DeepSeek" : ap === "openrouter" ? "OpenRouter" : "Claude Max";
        const provColor = ap === "deepseek" ? "violet" : ap === "openrouter" ? "orange"
          : upstream?.ok ? "blue" : "gray";
        const modelLabel = upstream?.activeModel ?? "claude-sonnet-4-6";

        const roleColor = profile?.role === "SUPER_ADMIN" ? "red" : profile?.role === "ADMIN" ? "orange" : "blue";
        const roleLabel = profile?.role === "SUPER_ADMIN" ? "Super Admin" : profile?.role === "ADMIN" ? "Admin" : "User";
        const myTokens  = Object.values(profile?.tokens || {});
        const totalUsed = myTokens.reduce((s, t) => s + t.used, 0);
        const totalLim  = myTokens.reduce((s, t) => s + (t.limit ?? 0), 0);
        const todayTok  = myTokens.reduce((s, t) => s + t.today, 0);
        const pct       = totalLim > 0 ? Math.min(100, Math.round((totalUsed / totalLim) * 100)) : 0;
        const userInitials = (profile?.name || profile?.email || "?").slice(0, 2).toUpperCase();

        return (
          <Paper withBorder p={{ base: "sm", sm: "lg" }} radius="lg" mb="lg"
            style={{ borderColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)" }}>
            {/* top row: logo + actions */}
            <Group justify="space-between" wrap="wrap" mb="md" gap="xs">
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
                {(isAdmin || status.isAdmin) &&
                  <Button component="a" href="/admin" variant="light" size="xs" radius="md" leftSection={<IconLogin size={13} />}>Admin</Button>
                }
                <Button component="a" href="/auth/logout" variant="default" size="xs" radius="md" leftSection={<IconLogout size={13} />}>Sign out</Button>
              </Group>
            </Group>

            <Divider mb="md" opacity={0.5} />

            {/* middle row: user profile + clock */}
            <Group justify="space-between" wrap="wrap" gap="sm" mb="md">
              {profile?.authenticated ? (
                <Group gap="sm" wrap="nowrap">
                  <Box style={{
                    width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                    background: `var(--mantine-color-${avatarColor(profile.name || profile.email || "")}-5)`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Text span fz={12} fw={700} c="white">{userInitials}</Text>
                  </Box>
                  <div>
                    <Group gap={6} align="center">
                      <Text size="sm" fw={600}>{profile.name || profile.email}</Text>
                      <Badge size="xs" color={roleColor} variant="light" radius="sm">{roleLabel}</Badge>
                    </Group>
                    <Text size="xs" c="dimmed">{profile.email}</Text>
                  </div>
                </Group>
              ) : <div />}
              <ClockInline />
            </Group>

            {/* quota row */}
            {profile?.authenticated && (
              <Group justify="space-between" wrap="wrap" gap="sm" mb="md">
                {totalLim > 0 ? (
                  <div style={{ flex: 1, minWidth: 180, maxWidth: 320 }}>
                    <Group justify="space-between" mb={4}>
                      <Text size="xs" c="dimmed">Quota</Text>
                      <Text size="xs" ff="monospace" c={pct > 80 ? "red" : "dimmed"}>{pct}%</Text>
                    </Group>
                    <Progress value={pct} size="xs" radius="xl" color={pct > 80 ? "red" : pct > 50 ? "yellow" : "blue"} />
                    <Text size="xs" c="dimmed" mt={3}>{nf.format(totalUsed)} / {nf.format(totalLim)} tokens</Text>
                  </div>
                ) : <div />}
                <Group gap="lg" wrap="nowrap">
                  <div style={{ textAlign: "right" }}>
                    <Text size="xs" c="dimmed">Today</Text>
                    <Text size="sm" fw={600} ff="monospace">{nf.format(todayTok)}</Text>
                  </div>
                  <Button component="a" href="/profile" variant="light" size="xs" radius="md" leftSection={<IconUsers size={13} />}>
                    Profile
                  </Button>
                </Group>
              </Group>
            )}

            <Divider mb="md" opacity={0.5} />

            {/* bottom row: active model */}
            <Group justify="space-between" wrap="nowrap" gap="md">
              <Group gap="sm" wrap="nowrap">
                <Box w={8} h={8} style={{ borderRadius: "50%", flexShrink: 0,
                  background: `var(--mantine-color-${provColor}-5)` }} />
                <Group gap={6} align="baseline" wrap="nowrap">
                  <Text size="sm" fw={600}>{provName}</Text>
                  <Text size="xs" c="dimmed" ff="monospace">{modelLabel}</Text>
                </Group>
                {isFallback && (
                  <Text size="xs" c="dimmed">
                    — rate-limited, auto-routing until Claude recovers
                  </Text>
                )}
              </Group>
              <Text size="xs" c="dimmed" tt="uppercase" style={{ letterSpacing: ".08em", flexShrink: 0 }}>
                {isFallback ? "fallback" : "primary"}
              </Text>
            </Group>
          </Paper>
        );
      })()}

      {/* ── Critical Sonnet Alert ────────────────────────────── */}
      {upstream?.sevenDaySonnet && (
        <SonnetCriticalAlert pct={Math.round(upstream.sevenDaySonnet.utilization)} />
      )}

      {/* ── Quick Stats ──────────────────────────────────────── */}
      <SimpleGrid cols={{ base: 2, sm: 4 }} mb="lg" id="stats" style={{ scrollMarginTop: 16 }}>
        <Paper withBorder p="md" radius="md" style={{ overflow: "hidden" }}>
          <Group gap="sm" mb={6}>
            <ThemeIcon variant="light" color="blue" size="md" radius="md">
              <IconActivity size={16} />
            </ThemeIcon>
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Today</Text>
          </Group>
          <Text fz={{ base: 18, xs: 22, sm: 24 }} fw={700} ff="monospace" c={todayTotal === 0 ? "dimmed" : undefined}
            style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {nf.format(todayTotal)}
          </Text>
          <Text size="xs" c="dimmed" mt={2}>
            {todayTotal === 0 ? "Quiet day — no requests yet" : "tokens used today"}
          </Text>
        </Paper>

        <Paper withBorder p="md" radius="md" style={{ overflow: "hidden" }}>
          <Group gap="sm" mb={6}>
            <ThemeIcon variant="light" color="violet" size="md" radius="md">
              <IconDatabase size={16} />
            </ThemeIcon>
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>All-Time</Text>
          </Group>
          <Text fz={{ base: 18, xs: 22, sm: 24 }} fw={700} ff="monospace"
            style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {nf.format(status.totalAllTime ?? 0)}
          </Text>
          <Text size="xs" c="dimmed" mt={2}>total tokens processed</Text>
        </Paper>

        <Paper withBorder p="md" radius="md" style={{ overflow: "hidden" }}>
          <Group gap="sm" mb={6}>
            <ThemeIcon variant="light" color="teal" size="md" radius="md">
              <IconUsers size={16} />
            </ThemeIcon>
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Active</Text>
          </Group>
          <Text fz={{ base: 18, xs: 22, sm: 24 }} fw={700} ff="monospace"
            style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {activeTokens}
            <Text span fz="sm" fw={400} c="dimmed"> / {totalTokens}</Text>
          </Text>
          <Text size="xs" c="dimmed" mt={2}>
            {totalTokens === 0 ? "no tokens configured" : activeTokens === 0 ? "no token has usage this window" : "tokens with usage this window"}
          </Text>
        </Paper>

        <Paper withBorder p="md" radius="md" style={{ overflow: "hidden" }}>
          <Group gap="sm" mb={6}>
            <ThemeIcon variant="light" color="orange" size="md" radius="md">
              <IconClock size={16} />
            </ThemeIcon>
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Resets In</Text>
          </Group>
          {countdownMs !== null ? (
            <>
              <Text fz={{ base: 18, xs: 22, sm: 24 }} fw={700} ff="monospace"
                style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                {fmtCountdown(countdownMs)}
              </Text>
              <Text size="xs" c="dimmed" mt={2}>
                at {new Date(resetsAtMs!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </Text>
            </>
          ) : (
            <>
              <Group gap="xs" align="center" mih={32}>
                <Loader size="xs" color="orange" />
                <Text fz="md" fw={500} c="dimmed">polling…</Text>
              </Group>
              <Text size="xs" c="dimmed" mt={2}>upstream not yet responded</Text>
            </>
          )}
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
      <Stack gap="xs" mb="lg" id="health" style={{ scrollMarginTop: 16 }}>
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Upstream Health</Text>
        <Paper withBorder p="md" radius="md">
          <UpstreamSection upstream={upstream} isAdmin={isAdmin} />
        </Paper>
      </Stack>

      {/* ── Token Usage Overview ─────────────────────────────── */}
      <Stack gap="xs" mb="lg" id="tokens" style={{ scrollMarginTop: 16 }}>
        <Group justify="space-between">
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>
            Token Usage
          </Text>
          {totalTokens > 0 && activeTokens === 0 && (
            <Badge size="xs" variant="light" color="teal">all quotas fresh</Badge>
          )}
        </Group>
        <Paper withBorder p="md" radius="md" style={{ overflow: "hidden" }}>
          {totalTokens === 0 ? (
            <Stack gap="xs" align="center" py="md">
              <ThemeIcon variant="light" color="gray" size="lg" radius="xl"><IconKey size={18} /></ThemeIcon>
              <Text size="sm" c="dimmed">No tokens configured yet</Text>
              {isAdmin && <Text size="xs" c="dimmed">Add a token below to start routing requests</Text>}
            </Stack>
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
                const display  = maskToken(tk.label);
                const dotColor = avatarColor(display);
                return (
                  <Box key={key} style={{ cursor: "pointer" }} onClick={() => setSelectedToken({ key, tk })}>
                    <Group gap="sm" wrap="nowrap" mb={4}>
                      <Group gap={6} style={{ minWidth: isAdmin ? 100 : 72, maxWidth: isAdmin ? 160 : 100, flexShrink: 0 }} wrap="nowrap">
                        <Box w={6} h={6} style={{ borderRadius: "50%", background: `var(--mantine-color-${dotColor}-5)`, flexShrink: 0 }} />
                        <Tooltip label={tk.label} withArrow openDelay={400} disabled={display === tk.label}>
                          <Text size="xs" ff="monospace" truncate>{display}</Text>
                        </Tooltip>
                        {ins && <Badge size="xs" variant="light" color={profColor[prof]}>{profLabel[prof]}</Badge>}
                      </Group>
                      <Progress value={pct} color={color} size="md" radius="sm" style={{ flex: 1 }} />
                      <Group gap={4} style={{ minWidth: 72, justifyContent: "flex-end", flexShrink: 0 }} wrap="nowrap">
                        {spike && <Tooltip label="Spike hari ini >2× rata-rata" withArrow><IconAlertTriangle size={12} color="var(--mantine-color-orange-5)" /></Tooltip>}
                        {tk.activeProvider && tk.activeProvider !== "anthropic" && (
                          <Text size="10px" ff="monospace"
                            c={tk.activeProvider === "deepseek" ? "violet" : "orange"}
                            style={{ flexShrink: 0 }}>
                            {tk.activeProvider === "deepseek" ? "deepseek" : "openrouter"}
                          </Text>
                        )}
                        <Text size="xs" ff="monospace" c="dimmed" ta="right" style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: 140 }}>
                          {nf.format(tk.used)}{tk.limit != null && ` / ${nf.format(tk.limit)}`}
                        </Text>
                      </Group>
                    </Group>
                    {/* Sparkline + burn rate */}
                    {spark.length === 7 && (
                      <Group gap="sm" wrap="nowrap" pl={isAdmin ? 108 : 80}>
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

      {/* ── All-Time Token Usage per User ───────────────────── */}
      {analytics && analytics.allTimeByUser.length > 0 && (() => {
        const COLORS = ["#228be6","#12b886","#fab005","#e03131","#7950f2","#fd7e14","#339af0","#20c997","#f59f00","#c92a2a","#74c0fc","#63e6be"];
        const grandTotal = analytics.allTimeByUser.reduce((s, u) => s + u.total, 0) || 1;
        return (
          <Stack gap="xs" mb="lg">
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>All-Time Usage per User</Text>
            <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
              <Stack gap={0}>
                {analytics.allTimeByUser.map((u, i) => {
                  const display = maskToken(u.user);
                  const pct     = Math.round((u.total / grandTotal) * 100);
                  const color   = COLORS[i % COLORS.length];
                  return (
                    <Box key={u.user} px="md" py="sm"
                      style={{ borderBottom: i < analytics.allTimeByUser.length - 1 ? "1px solid var(--mantine-color-default-border)" : undefined }}>
                      <Group justify="space-between" mb={6} wrap="nowrap">
                        <Group gap={8} wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                          <Box w={10} h={10} style={{ borderRadius: "50%", background: color, flexShrink: 0 }} />
                          <Tooltip label={u.user} withArrow openDelay={400} disabled={display === u.user}>
                            <Text size="sm" fw={600} ff="monospace" truncate>{display}</Text>
                          </Tooltip>
                        </Group>
                        <Group gap="xl" wrap="nowrap">
                          <Box ta="right" style={{ minWidth: 90 }}>
                            <Text size="10px" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".06em" }}>All-Time</Text>
                            <Text size="sm" ff="monospace" fw={700}>{nf.format(u.total)}</Text>
                          </Box>
                          <Box ta="right" style={{ minWidth: 40 }}>
                            <Text size="10px" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".06em" }}>Share</Text>
                            <Text size="sm" ff="monospace" fw={600} style={{ color }}>{pct}%</Text>
                          </Box>
                        </Group>
                      </Group>
                      <Progress value={pct} color={color} size="xs" radius="xl"
                        style={{ background: isDark ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.06)" }} />
                    </Box>
                  );
                })}
              </Stack>
            </Paper>
          </Stack>
        );
      })()}

      {/* ── Today's Activity ─────────────────────────────────── */}
      {hourly.length === 24 && (() => {
        const maxTok = Math.max(...hourly.map(h => h.tokens), 1);
        const curH   = new Date().getHours();
        const dayTotal = hourly.reduce((s, h) => s + h.tokens, 0);
        return (
          <Stack gap="xs" mb="lg" id="activity" style={{ scrollMarginTop: 16 }}>
            <Group justify="space-between">
              <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Today's Activity</Text>
              <Text size="xs" c="dimmed" ff="monospace">{nf.format(dayTotal)} tokens</Text>
            </Group>
            <Paper withBorder p="md" radius="md">
              {dayTotal === 0 ? (
                <Stack gap={4} align="center" py="md">
                  <ThemeIcon variant="light" color="gray" size="lg" radius="xl"><IconChartHistogram size={18} /></ThemeIcon>
                  <Text size="sm" c="dimmed">No activity yet today</Text>
                  <Text size="xs" c="dimmed">Hourly bars will appear as requests arrive</Text>
                </Stack>
              ) : (
                <>
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
                </>
              )}
            </Paper>
          </Stack>
        );
      })()}

      {/* ── Leaderboard + User Usage Charts ─────────────────── */}
      <Box id="users" style={{ scrollMarginTop: 16 }}>
      {analytics && analytics.leaderboard.length > 0 && (() => {
        const CHART_COLORS = ["#228be6","#12b886","#fab005","#e03131","#7950f2","#fd7e14","#339af0","#20c997","#f59f00","#c92a2a","#74c0fc","#63e6be"];
        const board = analytics.leaderboard.slice(0, 10);
        return (
          <Stack gap="md" mb="lg">
            {/* Leaderboard table */}
            <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
              <Group gap="xs" px="md" py="sm" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
                <ThemeIcon variant="light" color="yellow" size="sm" radius="sm"><IconTrophy size={13} /></ThemeIcon>
                <Text size="sm" fw={700}>Leaderboard</Text>
                <Text size="xs" c="dimmed">— ranked by all-time token usage</Text>
              </Group>
              <Table.ScrollContainer minWidth={360}>
                <Table highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th style={{ width: 40 }}>#</Table.Th>
                      <Table.Th>User</Table.Th>
                      <Table.Th ta="right">Today</Table.Th>
                      <Table.Th ta="right">All-Time</Table.Th>
                      <Table.Th ta="center">Peak Hour</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {board.map((u, i) => {
                      const display = maskToken(u.label);
                      const dot = avatarColor(display);
                      return (
                        <Table.Tr key={u.label}>
                          <Table.Td>
                            <Text size="sm" fw={700} c={i === 0 ? "yellow" : i === 1 ? "gray" : i === 2 ? "orange" : "dimmed"} ff="monospace">{i + 1}</Text>
                          </Table.Td>
                          <Table.Td>
                            <Group gap={6} wrap="nowrap">
                              <Box w={8} h={8} style={{ borderRadius: "50%", background: `var(--mantine-color-${dot}-5)`, flexShrink: 0 }} />
                              <Tooltip label={u.label} withArrow openDelay={400} disabled={display === u.label}>
                                <Badge variant="light" color={u.paused ? "gray" : "blue"} size="sm" ff="monospace">{display}</Badge>
                              </Tooltip>
                              {u.paused && <Badge size="xs" color="gray">paused</Badge>}
                            </Group>
                          </Table.Td>
                          <Table.Td ta="right"><Text size="sm" ff="monospace">{u.today > 0 ? nf.format(u.today) : "—"}</Text></Table.Td>
                          <Table.Td ta="right"><Text size="sm" ff="monospace" fw={600}>{nf.format(u.alltime)}</Text></Table.Td>
                          <Table.Td ta="center">
                            {u.peakHour != null
                              ? <Badge size="xs" variant="outline" color="gray">{fmtHour(u.peakHour)}</Badge>
                              : <Text size="xs" c="dimmed">—</Text>}
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Paper>

            {/* All-time usage bar chart */}
            <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
              <Group gap="xs" px="md" py="sm" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
                <ThemeIcon variant="light" color="blue" size="sm" radius="sm"><IconChartBar size={13} /></ThemeIcon>
                <Text size="sm" fw={700}>All-Time Token Usage</Text>
                <Text size="xs" c="dimmed">— total tokens per user</Text>
              </Group>
              <Box px="md" pb="md" pt="sm">
                <ReactECharts
                  style={{ height: Math.max(140, board.length * 38) }}
                  opts={{ renderer: "canvas" }}
                  option={{
                    backgroundColor: "transparent",
                    tooltip: {
                      trigger: "axis",
                      axisPointer: { type: "shadow" },
                      formatter: (params: any[]) => {
                        const p = params[0];
                        const br = "<" + "br/>";
                        return p.name + br + nf.format(p.value) + " tokens";
                      },
                    },
                    grid: { top: 8, bottom: 8, left: "2%", right: "14%", containLabel: true },
                    xAxis: {
                      type: "value",
                      axisLabel: {
                        color: isDark ? "#6c757d" : "#868e96", fontSize: 10,
                        formatter: (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(0)}k` : String(v),
                      },
                      splitLine: { lineStyle: { color: isDark ? "#373a40" : "#dee2e6", type: "dashed" } },
                    },
                    yAxis: {
                      type: "category",
                      data: [...board].reverse().map(u => maskToken(u.label)),
                      axisLabel: { color: isDark ? "#c1c2c5" : "#343a40", fontSize: 12, fontFamily: "monospace" },
                      axisLine: { show: false }, axisTick: { show: false },
                    },
                    series: [{
                      type: "bar",
                      data: [...board].reverse().map((u, i) => ({
                        value: u.alltime,
                        itemStyle: {
                          color: CHART_COLORS[(board.length - 1 - i) % CHART_COLORS.length],
                          borderRadius: [0, 4, 4, 0],
                        },
                      })),
                      barMaxWidth: 28,
                      label: {
                        show: true, position: "right",
                        color: isDark ? "#c1c2c5" : "#495057", fontSize: 11,
                        formatter: (p: any) => {
                          const v = p.value as number;
                          return v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(0)}k` : String(v);
                        },
                      },
                    }],
                  }}
                />
              </Box>
            </Paper>
          </Stack>
        );
      })()}

      {/* Daily usage stacked area chart */}
      {analytics && analytics.dailyByUser.length > 1 && (() => {
        const CHART_COLORS = ["#228be6","#12b886","#fab005","#e03131","#7950f2","#fd7e14","#339af0","#20c997","#f59f00","#c92a2a","#74c0fc","#63e6be"];
        const dates = analytics.dailyByUser.map(d => d.date);
        const userNames = analytics.dailyUsers.slice(0, 10);
        return (
          <Paper withBorder radius="md" mb="lg" style={{ overflow: "hidden" }}>
            <Group gap="xs" px="md" py="sm" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
              <ThemeIcon variant="light" color="teal" size="sm" radius="sm"><IconChartHistogram size={13} /></ThemeIcon>
              <Text size="sm" fw={700}>Daily Token Usage per User</Text>
              <Text size="xs" c="dimmed">— last 30 days</Text>
            </Group>
            <Box px="md" pb="md" pt="sm">
              <ReactECharts
                style={{ height: 260 }}
                opts={{ renderer: "canvas" }}
                option={{
                  backgroundColor: "transparent",
                  tooltip: {
                    trigger: "axis",
                    axisPointer: { type: "cross" },
                    formatter: (params: any[]) => {
                      const br = "<" + "br/>";
                      const bOpen = "<" + "b>", bClose = "<" + "/b>";
                      const spanOpen = (color: string) => "<" + `span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:4px">`;
                      const spanClose = "<" + "/span>";
                      const date = params[0]?.axisValue ?? "";
                      const lines = params
                        .filter((p: any) => p.value > 0)
                        .sort((a: any, b: any) => b.value - a.value)
                        .map((p: any) => spanOpen(p.color) + spanClose + p.seriesName + ": " + nf.format(p.value));
                      return [bOpen + date + bClose, ...lines].join(br);
                    },
                  },
                  legend: {
                    bottom: 0,
                    textStyle: { color: isDark ? "#c1c2c5" : "#343a40", fontSize: 11 },
                    icon: "circle", itemWidth: 8, itemHeight: 8,
                    formatter: (name: string) => maskToken(name),
                  },
                  grid: { top: 12, bottom: 48, left: 60, right: 16 },
                  xAxis: {
                    type: "category",
                    data: dates,
                    axisLabel: {
                      color: isDark ? "#6c757d" : "#868e96", fontSize: 10,
                      formatter: (v: string) => v.slice(5),
                      interval: Math.floor(dates.length / 6),
                    },
                    axisLine: { lineStyle: { color: isDark ? "#373a40" : "#dee2e6" } },
                    axisTick: { show: false },
                  },
                  yAxis: {
                    type: "value",
                    axisLabel: {
                      color: isDark ? "#6c757d" : "#868e96", fontSize: 10,
                      formatter: (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(0)}k` : String(v),
                    },
                    splitLine: { lineStyle: { color: isDark ? "#373a40" : "#dee2e6", type: "dashed" } },
                  },
                  series: userNames.map((user, i) => ({
                    name: user,
                    type: "line",
                    stack: "total",
                    areaStyle: { opacity: isDark ? 0.55 : 0.45 },
                    smooth: true,
                    symbol: "none",
                    lineStyle: { width: 1.5, color: CHART_COLORS[i % CHART_COLORS.length] },
                    itemStyle: { color: CHART_COLORS[i % CHART_COLORS.length] },
                    data: dates.map(d => {
                      const day = analytics.dailyByUser.find(x => x.date === d);
                      return day?.by_user[user] ?? 0;
                    }),
                  })),
                }}
              />
            </Box>
          </Paper>
        );
      })()}
      </Box>

      {/* ── Analytics: Model + Stop Reason ───────────────────── */}
      {analytics && (
        <Box id="analytics" mb="lg" style={{ scrollMarginTop: 16 }}>
          <Stack gap="lg">
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              {analytics.modelDist.length > 0 && (
                <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
                  <Group gap="xs" px="md" py="sm" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
                    <ThemeIcon variant="light" color="blue" size="sm" radius="sm"><IconChartPie size={13} /></ThemeIcon>
                    <Text size="sm" fw={700}>Model Distribution</Text>
                  </Group>
                  <Box p="md">
                    <ReactECharts
                      style={{ height: 200 }}
                      opts={{ renderer: "canvas" }}
                      option={{
                        backgroundColor: "transparent",
                        tooltip: { trigger: "item", formatter: "{b}: {c} tokens ({d}%)" },
                        legend: { orient: "vertical", right: "5%", top: "center", textStyle: { color: isDark ? "#c1c2c5" : "#343a40", fontSize: 12 } },
                        series: [{
                          type: "pie", radius: ["45%", "72%"], center: ["38%", "50%"],
                          avoidLabelOverlap: true,
                          label: { show: false },
                          emphasis: { label: { show: true, fontSize: 14, fontWeight: "bold" } },
                          data: analytics.modelDist.map((m, i) => ({
                            name: m.model, value: m.tokens,
                            itemStyle: { color: ["#228be6","#12b886","#fab005","#e03131","#7950f2"][i % 5] },
                          })),
                        }],
                      }}
                    />
                  </Box>
                </Paper>
              )}

              {analytics.stopReasonDist.length > 0 && (() => {
                const stopTotal = analytics.stopReasonDist.reduce((s, r) => s + r.n, 0) || 1;
                const stopColors: Record<string, string> = { end_turn: "#12b886", max_tokens: "#f76707", stop_sequence: "#228be6", tool_use: "#7950f2" };
                return (
                  <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
                    <Group gap="xs" px="md" py="sm" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
                      <ThemeIcon variant="light" color="teal" size="sm" radius="sm"><IconBolt size={13} /></ThemeIcon>
                      <Text size="sm" fw={700}>Stop Reason Distribution</Text>
                    </Group>
                    <Stack gap="sm" p="md">
                      {analytics.stopReasonDist.map(r => (
                        <Group key={r.stop_reason} gap="sm" wrap="nowrap">
                          <Text size="xs" ff="monospace" style={{ minWidth: 130 }}>{r.stop_reason || "unknown"}</Text>
                          <Progress value={Math.round((r.n / stopTotal) * 100)} color={stopColors[r.stop_reason] ?? "gray"} size="sm" radius="sm" style={{ flex: 1 }} />
                          <Text size="xs" ff="monospace" c="dimmed" style={{ minWidth: 40, textAlign: "right" }}>{r.n}</Text>
                        </Group>
                      ))}
                      {analytics.stopReasonDist.some(r => r.stop_reason === "max_tokens") && (
                        <Text size="xs" c="orange" mt={4}>
                          ⚠ stop_reason: max_tokens — respons terpotong. User perlu naikkan max_tokens atau pecah task.
                        </Text>
                      )}
                    </Stack>
                  </Paper>
                );
              })()}
            </SimpleGrid>

            {/* Peak Hours (7-day pattern) */}
            {analytics.peakHours.length > 0 && (() => {
              return (
                <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
                  <Group justify="space-between" px="md" py="sm" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
                    <Group gap="xs">
                      <ThemeIcon variant="light" color="orange" size="sm" radius="sm"><IconClock size={13} /></ThemeIcon>
                      <Text size="sm" fw={700}>Peak Hours</Text>
                      <Text size="xs" c="dimmed">— 7-day request pattern</Text>
                    </Group>
                    <Badge size="sm" variant="light" color="blue">Peak: {fmtHour(analytics.peakHour)}</Badge>
                  </Group>
                  <Box px="md" pb="sm">
                    <ReactECharts
                      style={{ height: 120 }}
                      opts={{ renderer: "canvas" }}
                      option={{
                        backgroundColor: "transparent",
                        tooltip: { trigger: "axis", formatter: (p: any[]) => `${fmtHour(p[0].dataIndex)} · ${p[0].value} requests` },
                        grid: { top: 10, bottom: 30, left: 40, right: 10 },
                        xAxis: { type: "category", data: analytics.peakHours.map(h => h.h % 6 === 0 ? fmtHour(h.h) : ""),
                          axisLabel: { color: isDark ? "#6c757d" : "#868e96", fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } },
                        yAxis: { type: "value", axisLabel: { show: false }, splitLine: { lineStyle: { color: isDark ? "#373a40" : "#dee2e6", type: "dashed" } } },
                        series: [{
                          type: "bar", barMaxWidth: 18,
                          data: analytics.peakHours.map(h => ({
                            value: h.requests,
                            itemStyle: { color: h.h === analytics.peakHour ? "#228be6" : (isDark ? "#373a40" : "#dee2e6"), borderRadius: [3, 3, 0, 0] },
                          })),
                        }],
                      }}
                    />
                  </Box>
                </Paper>
              );
            })()}

            {/* Cache Hit Rate */}
            {analytics.cacheHitRate.length > 0 && (
              <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
                <Group gap="xs" px="md" py="sm" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
                  <ThemeIcon variant="light" color="violet" size="sm" radius="sm"><IconDatabase size={13} /></ThemeIcon>
                  <Text size="sm" fw={700}>Cache Hit Rate per User</Text>
                  <Text size="xs" c="dimmed">— higher = longer sessions, more efficient</Text>
                </Group>
                <Stack gap="sm" p="md">
                  {analytics.cacheHitRate.map(u => {
                    const display = maskToken(u.label);
                    const dot = avatarColor(display);
                    return (
                      <Group key={u.label} gap="sm" wrap="nowrap">
                        <Group gap={6} wrap="nowrap" style={{ minWidth: 110, maxWidth: 160 }}>
                          <Box w={6} h={6} style={{ borderRadius: "50%", background: `var(--mantine-color-${dot}-5)`, flexShrink: 0 }} />
                          <Tooltip label={u.label} withArrow openDelay={400} disabled={display === u.label}>
                            <Text size="xs" ff="monospace" truncate>{display}</Text>
                          </Tooltip>
                        </Group>
                        <Tooltip label={`${u.hitRate}% of ${nf.format(u.totalInput + u.totalCached)} input tokens served from cache`} withArrow>
                          <Progress value={u.hitRate} color={u.hitRate > 60 ? "teal" : u.hitRate > 30 ? "yellow" : "orange"} size="md" radius="sm" style={{ flex: 1 }} />
                        </Tooltip>
                        <Text size="xs" ff="monospace" c="dimmed" style={{ minWidth: 40, textAlign: "right" }}>{u.hitRate}%</Text>
                      </Group>
                    );
                  })}
                </Stack>
              </Paper>
            )}

            {/* Anomaly Scores */}
            {analytics.anomalyScores.length > 0 && (() => {
              const ANOMALY_PAGE = 10;
              const anomalyPages = Math.ceil(analytics.anomalyScores.length / ANOMALY_PAGE);
              const anomalySlice = analytics.anomalyScores.slice(
                (anomalyPage - 1) * ANOMALY_PAGE, anomalyPage * ANOMALY_PAGE
              );
              return (
              <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
                <Group gap="xs" px="md" py="sm" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
                  <ThemeIcon variant="light" color="red" size="sm" radius="sm"><IconFlame size={13} /></ThemeIcon>
                  <Text size="sm" fw={700}>Anomaly Score</Text>
                  <Text size="xs" c="dimmed">— heaviest requests, scored 0–100 from input tokens, ratio, tool use, duration</Text>
                  <Badge size="xs" variant="light" color="red" ml="auto">{analytics.anomalyScores.length} entries</Badge>
                </Group>
                <Table.ScrollContainer minWidth={380}>
                  <Table highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Score</Table.Th>
                        <Table.Th>User</Table.Th>
                        <Table.Th>Time</Table.Th>
                        <Table.Th ta="right">Input</Table.Th>
                        <Table.Th ta="right">Output</Table.Th>
                        <Table.Th ta="right">Turns</Table.Th>
                        <Table.Th ta="right">Tools</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {anomalySlice.map(r => {
                        const display = maskToken(r.label);
                        const openDetail = async () => {
                          setAnomalyDetailLoading(true);
                          openAnomalyModal();
                          try {
                            const res = await fetch(`/api/logs/${r.id}`);
                            if (res.ok) setAnomalyDetail(await res.json());
                          } finally { setAnomalyDetailLoading(false); }
                        };
                        return (
                          <Table.Tr key={r.id} style={{ cursor: "pointer" }} onClick={openDetail}>
                            <Table.Td>
                              <Badge size="sm" style={{ background: anomalyScoreColor(r.score), color: "#fff" }} ff="monospace">{r.score}</Badge>
                            </Table.Td>
                            <Table.Td>
                              <Tooltip label={r.label} withArrow openDelay={400} disabled={display === r.label}>
                                <Text size="xs" ff="monospace">{display}</Text>
                              </Tooltip>
                            </Table.Td>
                            <Table.Td><Text size="xs" c="dimmed">{new Date(r.ts).toLocaleString()}</Text></Table.Td>
                            <Table.Td ta="right"><Text size="xs" ff="monospace" c={r.input_tokens > 100_000 ? "red" : r.input_tokens > 50_000 ? "orange" : "dimmed"}>{nf.format(r.input_tokens)}</Text></Table.Td>
                            <Table.Td ta="right"><Text size="xs" ff="monospace" c="dimmed">{nf.format(r.output_tokens)}</Text></Table.Td>
                            <Table.Td ta="right"><Text size="xs" ff="monospace" c="dimmed">{r.turns}</Text></Table.Td>
                            <Table.Td ta="right"><Text size="xs" ff="monospace" c={r.tool_use > 10 ? "violet" : "dimmed"}>{r.tool_use}</Text></Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>

                {anomalyPages > 1 && (
                  <Group justify="space-between" p="sm" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
                    <Text size="xs" c="dimmed">{analytics.anomalyScores.length} entries · page {anomalyPage}/{anomalyPages}</Text>
                    <Pagination total={anomalyPages} value={anomalyPage} onChange={setAnomalyPage} size="sm" />
                  </Group>
                )}
              </Paper>
              );
            })()}
          </Stack>
        </Box>
      )}

      {/* ── Token Detail Modal ───────────────────────────────── */}
      {selectedToken && (
        <TokenDetailModal
          tokenKey={selectedToken.key}
          tk={selectedToken.tk}
          ins={insights[selectedToken.key]}
          opened={!!selectedToken}
          onClose={() => setSelectedToken(null)}
        />
      )}

      {/* ── Anomaly Detail Modal ─────────────────────────────── */}
      <Modal opened={anomalyModalOpen} onClose={() => { closeAnomalyModal(); setAnomalyDetail(null); }}
        title="Request Detail" size="lg" centered>
        {anomalyDetailLoading
          ? <Group justify="center" py="xl"><Loader size="sm" /></Group>
          : anomalyDetail
          ? <DetailContent log={anomalyDetail} />
          : <Text size="sm" c="dimmed">Failed to load detail.</Text>
        }
      </Modal>

      {/* ── Request Log (public shows compact preview) ───────── */}
      <Box id="logs" style={{ scrollMarginTop: 16 }}>
        <RequestLog isAdmin={isAdmin} />
      </Box>

      {/* ── Admin-only sections ──────────────────────────────── */}
      {isAdmin && (
        <>
          <Divider my="lg" />

          <Stack gap="xs" mb="xl">
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Daily History</Text>
            <Paper withBorder style={{ overflow: "hidden" }}>
              <DailyHistory isAdmin={isAdmin} />
            </Paper>
          </Stack>
        </>
      )}
    </Container>

    <BackToTop />
    <FloatingChat userName={profile?.name || profile?.email} />
    </Box>
  );
}

export function App() {
  const [status, setStatus]     = useState<StatusResponse | null>(null);
  const [profile, setProfile]   = useState<import("./contexts").ProfileResponse | null | "loading">("loading");
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

  useEffect(() => {
    fetch("/api/profile", { credentials: "include" })
      .then(r => r.json())
      .then(d => setProfile(d))
      .catch(() => setProfile({ authenticated: false }));
  }, []);

  return (
    <ChatCtx.Provider value={{ messages: chatMsgs, send: sendChat }}>
      <StatusCtx.Provider value={status}>
        <Routes>
          <Route path="/" element={
            <RequireAuth profile={profile}>
              {status ? <Dashboard isAdmin={profile !== "loading" && (profile?.role === "SUPER_ADMIN" || profile?.role === "ADMIN")} profile={profile as import("./contexts").ProfileResponse} /> : <LoadingScreen />}
            </RequireAuth>
          } />
          <Route path="/admin" element={
            <RequireAdmin>
              <AdminDashboard />
            </RequireAdmin>
          } />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/login/redirect" element={<LoginRedirect />} />
          <Route path="/menunggu" element={<WaitingPage />} />
          <Route path="/diblokir" element={<BlockedPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/mind" element={<MindPage />} />
          <Route path="/race" element={<RacePage />} />
          <Route path="/sessions/:user" element={<SessionHistory />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </StatusCtx.Provider>
    </ChatCtx.Provider>
  );
}
