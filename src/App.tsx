import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useDisclosure } from "@mantine/hooks";
import { Routes, Route } from "react-router-dom";
import ReactECharts from "echarts-for-react";
import {
  Container, Group, Stack, Title, Text, Box, Button, Paper,
  ActionIcon, Tooltip, TextInput, useMantineColorScheme,
  SimpleGrid, Progress, ThemeIcon, Divider, Alert, Badge, Code, Collapse, Loader, Transition,
  Table, Pagination, Modal, Anchor, Tabs, Overlay, Center, RingProgress, Indicator, Popover, ScrollArea,
} from "@mantine/core";
import {
  IconSun, IconMoon, IconLogout, IconLogin,
  IconRefresh, IconPlayerPause, IconPencil, IconPlus,
  IconUsers, IconActivity, IconClock, IconDatabase,
  IconAlertTriangle, IconAlertHexagon, IconChevronDown, IconChevronUp,
  IconBulb, IconX, IconChartBar, IconArrowUp, IconHeartbeat, IconKey,
  IconChartHistogram, IconList, IconLayoutGrid, IconFlame, IconChartPie, IconBolt,
  IconTrophy, IconBrain, IconLayoutDashboard, IconChartLine, IconMessages, IconHistory,
  IconBrandGoogle, IconShieldCheck, IconCheck, IconBell, IconBellOff, IconExternalLink, IconChecks,
} from "@tabler/icons-react";
import { StatusCtx, ChatCtx, NotificationsCtx } from "./contexts";
import type { StatusResponse, ChatMsg, ContextAlert, AppNotification, NotificationsCtxType } from "./contexts";
import { notifications } from "@mantine/notifications";
import { pctColor, adminPost, maskToken, avatarColor, fmtRel } from "./utils";
import { resolveProvider, shortenModel, type ProviderInfo } from "./providerDisplay";
import { useStatus, useNotifications } from "./contexts";
import { LoadingScreen, NotFoundPage, RequireAdmin, RequireAuth, WaitingPage, BlockedPage, UpstreamSection } from "./components/shared";
import { CompetitionPanel } from "./components/CompetitionPanel";
import { UserAvatar } from "./components/UserAvatar";
import { AdminUserActivity } from "./components/admin/UserActivity";
import { LiveFeed } from "./components/LiveFeed";
import { SessionsContent } from "./components/SessionHistory";
import { DailyHistory } from "./components/tables/DailyHistory";
import { RequestLog, DetailContent } from "./components/tables/RequestLog";
import { FeedHistory } from "./components/FeedHistory";
import { AdminDashboard } from "./components/admin/Dashboard";
import { MindPage } from "./components/MindPage";
import { RacePage } from "./components/RacePage";
import { SessionHistory } from "./components/SessionHistory";
import { FloatingChat } from "./components/FloatingChat";
import { NotificationsPage } from "./components/NotificationsPage";
import { ContextPunishmentScreen } from "./components/ContextPunishmentScreen";
import { GraceBanner } from "./components/GraceBanner";
import { UserNotificationModal } from "./components/UserNotificationModal";

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


function ContextAlertOverlay({ alerts, onDismiss }: {
  alerts: ContextAlert[];
  onDismiss: (key: string) => void;
}) {
  const worst = alerts[0];
  if (!worst) return null;

  const isCrit  = worst.severity === "critical";
  const msg     = contextMessage(worst);
  const color   = isCrit ? "#dc2626" : "#ea580c";
  const bgColor = isCrit ? "rgba(220,38,38,0.08)" : "rgba(234,88,12,0.07)";
  const Icon    = isCrit ? IconAlertHexagon : IconAlertTriangle;
  const nf      = new Intl.NumberFormat();
  const key     = worst.label + worst.ts;

  return (
    <>
      <Overlay backgroundOpacity={0.75} blur={6} zIndex={300} />
      <Center style={{ position: "fixed", inset: 0, zIndex: 301, padding: 16 }}>
        <Box style={{
          width: "100%", maxWidth: 520,
          background: "var(--mantine-color-body)",
          borderRadius: 20,
          border: `2px solid ${color}`,
          boxShadow: `0 0 60px ${color}40, 0 24px 48px rgba(0,0,0,0.4)`,
          overflow: "hidden",
        }}>
          {/* Top stripe */}
          <Box style={{ height: 6, background: `linear-gradient(90deg, ${color}, ${color}99)` }} />

          <Stack gap={0} p="xl">
            {/* Header */}
            <Group gap="md" mb="lg" align="flex-start">
              <RingProgress size={72} thickness={6} roundCaps
                sections={[{ value: Math.min(100, worst.ratio), color }]}
                label={<Center><Icon size={22} color={color} /></Center>}
              />
              <Box style={{ flex: 1 }}>
                <Group gap="xs" mb={4}>
                  <Badge color={isCrit ? "red" : "orange"} variant="filled" size="sm" tt="uppercase">
                    {isCrit ? "⚠ Critical" : "⚠ Warning"}
                  </Badge>
                  <Text size="xs" c="dimmed" ff="monospace">{worst.label}</Text>
                </Group>
                <Text fw={800} fz={18} lh={1.3} style={{ letterSpacing: "-0.02em" }}>
                  {msg.title}
                </Text>
              </Box>
            </Group>

            {/* Stats */}
            <SimpleGrid cols={3} mb="lg" style={{ background: bgColor, borderRadius: 12, padding: "12px 16px" }}>
              <Box>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".06em" }}>Input</Text>
                <Text fw={700} ff="monospace" fz={16} style={{ color }}>{nf.format(worst.input_tokens)}</Text>
              </Box>
              <Box>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".06em" }}>Output</Text>
                <Text fw={700} ff="monospace" fz={16}>{nf.format(worst.output_tokens)}</Text>
              </Box>
              <Box>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".06em" }}>Rasio</Text>
                <Text fw={700} ff="monospace" fz={16} style={{ color }}>{worst.ratio}×</Text>
              </Box>
            </SimpleGrid>

            {/* What & why */}
            <Stack gap="sm" mb="lg">
              <Box>
                <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={4} style={{ letterSpacing: ".06em" }}>Apa yang terjadi</Text>
                <Text size="sm" lh={1.6}>{msg.what}</Text>
              </Box>
              <Box>
                <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={4} style={{ letterSpacing: ".06em" }}>Mengapa</Text>
                <Text size="sm" c="dimmed" lh={1.6}>{msg.why}</Text>
              </Box>
            </Stack>

            {/* Steps */}
            <Stack gap="sm" mb="xl">
              <Group gap="xs">
                <IconBulb size={14} color="var(--mantine-color-yellow-5)" />
                <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".06em" }}>Yang bisa dilakukan sekarang</Text>
              </Group>
              {msg.steps.map((s, i) => (
                <Group key={i} gap="sm" align="flex-start" wrap="nowrap"
                  style={{ background: "var(--mantine-color-default-hover)", borderRadius: 10, padding: "10px 14px" }}>
                  <Badge variant="outline" color="gray" size="sm" style={{ flexShrink: 0, marginTop: 2 }}>{i + 1}</Badge>
                  <Box>
                    <Group gap="xs" mb={2}>
                      {s.cmd && <Code fz="sm" fw={700}>{s.cmd}</Code>}
                      <Text size="sm" fw={600}>{s.label}</Text>
                    </Group>
                    <Text size="xs" c="dimmed">{s.desc}</Text>
                  </Box>
                </Group>
              ))}
            </Stack>

            {/* Actions */}
            <Group gap="sm">
              <Button flex={1} color={isCrit ? "red" : "orange"} size="md" radius="xl" fw={700}
                onClick={() => onDismiss(key)}>
                Saya Mengerti — Akan Saya Tangani
              </Button>
              {alerts.length > 1 && (
                <Text size="xs" c="dimmed" ta="center">
                  +{alerts.length - 1} alert lain
                </Text>
              )}
            </Group>
          </Stack>
        </Box>
      </Center>
    </>
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
    <Group gap={10} wrap="nowrap" align="center">
      <Box hiddenFrom="sm">
        <Text fz={16} fw={800} ff="Geist Mono, monospace" lh={1} style={{ letterSpacing: "-0.03em" }}>
          {hh}:{mm}
        </Text>
      </Box>
      <Box visibleFrom="sm">
        <Group gap={4} wrap="nowrap" align="center">
          <IconClock size={11} color="var(--cp-text-3)" />
          <Text fz={11} c="dimmed">{day}, {date}</Text>
        </Group>
        <Group gap={3} align="baseline" wrap="nowrap" mt={1}>
          <Text fz={19} fw={800} ff="Geist Mono, monospace" lh={1} style={{ letterSpacing: "-0.04em" }}>
            {hh}:{mm}
          </Text>
          <Text fz={12} ff="Geist Mono, monospace" lh={1} c="dimmed">:{ss}</Text>
          <Text fz={10} c="dimmed" ml={3}>{tz}</Text>
        </Group>
      </Box>
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

