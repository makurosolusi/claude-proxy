import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Stack, Text, Box, Badge, Group, SimpleGrid,
  Avatar, Loader, Divider, useMantineColorScheme,
  Progress, Tooltip, RingProgress,
} from "@mantine/core";
import {
  IconTrophy, IconFlame, IconBolt, IconUsers,
  IconArrowUp, IconArrowDown, IconMinus, IconChartBar,
  IconRefresh,
} from "@tabler/icons-react";
import ReactECharts from "echarts-for-react";
import confetti from "canvas-confetti";
import { avatarColor } from "../utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LeaderEntry {
  rank: number; name: string; userId: string;
  tokens_today: number; requests_today: number;
  streak_days: number; alltime_tokens: number; is_me: boolean;
}
interface HeatDay {
  day: string;
  hours: { h: number; requests: number; tokens: number }[];
}
interface MeStats {
  rank: number; total: number;
  tokens_today: number; avg_tokens: number; vs_avg_pct: number;
  streak_days: number; top_streak: number;
}
interface CompetitionData {
  leaderboard: LeaderEntry[];
  heatmap: HeatDay[];
  today: string;
  me_stats: MeStats | null;
  community: { total_participants: number; avg_tokens: number; top_streak: number };
  generated_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const LT = "\x3c", GT = "\x3e";
const H = {
  b:  (s: string) => LT + "b" + GT + s + LT + "/b" + GT,
  br: LT + "br" + GT,
  span: (s: string, c: string) => LT + "span style='color:" + c + "'" + GT + s + LT + "/span" + GT,
};

function kFmt(n: number): string {
  return n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + "M"
       : n >= 1_000     ? (n / 1_000).toFixed(1) + "K"
       : String(n);
}
function initials(s: string): string {
  return (s || "?").trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? "").join("") || "?";
}
function fmtAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// ── Milestone system ──────────────────────────────────────────────────────────

type MilestoneKey = "first_request" | "rank_1" | "streak_3" | "streak_7" | "streak_30" | "quota_50" | "quota_100" | "overtake";

interface MilestoneState {
  hadActivityToday: boolean; prevRank: number | null;
  prevStreak: number; prevQuotaPct: number; fired: Set<MilestoneKey>;
}

function fireCelebration(type: "big" | "small") {
  if (type === "big") {
    confetti({ particleCount: 160, spread: 75, origin: { y: 0.55 }, colors: ["#2563eb","#0d9488","#d97706","#7c3aed","#dc2626"] });
    setTimeout(() => confetti({ particleCount: 80, angle: 60,  spread: 55, origin: { x: 0 } }), 250);
    setTimeout(() => confetti({ particleCount: 80, angle: 120, spread: 55, origin: { x: 1 } }), 450);
  } else {
    confetti({ particleCount: 50, spread: 45, origin: { y: 0.65 }, scalar: 0.85 });
  }
}

function checkMilestones(data: CompetitionData, quotaPct: number, state: MilestoneState, notify: (title: string, msg: string, big?: boolean) => void): MilestoneState {
  const me = data.me_stats;
  if (!me) return state;
  const next: MilestoneState = { hadActivityToday: me.tokens_today > 0, prevRank: me.rank, prevStreak: me.streak_days, prevQuotaPct: quotaPct, fired: new Set(state.fired) };
  if (!state.hadActivityToday && me.tokens_today > 0 && !state.fired.has("first_request")) {
    next.fired.add("first_request"); notify("Mulai hari ini! ☀️", "Request pertama sudah masuk.", false); fireCelebration("small");
  }
  if (me.rank === 1 && (state.prevRank === null || state.prevRank > 1) && !state.fired.has("rank_1")) {
    next.fired.add("rank_1"); notify("🥇 Posisi #1!", "Kamu memimpin leaderboard hari ini!", true); fireCelebration("big");
  }
  if (state.prevRank !== null && me.rank < state.prevRank && me.rank > 1 && !state.fired.has("overtake")) {
    next.fired.add("overtake"); notify("⬆️ Naik peringkat!", `Sekarang posisi #${me.rank}`); fireCelebration("small");
  }
  for (const days of [3, 7, 30] as const) {
    const key = `streak_${days}` as MilestoneKey;
    if (me.streak_days >= days && state.prevStreak < days && !state.fired.has(key)) {
      next.fired.add(key); notify(`🔥 ${days}-hari streak!`, `Aktif ${days} hari berturut-turut.`, days >= 7); fireCelebration(days >= 7 ? "big" : "small");
    }
  }
  for (const pct of [50, 100] as const) {
    const key = `quota_${pct}` as MilestoneKey;
    if (quotaPct >= pct && state.prevQuotaPct < pct && !state.fired.has(key)) {
      next.fired.add(key); notify(pct === 100 ? "💯 Quota habis!" : `📊 ${pct}% quota`, pct === 100 ? "Seluruh quota terpakai." : `${pct}% quota sudah digunakan.`, pct === 100); fireCelebration(pct === 100 ? "big" : "small");
    }
  }
  return next;
}

