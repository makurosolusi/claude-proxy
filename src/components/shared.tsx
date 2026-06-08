import { useRef, useState, useEffect, type ReactNode } from "react";
import { Stack, Text, Button, Center, Paper, Box, Group, Badge, SimpleGrid, Tooltip, useMantineColorScheme, ThemeIcon } from "@mantine/core";
import { Loader } from "@mantine/core";
import { IconClock, IconBan } from "@tabler/icons-react";
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

export function WaitingPage() {
  return (
    <Center mih="100vh">
      <Paper withBorder p="xl" radius="md" style={{ maxWidth: 400, width: "100%", textAlign: "center" }}>
        <Stack align="center" gap="md">
          <ThemeIcon size={56} radius="xl" variant="light" color="yellow">
            <IconClock size={28} />
          </ThemeIcon>
          <Stack gap={4} align="center">
            <Text size="lg" fw={700}>Menunggu Persetujuan</Text>
            <Text size="sm" c="dimmed">Akun kamu sudah terdaftar. Silakan tunggu admin menyetujui aksesmu.</Text>
          </Stack>
          <Button component="a" href="/auth/logout" variant="subtle" color="gray" size="sm">
            Keluar
          </Button>
        </Stack>
      </Paper>
    </Center>
  );
}

export function BlockedPage() {
  return (
    <Center mih="100vh">
      <Paper withBorder p="xl" radius="md" style={{ maxWidth: 400, width: "100%", textAlign: "center" }}>
        <Stack align="center" gap="md">
          <ThemeIcon size={56} radius="xl" variant="light" color="red">
            <IconBan size={28} />
          </ThemeIcon>
          <Stack gap={4} align="center">
            <Text size="lg" fw={700}>Akses Diblokir</Text>
            <Text size="sm" c="dimmed">Akun kamu telah diblokir. Hubungi admin jika kamu merasa ini adalah kesalahan.</Text>
          </Stack>
          <Button component="a" href="/auth/logout" variant="subtle" color="gray" size="sm">
            Keluar
          </Button>
        </Stack>
      </Paper>
    </Center>
  );
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
  if (profile.status === "blocked") {
    window.location.replace("/diblokir");
    return null;
  }
  if (profile.status === "pending") {
    window.location.replace("/menunggu");
    return null;
  }
  return <>{children}</>;
}

export function TruncText({ children, tooltip, ...rest }: {
  children: string;
  tooltip?: string;
  [key: string]: unknown;
}) {
  const ref = useRef<HTMLElement>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOver(el.scrollWidth > el.clientWidth);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children]);

  return (
    <Tooltip label={tooltip ?? children} withArrow disabled={!over} openDelay={200}>
      <Text ref={ref} truncate {...(rest as any)}>{children}</Text>
    </Tooltip>
  );
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
        distance: -42, color: textCol, fontSize: 11, fontFamily: "monospace",
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
    <SimpleGrid cols={{ base: 1, sm: entries.length > 1 ? 2 : 1, md: entries.length }} spacing="xs">
      {entries.map(e => (
        <SingleGauge key={e.label} label={e.label} data={e.data} dark={dark} arcColors={arcColors} />
      ))}
    </SimpleGrid>
  );
}

export function UpstreamSection({ upstream, isAdmin }: { upstream: UpstreamData; isAdmin: boolean }) {
  const fb = upstream.fallbackProvider;
  const ap = upstream.activeProvider;
  const isFallback = fb != null && fb !== "anthropic";
  const fbName = fb === "deepseek" ? "DeepSeek" : fb === "openrouter" ? "OpenRouter" : fb || "";
  const fbColor = fb === "deepseek" ? "violet" : fb === "openrouter" ? "orange" : "violet";
  const anthropicAvail = upstream.anthropicAvailable ?? true;
  const opMode = upstream.operationMode;

  // No-provider mode: nothing is configured — flag the admin to fix it.
  if (opMode === "no-provider") return (
    <Stack gap="xs">
      <Group gap="xs">
        <Box w={8} h={8} style={{ borderRadius: "50%", background: "var(--mantine-color-red-5)", flexShrink: 0 }} />
        <Text size="sm" fw={600} c="red">No provider configured</Text>
      </Group>
      <Text size="xs" c="dimmed">Connect a Claude account in admin → Accounts, or set a DeepSeek/OpenRouter API key in admin → Providers.</Text>
    </Stack>
  );

  // Fallback-only mode: Anthropic intentionally disabled — show informational
  // banner instead of red "upstream unreachable". The "activeProvider" tells us
  // which provider is currently serving requests.
  if (!anthropicAvail) {
    const apName  = ap === "deepseek" ? "DeepSeek" : ap === "openrouter" ? "OpenRouter" : ap || "fallback";
    const apColor = ap === "deepseek" ? "violet" : ap === "openrouter" ? "orange" : "blue";
    return (
      <Stack gap="md">
        <Paper withBorder p="xs" style={{ borderColor: `var(--mantine-color-${apColor}-5)` }}>
          <Group gap="xs">
            <Box w={8} h={8} style={{ borderRadius: "50%", background: `var(--mantine-color-${apColor}-5)`, flexShrink: 0 }} />
            <Text size="sm" c={apColor} fw={600}>Running on {apName}</Text>
            <Text size="xs" c="dimmed">— Anthropic not connected, all requests route via {apName}</Text>
          </Group>
        </Paper>
        <Text size="xs" c="dimmed">{isAdmin ? "To enable Claude routing, connect a Claude credential in admin → Accounts." : "Service is operating normally on the fallback provider."}</Text>
      </Stack>
    );
  }

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
          <Text size="sm" c="yellow" style={{ wordBreak: "break-word" }}>⚠ Poll failed{isAdmin && upstream.error ? ` · ${upstream.error}` : ""}</Text>
        </Paper>
      )}
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
          <Box w={8} h={8} style={{ borderRadius: "50%", background: `var(--mantine-color-${isFallback ? fbColor : dotColor}-5)`, flexShrink: 0 }} />
          <Text size="sm" fw={600} style={{ flexShrink: 0 }}>{isFallback ? fbName : "Claude Max"}</Text>
          {isAdmin && upstream.email && (
            <Text size="xs" c="dimmed" ff="monospace" truncate style={{ minWidth: 0, flex: 1 }}>{upstream.email}</Text>
          )}
        </Group>
        <Group gap="xs" style={{ flexShrink: 0 }}>
          {isFallback && <Badge color={fbColor} variant="light" size="xs">fallback</Badge>}
          {upstream.stale && <Badge color="yellow" variant="light" size="xs">stale</Badge>}
        </Group>
      </Group>

      <UpstreamGauge upstream={upstream} />
    </Stack>
  );
}
