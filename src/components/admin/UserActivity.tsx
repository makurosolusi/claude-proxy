import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Stack, Paper, Group, Text, Badge, SimpleGrid, Box, Avatar,
  ActionIcon, Tooltip, Loader, Alert, SegmentedControl,
  RingProgress, ThemeIcon, Chip, useMantineColorScheme,
  Divider,
} from "@mantine/core";
import {
  IconRefresh, IconAlertTriangle, IconFlame, IconBolt,
  IconClock, IconTrophy, IconChartLine,
} from "@tabler/icons-react";
import ReactECharts from "echarts-for-react";
import { avatarColor } from "../../utils";

// HTML helpers for ECharts tooltips — use \x3c/\x3e to avoid esbuild JSX parse issues
const LT = "\x3c", GT = "\x3e";
const H = {
  b:    (s: string) => LT + "b" + GT + s + LT + "/b" + GT,
  br:   LT + "br" + GT,
  span: (s: string, color: string) => LT + "span style='color:" + color + "'" + GT + s + LT + "/span" + GT,
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface HourlyRow  { user: string; h: number; requests: number; tokens: number; input_tokens: number; cache_read: number; avg_duration_ms: number; }
interface DailyRow   { user: string; day: string; requests: number; tokens: number; cache_read: number; input_tokens: number; }
interface LeaderboardEntry {
  user: string; today_tokens: number; today_requests: number;
  streak_days: number; cache_hit_rate: number; avg_latency_ms: number;
  avg_turns: number; top_model: string; productivity_score: number;
}
interface ActivityData {
  hourly: HourlyRow[]; daily: DailyRow[];
  leaderboard: LeaderboardEntry[];
  users: string[]; generated_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PALETTE = [
  "#339af0","#f03e3e","#40c057","#fab005","#cc5de8","#20c997","#fd7e14",
  "#74c0fc","#ffa8a8","#8ce99a","#ffe066","#e599f7","#63e6be","#ffc078",
];

function nf(n: number): string { return n.toLocaleString(); }
function kFmt(v: number): string {
  return v >= 1_000_000 ? (v / 1_000_000).toFixed(1) + "M"
       : v >= 1_000     ? (v / 1_000).toFixed(1) + "K"
       : String(v);
}
function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? "").join("") || "?";
}
function fmtTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

// ── Panel 1: Hourly Heatmap ───────────────────────────────────────────────────

