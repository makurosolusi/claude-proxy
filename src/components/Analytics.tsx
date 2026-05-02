import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import ReactECharts from "echarts-for-react";
import {
  Stack, Text, Box, Group, Badge, Paper, SimpleGrid,
  Button, ThemeIcon, Progress, Tooltip, Table, ScrollArea,
  useMantineColorScheme, Loader, Center,
} from "@mantine/core";
import {
  IconArrowLeft, IconBrain, IconChartPie, IconDatabase,
  IconFlame, IconClock, IconAlertTriangle, IconTrophy,
  IconBolt, IconActivity,
} from "@tabler/icons-react";

const nf = new Intl.NumberFormat();

interface AnalyticsData {
  modelDist:      { model: string; requests: number; tokens: number; pct: number }[];
  cacheHitRate:   { label: string; hitRate: number; totalInput: number; totalCached: number; requests: number }[];
  peakHours:      { h: number; requests: number; tokens: number }[];
  peakHour:       number;
  leaderboard:    { label: string; today: number; alltime: number; peakHour: number | null; paused: boolean }[];
  anomalyScores:  { id: number; ts: number; label: string; input_tokens: number; output_tokens: number; turns: number; tool_use: number; duration_ms: number; score: number }[];
  stopReasonDist: { stop_reason: string; n: number }[];
}

function fmtHour(h: number) { return `${String(h).padStart(2, "0")}:00`; }
function scoreColor(s: number) {
  if (s >= 70) return "#e03131";
  if (s >= 40) return "#f76707";
  if (s >= 20) return "#fab005";
  return "#12b886";
}