// ── Toast notification ────────────────────────────────────────────────────────

interface Toast { id: number; title: string; msg: string; }

function MilestoneToast({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null;
  return (
    <Box style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}>
      {toasts.map(t => (
        <Box key={t.id} className="cp-scale-in" style={{
          minWidth: 220, maxWidth: 300,
          background: "var(--cp-surface)",
          border: "1px solid var(--cp-accent-glow)",
          borderRadius: 16, padding: "10px 14px",
          boxShadow: "var(--cp-shadow-lg)",
        }}>
          <Text fz={13} fw={700} style={{ letterSpacing: "-0.01em" }}>{t.title}</Text>
          <Text fz={11} c="dimmed" mt={2}>{t.msg}</Text>
        </Box>
      ))}
    </Box>
  );
}

// ── Community Heatmap ─────────────────────────────────────────────────────────

function CommunityHeatmap({ heatmap, dark }: { heatmap: HeatDay[]; dark: boolean }) {
  const mutedClr = dark ? "#52525b" : "#a1a1aa";
  const textClr  = dark ? "#d4d4d8" : "#3f3f46";
  const days = useMemo(() => heatmap.map(d => d.day.slice(5)), [heatmap]);

  const heatData = useMemo(() => {
    const out: [number, number, number][] = [];
    heatmap.forEach((day, di) => {
      day.hours.forEach(h => {
        if (h.requests > 0) out.push([di, h.h, h.requests]);
      });
    });
    return out;
  }, [heatmap]);

  const maxVal = useMemo(() => Math.max(...heatData.map(d => d[2]), 1), [heatData]);

  const option = useMemo(() => ({
    backgroundColor: "transparent",
    tooltip: {
      formatter: (p: any) => H.b(days[p.data[0]] ?? "") + " · " + p.data[1] + ":00" + H.br + H.span(p.data[2] + " req", "#0d9488"),
    },
    grid: { top: 6, bottom: 32, left: 6, right: 6, containLabel: true },
    xAxis: {
      type: "category", data: days,
      axisLabel: { color: mutedClr, fontFamily: "Geist Mono, monospace", fontSize: 9 },
      axisLine: { show: false }, axisTick: { show: false },
    },
    yAxis: {
      type: "category",
      data: Array.from({ length: 24 }, (_, i) => i % 6 === 0 ? `${i}h` : ""),
      inverse: true,
      axisLabel: { color: mutedClr, fontFamily: "Geist Mono, monospace", fontSize: 9 },
      axisLine: { show: false }, axisTick: { show: false },
    },
    visualMap: {
      min: 0, max: maxVal, show: false,
      inRange: { color: dark
        ? ["#18181b", "#0d4b6e", "#0d9488", "#2dd4bf"]
        : ["#f0fdfa", "#99f6e4", "#0d9488", "#0f766e"] },
    },
    series: [{
      type: "heatmap", data: heatData,
      itemStyle: { borderRadius: 3, borderWidth: 1, borderColor: dark ? "#0f0f10" : "#f8f9fa" },
    }],
  }), [heatData, days, maxVal, dark, mutedClr]);

  if (heatmap.length === 0) return null;

  return (
    <Box style={{
      background: "var(--cp-surface-2)",
      borderRadius: 16, padding: "14px",
      border: "1px solid var(--cp-border)",
    }}>
      <Group gap={6} mb={10}>
        <IconChartBar size={12} color="var(--cp-text-3)" />
        <Text fz={10} fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".09em" }}>Aktivitas Komunitas · 7 Hari</Text>
      </Group>
      <Box style={{ overflowX: "auto" }}>
        <ReactECharts option={option} style={{ height: 180, minWidth: 280 }} opts={{ renderer: "canvas" }} />
      </Box>
    </Box>
  );
}

