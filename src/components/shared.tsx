import type { ReactNode } from "react";
import { Stack, Text, Button, Center, Paper, Box, Group, Badge, SimpleGrid, Tooltip, useMantineColorScheme } from "@mantine/core";
import { Loader } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import ReactECharts from "echarts-for-react";
import { fmtResetAt } from "../utils";
import { useStatus } from "../contexts";
import type { UpstreamPeriod, UpstreamData } from "../contexts";

export function LoadingScreen() {
  return (
    <Center mih="100vh">
      <Stack align="center" gap="md">
        <Box
          style={{
            width: 40, height: 40, background: "#228be6", borderRadius: 10,
            display: "flex", alignItems: "center", justifyContent: "center",
            animation: "cpPulse 2s ease-in-out infinite",
          }}
        >
          <Text span fz={13} fw={700} c="white" ff="monospace">CP</Text>
        </Box>
        <style>{`@keyframes cpPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.55;transform:scale(.92)}}`}</style>
        <Text size="sm" c="dimmed">claude-proxy</Text>
      </Stack>
    </Center>
  );
}

export function NotFoundPage() {
  return (
    <Center mih="100vh">
      <Stack align="center" gap="xs">
        <Text size="xl" fw={700} c="dimmed">404</Text>
        <Text size="sm" c="dimmed">Page not found</Text>
        <Button component="a" href="/" variant="subtle" size="xs" mt="xs">Go home</Button>
      </Stack>
    </Center>
  );
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const status = useStatus();
  if (!status) return <LoadingScreen />;
  if (!status.isAdmin) {
    window.location.replace("/login");
    return null;
  }
  return <>{children}</>;
}

export function RequireAuth({
  profile,
  children,
}: {
  profile: import("../contexts").ProfileResponse | null | "loading";
  children: ReactNode;
}) {
  if (profile === "loading") return <LoadingScreen />;
  if (!profile?.authenticated) {
    window.location.replace("/login");
    return null;
  }
  return <>{children}</>;
}

function needleColor(pct: number): string {
  if (pct < 40) return "#12b886";
  if (pct < 65) return "#fab005";
  if (pct < 82) return "#f76707";
  return "#e03131";
}

const DESCRIPTIONS: Record<string, string> = {
  "5-Hour":        "Rolling 5-hour window · resets every 5 hours",
  "7-Day":         "Rolling 7-day total across all models",
  "Sonnet 7-Day":  "Rolling 7-day usage limited to the Sonnet model",
};

function SingleGauge({
  label, data, dark, arcColors,
}: {
  label: string; data: UpstreamPeriod; dark: boolean; arcColors: [number, string][];
}) {
  const expired  = new Date(data.resets_at).getTime() <= Date.now();
  const val      = expired ? 0 : Math.round(data.utilization);
  const nc       = expired ? "#868e96" : needleColor(val);
  const tickCol  = dark ? "#6c757d" : "#868e96";
  const textCol  = dark ? "#c1c2c5" : "#343a40";
  const dimCol   = dark ? "#5c5f66" : "#adb5bd";
  const resetStr = fmtResetAt(data.resets_at);

  const option = {
    backgroundColor: "transparent",
    series: [{
      type: "gauge",
      center: ["50%", "60%"],   // lower center → more arc visible at top
      radius: "82%",
      min: 0, max: 100,
      startAngle: 215, endAngle: -35,
      splitNumber: 5,
      axisLine:  { lineStyle: { width: 16, color: arcColors } },
      progress:  { show: false },
      pointer: {
        show: true, length: "65%", width: 6,
        itemStyle: { color: nc },
      },
      anchor: {
        show: true, showAbove: true, size: 16,
        itemStyle: {
          color: dark ? "#25262b" : "#f8f9fa",
          borderColor: dark ? "#5c5f66" : "#adb5bd",
          borderWidth: 3,
        },
      },
      splitLine: {
        distance: -22, length: 22,
        lineStyle: { color: tickCol, width: 2 },
      },
      axisTick: {
        distance: -14, length: 12,
        lineStyle: { color: tickCol, width: 1 },
      },
      axisLabel: {
        distance: -42, color: textCol, fontSize: 14, fontFamily: "monospace",
        // hide 0 & 100 — they sit at bottom corners and overlap reset text
        formatter: (v: number) => (v === 0 || v === 100) ? "" : String(v),
      },
      title: { show: false },
      detail: {
        valueAnimation: true,
        offsetCenter: ["0%", "38%"],
        borderWidth: 0,
        rich: {
          v: { fontSize: 40, fontWeight: "bold", fontFamily: "monospace", color: nc, lineHeight: 46 },
          r: { fontSize: 13, fontFamily: "monospace", color: dimCol, lineHeight: 20 },
        },
        formatter: expired
          ? () => `{v|—}\n{r|waiting for poll}`
          : (v: number) => `{v|${v}%}\n{r|resets ${resetStr}}`,
      },
      data: [{ value: val }],
    }],
  };

  return (
    <Box style={{ textAlign: "center" }}>
      <Tooltip label={DESCRIPTIONS[label] ?? ""} withArrow position="top" disabled={!DESCRIPTIONS[label]}>
        <Group gap={4} justify="center" wrap="nowrap" style={{ cursor: DESCRIPTIONS[label] ? "help" : "default" }}>
          <Text size="sm" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".1em" }}>
            {label}
          </Text>
          {DESCRIPTIONS[label] && <IconInfoCircle size={11} color="var(--mantine-color-dimmed)" />}
        </Group>
      </Tooltip>
      <ReactECharts
        option={option}
        style={{ height: "min(240px, 45vw)", width: "100%" }}
        opts={{ renderer: "canvas" }}
      />
    </Box>
  );
}