function HourlyHeatmap({ hourly, users, dark }: { hourly: HourlyRow[]; users: string[]; dark: boolean }) {
  const [metric, setMetric] = useState<"requests" | "tokens">("requests");

  const textClr  = dark ? "#c1c2c5" : "#343a40";
  const mutedClr = dark ? "#5c5f66" : "#adb5bd";

  const heatData = useMemo(() => {
    const out: [number, number, number][] = [];
    for (const row of hourly) {
      const uIdx = users.indexOf(row.user);
      if (uIdx < 0) continue;
      out.push([row.h, uIdx, metric === "requests" ? row.requests : row.tokens]);
    }
    return out;
  }, [hourly, users, metric]);

  const maxVal = useMemo(() => Math.max(...heatData.map(d => d[2]), 1), [heatData]);

  const chartH = Math.max(180, users.length * 52 + 80);

  const option = useMemo(() => ({
    backgroundColor: "transparent",
    tooltip: {
      position: "top",
      formatter: (p: any) => H.b(users[p.data[1]]) + H.br + p.data[0] + ":00 - " + nf(p.data[2]) + " " + metric,
    },
    grid: { top: 10, bottom: 48, left: 12, right: 24, containLabel: true },
    xAxis: {
      type: "category",
      data: Array.from({ length: 24 }, (_, i) => `${i}:00`),
      splitArea: { show: true, areaStyle: { color: dark ? ["rgba(255,255,255,.02)", "transparent"] : ["rgba(0,0,0,.02)", "transparent"] } },
      axisLabel: { color: mutedClr, fontFamily: "monospace", fontSize: 10, interval: 1 },
      axisLine: { show: false }, axisTick: { show: false },
    },
    yAxis: {
      type: "category",
      data: users,
      splitArea: { show: true, areaStyle: { color: dark ? ["rgba(255,255,255,.02)", "transparent"] : ["rgba(0,0,0,.02)", "transparent"] } },
      axisLabel: { color: textClr, fontFamily: "monospace", fontSize: 11, fontWeight: "bold" },
      axisLine: { show: false }, axisTick: { show: false },
    },
    visualMap: {
      min: 0, max: maxVal, calculable: false, show: false,
      inRange: {
        color: dark
          ? ["#1a1b1e", "#1864ab", "#339af0", "#74c0fc", "#bac8ff"]
          : ["#eef2ff", "#4dabf7", "#1c7ed6", "#1864ab", "#1971c2"],
      },
    },
    series: [{
      type: "heatmap",
      data: heatData,
      label: { show: heatData.length <= 72, fontSize: 9, color: dark ? "#c9cace" : "#fff", fontFamily: "monospace" },
      emphasis: { itemStyle: { shadowBlur: 10, shadowColor: "rgba(0,0,0,0.4)" } },
      itemStyle: { borderRadius: 3 },
    }],
    animation: true,
    animationDuration: 300,
  }), [heatData, users, maxVal, dark, textClr, mutedClr, metric]);

  // Per-user active hours summary
  const userHourSummary = useMemo(() => {
    return users.map(user => {
      const rows = hourly.filter(r => r.user === user).sort((a, b) => a.h - b.h);
      const activeHours = rows.map(r => r.h);
      const peak = rows.reduce((m, r) => r.requests > m.requests ? r : m, rows[0] ?? { h: 0, requests: 0, tokens: 0 });
      const totalTokens = rows.reduce((s, r) => s + r.tokens, 0);
      const totalReqs = rows.reduce((s, r) => s + r.requests, 0);
      return { user, activeHours, firstHour: activeHours[0] ?? null, peakHour: rows.length ? peak.h : null, peakReqs: peak?.requests ?? 0, totalTokens, totalReqs };
    });
  }, [hourly, users]);

  if (users.length === 0) return (
    <Paper withBorder p="xl" radius="md" ta="center">
      <Text size="sm" c="dimmed">No activity today yet.</Text>
    </Paper>
  );

  return (
    <Stack gap="md">
      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" mb="md" wrap="wrap" gap="xs">
          <div>
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }} mb={2}>Hourly Activity — Today</Text>
            <Text size="lg" fw={800} ff="monospace">Active Hours per User</Text>
            <Text size="xs" c="dimmed" mt={2}>Heat intensity = {metric} count · local time</Text>
          </div>
          <SegmentedControl size="xs" value={metric} onChange={v => setMetric(v as typeof metric)}
            data={[{ value: "requests", label: "Requests" }, { value: "tokens", label: "Tokens" }]} />
        </Group>
        <Box style={{ overflowX: "auto" }}>
          <ReactECharts option={option} style={{ height: chartH, minWidth: 560 }} opts={{ renderer: "canvas" }} />
        </Box>
      </Paper>

      {/* Active hours cards */}
      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="sm">
        {userHourSummary.map(s => (
          <Paper key={s.user} withBorder p="md" radius="md">
            <Group gap="sm" mb="xs" wrap="nowrap">
              <Avatar color={avatarColor(s.user)} radius="xl" size="sm">{initials(s.user)}</Avatar>
              <Text size="sm" fw={700} truncate style={{ flex: 1 }}>{s.user}</Text>
              <Badge size="xs" variant="light" color="blue" ff="monospace">{s.totalReqs} req</Badge>
            </Group>
            <SimpleGrid cols={2} spacing={4} mb="xs">
              <div>
                <Text size="xs" c="dimmed">First active</Text>
                <Text size="xs" fw={600} ff="monospace">{s.firstHour != null ? `${s.firstHour}:00` : "—"}</Text>
              </div>
              <div>
                <Text size="xs" c="dimmed">Peak hour</Text>
                <Text size="xs" fw={600} ff="monospace">{s.peakHour != null ? `${s.peakHour}:00 (${s.peakReqs}r)` : "—"}</Text>
              </div>
            </SimpleGrid>
            <Text size="xs" c="dimmed" mb={4}>Active hours</Text>
            <Group gap={3} wrap="wrap">
              {s.activeHours.length === 0
                ? <Text size="xs" c="dimmed">none</Text>
                : s.activeHours.map(h => (
                  <Badge key={h} size="xs" variant={h === s.peakHour ? "filled" : "light"} color={h === s.peakHour ? "blue" : "gray"} ff="monospace">
                    {h}h
                  </Badge>
                ))
              }
            </Group>
            <Text size="xs" c="dimmed" mt="xs" ff="monospace">{kFmt(s.totalTokens)} tokens today</Text>
          </Paper>
        ))}
      </SimpleGrid>
    </Stack>
  );
}