// ── Me Card ───────────────────────────────────────────────────────────────────

function MeCard({ me, dark }: { me: MeStats; dark: boolean }) {
  const aboveAvg   = me.vs_avg_pct >= 0;
  const isTopStreak = me.streak_days > 0 && me.streak_days >= me.top_streak;
  const rankPct    = me.total > 0 ? Math.round(((me.total - me.rank + 1) / me.total) * 100) : 0;
  const rankColor  = me.rank === 1 ? "#d97706" : me.rank <= 3 ? "#f97316" : "var(--cp-accent)";

  return (
    <Box style={{
      background: dark
        ? "linear-gradient(135deg, rgba(37,99,235,0.08) 0%, rgba(13,148,136,0.05) 100%)"
        : "linear-gradient(135deg, rgba(37,99,235,0.05) 0%, rgba(13,148,136,0.03) 100%)",
      border: "1px solid var(--cp-accent-glow)",
      borderRadius: 18, padding: "16px",
      position: "relative", overflow: "hidden",
    }}>
      {/* Decorative circle */}
      <Box style={{
        position: "absolute", top: -20, right: -20,
        width: 80, height: 80, borderRadius: "50%",
        background: "var(--cp-accent-dim)", pointerEvents: "none",
      }} />

      <Group gap={6} mb={12}>
        <IconBolt size={12} color="var(--cp-accent)" />
        <Text fz={10} fw={700} tt="uppercase" style={{ letterSpacing: ".09em", color: "var(--cp-accent)" }}>
          Posisiku Hari Ini
        </Text>
      </Group>

      <SimpleGrid cols={3} spacing={8}>
        {/* Rank */}
        <Box ta="center">
          <Text fz={32} fw={900} lh={1} ff="Geist Mono, monospace" style={{ color: rankColor, letterSpacing: "-0.04em" }}>
            #{me.rank}
          </Text>
          <Text fz={10} c="dimmed" mt={2}>dari {me.total} user</Text>
          <Box style={{ height: 2, background: "var(--cp-surface-3)", borderRadius: 2, marginTop: 6 }}>
            <Box style={{ width: `${rankPct}%`, height: "100%", background: rankColor, borderRadius: 2, transition: "width 0.6s ease" }} />
          </Box>
        </Box>

        {/* vs avg */}
        <Box ta="center">
          <Group justify="center" gap={3} align="baseline">
            {aboveAvg
              ? <IconArrowUp size={12} color="#0d9488" />
              : <IconArrowDown size={12} color="#dc2626" />}
            <Text fz={24} fw={800} lh={1} ff="Geist Mono, monospace"
              style={{ color: aboveAvg ? "#0d9488" : "#dc2626", letterSpacing: "-0.03em" }}>
              {Math.abs(me.vs_avg_pct)}%
            </Text>
          </Group>
          <Text fz={10} c="dimmed" mt={2}>{aboveAvg ? "di atas" : "di bawah"} avg</Text>
        </Box>

        {/* Streak */}
        <Box ta="center">
          <Text fz={24} fw={800} lh={1} ff="Geist Mono, monospace"
            style={{ color: me.streak_days >= 7 ? "#f97316" : me.streak_days >= 3 ? "#d97706" : "var(--cp-text-3)", letterSpacing: "-0.03em" }}>
            {me.streak_days > 0 ? me.streak_days : "—"}
          </Text>
          <Text fz={10} c="dimmed" mt={2}>
            {isTopStreak ? "🔥 top streak" : me.streak_days > 0 ? "hari streak" : "belum streak"}
          </Text>
        </Box>
      </SimpleGrid>

      {/* Token today vs avg */}
      <Box mt={12} style={{ background: "var(--cp-surface-2)", borderRadius: 10, padding: "10px 12px" }}>
        <Group justify="space-between" mb={5}>
          <Text fz={10} c="dimmed">Token hari ini</Text>
          <Group gap={6}>
            <Text fz={11} fw={700} ff="Geist Mono, monospace">{kFmt(me.tokens_today)}</Text>
            <Text fz={10} c="dimmed">/ avg {kFmt(me.avg_tokens)}</Text>
          </Group>
        </Group>
        <Box style={{ height: 3, background: "var(--cp-surface-3)", borderRadius: 4 }}>
          <Box style={{
            height: "100%", borderRadius: 4,
            width: `${Math.min(100, me.avg_tokens > 0 ? (me.tokens_today / (me.avg_tokens * 2)) * 100 : 0)}%`,
            background: aboveAvg ? "var(--cp-teal)" : "var(--cp-accent)",
            transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)",
          }} />
        </Box>
      </Box>
    </Box>
  );
}

