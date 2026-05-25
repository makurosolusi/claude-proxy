import { useMantineColorScheme } from "@mantine/core";
import { Box, Paper, Group, Text, ThemeIcon, Stack, SimpleGrid, Progress, Badge, Tooltip, Table, Pagination } from "@mantine/core";
import { IconChartPie, IconBolt, IconClock, IconDatabase, IconFlame } from "@tabler/icons-react";
import ReactECharts from "echarts-for-react";
import type { AnalyticsData } from "../../contexts";
import { UserAvatar } from "../UserAvatar";
import { maskToken, avatarColor, fmtHour, anomalyScoreColor } from "../../utils";

const nf = new Intl.NumberFormat();

interface AnalyticsPanelProps {
  analytics: AnalyticsData;
  userImages?: Record<string, string>;
  anomalyPage: number;
  setAnomalyPage: (n: number) => void;
  onOpenAnomalyDetail: (id: number) => void;
}

export function AnalyticsPanel({ analytics, userImages, anomalyPage, setAnomalyPage, onOpenAnomalyDetail }: AnalyticsPanelProps) {
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark" ||
    (colorScheme === "auto" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  return (
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
                      <Text size="xs" ff="monospace" style={{ flex: "0 0 clamp(80px,30%,130px)", minWidth: 0 }} truncate>{r.stop_reason || "unknown"}</Text>
                      <Progress value={Math.round((r.n / stopTotal) * 100)} color={stopColors[r.stop_reason] ?? "gray"} size="sm" radius="sm" style={{ flex: 1 }} />
                      <Text size="xs" ff="monospace" c="dimmed" style={{ minWidth: 32, textAlign: "right" }}>{r.n}</Text>
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

        {analytics.peakHours.length > 0 && (
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
                style={{ height: 140 }}
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
        )}

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
                return (
                  <Group key={u.label} gap="sm" wrap="nowrap">
                    <Group gap={6} wrap="nowrap" style={{ minWidth: 90, maxWidth: 150 }}>
                      <UserAvatar name={display} imageUrl={userImages?.[u.label]} size={20} />
                      <Tooltip label={u.label} withArrow openDelay={400} disabled={display === u.label}>
                        <Text size="xs" ff="monospace" truncate>{display}</Text>
                      </Tooltip>
                    </Group>
                    <Tooltip label={`${u.hitRate}% of ${nf.format(u.totalInput + u.totalCached)} input tokens served from cache`} withArrow>
                      <Progress value={u.hitRate} color={u.hitRate > 60 ? "teal" : u.hitRate > 30 ? "yellow" : "orange"} size="md" radius="sm" style={{ flex: 1 }} />
                    </Tooltip>
                    <Text size="xs" ff="monospace" c="dimmed" style={{ minWidth: 36, textAlign: "right" }}>{u.hitRate}%</Text>
                  </Group>
                );
              })}
            </Stack>
          </Paper>
        )}

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
              <Table.ScrollContainer minWidth={340}>
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
                      return (
                        <Table.Tr key={r.id} style={{ cursor: "pointer" }} onClick={() => onOpenAnomalyDetail(r.id)}>
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
  );
}
