import { useMantineColorScheme, Box, Group, Text, Badge, Button, ActionIcon, Tooltip } from "@mantine/core";
import { IconSun, IconMoon, IconLogin, IconLogout, IconUsers } from "@tabler/icons-react";
import type { UpstreamData, ProfileResponse, StatusResponse } from "../../contexts";
import type { ProviderInfo } from "../../providerDisplay";
import { resolveProvider, shortenModel } from "../../providerDisplay";
import { ClockInline } from "../ClockInline";
import { NotificationPopover } from "../NotificationPopover";

const nf = new Intl.NumberFormat();

interface DashboardHeaderProps {
  isAdmin: boolean;
  isAdminStatus: boolean;
  profile: ProfileResponse | undefined;
  upstream: UpstreamData | undefined;
  customProviders: ProviderInfo[];
}

export function DashboardHeader({ isAdmin, isAdminStatus, profile, upstream, customProviders }: DashboardHeaderProps) {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();

  const ap             = upstream?.activeProvider;
  const anthropicAvail = upstream?.anthropicAvailable ?? true;
  const displayProvider = ap || (anthropicAvail ? "anthropic" : "");
  const isFallback     = !!ap && ap !== "anthropic";
  const provInfo       = resolveProvider(displayProvider || "anthropic", customProviders);
  const provName       = displayProvider ? provInfo.name : "no provider";
  const colorMap: Record<string, string> = {
    blue: "#3b82f6", violet: "#7c3aed", orange: "#f97316", teal: "#0d9488",
    gray: "#71717a", pink: "#ec4899", cyan: "#06b6d4", yellow: "#eab308",
    lime: "#84cc16", indigo: "#6366f1", red: "#ef4444",
  };
  const provDot    = upstream?.ok || isFallback ? (colorMap[provInfo.color] || "#3b82f6") : "#71717a";
  const modelLabel = shortenModel(upstream?.activeModel || (anthropicAvail ? "claude-sonnet-4-6" : "—"), 20);
  const roleColor  = profile?.role === "SUPER_ADMIN" ? "red" : profile?.role === "ADMIN" ? "orange" : "blue";
  const roleLabel  = profile?.role === "SUPER_ADMIN" ? "Super Admin" : profile?.role === "ADMIN" ? "Admin" : "User";
  const myTokens   = Object.values(profile?.tokens || {});
  const totalUsed  = myTokens.reduce((s, t) => s + t.used, 0);
  const totalLim   = myTokens.reduce((s, t) => s + (t.limit ?? 0), 0);
  const todayTok   = myTokens.reduce((s, t) => s + t.today, 0);
  const pct        = totalLim > 0 ? Math.min(100, Math.round((totalUsed / totalLim) * 100)) : 0;
  const pctColor   = pct >= 95 ? "#dc2626" : pct >= 75 ? "#f97316" : pct >= 50 ? "#d97706" : "#2563eb";

  return (
    <>
      {/* ── Navbar — sticky ─────────────────────────── */}
      <div className="cp-header-fixed">
        <Box px={{ base: 12, sm: 24 }} style={{ height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 1800, margin: "0 auto" }}>
          <Group gap={12} wrap="nowrap">
            <Box style={{
              width: 34, height: 34, flexShrink: 0,
              background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
              borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 2px 8px rgba(37,99,235,0.35)",
            }}>
              <Text span fz={11} fw={800} c="white" ff="Geist Mono, monospace" style={{ letterSpacing: "-0.03em" }}>CP</Text>
            </Box>
            <div>
              <Text fw={700} fz={15} lh={1.2} style={{ letterSpacing: "-0.02em" }}>claude-proxy</Text>
              <Text fz={11} c="dimmed" visibleFrom="sm" lh={1}>Multi-user Claude Max proxy</Text>
            </div>
          </Group>
          <Group gap={6} wrap="nowrap">
            <NotificationPopover />
            <Tooltip label="Toggle theme" position="bottom" withArrow openDelay={600}>
              <ActionIcon variant="subtle" size="md" radius="lg" onClick={() => toggleColorScheme()}
                style={{ color: "var(--cp-text-2)" }}>
                {colorScheme === "dark" ? <IconSun size={15} /> : <IconMoon size={15} />}
              </ActionIcon>
            </Tooltip>
            {(isAdmin || isAdminStatus) && (
              <Button component="a" href="/admin" size="xs" variant="light" radius="lg"
                leftSection={<IconLogin size={12} />} style={{ fontWeight: 600, fontSize: 12 }}>
                Admin
              </Button>
            )}
            <Button component="a" href="/auth/logout" size="xs" variant="subtle" radius="lg"
              leftSection={<IconLogout size={12} />}
              style={{ fontWeight: 600, fontSize: 12, color: "var(--cp-text-2)" }}>
              <Text visibleFrom="xs" span>Sign out</Text>
            </Button>
          </Group>
        </Box>
      </div>

      {/* ── Sub-header — scroll normal ──────────────── */}
      <Box px={{ base: 12, sm: 24 }} py={{ base: 8, sm: 10 }}
        style={{ borderTop: "1px solid var(--cp-border)", borderBottom: "1px solid var(--cp-border)" }}>
        <Group justify="space-between" gap="md" wrap="wrap" style={{ maxWidth: 1800, margin: "0 auto" }}>

          {/* Left: User + Quota + Model */}
          <Group gap={16} wrap="wrap" style={{ flex: 1, minWidth: 0 }}>

            {profile?.authenticated && (
              <Group gap={8} wrap="nowrap" style={{ flexShrink: 0 }}>
                <Box>
                  <Group gap={5} wrap="nowrap">
                    <Text fz={13} fw={600} style={{ letterSpacing: "-0.01em" }}>
                      {profile.name || profile.email?.split("@")[0]}
                    </Text>
                    <Badge size="xs" color={roleColor} variant="light" style={{ fontSize: 10, fontWeight: 700 }}>{roleLabel}</Badge>
                  </Group>
                  <Text fz={10} c="dimmed" visibleFrom="sm">{profile.email}</Text>
                </Box>
              </Group>
            )}

            {totalLim > 0 && (() => {
              const remaining     = Math.max(0, totalLim - totalUsed);
              const lowRemaining  = remaining < totalLim * 0.1;
              const remainColor   = lowRemaining ? "#f97316" : "#10b981";
              const barColor      = pct >= 95 ? "var(--cp-red)" : pct >= 75 ? "var(--cp-amber)" : "var(--cp-accent)";
              const tokenCount    = myTokens.length;
              return (
                <Box style={{ minWidth: 180, maxWidth: 340, flex: 1 }}>
                  <Group justify="space-between" align="center" mb={5} wrap="nowrap">
                    <Group gap={5} wrap="nowrap" style={{ minWidth: 0 }}>
                      <Text fz={10} c="dimmed" fw={600} tt="uppercase" style={{ letterSpacing: ".06em" }}>Quota</Text>
                      {tokenCount > 1 && (
                        <Text fz={9} c="dimmed" ff="Geist Mono, monospace" style={{ opacity: 0.7 }}>· {tokenCount} token</Text>
                      )}
                    </Group>
                    <Group gap={4} wrap="nowrap" align="baseline">
                      <Text fz={12} ff="Geist Mono, monospace" fw={700} style={{ color: pctColor, lineHeight: 1 }}>{pct}%</Text>
                      <Text fz={9} c="dimmed" ff="Geist Mono, monospace">terpakai</Text>
                    </Group>
                  </Group>
                  <Box style={{ height: 4, background: "var(--cp-surface-3)", borderRadius: 4, overflow: "hidden", marginBottom: 6 }}>
                    <Box style={{ height: "100%", borderRadius: 4, width: `${pct}%`, background: barColor, transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)" }} />
                  </Box>
                  <Group gap={0} wrap="nowrap" align="stretch">
                    <Tooltip label={`Window ini: ${nf.format(totalUsed)} dari ${nf.format(totalLim)} token`} withArrow position="bottom">
                      <Box style={{ flex: 1, minWidth: 0, cursor: "default" }}>
                        <Text fz={9} c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".05em", lineHeight: 1.2 }}>Window</Text>
                        <Text fz={11} fw={700} ff="Geist Mono, monospace" truncate style={{ color: pctColor, lineHeight: 1.3 }}>{nf.format(totalUsed)}</Text>
                      </Box>
                    </Tooltip>
                    <Box style={{ width: 1, background: "var(--cp-border)", margin: "1px 8px" }} />
                    <Tooltip label={`Total token hari ini (semua window): ${nf.format(todayTok)}`} withArrow position="bottom">
                      <Box style={{ flex: 1, minWidth: 0, cursor: "default" }}>
                        <Text fz={9} c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".05em", lineHeight: 1.2 }}>Hari ini</Text>
                        <Text fz={11} fw={700} ff="Geist Mono, monospace" truncate style={{ lineHeight: 1.3 }}>{nf.format(todayTok)}</Text>
                      </Box>
                    </Tooltip>
                    <Box style={{ width: 1, background: "var(--cp-border)", margin: "1px 8px" }} />
                    <Tooltip label={lowRemaining ? "Sisa kuota window menipis" : `Sisa kuota: ${nf.format(remaining)} token`} withArrow position="bottom">
                      <Box style={{ flex: 1, minWidth: 0, cursor: "default" }}>
                        <Text fz={9} c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".05em", lineHeight: 1.2 }}>Sisa</Text>
                        <Text fz={11} fw={700} ff="Geist Mono, monospace" truncate style={{ color: remainColor, lineHeight: 1.3 }}>{nf.format(remaining)}</Text>
                      </Box>
                    </Tooltip>
                  </Group>
                </Box>
              );
            })()}

            <Group gap={6} wrap="nowrap" visibleFrom="md">
              <Box w={6} h={6} style={{ borderRadius: "50%", background: provDot, flexShrink: 0 }} />
              <Text fz={12} fw={600}>{provName}</Text>
              <Text fz={11} c="dimmed" ff="Geist Mono, monospace">{modelLabel}</Text>
              <Badge size="xs" variant="dot" color={isFallback ? "orange" : "teal"} style={{ fontSize: 10 }}>
                {isFallback ? "fallback" : "primary"}
              </Badge>
            </Group>
          </Group>

          {/* Right: clock + today + profile */}
          <Group gap={12} wrap="nowrap" style={{ flexShrink: 0 }}>
            <ClockInline />
            <Box ta="center" style={{ flexShrink: 0 }}>
              <Text fz={9} c="dimmed" tt="uppercase" style={{ letterSpacing: ".06em" }}>Today</Text>
              <Text fz={14} fw={700} ff="Geist Mono, monospace" lh={1.2}>{nf.format(todayTok)}</Text>
            </Box>
            <Button component="a" href="/profile" size="xs" variant="light" radius="lg"
              leftSection={<IconUsers size={11} />} style={{ fontWeight: 600, fontSize: 12 }}>
              <Text visibleFrom="xs" span>Profile</Text>
            </Button>
          </Group>
        </Group>
      </Box>
    </>
  );
}