// ── Leaderboard Row ───────────────────────────────────────────────────────────

const RANK_MEDALS = ["🥇", "🥈", "🥉"];

function LeaderRow({ entry, maxTokens }: { entry: LeaderEntry; maxTokens: number }) {
  const pct      = maxTokens > 0 ? (entry.tokens_today / maxTokens) * 100 : 0;
  const isTop3   = entry.rank <= 3;
  const aColor   = avatarColor(entry.name);
  const rankClass = entry.rank <= 3 ? `rank-${entry.rank}` : "rank-n";

  return (
    <Box className={`leader-row${entry.is_me ? " is-me" : ""}`}>
      <Group gap={10} wrap="nowrap">

        {/* Rank badge */}
        <Box className={`rank-badge ${rankClass}`} style={{ fontSize: isTop3 ? 14 : 11 }}>
          {isTop3 ? RANK_MEDALS[entry.rank - 1] : entry.rank}
        </Box>

        {/* Avatar */}
        <Avatar color={aColor} radius="xl" size={30} style={{ flexShrink: 0 }}>
          <Text fz={11} fw={700}>{initials(entry.name)}</Text>
        </Avatar>

        {/* Name + progress */}
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Group gap={5} wrap="nowrap" mb={4}>
            <Text fz={13} fw={entry.is_me ? 800 : 600} truncate style={{ letterSpacing: "-0.01em" }}
              c={entry.is_me ? "blue" : undefined}>
              {entry.name}
              {entry.is_me && <Text span fz={10} c="blue" ml={4}>(kamu)</Text>}
            </Text>
            {entry.streak_days >= 3 && (
              <Tooltip label={`${entry.streak_days} hari streak`} withArrow>
                <Badge size="xs" variant="light" color="orange"
                  leftSection={<IconFlame size={8} />}
                  style={{ fontSize: 10, cursor: "default" }}>
                  {entry.streak_days}d
                </Badge>
              </Tooltip>
            )}
          </Group>
          {/* Progress bar */}
          <Box style={{ height: 3, background: "var(--cp-surface-3)", borderRadius: 4 }}>
            <Box style={{
              width: `${pct}%`, height: "100%", borderRadius: 4,
              background: entry.rank === 1 ? "linear-gradient(90deg, #d97706, #f59e0b)"
                        : entry.is_me      ? "var(--cp-accent)"
                        : "var(--cp-teal)",
              transition: "width 0.5s ease",
            }} />
          </Box>
        </Box>

        {/* Tokens */}
        <Text fz={12} fw={700} ff="Geist Mono, monospace" style={{ flexShrink: 0, letterSpacing: "-0.02em" }}>
          {kFmt(entry.tokens_today)}
        </Text>
      </Group>
    </Box>
  );
}

// ── Root Component ────────────────────────────────────────────────────────────