// ── Panel 2: Daily Line Chart ─────────────────────────────────────────────────

function DailyTrends({ daily, users, dark }: { daily: DailyRow[]; users: string[]; dark: boolean }) {
  const [metric, setMetric] = useState<"tokens" | "requests">("tokens");
  const [visible, setVisible] = useState<string[]>(users);

  // Sync visible when users changes (on reload)
  useEffect(() => { setVisible(users); }, [users]);

  const textClr  = dark ? "#c1c2c5" : "#343a40";
  const mutedClr = dark ? "#5c5f66" : "#adb5bd";
  const gridClr  = dark ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.06)";

  const allDays = useMemo(() => [...new Set(daily.map(r => r.day))].sort(), [daily]);

  const dailyMap = useMemo(() => {
    const m: Record<string, Record<string, DailyRow>> = {};
    for (const row of daily) {
      if (!m[row.user]) m[row.user] = {};
      m[row.user]![row.day] = row;
    }
    return m;
  }, [daily]);

  const option = useMemo(() => {
    const series = visible.map((user, i) => {
      const uMap = dailyMap[user] ?? {};
      return {
        name: user,
        type: "line",
        smooth: true,
        data: allDays.map(day => uMap[day]?.[metric] ?? 0),
        itemStyle: { color: PALETTE[i % PALETTE.length] },
        lineStyle: { width: 2, color: PALETTE[i % PALETTE.length] },
        areaStyle: { color: PALETTE[i % PALETTE.length], opacity: 0.08 },
        symbol: "circle", symbolSize: 5,
        emphasis: { focus: "series" },
      };
    });

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross", label: { backgroundColor: dark ? "#25262b" : "#f8f9fa" } },
        backgroundColor: dark ? "#25262b" : "#fff",
        borderColor: dark ? "#373a40" : "#dee2e6",
        textStyle: { color: textClr, fontFamily: "monospace", fontSize: 11 },
        formatter: (params: any[]) => {
          const day = params[0]?.axisValue;
          const lines = params
            .filter((p: any) => p.value > 0)
            .sort((a: any, b: any) => b.value - a.value)
            .map((p: any) => p.marker + H.b(p.seriesName) + ": " + kFmt(p.value))
            .join(H.br);
          return H.b(day) + H.br + (lines || H.span("no data", "#868e96"));
        },
      },
      legend: {
        data: visible,
        bottom: 0,
        textStyle: { color: textClr, fontFamily: "monospace", fontSize: 10 },
        icon: "circle",
        itemWidth: 8, itemHeight: 8,
      },
      grid: { top: 16, bottom: 64, left: 8, right: 8, containLabel: true },
      xAxis: {
        type: "category",
        data: allDays.map(d => d.slice(5)),
        axisLabel: { color: mutedClr, fontFamily: "monospace", fontSize: 10, rotate: allDays.length > 14 ? 30 : 0 },
        axisLine: { show: false }, axisTick: { show: false },
        splitLine: { show: false },
      },
      yAxis: {
        axisLabel: { color: mutedClr, fontFamily: "monospace", fontSize: 10, formatter: kFmt },
        splitLine: { lineStyle: { color: gridClr, type: "dashed" } },
        axisLine: { show: false },
      },
      series,
      animationDuration: 400,
    };
  }, [visible, dailyMap, allDays, metric, dark, textClr, mutedClr, gridClr]);

  if (allDays.length === 0) return (
    <Paper withBorder p="xl" radius="md" ta="center">
      <Text size="sm" c="dimmed">No historical data yet.</Text>
    </Paper>
  );

  return (
    <Paper withBorder p="lg" radius="md">
      <Group justify="space-between" mb="md" wrap="wrap" gap="xs">
        <div>
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }} mb={2}>Daily Trends — Last 30 Days</Text>
          <Text size="lg" fw={800} ff="monospace">Activity per User by Date</Text>
          <Text size="xs" c="dimmed" mt={2}>{allDays.length} days of data · click legend to hide/show</Text>
        </div>
        <SegmentedControl size="xs" value={metric} onChange={v => setMetric(v as typeof metric)}
          data={[{ value: "tokens", label: "Tokens" }, { value: "requests", label: "Requests" }]} />
      </Group>

      {/* User toggle chips */}
      {users.length > 1 && (
        <Group gap="xs" mb="md" wrap="wrap">
          {users.map((u, i) => (
            <Chip key={u} size="xs" checked={visible.includes(u)}
              color={PALETTE[i % PALETTE.length]}
              onChange={checked => setVisible(prev =>
                checked ? [...prev, u] : prev.filter(x => x !== u)
              )}>
              {u}
            </Chip>
          ))}
        </Group>
      )}

      <ReactECharts option={option} style={{ height: 320 }} opts={{ renderer: "canvas" }} />
    </Paper>
  );
}

