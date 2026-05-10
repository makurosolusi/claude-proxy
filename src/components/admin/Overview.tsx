import { useState } from "react";
import { Stack, SimpleGrid, Paper, Text, Group, ThemeIcon, NumberFormatter, Box, Loader } from "@mantine/core";
import { IconRefresh, IconPlayerPause, IconPencil, IconLogout, IconActivity, IconUsers, IconGauge, IconChartBar, IconClock, IconTrash } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { modals } from "@mantine/modals";
import { pctColor, fmtResetAt, adminPost } from "../../utils";
import type { TokenStatus, UpstreamData } from "../../contexts";
import { UpstreamSection } from "../shared";

function StatCard({ label, value, sub, color, suffix, icon }: {
  label: string; value: string | number; sub?: string; color?: string; suffix?: string; icon: React.ReactNode;
}) {
  return (
    <Paper withBorder p="md" h="100%" radius="md" style={{ overflow: "hidden" }}>
      <Group gap="sm" mb={8}>
        <ThemeIcon variant="light" color={color ?? "gray"} size="md" radius="md">{icon}</ThemeIcon>
        <Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>{label}</Text>
      </Group>
      <Group gap={4} align="baseline" wrap="nowrap">
        <Text fz={{ base: 18, xs: 22, sm: 26 }} fw={800} ff="monospace" c={color ?? "inherit"}
          style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
          {typeof value === "number" ? <NumberFormatter value={value} thousandSeparator /> : value}
        </Text>
        {suffix && <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>{suffix}</Text>}
      </Group>
      {sub && <Text size="xs" c="dimmed" mt={2}>{sub}</Text>}
    </Paper>
  );
}

type ActionId = "reset" | "pause" | "edit" | "clearLogs" | "clearUsage";

function ActionCard({ icon, label, desc, color, loading, onClick }: {
  icon: React.ReactNode; label: string; desc: string; color: string;
  loading?: boolean; onClick: () => void;
}) {
  return (
    <Paper withBorder p="sm" radius="md"
      style={{ cursor: loading ? "default" : "pointer", opacity: loading ? 0.7 : 1, transition: "opacity .15s" }}
      onClick={loading ? undefined : onClick}>
      <Group gap="sm" wrap="nowrap">
        <ThemeIcon variant="light" color={color} size="lg" radius="md" style={{ flexShrink: 0 }}>
          {loading ? <Loader size={16} color="var(--mantine-color-dimmed)" /> : icon}
        </ThemeIcon>
        <div style={{ minWidth: 0 }}>
          <Text size="sm" fw={600}>{label}</Text>
          <Text size="xs" c="dimmed">{desc}</Text>
        </div>
      </Group>
    </Paper>
  );
}