export function CompetitionPanel({ quotaPct }: { quotaPct: number }) {
  const [data, setData]       = useState<CompetitionData | null>(null);
  const [loading, setLoading] = useState(true);
  const { colorScheme }       = useMantineColorScheme();
  const dark                  = colorScheme === "dark";
  const milestoneRef = useRef<MilestoneState>({ hadActivityToday: false, prevRank: null, prevStreak: 0, prevQuotaPct: 0, fired: new Set() });
  const [toasts, setToasts]   = useState<Toast[]>([]);
  const toastId = useRef(0);

  const notify = useCallback((title: string, msg: string, _big = false) => {
    const id = ++toastId.current;
    setToasts(prev => [...prev, { id, title, msg }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/competition", { credentials: "include" });
      if (!r.ok) return;
      const d = await r.json() as CompetitionData;
      setData(d);
      milestoneRef.current = checkMilestones(d, quotaPct, milestoneRef.current, notify);
    } finally { setLoading(false); }
  }, [quotaPct, notify]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!data) return;
    milestoneRef.current = checkMilestones(data, quotaPct, milestoneRef.current, notify);
  }, [quotaPct, data, notify]);
  useEffect(() => {
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const maxTokens = data ? Math.max(...data.leaderboard.map(e => e.tokens_today), 1) : 1;

  if (loading) return <Group justify="center" py="xl"><Loader size="sm" /></Group>;

  if (!data || data.leaderboard.length === 0) return (
    <Box style={{
      background: "var(--cp-surface)", border: "1px solid var(--cp-border)",
      borderRadius: 20, padding: 24, textAlign: "center",
    }}>
      <Stack align="center" gap={8}>
        <Box style={{ width: 48, height: 48, borderRadius: 14, background: "var(--cp-surface-2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <IconTrophy size={22} color="var(--cp-text-3)" />
        </Box>
        <Text fz={14} fw={600}>Belum ada aktivitas hari ini</Text>
        <Text fz={12} c="dimmed">Jadilah yang pertama! 🚀</Text>
      </Stack>
    </Box>
  );

  return (
    <>
      <Stack gap={12}>
        {/* Header */}
        <Group justify="space-between" align="center">
          <Group gap={8}>
            <Box style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg,#d97706,#f59e0b)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <IconTrophy size={14} color="#fff" />
            </Box>
            <div>
              <Text fz={14} fw={800} style={{ letterSpacing: "-0.02em", lineHeight: 1.2 }}>Leaderboard</Text>
              <Text fz={10} c="dimmed">hari ini · {data.today}</Text>
            </div>
          </Group>
          <Group gap={8}>
            <Badge variant="dot" color="teal" size="sm" leftSection={<IconUsers size={10} />}>
              {data.community.total_participants} aktif
            </Badge>
            <Tooltip label={`Updated ${fmtAge(data.generated_at)}`} withArrow>
              <Box style={{ cursor: "default", color: "var(--cp-text-3)" }}>
                <IconRefresh size={13} />
              </Box>
            </Tooltip>
          </Group>
        </Group>

        {/* Me card */}
        {data.me_stats && <MeCard me={data.me_stats} dark={dark} />}

        {/* Leaderboard */}
        <Box style={{ background: "var(--cp-surface)", border: "1px solid var(--cp-border)", borderRadius: 18, overflow: "hidden" }}>
          {/* Table header */}
          <Box style={{ padding: "10px 12px 8px", borderBottom: "1px solid var(--cp-border)", background: "var(--cp-surface-2)" }}>
            <Group justify="space-between">
              <Text fz={10} fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Ranking</Text>
              <Text fz={10} fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Tokens</Text>
            </Group>
          </Box>
          <Box style={{ padding: "4px 0" }}>
            {data.leaderboard.map(e => (
              <LeaderRow key={e.userId || e.name} entry={e} maxTokens={maxTokens} />
            ))}
          </Box>
        </Box>

        {/* Community heatmap */}
        <CommunityHeatmap heatmap={data.heatmap} dark={dark} />
      </Stack>

      <MilestoneToast toasts={toasts} />
    </>
  );
}