// ── Panel 3: Leaderboard ──────────────────────────────────────────────────────

const MEDALS = ["🥇", "🥈", "🥉"];

function MetricCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Box>
      <Text size="xs" c="dimmed" style={{ lineHeight: 1.3 }}>{label}</Text>
      <Group gap={3} align="baseline">
        <Text size="sm" fw={700} ff="monospace" style={{ lineHeight: 1.3 }}>{value}</Text>
        {sub && <Text size="xs" c="dimmed">{sub}</Text>}
      </Group>
    </Box>
  );
}

function LeaderboardCard({ entry, rank }: { entry: LeaderboardEntry; rank: number }) {
  const score = entry.productivity_score;
  const scoreColor = score >= 80 ? "teal" : score >= 50 ? "blue" : score >= 25 ? "yellow" : "gray";
  const medal = rank < 3 ? MEDALS[rank] : null;

  return (
    <Paper withBorder p="md" radius="md" style={{
      borderColor: rank === 0 ? "var(--mantine-color-yellow-5)" : undefined,
      position: "relative", overflow: "hidden",
    }}>
      {rank === 0 && (
        <Box style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg,#fab005,#fd7e14)" }} />
      )}
      <Group justify="space-between" wrap="nowrap" mb="sm" align="flex-start">
        <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          <Avatar color={avatarColor(entry.user)} radius="xl" size="md">{initials(entry.user)}</Avatar>
          <div style={{ minWidth: 0 }}>
            <Group gap={4} align="center" wrap="nowrap">
              {medal && <Text span fz={14}>{medal}</Text>}
              <Text size="sm" fw={700} truncate>{entry.user}</Text>
            </Group>
            <Text size="xs" c="dimmed" ff="monospace" truncate>{entry.top_model}</Text>
          </div>
        </Group>
        <Tooltip label={`Productivity score: ${score}/100`} withArrow>
          <RingProgress size={56} thickness={5} roundCaps
            sections={[{ value: score, color: scoreColor }]}
            label={<Text size="xs" fw={800} ta="center" ff="monospace" c={scoreColor}>{score}</Text>}
          />
        </Tooltip>
      </Group>

      <Divider mb="sm" />

      <SimpleGrid cols={2} spacing={6}>
        <MetricCell label="Tokens today"  value={kFmt(entry.today_tokens)} />
        <MetricCell label="Requests"      value={String(entry.today_requests)} />
        <MetricCell label="Streak"        value={`${entry.streak_days}d`} sub={entry.streak_days > 0 ? "🔥" : ""} />
        <MetricCell label="Cache hit"     value={`${entry.cache_hit_rate}%`} />
        <MetricCell label="Avg latency"   value={fmtTime(entry.avg_latency_ms)} />
        <MetricCell label="Avg turns"     value={String(entry.avg_turns)} />
      </SimpleGrid>
    </Paper>
  );
}