function UpstreamGauge({ upstream }: { upstream: UpstreamData }) {
  const { colorScheme } = useMantineColorScheme();
  const dark = colorScheme === "dark";

  const entries = [
    upstream.fiveHour       && { label: "5-Hour",       data: upstream.fiveHour },
    upstream.sevenDay       && { label: "7-Day",        data: upstream.sevenDay },
    upstream.sevenDaySonnet && { label: "Sonnet 7-Day", data: upstream.sevenDaySonnet },
  ].filter(Boolean) as { label: string; data: UpstreamPeriod }[];

  if (entries.length === 0) return null;

  const arcColors: [number, string][] = [
    [0.65, dark ? "#373a40" : "#ced4da"],
    [0.82, "#e8590c"],
    [1.0,  "#c92a2a"],
  ];

  return (
    <SimpleGrid cols={{ base: 1, xs: entries.length === 1 ? 1 : 2, md: entries.length === 1 ? 1 : entries.length === 2 ? 2 : 3 }} spacing="xs">
      {entries.map(e => (
        <SingleGauge key={e.label} label={e.label} data={e.data} dark={dark} arcColors={arcColors} />
      ))}
    </SimpleGrid>
  );
}

export function UpstreamSection({ upstream, isAdmin }: { upstream: UpstreamData; isAdmin: boolean }) {
  const fb = upstream.fallbackProvider;
  const isFallback = fb != null && fb !== "anthropic";
  const fbName = fb === "deepseek" ? "DeepSeek" : fb === "openrouter" ? "OpenRouter" : fb || "";
  const fbColor = fb === "deepseek" ? "violet" : fb === "openrouter" ? "orange" : "violet";

  if (!upstream.ok && !upstream.fiveHour && !isFallback) return (
    <Stack gap="xs">
      <Group gap="xs">
        <Box w={8} h={8} style={{ borderRadius: "50%", background: "var(--mantine-color-red-5)", flexShrink: 0 }} />
        <Text size="sm" fw={600} c="red">Upstream unreachable</Text>
      </Group>
      {isAdmin && upstream.error && <Text size="xs" c="dimmed">{upstream.error}</Text>}
      {upstream.nextPoll && <Text size="xs" c="dimmed">Next poll in {upstream.nextPoll}</Text>}
    </Stack>
  );

  const dotColor = upstream.ok ? (upstream.stale ? "yellow" : "teal") : "orange";

  return (
    <Stack gap="md">
      {isFallback && (
        <Paper withBorder p="xs" style={{ borderColor: `var(--mantine-color-${fbColor}-5)` }}>
          <Group gap="xs">
            <Text size="sm" c={fbColor} fw={600}>Currently using {fbName}</Text>
            <Text size="xs" c="dimmed">— Claude Max is rate-limited, requests are routed to {fbName}</Text>
          </Group>
        </Paper>
      )}
      {!upstream.ok && upstream.fiveHour && (
        <Paper withBorder p="xs" style={{ borderColor: "var(--mantine-color-yellow-5)" }}>
          <Text size="sm" c="yellow">⚠ Poll failed{isAdmin && upstream.error ? ` · ${upstream.error}` : ""}</Text>
        </Paper>
      )}
      <Group justify="space-between">
        <Group gap="sm">
          <Box w={8} h={8} style={{ borderRadius: "50%", background: `var(--mantine-color-${isFallback ? fbColor : dotColor}-5)`, flexShrink: 0 }} />
          <Text size="sm" fw={600}>{isFallback ? fbName : "Claude Max"}</Text>
          {isAdmin && upstream.email && <Text size="xs" c="dimmed" ff="monospace">{upstream.email}</Text>}
        </Group>
        <Group gap="xs">
          {isFallback && <Badge color={fbColor} variant="light" size="xs">fallback</Badge>}
          {upstream.stale && <Badge color="yellow" variant="light" size="xs">stale</Badge>}
        </Group>
      </Group>

      <UpstreamGauge upstream={upstream} />
    </Stack>
  );
}
