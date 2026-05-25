import { Modal, Stack, Group, Text, Badge, Progress, Box, Tooltip, SimpleGrid, Paper } from "@mantine/core";
import type { TokenStatus, UserInsight } from "../contexts";
import type { ProviderInfo } from "../providerDisplay";
import { resolveProvider } from "../providerDisplay";
import { maskToken } from "../utils";

const nf = new Intl.NumberFormat();

interface TokenDetailModalProps {
  tokenKey: string;
  tk: TokenStatus;
  ins: UserInsight | undefined;
  opened: boolean;
  onClose: () => void;
  customProviders?: ProviderInfo[];
}

export function TokenDetailModal({ tokenKey: _tokenKey, tk, ins, opened, onClose, customProviders = [] }: TokenDetailModalProps) {
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

  const providerInfo  = resolveProvider(tk.activeProvider || "anthropic", customProviders);
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

        <Stack gap={6}>
          <Group justify="space-between">
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".07em" }}>Window Usage</Text>
            <Text size="xs" ff="monospace" c="dimmed">
              {nf.format(tk.used)}{tk.limit != null ? ` / ${nf.format(tk.limit)}` : " / ∞"}
              {tk.limit != null && ` · ${pct}%`}
            </Text>
          </Group>
          <Progress value={pct} color={color} size="lg" radius="sm" />
          <Group gap="xl">
            <Box>
              <Text size="xs" c="dimmed">Today</Text>
              <Text size="sm" fw={600} ff="monospace">{nf.format(tk.today)}</Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed">All-time</Text>
              <Text size="sm" fw={600} ff="monospace">{nf.format(tk.alltime)}</Text>
            </Box>
            {tk.remaining != null && (
              <Box>
                <Text size="xs" c="dimmed">Remaining</Text>
                <Text size="sm" fw={600} ff="monospace" c={tk.remaining < 5000 ? "red" : undefined}>
                  {nf.format(tk.remaining)}
                </Text>
              </Box>
            )}
          </Group>
        </Stack>

        {ins && ins.sparkline.length === 7 && (
          <Stack gap={6}>
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".07em" }}>7-Day History</Text>
            <Group gap={4} align="flex-end" style={{ height: 48 }}>
              {ins.sparkline.map((v, i) => {
                const label = i === 6 ? "Today" : `-${6 - i}d`;
                return (
                  <Tooltip key={i} label={`${label}: ${nf.format(v)}`} withArrow>
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

        {ins && (
          <SimpleGrid cols={2} spacing="sm">
            <Paper withBorder p="sm" radius="md">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={6} style={{ letterSpacing: ".06em" }}>Burn Rate</Text>
              <Stack gap={4}>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Avg daily</Text>
                  <Text size="xs" ff="monospace">{nf.format(Math.round(ins.burnRate.avgDaily))}</Text>
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

        {ins && (
          <SimpleGrid cols={2} spacing="sm">
            <Paper withBorder p="sm" radius="md">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={6} style={{ letterSpacing: ".06em" }}>Cache Hit Rate</Text>
              <Text size="xl" fw={700} ff="monospace" c={ins.cacheHitRate > 0.5 ? "teal" : undefined}>
                {(ins.cacheHitRate * 100).toFixed(0)}%
              </Text>
              <Text size="xs" c="dimmed" mt={2}>avg {nf.format(ins.avgInputTokens)} in/req</Text>
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

        {qs && (
          <Paper withBorder p="sm" radius="md" style={{ borderColor: `var(--mantine-color-${qsColor}-4)` }}>
            <Group gap="sm" mb={4}>
              <Badge color={qsColor} variant="light" size="sm">
                {qs.action === "increase" ? "Perlu naik" : qs.action === "decrease" ? "Bisa turun" : "Limit OK"}
              </Badge>
              {qs.suggested != null && (
                <Text size="xs" ff="monospace" c="dimmed">Saran: {nf.format(qs.suggested)}</Text>
              )}
            </Group>
            <Text size="xs" c="dimmed">{qs.reason}</Text>
          </Paper>
        )}

      </Stack>
    </Modal>
  );
}