function Leaderboard({ leaderboard }: { leaderboard: LeaderboardEntry[] }) {
  if (leaderboard.length === 0) return (
    <Paper withBorder p="xl" radius="md" ta="center">
      <Stack align="center" gap="xs">
        <ThemeIcon variant="light" color="gray" size="xl" radius="xl"><IconTrophy size={22} /></ThemeIcon>
        <Text size="sm" c="dimmed">No activity yet today. Leaderboard resets at midnight.</Text>
      </Stack>
    </Paper>
  );

  return (
    <Stack gap="md">
      <Paper withBorder p="lg" radius="md">
        <Group gap="sm" mb={4}>
          <ThemeIcon variant="light" color="yellow" size="lg" radius="md"><IconTrophy size={18} /></ThemeIcon>
          <div>
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Productivity Leaderboard</Text>
            <Text size="lg" fw={800} ff="monospace">Today's Rankings</Text>
          </div>
        </Group>
        <Text size="xs" c="dimmed">Score = volume (40) + streak (20) + cache efficiency (20) + avg turns (10) + request count (10)</Text>
      </Paper>
      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="sm">
        {leaderboard.map((entry, i) => (
          <LeaderboardCard key={entry.user} entry={entry} rank={i} />
        ))}
      </SimpleGrid>
    </Stack>
  );
}

// ── Stat Summary Bar ──────────────────────────────────────────────────────────

function SummaryBar({ leaderboard }: { leaderboard: LeaderboardEntry[] }) {
  if (leaderboard.length === 0) return null;
  const totalTokens = leaderboard.reduce((s, e) => s + e.today_tokens, 0);
  const totalReqs   = leaderboard.reduce((s, e) => s + e.today_requests, 0);
  const topStreak   = Math.max(...leaderboard.map(e => e.streak_days));
  const avgCache    = Math.round(leaderboard.reduce((s, e) => s + e.cache_hit_rate, 0) / leaderboard.length);

  return (
    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
      {[
        { icon: <IconBolt size={16} />, label: "Total Tokens Today", value: kFmt(totalTokens), color: "blue" },
        { icon: <IconChartLine size={16} />, label: "Total Requests", value: nf(totalReqs), color: "teal" },
        { icon: <IconFlame size={16} />, label: "Longest Streak", value: `${topStreak}d`, color: "orange" },
        { icon: <IconClock size={16} />, label: "Avg Cache Hit", value: `${avgCache}%`, color: "violet" },
      ].map(s => (
        <Paper key={s.label} withBorder p="md" radius="md">
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon variant="light" color={s.color} size="md" radius="md">{s.icon}</ThemeIcon>
            <div>
              <Text size="xs" c="dimmed" style={{ lineHeight: 1.2 }}>{s.label}</Text>
              <Text size="md" fw={800} ff="monospace">{s.value}</Text>
            </div>
          </Group>
        </Paper>
      ))}
    </SimpleGrid>
  );
}

// ── Root Component ────────────────────────────────────────────────────────────

export function AdminUserActivity() {
  const [data, setData]       = useState<ActivityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const { colorScheme }       = useMantineColorScheme();
  const dark                  = colorScheme === "dark";

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const res = await fetch("/api/admin/user-activity");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json() as ActivityData);
    } catch { setError(true); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <Stack gap="xl">
      {/* Header */}
      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" wrap="wrap" gap="xs">
          <div>
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }} mb={4}>User Activity</Text>
            <Text size="xl" fw={800} ff="monospace">Activity & Productivity</Text>
            <Text size="sm" c="dimmed" mt={2}>
              Hourly heatmap · 30-day trends · productivity leaderboard
              {data && <Text span size="xs" c="dimmed" ml="xs">· updated {relTime(data.generated_at)}</Text>}
            </Text>
          </div>
          <Tooltip label="Refresh data" withArrow>
            <ActionIcon variant="default" size="lg" radius="md" loading={loading} onClick={load}>
              <IconRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Paper>

      {/* States */}
      {loading && !data && (
        <Group justify="center" py="xl"><Loader size="md" /></Group>
      )}
      {error && (
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
          Failed to load activity data. <b onClick={load} style={{ cursor: "pointer", textDecoration: "underline" }}>Retry</b>
        </Alert>
      )}

      {data && (
        <>
          <SummaryBar leaderboard={data.leaderboard} />
          <HourlyHeatmap hourly={data.hourly} users={data.users} dark={dark} />
          <DailyTrends   daily={data.daily}   users={data.users} dark={dark} />
          <Leaderboard   leaderboard={data.leaderboard} />
        </>
      )}
    </Stack>
  );
}