function TokenDetailModal({ tokenKey, tk, ins, opened, onClose, customProviders = [] }: {
  tokenKey: string;
  tk: import("./contexts").TokenStatus;
  ins: import("./contexts").UserInsight | undefined;
  opened: boolean;
  onClose: () => void;
  customProviders?: ProviderInfo[];
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

  const providerInfo = resolveProvider(tk.activeProvider || "anthropic", customProviders);
  const providerName  = providerInfo.name;
  const providerColor = providerInfo.color;

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

  const customProviders: ProviderInfo[] = (profile?.custom_providers ?? [])
    .map(p => ({ id: p.id, name: p.name, color: p.color || "gray" }));

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
                <UserAvatar name={profile.name || profile.email || "?"} imageUrl={profile.image} size={46} />
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
                const literalInfo   = resolveProvider(tk.provider || "inherit", customProviders);
                const effectiveInfo = resolveProvider(tk.effective_provider || "anthropic", customProviders);
                // If literal === "inherit", show effective (more useful). Else show literal.
                const showInfo = tk.provider === "inherit" ? effectiveInfo : literalInfo;
                const pn = showInfo.name;
                const pc = showInfo.color;
                const showEffectiveTooltip = tk.provider === "inherit" && tk.effective_provider !== "anthropic";
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
                      {/* Token label + description (admin-set, if any) */}
                      {(tk.label || tk.description) && (
                        <div>
                          {tk.label && (
                            <Text size="sm" fw={700} ff="monospace" style={{ letterSpacing: "-0.01em" }}>
                              {tk.label}
                            </Text>
                          )}
                          {tk.description && (
                            <Text size="xs" c="dimmed" mt={2}>{tk.description}</Text>
                          )}
                        </div>
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
                          <Tooltip
                            withArrow
                            label={tk.provider === "inherit"
                              ? `Provider: Auto (routes to ${effectiveInfo.name})`
                              : `Provider: ${pn} (explicitly assigned)`}>
                            <Badge size="xs" color={pc} variant={showEffectiveTooltip ? "outline" : "light"}>
                              {tk.provider === "inherit" ? `Auto → ${effectiveInfo.name}` : pn}
                            </Badge>
                          </Tooltip>
                          {tk.pinned_model && (
                            <Tooltip withArrow label={`Pinned model: ${tk.pinned_model}`}>
                              <Badge size="xs" color={pc} variant="outline">
                                {shortenModel(tk.pinned_model, 16)}
                              </Badge>
                            </Tooltip>
                          )}
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
  const [signing, setSigning] = useState(false);
  const [errorParam, setErrorParam] = useState<string | null>(null);
  const [version, setVersion] = useState<string>("");
  const [upstreamOk, setUpstreamOk] = useState<boolean>(true);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const e = p.get("error");
    if (e) setErrorParam(e);
    fetch("/api/status", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then((d: any) => {
        if (d?.version) setVersion(d.version);
        if (d?.upstream) setUpstreamOk(!!d.upstream.ok);
      })
      .catch(() => {});
  }, []);

  const handleSignIn = async () => {
    setSigning(true);
    try { await signInWithGoogle(); }
    finally { setTimeout(() => setSigning(false), 5000); }
  };

  const features = [
    { label: "Share Claude Max across your team via OAuth" },
    { label: "Per-user quota, rate limits, and audit logs" },
    { label: "Automatic fallback to DeepSeek or OpenRouter" },
    { label: "Real-time monitoring with quota alerts" },
  ];

  const rightBg   = isDark ? "#0e1014" : "#ffffff";
  const leftBg    = isDark ? "#0a0b10" : "#fafbfc";
  const borderCol = isDark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.08)";
  const accent    = "#3b82f6";

  return (
    <Box style={{
      minHeight: "100vh",
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr)",
      background: rightBg,
    }} className="cp-login-grid">
      {/* CSS for responsive split */}
      <style>{`
        @media (min-width: 992px) {
          .cp-login-grid { grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr) !important; }
          .cp-login-left { display: flex !important; }
        }
        .cp-login-left { display: none; }
      `}</style>

      {/* ── LEFT: welcome + brand + features ─────────────────────────────────── */}
      <Box className="cp-login-left" style={{
        flexDirection: "column",
        padding: "48px 56px",
        background: leftBg,
        borderRight: `1px solid ${borderCol}`,
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Subtle accent gradient */}
        <Box style={{
          position: "absolute", inset: 0,
          background: isDark
            ? "radial-gradient(ellipse 80% 60% at 0% 100%, rgba(59,130,246,0.10) 0%, transparent 60%)"
            : "radial-gradient(ellipse 80% 60% at 0% 100%, rgba(59,130,246,0.08) 0%, transparent 60%)",
          pointerEvents: "none",
        }} />

        {/* Top: brand */}
        <Group gap={10} align="center" style={{ position: "relative", zIndex: 1 }}>
          <Box style={{
            width: 32, height: 32,
            background: accent,
            borderRadius: 8,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Text span fz={12} fw={700} c="white" ff="monospace" style={{ letterSpacing: "-0.02em" }}>CP</Text>
          </Box>
          <Text fw={600} size="md" ff="monospace">claude-proxy</Text>
        </Group>

        {/* Middle: welcome + features */}
        <Box style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", marginTop: 32, marginBottom: 32, position: "relative", zIndex: 1 }}>
          <Stack gap="md" maw={460}>
            <Stack gap={8}>
              <Text fz={11} fw={600} tt="uppercase" c={accent} style={{ letterSpacing: "0.12em" }}>
                Welcome back
              </Text>
              <Text fw={700} style={{ fontSize: 36, lineHeight: 1.1, letterSpacing: "-0.03em" }}>
                The smart gateway for sharing Claude with your team.
              </Text>
              <Text size="md" c="dimmed" style={{ lineHeight: 1.55 }} mt={8}>
                One Claude Max account, many users. Manage quotas, monitor usage in real-time, and never lose service to rate limits.
              </Text>
            </Stack>

            <Divider my="md" opacity={0.5} />

            <Stack gap={12}>
              {features.map(({ label }) => (
                <Group key={label} gap={12} wrap="nowrap" align="flex-start">
                  <Box style={{
                    marginTop: 4,
                    width: 18, height: 18,
                    borderRadius: 5,
                    background: isDark ? "rgba(59,130,246,0.15)" : "rgba(59,130,246,0.1)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <IconCheck size={11} color={accent} stroke={3} />
                  </Box>
                  <Text size="sm" c={isDark ? "gray.3" : "dark.6"} style={{ lineHeight: 1.55 }}>
                    {label}
                  </Text>
                </Group>
              ))}
            </Stack>
          </Stack>
        </Box>

        {/* Bottom: status meta */}
        <Group justify="space-between" align="center" wrap="wrap" gap="xs" style={{ position: "relative", zIndex: 1 }}>
          <Group gap={6}>
            <Box w={6} h={6} style={{
              borderRadius: "50%",
              background: upstreamOk ? "var(--mantine-color-teal-5)" : "var(--mantine-color-yellow-5)",
              boxShadow: upstreamOk ? "0 0 8px var(--mantine-color-teal-5)" : "0 0 8px var(--mantine-color-yellow-5)",
            }} />
            <Text size="xs" c="dimmed">{upstreamOk ? "All systems operational" : "Limited service"}</Text>
          </Group>
          {version && <Text size="xs" c="dimmed" ff="monospace">v{version}</Text>}
        </Group>
      </Box>

      {/* ── RIGHT: login form ────────────────────────────────────────────────── */}
      <Box style={{
        display: "flex", flexDirection: "column",
        background: rightBg,
        minHeight: "100vh",
      }}>
        {/* Mobile-only top bar with brand */}
        <Box className="cp-login-mobile-brand" style={{ padding: "20px 24px" }}>
          <style>{`
            @media (min-width: 992px) { .cp-login-mobile-brand { display: none !important; } }
          `}</style>
          <Group gap={10} align="center">
            <Box style={{
              width: 28, height: 28,
              background: accent,
              borderRadius: 7,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Text span fz={11} fw={700} c="white" ff="monospace" style={{ letterSpacing: "-0.02em" }}>CP</Text>
            </Box>
            <Text fw={600} size="sm" ff="monospace">claude-proxy</Text>
          </Group>
        </Box>

        <Box style={{
          flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
          padding: "40px 24px",
        }}>
          <Transition mounted transition="fade" duration={300}>
            {(styles) => (
              <Stack gap={28} style={{ ...styles, width: "100%", maxWidth: 380 }}>
                {/* Heading */}
                <Stack gap={6}>
                  <Text fw={700} fz={26} style={{ letterSpacing: "-0.025em", lineHeight: 1.2 }}>
                    Sign in
                  </Text>
                  <Text size="sm" c="dimmed" style={{ lineHeight: 1.55 }}>
                    Continue with your Google account to access the dashboard.
                  </Text>
                </Stack>

                {errorParam && (
                  <Alert color="red" variant="light" icon={<IconAlertTriangle size={14} />} radius="sm" p="sm">
                    <Text size="xs">
                      Sign-in failed: <Code>{errorParam}</Code>
                    </Text>
                  </Alert>
                )}

                {/* Sign-in button */}
                <Button fullWidth size="md" radius="sm"
                  loading={signing}
                  onClick={handleSignIn}
                  leftSection={<IconBrandGoogle size={17} stroke={2} />}
                  color={accent}
                  style={{ fontWeight: 500, fontSize: 14 }}>
                  Continue with Google
                </Button>

                {/* Trust note */}
                <Group gap={6} justify="center" wrap="nowrap" mt={-12}>
                  <IconShieldCheck size={11} color="var(--mantine-color-dimmed)" />
                  <Text size="xs" c="dimmed" ta="center">
                    New accounts require admin approval before first use
                  </Text>
                </Group>

                <Divider opacity={0.5} />

                {/* Footer links */}
                <Group justify="space-between" gap="xs" wrap="wrap">
                  <Anchor href="/" size="xs" c="dimmed" style={{ fontWeight: 500 }}>
                    Public stats →
                  </Anchor>
                  <Text size="xs" c="dimmed">
                    Need help? Contact admin
                  </Text>
                </Group>
              </Stack>
            )}
          </Transition>
        </Box>

        {/* Right footer (legal) */}
        <Box style={{ padding: "20px 24px" }}>
          <Text size="xs" c="dimmed" ta="center">
            © {new Date().getFullYear()} claude-proxy · By signing in you agree to admin usage policies
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

function SessionsTab({ tokens }: { tokens: import("./contexts").StatusResponse["tokens"] }) {
  const status = useStatus();
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">(() => {
    try { return (localStorage.getItem("sessions-view") as "grid" | "list") || "grid"; } catch { return "grid"; }
  });
  const [sessionCounts, setSessionCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch("/api/sessions/summary")
      .then(r => r.ok ? r.json() : {})
      .then(setSessionCounts)
      .catch(() => {});
  }, []);

  const userOptions = [...new Set(
    Object.values(tokens).map(tk => tk.owner_name || tk.token_label || tk.name).filter(Boolean)
  )].sort().map(n => ({ value: n, label: n }));

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <TextInput
          placeholder="Cari atau pilih user…"
          value={selectedUser || ""}
          onChange={e => setSelectedUser(e.currentTarget.value || null)}
          leftSection={<IconMessages size={14} />}
          rightSection={selectedUser ? (
            <Box style={{ cursor: "pointer", display: "flex" }} onClick={() => setSelectedUser(null)}>
              <IconX size={14} color="var(--cp-text-3)" />
            </Box>
          ) : null}
          size="sm"
          style={{ flex: 1 }}
        />
        {!selectedUser && (
          <Group gap={4}>
            <ActionIcon
              variant={viewMode === "grid" ? "filled" : "default"}
              color={viewMode === "grid" ? "blue" : "gray"}
              size="sm" radius="md"
              onClick={() => { setViewMode("grid"); try { localStorage.setItem("sessions-view", "grid"); } catch {} }}
            >
              <IconLayoutGrid size={14} />
            </ActionIcon>
            <ActionIcon
              variant={viewMode === "list" ? "filled" : "default"}
              color={viewMode === "list" ? "blue" : "gray"}
              size="sm" radius="md"
              onClick={() => { setViewMode("list"); try { localStorage.setItem("sessions-view", "list"); } catch {} }}
            >
              <IconList size={14} />
            </ActionIcon>
          </Group>
        )}
      </Group>

      {userOptions.length > 0 && !selectedUser && (
        <Stack gap="xs">
          <Text fz={11} fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: ".07em" }}>Pilih User</Text>

          {viewMode === "grid" ? (
            <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="xs">
              {userOptions.map(u => (
                <Paper key={u.value} withBorder p="sm" radius="md"
                  style={{ cursor: "pointer", transition: "all 0.15s" }}
                  onClick={() => setSelectedUser(u.value)}
                  className="cp-interactive">
                  <Group gap={8} wrap="nowrap">
                    <UserAvatar name={u.value} imageUrl={status?.userImages?.[u.value]} size={28} />
                    <Box style={{ minWidth: 0, flex: 1 }}>
                      <Text fz={12} fw={600} truncate>{u.value}</Text>
                      {sessionCounts[u.value] != null && (
                        <Text fz={10} c="dimmed">{sessionCounts[u.value]} session</Text>
                      )}
                    </Box>
                  </Group>
                </Paper>
              ))}
            </SimpleGrid>
          ) : (
            <Stack gap={4}>
              {userOptions.map(u => (
                <Paper key={u.value} withBorder px="md" py="xs" radius="md"
                  style={{ cursor: "pointer", transition: "all 0.15s" }}
                  onClick={() => setSelectedUser(u.value)}
                  className="cp-interactive">
                  <Group justify="space-between" wrap="nowrap">
                    <Group gap={8} wrap="nowrap">
                      <UserAvatar name={u.value} imageUrl={status?.userImages?.[u.value]} size={26} />
                      <Text fz={13} fw={600}>{u.value}</Text>
                    </Group>
                    {sessionCounts[u.value] != null && (
                      <Badge size="xs" variant="light" color="blue">
                        {sessionCounts[u.value]} session
                      </Badge>
                    )}
                  </Group>
                </Paper>
              ))}
            </Stack>
          )}
        </Stack>
      )}

      {selectedUser && (
        <Box>
          <Group gap="xs" mb="md">
            <Badge
              variant="light" color="blue" size="sm" ff="monospace"
              style={{ cursor: "pointer" }}
              onClick={() => setSelectedUser(null)}
            >
              ← {selectedUser}
            </Badge>
            <Text fz={11} c="dimmed">klik untuk ganti user</Text>
          </Group>
          <SessionsContent user={selectedUser} />
        </Box>
      )}
    </Stack>
  );
}

const NOTIF_COLOR_DOT: Record<string, string> = {
  red: "var(--mantine-color-red-6)", orange: "var(--mantine-color-orange-6)",
  teal: "var(--mantine-color-teal-6)", blue: "var(--mantine-color-blue-6)",
};

function NotificationPopover() {
  const { items, unread, markAllRead } = useNotifications();
  const [opened, setOpened] = useState(false);
  const recent = items.slice(0, 8);

  return (
    <Popover
      opened={opened} onChange={setOpened}
      position="bottom-end" offset={8} withArrow arrowSize={10}
      shadow="md" radius="md" width={340}
    >
      <Popover.Target>
        <Tooltip label="Notifikasi" position="bottom" withArrow openDelay={600} disabled={opened}>
          <Indicator
            label={unread > 99 ? "99+" : unread}
            size={16} disabled={unread === 0} color="red"
            style={{ display: "flex" }}
          >
            <ActionIcon
              variant="subtle" size="md" radius="lg"
              style={{ color: "var(--cp-text-2)" }}
              onClick={() => setOpened(o => !o)}
            >
              <IconBell size={15} />
            </ActionIcon>
          </Indicator>
        </Tooltip>
      </Popover.Target>

      <Popover.Dropdown p={0} style={{ overflow: "hidden" }}>
        {/* Header */}
        <Group justify="space-between" px={14} py={10}
          style={{ borderBottom: "1px solid var(--cp-border)" }}>
          <Group gap={8}>
            <IconBell size={14} style={{ color: "var(--cp-text-2)" }} />
            <Text fz={13} fw={700} style={{ letterSpacing: "-0.01em" }}>Notifikasi</Text>
            {unread > 0 && <Badge size="xs" color="red" variant="filled" circle>{unread}</Badge>}
          </Group>
          {unread > 0 && (
            <Tooltip label="Tandai semua dibaca" withArrow>
              <ActionIcon size="xs" variant="subtle" color="teal" onClick={markAllRead}>
                <IconChecks size={13} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>

        {/* List */}
        {recent.length === 0 ? (
          <Stack align="center" gap={6} py={28}>
            <IconBellOff size={24} style={{ color: "var(--cp-text-3)" }} />
            <Text fz={12} c="dimmed">Belum ada notifikasi</Text>
          </Stack>
        ) : (
          <ScrollArea.Autosize mah={320} scrollbarSize={4}>
            <Stack gap={0}>
              {recent.map((n, i) => (
                <Box key={n.id}>
                  {i > 0 && <Divider />}
                  <Box px={14} py={10}
                    style={{
                      borderLeft: n.read ? "3px solid transparent" : `3px solid ${NOTIF_COLOR_DOT[n.color] ?? NOTIF_COLOR_DOT.blue}`,
                    }}>
                    <Group gap={8} wrap="nowrap" align="flex-start">
                      <Box style={{
                        width: 7, height: 7, borderRadius: "50%", flexShrink: 0, marginTop: 5,
                        background: n.read ? "var(--cp-text-3)" : (NOTIF_COLOR_DOT[n.color] ?? NOTIF_COLOR_DOT.blue),
                        opacity: n.read ? 0.4 : 1,
                      }} />
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Group justify="space-between" gap={4} wrap="nowrap">
                          <Text fz={12} fw={n.read ? 500 : 700} truncate>{n.title}</Text>
                          <Text fz={10} c="dimmed" ff="Geist Mono, monospace" style={{ flexShrink: 0 }}>
                            {fmtRel(n.ts)}
                          </Text>
                        </Group>
                        <Text fz={11} c="dimmed" lineClamp={2} mt={2}>{n.message}</Text>
                      </Box>
                    </Group>
                  </Box>
                </Box>
              ))}
            </Stack>
          </ScrollArea.Autosize>
        )}

        {/* Footer */}
        <Box px={14} py={10} style={{ borderTop: "1px solid var(--cp-border)" }}>
          <Button
            component="a" href="/notifications"
            variant="light" size="xs" radius="lg" fullWidth
            rightSection={<IconExternalLink size={12} />}
            style={{ fontWeight: 600, fontSize: 12 }}
            onClick={() => setOpened(false)}
          >
            Lihat semua notifikasi
          </Button>
        </Box>
      </Popover.Dropdown>
    </Popover>
  );
}

function Dashboard({ isAdmin, profile, wsSignal }: { isAdmin: boolean; profile?: import("./contexts").ProfileResponse; wsSignal?: number }) {
  const status = useStatus()!;
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const { tokens, upstream, contextAlerts = [], thresholdAlerts = [], insights = {} } = status;
  const [activeTab, setActiveTab] = useState<string>(() => {
    try { return localStorage.getItem("dashboard-tab") || "dashboard"; } catch { return "dashboard"; }
  });
  const headerRef = useRef<HTMLDivElement>(null);
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>([]);
  const [dismissedThresh, setDismissedThresh] = useState<string[]>([]);
  const [dismissedOverlay, setDismissedOverlay] = useState<string[]>([]);
  const visibleAlerts  = contextAlerts.filter(a => !dismissedAlerts.includes(a.label + a.ts));
  const visibleThresh  = thresholdAlerts.filter(a => !dismissedThresh.includes(a.label + a.type));

  // Alerts milik user yang sedang login — cocokkan label token dengan nama token user
  const myTokenNames = Object.values(profile?.tokens ?? {}).map(t => t.name).filter(Boolean);
  const myAlerts = contextAlerts.filter(a =>
    myTokenNames.includes(a.label) && !dismissedOverlay.includes(a.label + a.ts)
  );

  // Dynamic background: prairie-to-fire scene driven by 5h upstream utilization.
  // t=0 → calm (faint blue sky tint). t=1 → dark sky + deep red fire from bottom.
  const utilPct = upstream?.fiveHour?.utilization ?? 0;
  const t       = Math.max(0, Math.min(1, utilPct / 90));
  const isDark  = colorScheme === "dark" ||
    (colorScheme === "auto" && typeof window !== "undefined" &&
     window.matchMedia("(prefers-color-scheme: dark)").matches);
  const pageBg  = useMemo(() => {
    if (t <= 0) return "transparent";

    // ── Sky (top) — blue wash fading to dark as fire grows ──────────────
    const skyA = isDark ? (0.10 + t * 0.12) : (0.10 + t * 0.10);
    const skyR = Math.round(20  + t * 20);
    const skyG = Math.round(60  - t * 55);
    const skyB = Math.round(150 - t * 130);
    const sky  = `radial-gradient(ellipse 220% 55% at 50% 0%, rgba(${skyR},${skyG},${skyB},${skyA.toFixed(3)}) 0%, transparent 65%)`;

    // ── Fire (bottom) — green meadow → amber → orange → deep red ────────
    // colour shifts through phases based on t
    const fr = Math.round(t < 0.35 ? 30  + t * 560 : t < 0.65 ? 226 - (t-0.35)*100 : 196);
    const fg = Math.round(t < 0.35 ? 90  - t * 257 : t < 0.65 ? Math.max(0, 0 - (t-0.35)*0) : 0);
    const fb = Math.round(t < 0.35 ? 50  - t * 143 : 0);
    const fireA  = isDark ? (t * 0.55) : (t * 0.35);
    const fireA2 = isDark ? (t * 0.25) : (t * 0.15);
    const fire = `radial-gradient(ellipse 180% 75% at 50% 100%, rgba(${fr},${fg},${fb},${fireA.toFixed(3)}) 0%, rgba(${Math.round(fr*0.6)},${Math.round(fg*0.3)},0,${fireA2.toFixed(3)}) 40%, transparent 75%)`;

    return `${sky}, ${fire}`;
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

  // Custom providers for display name/color resolution
  const [customProviders, setCustomProviders] = useState<ProviderInfo[]>([]);
  useEffect(() => {
    fetch("/api/admin/custom-providers", { credentials: "include" })
      .then(r => r.ok ? r.json() : { providers: [] })
      .then((d: any) => {
        const list: ProviderInfo[] = (Array.isArray(d?.providers) ? d.providers : [])
          .map((p: any) => ({ id: p.id, name: p.name, color: p.color || "gray" }));
        setCustomProviders(list);
      })
      .catch(() => {});
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

  const quotaPct = (() => {
    const myTokens  = Object.values(profile?.tokens ?? {});
    const totalUsed = myTokens.reduce((s, t) => s + t.used, 0);
    const totalLim  = myTokens.reduce((s, t) => s + (t.limit ?? 0), 0);
    return totalLim > 0 ? Math.min(100, Math.round((totalUsed / totalLim) * 100)) : 0;
  })();

  return (
    <Box className="cp-page-bg" style={{ minHeight: "100vh", backgroundImage: pageBg !== "transparent" ? pageBg : undefined, backgroundAttachment: "fixed" }}>
    {/* ── Sticky Header (Navbar + Sub-header) ─────────────── */}
    {(() => {
      const ap         = upstream?.activeProvider;
      const anthropicAvail = upstream?.anthropicAvailable ?? true;
      // When Anthropic is not connected, "anthropic" is no longer a sensible
      // default for display — fall back to whatever active provider we have.
      const displayProvider = ap || (anthropicAvail ? "anthropic" : "");
      const isFallback = !!ap && ap !== "anthropic";
      const provInfo   = resolveProvider(displayProvider || "anthropic", customProviders);
      const provName   = displayProvider ? provInfo.name : "no provider";
      const colorMap: Record<string, string> = {
        blue:   "#3b82f6", violet: "#7c3aed", orange: "#f97316", teal: "#0d9488",
        gray:   "#71717a", pink:   "#ec4899", cyan:   "#06b6d4", yellow: "#eab308",
        lime:   "#84cc16", indigo: "#6366f1", red:    "#ef4444",
      };
      const provDot    = upstream?.ok || isFallback ? (colorMap[provInfo.color] || "#3b82f6") : "#71717a";
      const modelLabel = shortenModel(upstream?.activeModel || (anthropicAvail ? "claude-sonnet-4-6" : "—"), 20);
      const roleColor  = profile?.role === "SUPER_ADMIN" ? "red" : profile?.role === "ADMIN" ? "orange" : "blue";
      const roleLabel  = profile?.role === "SUPER_ADMIN" ? "Super Admin" : profile?.role === "ADMIN" ? "Admin" : "User";
      const myTokens   = Object.values(profile?.tokens || {});
      const totalUsed  = myTokens.reduce((s, t) => s + t.used, 0);
      const totalLim   = myTokens.reduce((s, t) => s + (t.limit ?? 0), 0);
      const todayTok   = myTokens.reduce((s, t) => s + t.today, 0);
      const pct        = totalLim > 0 ? Math.min(100, Math.round((totalUsed / totalLim) * 100)) : 0;
      const pctColor   = pct >= 95 ? "#dc2626" : pct >= 75 ? "#f97316" : pct >= 50 ? "#d97706" : "#2563eb";

      return (
        <>
          {/* ── Navbar — sticky ─────────────────────────── */}
          <div ref={headerRef} className="cp-header-fixed">
          <Box px={{ base: 12, sm: 24 }} style={{ height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 1800, margin: "0 auto" }}>
            <Group gap={12} wrap="nowrap">
              {/* Logo */}
              <Box style={{
                width: 34, height: 34, flexShrink: 0,
                background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
                borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 2px 8px rgba(37,99,235,0.35)",
              }}>
                <Text span fz={11} fw={800} c="white" ff="Geist Mono, monospace" style={{ letterSpacing: "-0.03em" }}>CP</Text>
              </Box>
              <div>
                <Text fw={700} fz={15} lh={1.2} style={{ letterSpacing: "-0.02em" }}>claude-proxy</Text>
                <Text fz={11} c="dimmed" visibleFrom="sm" lh={1}>Multi-user Claude Max proxy</Text>
              </div>
            </Group>

            <Group gap={6} wrap="nowrap">
              <NotificationPopover />
              <Tooltip label="Toggle theme" position="bottom" withArrow openDelay={600}>
                <ActionIcon variant="subtle" size="md" radius="lg" onClick={() => toggleColorScheme()}
                  style={{ color: "var(--cp-text-2)" }}>
                  {colorScheme === "dark" ? <IconSun size={15} /> : <IconMoon size={15} />}
                </ActionIcon>
              </Tooltip>
              {(isAdmin || status.isAdmin) && (
                <Button component="a" href="/admin" size="xs" variant="light" radius="lg"
                  leftSection={<IconLogin size={12} />}
                  style={{ fontWeight: 600, fontSize: 12 }}>
                  Admin
                </Button>
              )}
              <Button component="a" href="/auth/logout" size="xs" variant="subtle" radius="lg"
                leftSection={<IconLogout size={12} />}
                style={{ fontWeight: 600, fontSize: 12, color: "var(--cp-text-2)" }}>
                <Text visibleFrom="xs" span>Sign out</Text>
              </Button>
            </Group>
          </Box>

          </div>

          {/* ── Sub-header — scroll normal ──────────────── */}
          <Box px={{ base: 12, sm: 24 }} py={10}
            style={{ borderTop: "1px solid var(--cp-border)", borderBottom: "1px solid var(--cp-border)" }}>
            <Group justify="space-between" gap="md" wrap="wrap" style={{ maxWidth: 1800, margin: "0 auto" }}>

              {/* Left: User + Quota + Model */}
              <Group gap={16} wrap="wrap" style={{ flex: 1, minWidth: 0 }}>

                {/* Avatar + Name */}
                {profile?.authenticated && (
                  <Group gap={8} wrap="nowrap" style={{ flexShrink: 0 }}>
                    <UserAvatar name={profile?.name || profile?.email || "?"} imageUrl={profile?.image} size={32} />
                    <Box>
                      <Group gap={5} wrap="nowrap">
                        <Text fz={13} fw={600} style={{ letterSpacing: "-0.01em" }}>
                          {profile.name || profile.email?.split("@")[0]}
                        </Text>
                        <Badge size="xs" color={roleColor} variant="light" style={{ fontSize: 10, fontWeight: 700 }}>
                          {roleLabel}
                        </Badge>
                      </Group>
                      <Text fz={10} c="dimmed">{profile.email}</Text>
                    </Box>
                  </Group>
                )}

                {/* Quota bar */}
                {totalLim > 0 && (
                  <Box style={{ minWidth: 140, maxWidth: 240, flex: 1 }}>
                    <Group justify="space-between" mb={4}>
                      <Text fz={10} c="dimmed" fw={500} tt="uppercase" style={{ letterSpacing: ".06em" }}>Quota</Text>
                      <Text fz={10} ff="Geist Mono, monospace" fw={700} style={{ color: pctColor }}>{pct}%</Text>
                    </Group>
                    <Box style={{ height: 3, background: "var(--cp-surface-3)", borderRadius: 4, overflow: "hidden" }}>
                      <Box style={{
                        height: "100%", borderRadius: 4,
                        width: `${pct}%`,
                        background: pct >= 95 ? "var(--cp-red)" : pct >= 75 ? "var(--cp-amber)" : "var(--cp-accent)",
                        transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)",
                      }} />
                    </Box>
                    <Text fz={10} c="dimmed" mt={3} ff="Geist Mono, monospace">
                      {nf.format(totalUsed)} <Text span c="dimmed" fz={9}>/ {nf.format(totalLim)}</Text>
                    </Text>
                  </Box>
                )}

                {/* Model status */}
                <Group gap={6} wrap="nowrap" visibleFrom="md">
                  <Box w={6} h={6} style={{ borderRadius: "50%", background: provDot, flexShrink: 0 }} />
                  <Text fz={12} fw={600}>{provName}</Text>
                  <Text fz={11} c="dimmed" ff="Geist Mono, monospace">{modelLabel}</Text>
                  <Badge size="xs" variant="dot" color={isFallback ? "orange" : "teal"} style={{ fontSize: 10 }}>
                    {isFallback ? "fallback" : "primary"}
                  </Badge>
                </Group>
              </Group>

              {/* Right: clock + today + profile */}
              <Group gap={12} wrap="nowrap" style={{ flexShrink: 0 }}>
                <ClockInline />
                <Box ta="center" style={{ flexShrink: 0 }}>
                  <Text fz={9} c="dimmed" tt="uppercase" style={{ letterSpacing: ".06em" }}>Today</Text>
                  <Text fz={14} fw={700} ff="Geist Mono, monospace" lh={1.2}>{nf.format(todayTok)}</Text>
                </Box>
                <Button component="a" href="/profile" size="xs" variant="light" radius="lg"
                  leftSection={<IconUsers size={11} />}
                  style={{ fontWeight: 600, fontSize: 12 }}>
                  <Text visibleFrom="xs" span>Profile</Text>
                </Button>
              </Group>

            </Group>
          </Box>
        </>
      );
    })()}


    {/* ── 2-kolom: Tabs (kiri) + LiveFeed (kanan) ──────────── */}
    <Box px={{ base: 12, sm: 24 }} pt="xl" pb="xl" style={{ maxWidth: 1800, margin: "0 auto" }}>
      <Box className="dashboard-grid cp-stagger">

        {/* ── Kiri: Tabs ─────────────────────────────────────── */}
        <Box className="cp-fade-in">
          <Tabs value={activeTab} onChange={v => { if (!v) return; setActiveTab(v); try { localStorage.setItem("dashboard-tab", v); } catch {} }} variant="pills" radius="lg">
            <Tabs.List mb="lg">
              <Tabs.Tab value="dashboard" leftSection={<IconLayoutDashboard size={13} />}
                style={{ fontWeight: 600, fontSize: 13, letterSpacing: "-0.01em" }}>
                Dashboard
              </Tabs.Tab>
              <Tabs.Tab value="activity" leftSection={<IconChartLine size={13} />}
                style={{ fontWeight: 600, fontSize: 13, letterSpacing: "-0.01em" }}>
                Activity
              </Tabs.Tab>
              <Tabs.Tab value="sessions" leftSection={<IconMessages size={13} />}
                style={{ fontWeight: 600, fontSize: 13, letterSpacing: "-0.01em" }}>
                Sessions
              </Tabs.Tab>
              <Tabs.Tab value="history" leftSection={<IconHistory size={13} />}
                style={{ fontWeight: 600, fontSize: 13, letterSpacing: "-0.01em" }}>
                History
              </Tabs.Tab>
              {/* Feed tab: hanya muncul di mobile */}
              <Tabs.Tab value="feed" leftSection={<IconActivity size={13} />}
                hiddenFrom="sm"
                style={{ fontWeight: 600, fontSize: 13, letterSpacing: "-0.01em" }}>
                Feed
              </Tabs.Tab>
            </Tabs.List>

            {/* ── Tab Dashboard ─────────────────────────────── */}
            <Tabs.Panel value="dashboard">
              <Stack gap="lg">

      {/* ── Critical Sonnet Alert ────────────────────────────── */}
      {upstream?.sevenDaySonnet && (
        <SonnetCriticalAlert pct={Math.round(upstream.sevenDaySonnet.utilization)} />
      )}

      {/* ── Quick Stats ──────────────────────────────────────── */}
      <SimpleGrid cols={{ base: 2, sm: 4 }} mb="lg" id="stats" style={{ scrollMarginTop: 16 }}
        className="cp-stagger">
        <Box className="cp-stat-card cp-fade-in">
          <Group gap={8} mb={8}>
            <Box style={{
              width: 28, height: 28, borderRadius: 8, flexShrink: 0,
              background: "var(--cp-accent-dim)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <IconActivity size={14} color="var(--cp-accent)" />
            </Box>
            <Text fz={10} fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Today</Text>
          </Group>
          <Text fz={{ base: 20, sm: 26 }} fw={800} ff="Geist Mono, monospace"
            c={todayTotal === 0 ? "dimmed" : "var(--cp-text)"}
            style={{ letterSpacing: "-0.03em", lineHeight: 1 }}>
            {nf.format(todayTotal)}
          </Text>
          <Text fz={11} c="dimmed" mt={4}>
            {todayTotal === 0 ? "Quiet — no requests yet" : "tokens used today"}
          </Text>
        </Box>

        <Box className="cp-stat-card cp-fade-in">
          <Group gap={8} mb={8}>
            <Box style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(124,58,237,0.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <IconDatabase size={14} color="#7c3aed" />
            </Box>
            <Text fz={10} fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>All-Time</Text>
          </Group>
          <Text fz={{ base: 20, sm: 26 }} fw={800} ff="Geist Mono, monospace" style={{ letterSpacing: "-0.03em", lineHeight: 1 }}>
            {nf.format(status.totalAllTime ?? 0)}
          </Text>
          <Text fz={11} c="dimmed" mt={4}>total tokens processed</Text>
        </Box>

        <Box className="cp-stat-card cp-fade-in">
          <Group gap={8} mb={8}>
            <Box style={{ width: 28, height: 28, borderRadius: 8, background: "var(--cp-teal-dim)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <IconUsers size={14} color="var(--cp-teal)" />
            </Box>
            <Text fz={10} fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Active</Text>
          </Group>
          <Text fz={{ base: 20, sm: 26 }} fw={800} ff="Geist Mono, monospace" style={{ letterSpacing: "-0.03em", lineHeight: 1 }}>
            {activeTokens}
            <Text span fz={14} fw={500} c="dimmed"> /{totalTokens}</Text>
          </Text>
          <Text fz={11} c="dimmed" mt={4}>
            {totalTokens === 0 ? "no tokens configured" : activeTokens === 0 ? "none active this window" : "tokens active this window"}
          </Text>
        </Box>

        <Box className="cp-stat-card cp-fade-in">
          <Group gap={8} mb={8}>
            <Box style={{ width: 28, height: 28, borderRadius: 8, background: "var(--cp-amber-dim)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <IconClock size={14} color="var(--cp-amber)" />
            </Box>
            <Text fz={10} fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Resets In</Text>
          </Group>
          {countdownMs !== null ? (
            <>
              <Text fz={{ base: 20, sm: 26 }} fw={800} ff="Geist Mono, monospace" style={{ letterSpacing: "-0.03em", lineHeight: 1 }}>
                {fmtCountdown(countdownMs)}
              </Text>
              <Text fz={11} c="dimmed" mt={4}>
                at {new Date(resetsAtMs!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </Text>
            </>
          ) : (
            <>
              <Group gap={6} align="center" mih={28}>
                <Loader size={10} color="orange" />
                <Text fz={13} fw={500} c="dimmed">polling…</Text>
              </Group>
              <Text fz={11} c="dimmed" mt={4}>waiting for upstream</Text>
            </>
          )}
        </Box>
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
            <Stack gap="lg">
              {(() => {
                // Group tokens by owner (user_id). Orphan tokens (no user_id) get
                // an individual synthetic group so they still display.
                type Row = { key: string; tk: typeof tokens[string] };
                const groups = new Map<string, { ownerName: string; rows: Row[] }>();
                for (const [key, tk] of Object.entries(tokens)) {
                  const gk = tk.user_id || `__orphan__:${key}`;
                  const ownerName = tk.owner_name || "";
                  if (!groups.has(gk)) groups.set(gk, { ownerName, rows: [] });
                  groups.get(gk)!.rows.push({ key, tk });
                }
                const groupArr = Array.from(groups.entries()).map(([gk, g]) => {
                  const totalUsed  = g.rows.reduce((s, r) => s + r.tk.used, 0);
                  const totalLimit = g.rows.reduce((s, r) => s + (r.tk.limit ?? 0), 0);
                  const hasInf     = g.rows.some(r => r.tk.limit == null);
                  return {
                    groupKey: gk,
                    ownerName: g.ownerName,
                    rows: g.rows.sort((a, b) => b.tk.used - a.tk.used),
                    totalUsed, totalLimit, hasInf,
                    isOrphan: gk.startsWith("__orphan__:"),
                  };
                }).sort((a, b) => b.totalUsed - a.totalUsed);
                const cap = isAdmin ? 20 : 6;
                return groupArr.slice(0, cap).map(g => {
                  const pctTotal = g.hasInf ? 0 : g.totalLimit > 0 ? Math.min(100, Math.round((g.totalUsed / g.totalLimit) * 100)) : 0;
                  const colorTotal = pctTotal >= 95 ? "red" : pctTotal >= 75 ? "orange" : pctTotal >= 50 ? "yellow" : "teal";
                  // Header label: owner name (when known) or single token's label (orphan)
                  const headerName  = g.isOrphan ? maskToken(g.rows[0]!.tk.token_label || g.rows[0]!.tk.label) : (g.ownerName || "Anonymous");
                  const headerImage = g.isOrphan ? undefined : status.userImages?.[g.ownerName];
                  return (
                    <Box key={g.groupKey}>
                      {/* User header row */}
                      <Group gap="sm" wrap="nowrap" mb={6}>
                        <Group gap={8} style={{ minWidth: isAdmin ? 140 : 110, maxWidth: isAdmin ? 200 : 160, flexShrink: 0 }} wrap="nowrap">
                          <UserAvatar name={headerName} imageUrl={headerImage} size={26} />
                          <Text size="sm" fw={600} truncate>{headerName}</Text>
                          {g.rows.length > 1 && <Badge size="xs" variant="light" color="gray">{g.rows.length} tokens</Badge>}
                        </Group>
                        <Progress value={pctTotal} color={colorTotal} size="sm" radius="sm" style={{ flex: 1 }} />
                        <Text size="xs" ff="monospace" c="dimmed" ta="right" style={{ flexShrink: 0, minWidth: 100 }}>
                          {nf.format(g.totalUsed)}{!g.hasInf && g.totalLimit > 0 && ` / ${nf.format(g.totalLimit)}`}
                        </Text>
                      </Group>
                      {/* Token rows nested under owner */}
                      <Stack gap={4} pl={isAdmin ? 36 : 30}>
                        {g.rows.map(({ key, tk }) => {
                          const pct      = tk.limit == null ? 0 : Math.min(100, Math.round((tk.used / tk.limit) * 100));
                          const color    = tk.paused ? "gray" : pct >= 95 ? "red" : pct >= 75 ? "orange" : pct >= 50 ? "yellow" : "teal";
                          const ins      = insights[key];
                          const spike    = (ins?.burnRate.spikeMultiple ?? 0) >= 2;
                          const hoursL   = ins?.burnRate.hoursLeft;
                          // Explicit label, or fall back to model identity for unlabeled tokens.
                          const explicitLabel = tk.token_label || "";
                          const modelShort = (tk.activeModel || "").replace(/^claude-/, "").replace(/-\d{8}$/, "");
                          const rowLabel   = explicitLabel || (modelShort ? `default · ${modelShort}` : "default");
                          const isExplicit = !!explicitLabel;
                          return (
                            <Group key={key} gap="sm" wrap="nowrap" style={{ cursor: "pointer" }} onClick={() => setSelectedToken({ key, tk })}>
                              <Group gap={4} style={{ minWidth: isAdmin ? 140 : 110, maxWidth: isAdmin ? 200 : 160, flexShrink: 0 }} wrap="nowrap">
                                <Tooltip label={explicitLabel || `default token · ${tk.activeModel || "auto"}`} withArrow openDelay={400}>
                                  <Text size="xs" ff="monospace" c="dimmed" truncate fs={isExplicit ? undefined : "italic"}>
                                    {maskToken(rowLabel)}
                                  </Text>
                                </Tooltip>
                              </Group>
                              <Progress value={pct} color={color} size="xs" radius="sm" style={{ flex: 1 }} />
                              <Group gap={4} style={{ minWidth: 72, justifyContent: "flex-end", flexShrink: 0 }} wrap="nowrap">
                                {spike && <Tooltip label="Spike hari ini >2× rata-rata" withArrow><IconAlertTriangle size={11} color="var(--mantine-color-orange-5)" /></Tooltip>}
                                {tk.activeProvider && tk.activeProvider !== "anthropic" && (
                                  <Text size="10px" ff="monospace"
                                    c={tk.activeProvider === "deepseek" ? "violet" : tk.activeProvider === "openrouter" ? "orange" : "blue"}
                                    style={{ flexShrink: 0 }}>
                                    {tk.activeProvider}
                                  </Text>
                                )}
                                {hoursL != null && hoursL < 12 && (
                                  <Text size="10px" c={hoursL < 4 ? "red" : "orange"} ff="monospace">
                                    {hoursL < 1 ? "<1h" : `~${hoursL.toFixed(0)}h`}
                                  </Text>
                                )}
                                <Text size="10px" ff="monospace" c="dimmed" ta="right" style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: 120 }}>
                                  {nf.format(tk.used)}{tk.limit != null && ` / ${nf.format(tk.limit)}`}
                                </Text>
                              </Group>
                            </Group>
                          );
                        })}
                      </Stack>
                    </Box>
                  );
                });
              })()}
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
                          <UserAvatar name={display} imageUrl={status.userImages?.[u.user]} size={22} />
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
                              <UserAvatar name={display} imageUrl={status.userImages?.[u.label]} size={20} />
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
                        <Group gap={6} wrap="nowrap" style={{ minWidth: 120, maxWidth: 170 }}>
                          <UserAvatar name={display} imageUrl={status.userImages?.[u.label]} size={20} />
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
          customProviders={customProviders}
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

      {/* Admin-only: daily history */}
      {isAdmin && (
        <Stack gap="xs">
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Daily History</Text>
          <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
            <DailyHistory isAdmin={isAdmin} userImages={status.userImages} />
          </Paper>
        </Stack>
      )}

              </Stack>{/* end Tab Dashboard Stack */}
            </Tabs.Panel>

            {/* ── Tab Activity ──────────────────────────────── */}
            <Tabs.Panel value="activity">
              <Stack gap="xl">
                <CompetitionPanel quotaPct={quotaPct} />
                <AdminUserActivity />
              </Stack>
            </Tabs.Panel>

            {/* ── Tab Sessions ──────────────────────────────── */}
            <Tabs.Panel value="sessions">
              <SessionsTab tokens={tokens} />
            </Tabs.Panel>

            {/* ── Tab History ───────────────────────────────── */}
            <Tabs.Panel value="history">
              <FeedHistory />
            </Tabs.Panel>

            {/* ── Tab Feed (mobile only) ────────────────────── */}
            <Tabs.Panel value="feed">
              <Box style={{ height: "calc(100dvh - 220px)", minHeight: 400, display: "flex", flexDirection: "column" }}>
                <LiveFeed wsSignal={wsSignal} />
              </Box>
            </Tabs.Panel>

          </Tabs>
        </Box>{/* end Tabs col */}

        {/* ── Kanan: LiveFeed ────────────────────────────────── */}
        <Box className="live-feed-col">
          <LiveFeed wsSignal={wsSignal} />
        </Box>

      </Box>{/* end dashboard-grid */}
    </Box>{/* end px wrapper */}

    <BackToTop />
    <FloatingChat userName={profile?.name || profile?.email} />

    {/* ── Context alert overlay — hanya untuk user yang login ── */}
    {myAlerts.length > 0 && (
      <ContextAlertOverlay
        alerts={myAlerts}
        onDismiss={key => setDismissedOverlay(d => [...d, key])}
      />
    )}
    </Box>
  );
}

const NOTIF_KEY = "cp_notifications";
const MAX_NOTIFS = 200;

function loadNotifs(): AppNotification[] {
  try { return JSON.parse(localStorage.getItem(NOTIF_KEY) || "[]"); } catch { return []; }
}
function saveNotifs(items: AppNotification[]) {
  try { localStorage.setItem(NOTIF_KEY, JSON.stringify(items)); } catch {}
}

export function App() {
  const [status, setStatus]     = useState<StatusResponse | null>(null);
  const [profile, setProfile]   = useState<import("./contexts").ProfileResponse | null | "loading">("loading");
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [wsSignal, setWsSignal] = useState(0);
  const [notifBroadcastSignal, setNotifBroadcastSignal] = useState(0);
  const [notifItems, setNotifItems] = useState<AppNotification[]>(loadNotifs);
  const wsRef        = useRef<WebSocket | null>(null);
  const seenThresh   = useRef<Set<string>>(new Set());

  const notifCtx = useMemo<NotificationsCtxType>(() => ({
    items: notifItems,
    unread: notifItems.filter(n => !n.read).length,
    push(n) {
      setNotifItems(prev => {
        const next: AppNotification[] = [
          { ...n, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, ts: Date.now(), read: false },
          ...prev,
        ].slice(0, MAX_NOTIFS);
        saveNotifs(next);
        return next;
      });
    },
    markAllRead() {
      setNotifItems(prev => {
        const next = prev.map(n => ({ ...n, read: true }));
        saveNotifs(next);
        return next;
      });
    },
    clearAll() {
      setNotifItems([]);
      saveNotifs([]);
    },
  }), [notifItems]);

  useEffect(() => {
    const alerts = status?.thresholdAlerts ?? [];
    const TITLE: Record<string, string> = {
      quota_80:     "Quota 80%",
      quota_95:     "Quota 95%",
      high_context: "High Context",
      upstream_85:  "Upstream 85%",
      error_storm:  "Error Storm",
    };
    const COLOR: Record<string, AppNotification["color"]> = {
      quota_95:     "red",
      error_storm:  "red",
      quota_80:     "orange",
      upstream_85:  "orange",
      high_context: "blue",
    };
    for (const a of alerts) {
      const key = `${a.label}:${a.type}:${a.ts}`;
      if (seenThresh.current.has(key)) continue;
      seenThresh.current.add(key);
      const color = COLOR[a.type] ?? "orange";
      setNotifItems(prev => {
        const next: AppNotification[] = [
          { id: `th-${key}`, title: `${TITLE[a.type] ?? a.type} — ${a.label}`, message: a.msg, color, ts: a.ts, read: false },
          ...prev,
        ].slice(0, MAX_NOTIFS);
        saveNotifs(next);
        return next;
      });
    }
  }, [status?.thresholdAlerts]);

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
          if (data.type === "force_reload")   { window.location.reload(); return; }
          if (data.type === "notif_changed")  { setNotifBroadcastSignal(n => n + 1); return; }
          if (data.type === "chat_history")  { setChatMsgs(data.messages); return; }
          if (data.type === "chat_message")  {
            const msg: ChatMsg = data.message;
            setChatMsgs(prev => [...prev.slice(-99), msg]);
            // System messages → toast notification + simpan ke store
            if (msg.type === "system") {
              const text   = msg.text;
              const isErr  = text.includes("🚨") || text.includes("quota") || text.includes("besar") || text.includes("blocked");
              const isWarn = text.includes("⚠️") || text.includes("nearing") || text.includes("80%");
              const isGood = text.includes("🔄") || text.includes("reset") || text.includes("✅");
              const color  = (isErr ? "red" : isWarn ? "orange" : isGood ? "teal" : "blue") as AppNotification["color"];
              const title  = isErr ? "Peringatan sistem" : isGood ? "Info sistem" : "Sistem";
              const body   = text.replace(/^[⚡🚨⚠️🔄✅🗑️🚫]\s?/, "");
              notifications.show({
                id: msg.id, title, message: body, color,
                autoClose: isErr ? 10000 : 6000, withBorder: true,
              });
              setNotifItems(prev => {
                const next: AppNotification[] = [
                  { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, title, message: body, color, ts: Date.now(), read: false },
                  ...prev,
                ].slice(0, MAX_NOTIFS);
                saveNotifs(next);
                return next;
              });
            }
            return;
          }
          if (data.type === "chat_clear")    { setChatMsgs([]); return; }
          setStatus(data);
          setWsSignal(n => n + 1); // trigger LiveFeed refresh
        } catch {}
      };
      ws.onclose = () => { if (!dead) setTimeout(connect, 3000); };
    }
    connect();
    return () => {
      dead = true;
      if (!ws) return;
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      } else if (ws.readyState === WebSocket.CONNECTING) {
        // Defer close until open — avoids "closed before established" browser warning
        ws.onopen  = () => ws.close();
        ws.onclose = () => {};
      }
    };
  }, []);

  const statusTs = status?.ts;
  useEffect(() => {
    fetch("/api/profile", { credentials: "include" })
      .then(r => r.json())
      .then(d => setProfile(d))
      .catch(() => setProfile({ authenticated: false }));
  }, [statusTs]);

  const authenticated = profile && profile !== "loading" && profile.authenticated === true;

  return (
    <NotificationsCtx.Provider value={notifCtx}>
      <ChatCtx.Provider value={{ messages: chatMsgs, send: sendChat }}>
        <StatusCtx.Provider value={status}>
          {authenticated && <UserNotificationModal refreshSignal={notifBroadcastSignal} />}
          <Routes>
            <Route path="/" element={
              <RequireAuth profile={profile}>
                {(() => {
                  if (profile === "loading" || !status) return <LoadingScreen />;
                  const isAdmin = profile?.role === "SUPER_ADMIN" || profile?.role === "ADMIN";
                  const graceActive = profile?.context_block_grace_until && profile.context_block_grace_until > Date.now();
                  if (profile?.context_blocked && !graceActive)
                    return <ContextPunishmentScreen reason={profile.context_block_reason} blockedAt={profile.context_blocked_at} />;
                  return (
                    <>
                      {profile?.context_blocked && graceActive && (
                        <GraceBanner graceUntil={profile.context_block_grace_until!} />
                      )}
                      <Dashboard isAdmin={isAdmin} profile={profile as import("./contexts").ProfileResponse} wsSignal={wsSignal} />
                    </>
                  );
                })()}
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
            <Route path="/notifications" element={
              <RequireAuth profile={profile}>
                <NotificationsPage isSuperAdmin={profile !== "loading" && profile?.role === "SUPER_ADMIN"} />
              </RequireAuth>
            } />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </StatusCtx.Provider>
      </ChatCtx.Provider>
    </NotificationsCtx.Provider>
  );
}