export function Analytics() {
  const { colorScheme } = useMantineColorScheme();
  const dark = colorScheme === "dark";
  const [data, setData]     = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch("/api/analytics")
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Center mih="60vh"><Loader size="md" /></Center>;
  if (!data)   return <Center mih="60vh"><Text c="dimmed">Gagal memuat analytics.</Text></Center>;

  const bg    = dark ? "#1a1b1e" : "#f8f9fa";
  const faded = dark ? "#373a40" : "#dee2e6";

  // ── Model distribution option ────────────────────────────────────────────
  const modelOption = {
    backgroundColor: "transparent",
    tooltip: { trigger: "item", formatter: "{b}: {c} tokens ({d}%)" },
    legend: { orient: "vertical", right: "5%", top: "center", textStyle: { color: dark ? "#c1c2c5" : "#343a40", fontSize: 12 } },
    series: [{
      type: "pie", radius: ["45%", "72%"], center: ["38%", "50%"],
      avoidLabelOverlap: true,
      label: { show: false },
      emphasis: { label: { show: true, fontSize: 14, fontWeight: "bold" } },
      data: data.modelDist.map((m, i) => ({
        name: m.model, value: m.tokens,
        itemStyle: { color: ["#228be6","#12b886","#fab005","#e03131","#7950f2"][i % 5] },
      })),
    }],
  };

  // ── Peak hours option ────────────────────────────────────────────────────
  const maxHourReq = Math.max(...data.peakHours.map(h => h.requests), 1);
  const hourOption = {
    backgroundColor: "transparent",
    tooltip: { trigger: "axis", formatter: (p: any[]) => `${fmtHour(p[0].dataIndex)} · ${p[0].value} requests` },
    grid: { top: 10, bottom: 30, left: 40, right: 10 },
    xAxis: { type: "category", data: data.peakHours.map(h => h.h % 6 === 0 ? fmtHour(h.h) : ""),
      axisLabel: { color: dark ? "#6c757d" : "#868e96", fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: "value", axisLabel: { show: false }, splitLine: { lineStyle: { color: faded, type: "dashed" } } },
    series: [{
      type: "bar", barMaxWidth: 18,
      data: data.peakHours.map(h => ({
        value: h.requests,
        itemStyle: { color: h.h === data.peakHour ? "#228be6" : (dark ? "#373a40" : "#dee2e6"), borderRadius: [3, 3, 0, 0] },
      })),
    }],
  };

  // ── Stop reason option ───────────────────────────────────────────────────
  const stopTotal = data.stopReasonDist.reduce((s, r) => s + r.n, 0) || 1;
  const stopColors: Record<string, string> = { end_turn: "#12b886", max_tokens: "#f76707", stop_sequence: "#228be6", tool_use: "#7950f2" };

  return (
    <Stack gap="xl" p="md" maw={960} mx="auto">
      {/* Header */}
      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" wrap="wrap">
          <Box>
            <Group gap="xs" mb={4}>
              <Button component={Link} to="/" variant="subtle" size="xs" leftSection={<IconArrowLeft size={13} />} px={6}>Home</Button>
            </Group>
            <Text size="xl" fw={800} ff="monospace">Analytics</Text>
            <Text size="sm" c="dimmed" mt={2}>Insight mendalam tentang penggunaan, pola, dan anomali</Text>
          </Box>
          <ThemeIcon variant="light" color="violet" size="xl" radius="md"><IconBrain size={20} /></ThemeIcon>
        </Group>
      </Paper>

      {/* ── Leaderboard ──────────────────────────────────────────────── */}
      <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
        <Group gap="xs" px="md" py="sm" style={{ borderBottom: `1px solid var(--mantine-color-default-border)` }}>
          <ThemeIcon variant="light" color="yellow" size="sm" radius="sm"><IconTrophy size={13} /></ThemeIcon>
          <Text size="sm" fw={700}>Leaderboard — Penggunaan Token</Text>
        </Group>
        <Table.ScrollContainer minWidth={500}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>#</Table.Th>
                <Table.Th>User</Table.Th>
                <Table.Th ta="right">Hari Ini</Table.Th>
                <Table.Th ta="right">All-Time</Table.Th>
                <Table.Th ta="center">Peak Hour</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.leaderboard.slice(0, 10).map((u, i) => (
                <Table.Tr key={u.label}>
                  <Table.Td>
                    <Text size="sm" fw={700} c={i === 0 ? "yellow" : i === 1 ? "gray" : i === 2 ? "orange" : "dimmed"} ff="monospace">{i + 1}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs">
                      <Badge variant="light" color={u.paused ? "gray" : "blue"} size="sm" ff="monospace">{u.label}</Badge>
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
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>

      {/* ── Model + Stop Reason ──────────────────────────────────────── */}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
          <Group gap="xs" px="md" py="sm" style={{ borderBottom: `1px solid var(--mantine-color-default-border)` }}>
            <ThemeIcon variant="light" color="blue" size="sm" radius="sm"><IconChartPie size={13} /></ThemeIcon>
            <Text size="sm" fw={700}>Model Distribution</Text>
          </Group>
          <Box p="md">
            <ReactECharts option={modelOption} style={{ height: 200 }} opts={{ renderer: "canvas" }} />
          </Box>
        </Paper>

        <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
          <Group gap="xs" px="md" py="sm" style={{ borderBottom: `1px solid var(--mantine-color-default-border)` }}>
            <ThemeIcon variant="light" color="teal" size="sm" radius="sm"><IconBolt size={13} /></ThemeIcon>
            <Text size="sm" fw={700}>Stop Reason Distribution</Text>
          </Group>
          <Stack gap="sm" p="md">
            {data.stopReasonDist.map(r => (
              <Group key={r.stop_reason} gap="sm" wrap="nowrap">
                <Text size="xs" ff="monospace" style={{ minWidth: 130 }}>{r.stop_reason || "unknown"}</Text>
                <Progress value={Math.round((r.n / stopTotal) * 100)} color={stopColors[r.stop_reason] ?? "gray"} size="sm" radius="sm" style={{ flex: 1 }} />
                <Text size="xs" ff="monospace" c="dimmed" style={{ minWidth: 40, textAlign: "right" }}>{r.n}</Text>
              </Group>
            ))}
            {data.stopReasonDist.some(r => r.stop_reason === "max_tokens") && (
              <Text size="xs" c="orange" mt={4}>
                ⚠ stop_reason: max_tokens — respons terpotong. User perlu naikkan max_tokens atau pecah task.
              </Text>
            )}
          </Stack>
        </Paper>
      </SimpleGrid>

      {/* ── Peak Hours ────────────────────────────────────────────────── */}
      <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
        <Group justify="space-between" px="md" py="sm" style={{ borderBottom: `1px solid var(--mantine-color-default-border)` }}>
          <Group gap="xs">
            <ThemeIcon variant="light" color="orange" size="sm" radius="sm"><IconClock size={13} /></ThemeIcon>
            <Text size="sm" fw={700}>Peak Hours (7 hari terakhir)</Text>
          </Group>
          <Badge size="sm" variant="light" color="blue">Puncak: {fmtHour(data.peakHour)}</Badge>
        </Group>
        <Box px="md" pb="sm">
          <ReactECharts option={hourOption} style={{ height: 120 }} opts={{ renderer: "canvas" }} />
        </Box>
      </Paper>

      {/* ── Cache Hit Rate ────────────────────────────────────────────── */}
      <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
        <Group gap="xs" px="md" py="sm" style={{ borderBottom: `1px solid var(--mantine-color-default-border)` }}>
          <ThemeIcon variant="light" color="violet" size="sm" radius="sm"><IconDatabase size={13} /></ThemeIcon>
          <Text size="sm" fw={700}>Cache Hit Rate per User</Text>
          <Text size="xs" c="dimmed">— hit rate tinggi = session panjang, token lebih hemat</Text>
        </Group>
        <Stack gap="sm" p="md">
          {data.cacheHitRate.map(u => (
            <Group key={u.label} gap="sm" wrap="nowrap">
              <Text size="xs" ff="monospace" truncate style={{ minWidth: 90, maxWidth: 140 }}>{u.label}</Text>
              <Tooltip label={`${u.hitRate}% dari ${nf.format(u.totalInput + u.totalCached)} token adalah cache read`} withArrow>
                <Progress value={u.hitRate} color={u.hitRate > 60 ? "teal" : u.hitRate > 30 ? "yellow" : "orange"} size="md" radius="sm" style={{ flex: 1 }} />
              </Tooltip>
              <Text size="xs" ff="monospace" c="dimmed" style={{ minWidth: 40, textAlign: "right" }}>{u.hitRate}%</Text>
            </Group>
          ))}
        </Stack>
      </Paper>

      {/* ── Anomaly Scores ────────────────────────────────────────────── */}
      {data.anomalyScores.length > 0 && (
        <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
          <Group gap="xs" px="md" py="sm" style={{ borderBottom: `1px solid var(--mantine-color-default-border)` }}>
            <ThemeIcon variant="light" color="red" size="sm" radius="sm"><IconFlame size={13} /></ThemeIcon>
            <Text size="sm" fw={700}>Anomaly Score — Request Paling Berat</Text>
            <Text size="xs" c="dimmed">— skor 0–100 dari input tokens, rasio, tool use, durasi</Text>
          </Group>
          <Table.ScrollContainer minWidth={600}>
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Score</Table.Th>
                  <Table.Th>User</Table.Th>
                  <Table.Th>Waktu</Table.Th>
                  <Table.Th ta="right">Input</Table.Th>
                  <Table.Th ta="right">Output</Table.Th>
                  <Table.Th ta="right">Turns</Table.Th>
                  <Table.Th ta="right">Tools</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.anomalyScores.map(r => (
                  <Table.Tr key={r.id}>
                    <Table.Td>
                      <Badge size="sm" style={{ background: scoreColor(r.score), color: "#fff" }} ff="monospace">{r.score}</Badge>
                    </Table.Td>
                    <Table.Td><Text size="xs" ff="monospace">{r.label}</Text></Table.Td>
                    <Table.Td><Text size="xs" c="dimmed">{new Date(r.ts).toLocaleString()}</Text></Table.Td>
                    <Table.Td ta="right"><Text size="xs" ff="monospace" c={r.input_tokens > 100_000 ? "red" : r.input_tokens > 50_000 ? "orange" : "dimmed"}>{nf.format(r.input_tokens)}</Text></Table.Td>
                    <Table.Td ta="right"><Text size="xs" ff="monospace" c="dimmed">{nf.format(r.output_tokens)}</Text></Table.Td>
                    <Table.Td ta="right"><Text size="xs" ff="monospace" c="dimmed">{r.turns}</Text></Table.Td>
                    <Table.Td ta="right"><Text size="xs" ff="monospace" c={r.tool_use > 10 ? "violet" : "dimmed"}>{r.tool_use}</Text></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}
    </Stack>
  );
}