export function AdminOverview({ tokens, upstream }: {
  tokens: Record<string, TokenStatus>; upstream: UpstreamData;
}) {
  const [loading, setLoading] = useState<ActionId | null>(null);

  const run = async (id: ActionId, fn: () => Promise<void>, successMsg: string) => {
    setLoading(id);
    try {
      await fn();
      notifications.show({ color: "teal", message: successMsg, autoClose: 2000 });
    } catch (e: any) {
      notifications.show({ color: "red", title: "Error", message: e.message || "Action failed", autoClose: 4000 });
    } finally {
      setLoading(null);
    }
  };

  const totalToday  = Object.values(tokens).reduce((s, t) => s + (t.today ?? 0), 0);
  const totalUsed   = Object.values(tokens).reduce((s, t) => s + t.used, 0);
  const activeUsers = Object.values(tokens).filter(t => (t.today ?? 0) > 0).length;
  const totalTokens = Object.keys(tokens).length;
  const utilPct     = upstream.fiveHour?.utilization ?? null;
  const resetsIn    = upstream.fiveHour ? fmtResetAt(upstream.fiveHour.resets_at) : null;
  const statusDot   = upstream.ok ? "teal" : "red";

  return (
    <Stack gap="xl">
      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" wrap="wrap">
          <div>
            <Text size="sm" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }} mb={4}>Dashboard</Text>
            <Text size="xl" fw={800} ff="monospace">claude-proxy</Text>
            <Text size="sm" c="dimmed" mt={2}>Admin overview · all systems at a glance</Text>
          </div>
          <Group gap="sm">
            <Group gap="xs">
              <Box w={7} h={7} style={{ borderRadius: "50%", background: `var(--mantine-color-${statusDot}-5)` }} />
              <Text size="xs" c="dimmed" ff="monospace">{upstream.ok ? "upstream ok" : "upstream issues"}</Text>
            </Group>
            <Group gap={4}>
              <IconClock size={12} color="var(--mantine-color-dimmed)" />
              <Text size="xs" c="dimmed" ff="monospace">poll {upstream.pollAge ?? "—"}</Text>
            </Group>
          </Group>
        </Group>
      </Paper>

      <SimpleGrid cols={{ base: 1, xs: 2, sm: 4 }} spacing="md">
        <StatCard label="Tokens today" value={totalToday} sub="across all users"
          color={totalToday > 50000 ? "red" : totalToday > 20000 ? "orange" : "teal"} icon={<IconActivity size={16} />} />
        <StatCard label="Upstream 5h" value={utilPct !== null ? `${utilPct.toFixed(0)}` : "—"} suffix="%"
          sub={resetsIn ? `resets ${resetsIn}` : "no data"} color={utilPct !== null ? pctColor(utilPct) : "gray"} icon={<IconGauge size={16} />} />
        <StatCard label="Active users" value={activeUsers} sub={`of ${totalTokens} total`} color="blue" icon={<IconUsers size={16} />} />
        <StatCard label="Window usage" value={totalUsed} sub="current window" color="teal" icon={<IconChartBar size={16} />} />
      </SimpleGrid>

      <Stack gap="xs">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Upstream Health</Text>
        <Paper withBorder p="lg" radius="md">
          <UpstreamSection upstream={upstream} isAdmin={true} />
        </Paper>
      </Stack>

      <Stack gap="xs">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Quick Actions</Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <ActionCard
            icon={<IconRefresh size={18} />} label="Reset All Usage"
            desc="Zero out window counters for all tokens" color="gray"
            loading={loading === "reset"}
            onClick={() => modals.openConfirmModal({
              title: "Reset All Usage",
              children: <Text size="sm">Zero out window counters for all tokens? This cannot be undone.</Text>,
              labels: { confirm: "Reset", cancel: "Cancel" },
              confirmProps: { color: "red" },
              onConfirm: () => run("reset", () => adminPost("/admin/reset", { all: "true" }), "All usage reset"),
            })}
          />
          <ActionCard
            icon={<IconPlayerPause size={18} />} label="Pause All Tokens"
            desc="Suspend all tokens — requests will be rejected" color="orange"
            loading={loading === "pause"}
            onClick={() => run("pause", () => adminPost("/admin/token/pause", { all: "true" }), "All tokens paused/resumed")}
          />
          <ActionCard
            icon={<IconPencil size={18} />} label="Edit All Limits"
            desc="Set a new uniform quota across all tokens" color="blue"
            loading={loading === "edit"}
            onClick={() => {
              const v = prompt("New limit for all tokens:");
              if (v) run("edit", () => adminPost("/admin/token/edit-all", { limit: v }), `All limits set to ${v}`);
            }}
          />
          <ActionCard
            icon={<IconTrash size={18} />} label="Clear Request Logs"
            desc="Delete all request log history. Quota counters unaffected." color="red"
            loading={loading === "clearLogs"}
            onClick={() => modals.openConfirmModal({
              title: "Clear Request Logs",
              children: <Text size="sm">Hapus semua request logs? Quota counter tidak ikut terhapus. Tindakan ini tidak bisa dibatalkan.</Text>,
              labels: { confirm: "Clear Logs", cancel: "Cancel" },
              confirmProps: { color: "red" },
              onConfirm: () => run("clearLogs", async () => { await fetch("/admin/logs/clear", { method: "POST" }); }, "Request logs cleared"),
            })}
          />
          <ActionCard
            icon={<IconTrash size={18} />} label="Clear Usage History"
            desc="Delete daily usage history. Current window unaffected." color="orange"
            loading={loading === "clearUsage"}
            onClick={() => modals.openConfirmModal({
              title: "Clear Daily Usage History",
              children: <Text size="sm">Hapus semua data daily usage (grafik per-user)? Quota counter window saat ini tidak terpengaruh. Tindakan ini tidak bisa dibatalkan.</Text>,
              labels: { confirm: "Clear Usage History", cancel: "Cancel" },
              confirmProps: { color: "orange" },
              onConfirm: () => run("clearUsage", async () => { await fetch("/admin/usage/clear", { method: "POST" }); }, "Usage history cleared"),
            })}
          />
          <ActionCard
            icon={<IconLogout size={18} />} label="Sign Out"
            desc="End admin session and return to public page" color="gray"
            onClick={() => { window.location.href = "/admin/logout"; }}
          />
        </SimpleGrid>
      </Stack>
    </Stack>
  );
}
