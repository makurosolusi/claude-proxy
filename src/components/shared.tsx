import type { ReactNode } from "react";
import { Stack, Text, Button, Center, Paper, Box, Group, Badge, useMantineColorScheme } from "@mantine/core";
import { Loader } from "@mantine/core";
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
    // Hard redirect — /admin/login is server-rendered HTML, not in React Router
    window.location.replace("/admin/login");
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

function buildGaugeSeries(
  entry: { label: string; data: UpstreamPeriod },
  center: [string, string],
  radius: string,
  isMain: boolean,
  dark: boolean,
  arcColors: [number, string][],
) {
  const expired  = new Date(entry.data.resets_at).getTime() <= Date.now();
  const val      = expired ? 0 : Math.round(entry.data.utilization);
  const nc       = expired ? "#868e96" : needleColor(val);
  const tickCol  = dark ? "#6c757d" : "#868e96";
  const textCol  = dark ? "#c1c2c5" : "#343a40";
  const lblCol   = dark ? "#adb5bd" : "#495057";
  const dimCol   = dark ? "#5c5f66" : "#adb5bd";
  const resetStr = fmtResetAt(entry.data.resets_at);

  return {
    type: "gauge", center, radius,
    min: 0, max: 100,
    startAngle: 215, endAngle: -35,
    splitNumber: 5,
    axisLine:  { lineStyle: { width: isMain ? 16 : 10, color: arcColors } },
    progress:  { show: false },
    pointer: {
      show: true, length: "65%",
      width: isMain ? 7 : 4,
      itemStyle: { color: nc },
    },
    anchor: {
      show: true, showAbove: true,
      size: isMain ? 18 : 11,
      itemStyle: {
        color: dark ? "#25262b" : "#f8f9fa",
        borderColor: dark ? "#5c5f66" : "#adb5bd",
        borderWidth: isMain ? 4 : 2,
      },
    },
    splitLine: {
      distance: isMain ? -22 : -14,
      length:   isMain ? 22  : 14,
      lineStyle: { color: tickCol, width: isMain ? 2 : 1.5 },
    },
    axisTick: {
      distance: isMain ? -14 : -9,
      length:   isMain ? 12  : 7,
      lineStyle: { color: tickCol, width: 1 },
    },
    axisLabel: {
      distance:   isMain ? -40 : -26,
      color:      textCol,
      fontSize:   isMain ? 15  : 10,
      fontFamily: "monospace",
    },
    title: {
      offsetCenter: ["0%", "-25%"],
      color:   lblCol,
      fontSize: isMain ? 16 : 12,
      fontFamily: "monospace",
      fontWeight: "bold",
    },
    detail: {
      valueAnimation: true,
      offsetCenter: ["0%", "52%"],
      borderWidth: 0,
      rich: {
        v: { fontSize: isMain ? 48 : 26, fontWeight: "bold", fontFamily: "monospace", color: nc, lineHeight: isMain ? 56 : 30 },
        r: { fontSize: isMain ? 13 : 10, fontFamily: "monospace", color: dimCol, lineHeight: isMain ? 20 : 15 },
      },
      formatter: expired
        ? () => `{v|—}\n{r|waiting for poll}`
        : (v: number) => `{v|${v}%}\n{r|resets ${resetStr}}`,
    },
    data: [{ value: val, name: entry.label }],
  };
}

function UpstreamGauge({ upstream }: { upstream: UpstreamData }) {
  const { colorScheme } = useMantineColorScheme();
  const dark = colorScheme === "dark";

  const entries = [
    upstream.fiveHour       && { label: "5-Hour",   data: upstream.fiveHour },
    upstream.sevenDay       && { label: "7-Day",     data: upstream.sevenDay },
    upstream.sevenDaySonnet && { label: "7d·Sonnet", data: upstream.sevenDaySonnet },
  ].filter(Boolean) as { label: string; data: UpstreamPeriod }[];

  if (entries.length === 0) return null;

  const n = entries.length;
  const arcColors: [number, string][] = [
    [0.65, dark ? "#373a40" : "#ced4da"],
    [0.82, "#e8590c"],
    [1.0,  "#c92a2a"],
  ];

  // Layout: 5-hour is always the main large gauge on the left.
  // 7-day and 7d-Sonnet stack on the right side (smaller).
  type Pos = { center: [string, string]; radius: string; isMain: boolean };
  const positions: Pos[] = n === 1
    ? [{ center: ["50%", "52%"], radius: "76%",  isMain: true  }]
    : n === 2
    ? [
        { center: ["30%", "52%"], radius: "58%",  isMain: true  },
        { center: ["78%", "52%"], radius: "44%",  isMain: false },
      ]
    : [
        { center: ["27%", "52%"], radius: "54%",  isMain: true  },
        { center: ["78%", "22%"], radius: "25%",  isMain: false },
        { center: ["78%", "74%"], radius: "25%",  isMain: false },
      ];

  const height = n === 3 ? 460 : 380;

  const series = entries.map((e, i) =>
    buildGaugeSeries(e, positions[i].center, positions[i].radius, positions[i].isMain, dark, arcColors)
  );

  return (
    <ReactECharts
      option={{ backgroundColor: "transparent", series }}
      style={{ height, width: "100%" }}
      opts={{ renderer: "canvas" }}
    />
  );
}

export function UpstreamSection({ upstream, isAdmin }: { upstream: UpstreamData; isAdmin: boolean }) {
  if (!upstream.ok && !upstream.fiveHour) return (
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
      {!upstream.ok && upstream.fiveHour && (
        <Paper withBorder p="xs" style={{ borderColor: "var(--mantine-color-yellow-5)" }}>
          <Text size="sm" c="yellow">⚠ Poll failed{isAdmin && upstream.error ? ` · ${upstream.error}` : ""}</Text>
        </Paper>
      )}
      <Group justify="space-between">
        <Group gap="sm">
          <Box w={8} h={8} style={{ borderRadius: "50%", background: `var(--mantine-color-${dotColor}-5)`, flexShrink: 0 }} />
          <Text size="sm" fw={600}>Claude Max</Text>
          {isAdmin && upstream.email && <Text size="xs" c="dimmed" ff="monospace">{upstream.email}</Text>}
        </Group>
        {upstream.stale && <Badge color="yellow" variant="light" size="xs">stale</Badge>}
      </Group>

      <UpstreamGauge upstream={upstream} />
    </Stack>
  );
}
