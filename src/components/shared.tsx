import type { ReactNode } from "react";
import { Center, Stack, Text, Button, Paper, RingProgress, Box, Group, Badge } from "@mantine/core";
import { Loader } from "@mantine/core";
import { neonColor, pctColor, fmtResetAt } from "../utils";
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

export function PeriodCard({ label, data, size = "sm" }: {
  label: string; data: UpstreamPeriod; size?: "sm" | "lg";
}) {
  // If resets_at has already passed but poll hasn't refreshed yet,
  // the stale % is meaningless — show 0 / dimmed to avoid misleading display.
  const hasReset  = new Date(data.resets_at).getTime() <= Date.now();
  const p         = hasReset ? 0 : data.utilization;
  const ring      = size === "lg" ? 320 : 80;
  const thick     = size === "lg" ? 20  : 7;
  const fzPct     = size === "lg" ? 72  : 14;
  const fzLabel   = size === "lg" ? "sm" : "xs";
  const fzResets  = size === "lg" ? "lg" : "xs";
  const fwLabel   = size === "lg" ? 800  : 700;
  const nc        = neonColor(p);
  const textGlow  = size === "lg" && !hasReset
    ? `0 0 8px ${nc}99, 0 0 20px ${nc}66, 0 0 40px ${nc}44`
    : undefined;

  return (
    <Paper withBorder p={size === "lg" ? "xl" : "sm"}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: size === "lg" ? 14 : 8 }}>
      <Text size={fzLabel} fw={fwLabel} tt="uppercase" c="dimmed" ta="center"
        style={{ letterSpacing: ".08em" }}>{label}</Text>
      <RingProgress
        size={ring} thickness={thick}
        sections={[{ value: p, color: hasReset ? "gray" : pctColor(p) }]}
        label={
          hasReset ? (
            <Text ta="center" fz={size === "lg" ? 18 : 10} c="dimmed" lh={1.2}>
              waiting{"\n"}for poll
            </Text>
          ) : (
            <Text ta="center" fz={fzPct} fw={800} c={pctColor(p)} lh={1}
              style={textGlow ? { textShadow: textGlow } : undefined}>
              {data.utilization.toFixed(0)}%
            </Text>
          )
        }
      />
      <Text size={fzResets} c="dimmed" ta="center" fw={size === "lg" ? 500 : 400}>
        resets {fmtResetAt(data.resets_at)}
      </Text>
    </Paper>
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

  const dotColor   = upstream.ok ? (upstream.stale ? "yellow" : "teal") : "orange";
  const secondary  = [
    upstream.sevenDay     && { label: "7-day",        data: upstream.sevenDay },
    upstream.sevenDaySonnet && { label: "7-day Sonnet", data: upstream.sevenDaySonnet },
  ].filter(Boolean) as { label: string; data: UpstreamPeriod }[];

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

      {upstream.fiveHour && (
        <Center>
          <PeriodCard label="5-hour" data={upstream.fiveHour} size="lg" />
        </Center>
      )}

      {secondary.length > 0 && (
        <Group gap="sm" justify="center">
          {secondary.map(({ label, data }) => (
            <PeriodCard key={label} label={label} data={data} size="sm" />
          ))}
        </Group>
      )}
    </Stack>
  );
}
