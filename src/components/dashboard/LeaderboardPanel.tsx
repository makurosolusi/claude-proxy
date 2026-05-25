import { useMantineColorScheme } from "@mantine/core";
import { Paper, Group, ThemeIcon, Text, Table, Stack, Box, Badge, Tooltip, Progress } from "@mantine/core";
import { IconTrophy, IconChartBar, IconChartHistogram } from "@tabler/icons-react";
import ReactECharts from "echarts-for-react";
import type { AnalyticsData } from "../../contexts";
import { UserAvatar } from "../UserAvatar";
import { maskToken, avatarColor, fmtHour } from "../../utils";

const nf = new Intl.NumberFormat();
const CHART_COLORS = ["#228be6","#12b886","#fab005","#e03131","#7950f2","#fd7e14","#339af0","#20c997","#f59f00","#c92a2a","#74c0fc","#63e6be"];

interface LeaderboardPanelProps {
  analytics: AnalyticsData;
  userImages?: Record<string, string>;
}

export function LeaderboardPanel({ analytics, userImages }: LeaderboardPanelProps) {
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark" ||
    (colorScheme === "auto" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  const board      = analytics.leaderboard.slice(0, 10);
  const grandTotal = analytics.allTimeByUser.reduce((s, u) => s + u.total, 0) || 1;

  return (
    <Box id="users" style={{ scrollMarginTop: 16 }}>
      {board.length > 0 && (
        <Stack gap="md" mb="lg">
          {/* Leaderboard table */}
          <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
            <Group gap="xs" px="md" py="sm" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
              <ThemeIcon variant="light" color="yellow" size="sm" radius="sm"><IconTrophy size={13} /></ThemeIcon>
              <Text size="sm" fw={700}>Leaderboard</Text>
              <Text size="xs" c="dimmed">— ranked by all-time token usage</Text>
            </Group>
            <Table.ScrollContainer minWidth={320}>
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
                    return (
                      <Table.Tr key={u.label}>
                        <Table.Td>
                          <Text size="sm" fw={700} c={i === 0 ? "yellow" : i === 1 ? "gray" : i === 2 ? "orange" : "dimmed"} ff="monospace">{i + 1}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={6} wrap="nowrap">
                            <UserAvatar name={display} imageUrl={userImages?.[u.label]} size={20} />
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
                    trigger: "axis", axisPointer: { type: "shadow" },
                    formatter: (params: any[]) => {
                      const p = params[0];
                      return p.name + "<" + "br/>" + nf.format(p.value) + " tokens";
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
                      itemStyle: { color: CHART_COLORS[(board.length - 1 - i) % CHART_COLORS.length], borderRadius: [0, 4, 4, 0] },
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
      )}

      {/* Daily usage stacked area chart */}
      {analytics.dailyByUser.length > 1 && (() => {
        const dates     = analytics.dailyByUser.map(d => d.date);
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
                    trigger: "axis", axisPointer: { type: "cross" },
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
                    type: "category", data: dates,
                    axisLabel: { color: isDark ? "#6c757d" : "#868e96", fontSize: 10, formatter: (v: string) => v.slice(5), interval: Math.floor(dates.length / 6) },
                    axisLine: { lineStyle: { color: isDark ? "#373a40" : "#dee2e6" } }, axisTick: { show: false },
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
                    name: user, type: "line", stack: "total",
                    areaStyle: { opacity: isDark ? 0.55 : 0.45 }, smooth: true, symbol: "none",
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

      {/* All-Time per User bars */}
      {analytics.allTimeByUser.length > 0 && (
        <Stack gap="xs" mb="lg">
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>All-Time Usage per User</Text>
          <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
            <Stack gap={0}>
              {analytics.allTimeByUser.map((u, i) => {
                const display = maskToken(u.user);
                const pct     = Math.round((u.total / grandTotal) * 100);
                const color   = CHART_COLORS[i % CHART_COLORS.length];
                return (
                  <Box key={u.user} px="md" py="sm"
                    style={{ borderBottom: i < analytics.allTimeByUser.length - 1 ? "1px solid var(--mantine-color-default-border)" : undefined }}>
                    <Group justify="space-between" mb={6} wrap="nowrap">
                      <Group gap={8} wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                        <UserAvatar name={display} imageUrl={userImages?.[u.user]} size={22} />
                        <Tooltip label={u.user} withArrow openDelay={400} disabled={display === u.user}>
                          <Text size="sm" fw={600} ff="monospace" truncate>{display}</Text>
                        </Tooltip>
                      </Group>
                      <Group gap="md" wrap="nowrap">
                        <Box ta="right" style={{ minWidth: 72 }}>
                          <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".06em" }}>All-Time</Text>
                          <Text size="sm" ff="monospace" fw={700}>{nf.format(u.total)}</Text>
                        </Box>
                        <Box ta="right" style={{ minWidth: 36 }}>
                          <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".06em" }}>Share</Text>
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
      )}
    </Box>
  );
}
