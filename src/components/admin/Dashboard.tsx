import { useState } from "react";
import { useDisclosure } from "@mantine/hooks";
import {
  AppShell, NavLink, ScrollArea, Group, Text, Badge, ActionIcon, Tooltip,
  Box, Divider, Stack, Paper, useMantineColorScheme, Burger, ThemeIcon,
} from "@mantine/core";
import {
  IconLayoutDashboard, IconUsers, IconList, IconChartBar,
  IconSitemap, IconExternalLink, IconSun, IconMoon,
  IconChevronsLeft, IconChevronsRight,
  IconPlugConnected, IconKey, IconLogout,
  IconRoute, IconCloud, IconChartLine, IconDatabase,
  IconAlertTriangle, IconHistory,
} from "@tabler/icons-react";
import { pctColor } from "../../utils";
import { useStatus } from "../../contexts";
import { UpstreamSection } from "../shared";
import { DailyHistory } from "../tables/DailyHistory";
import { RequestLog } from "../tables/RequestLog";
import { AdminOverview } from "./Overview";
import { AdminUsers } from "./Users";
import { AdminTest } from "./Test";
import { AdminAccounts } from "./Accounts";
import { AdminModelRouting } from "./ModelRouting";
import { AdminProviders } from "./Providers";
import { AdminUserActivity } from "./UserActivity";
import { AdminDatabase } from "./Database";

type AdminSection = "overview" | "users" | "logs" | "stats" | "activity" | "routing" | "providers" | "test" | "accounts" | "database";

interface NavGroup {
  label: string;
  items: { id: AdminSection; label: string; icon: React.ReactNode; desc: string }[];
}

function AdminStats({ userImages }: { userImages: Record<string, string> }) {
  return (
    <Stack gap="xl">
      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" wrap="wrap">
          <div>
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }} mb={4}>Stats</Text>
            <Text size="xl" fw={800} ff="monospace">Daily Usage History</Text>
            <Text size="sm" c="dimmed" mt={2}>Per-user token usage breakdown · last 30 days</Text>
          </div>
        </Group>
      </Paper>
      <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
        <DailyHistory isAdmin={true} userImages={userImages} />
      </Paper>
    </Stack>
  );
}

export function AdminDashboard() {
  const status = useStatus()!;
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const isDark = colorScheme === "dark";

  const [section, setSection] = useState<AdminSection>(() => {
    try { return (localStorage.getItem("admin-section") as AdminSection) || "overview"; }
    catch { return "overview"; }
  });
  const [mobileOpen, { toggle: toggleMobile, close }] = useDisclosure(false);
  const [collapsed,  { toggle: toggleCollapse }]      = useDisclosure(false);

  const { tokens, upstream, userImages = {} } = status;
  const nav = (s: AdminSection) => {
    setSection(s); try { localStorage.setItem("admin-section", s); } catch {}; close();
  };

  const SZ = 16;
  const navGroups: NavGroup[] = [
    {
      label: "Monitor",
      items: [
        { id: "overview",  label: "Overview",      icon: <IconLayoutDashboard size={SZ} />, desc: "Upstream & quick stats"         },
        { id: "activity",  label: "Activity",      icon: <IconChartLine       size={SZ} />, desc: "Per-user activity"               },
        { id: "stats",     label: "Stats",         icon: <IconChartBar        size={SZ} />, desc: "Daily usage history"             },
        { id: "logs",      label: "Request Logs",  icon: <IconList            size={SZ} />, desc: "Full request history"            },
      ],
    },
    {
      label: "Manage",
      items: [
        { id: "users",     label: "Users",         icon: <IconUsers           size={SZ} />, desc: "Token & quota management"        },
        { id: "routing",   label: "Routing",       icon: <IconRoute           size={SZ} />, desc: "Model fallback rules"            },
        { id: "providers", label: "Providers",     icon: <IconCloud           size={SZ} />, desc: "Claude Max, OpenRouter & DS"     },
        { id: "accounts",  label: "Credentials",   icon: <IconKey             size={SZ} />, desc: "API keys & OAuth accounts"       },
      ],
    },
    {
      label: "Tools",
      items: [
        { id: "test",      label: "Test Connection", icon: <IconPlugConnected size={SZ} />, desc: "Verify API connectivity"         },
        { id: "database",  label: "Database",        icon: <IconDatabase      size={SZ} />, desc: "DB sync & retention"             },
      ],
    },
  ];
  const allNavItems = navGroups.flatMap(g => g.items);

  const footerLinks = [
    { icon: <IconSitemap      size={SZ} />, label: "Mind Map",    desc: "Request graph",           href: "/mind",  target: "_blank" },
    { icon: <IconHistory      size={SZ} />, label: "Public View", desc: "User-facing dashboard",   href: "/",      target: undefined },
    { icon: <IconExternalLink size={SZ} />, label: "Race Chart",  desc: "Token burn visualizer",   href: "/race",  target: "_blank" },
  ];

  const utilPct    = upstream.fiveHour?.utilization ?? null;
  const statusColor = upstream.ok ? "teal" : upstream.stale ? "orange" : "red";
  const SIDEBAR_W   = collapsed ? 60 : 224;

  const activeItem = allNavItems.find(i => i.id === section);

  return (
    <AppShell
      header={{ height: 52 }}
      navbar={{ width: SIDEBAR_W, breakpoint: "sm", collapsed: { mobile: !mobileOpen } }}
      padding={0}
      transitionDuration={180}
    >
      {/* ── Header ────────────────────────────────────────────────────── */}
      <AppShell.Header style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">

          {/* Left: burger + logo */}
          <Group gap={8} wrap="nowrap">
            <Burger opened={mobileOpen} onClick={toggleMobile} hiddenFrom="sm" size="sm" />
            <Tooltip label={collapsed ? "Expand sidebar" : "Collapse sidebar"} position="bottom" withArrow openDelay={500}>
              <ActionIcon variant="subtle" size="sm" onClick={toggleCollapse} visibleFrom="sm" color="gray">
                {collapsed ? <IconChevronsRight size={15} /> : <IconChevronsLeft size={15} />}
              </ActionIcon>
            </Tooltip>
            <Group gap={8} visibleFrom="xs" wrap="nowrap">
              <Box style={{
                width: 28, height: 28, flexShrink: 0,
                background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
                borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 2px 6px rgba(37,99,235,0.30)",
              }}>
                <Text span fz={10} fw={800} c="white" ff="Geist Mono, monospace" style={{ letterSpacing: "-0.03em" }}>CP</Text>
              </Box>
              <div>
                <Text fw={800} fz={14} lh={1.2} style={{ letterSpacing: "-0.02em" }}>claude-proxy</Text>
                <Text fz={10} c="dimmed" lh={1}>admin panel</Text>
              </div>
            </Group>
            {/* Breadcrumb: current section */}
            {activeItem && (
              <>
                <Text fz={13} c="dimmed" visibleFrom="sm">/</Text>
                <Group gap={5} visibleFrom="sm">
                  <ThemeIcon variant="light" color="blue" size="sm" radius="sm">{activeItem.icon}</ThemeIcon>
                  <Text fz={13} fw={600}>{activeItem.label}</Text>
                </Group>
              </>
            )}
          </Group>

          {/* Right: upstream badge + theme toggle */}
          <Group gap={8} wrap="nowrap">
            {/* Upstream status pill */}
            {utilPct !== null && (
              <Tooltip
                label={`5-hour utilization: ${utilPct.toFixed(1)}% · ${upstream.ok ? "healthy" : upstream.stale ? "stale data" : "error"}`}
                withArrow position="bottom">
                <Badge
                  variant="dot"
                  color={pctColor(utilPct)}
                  size="sm"
                  style={{ cursor: "default" }}>
                  {utilPct.toFixed(0)}% 5h
                </Badge>
              </Tooltip>
            )}
            {!upstream.ok && (
              <Tooltip label={upstream.stale ? "Upstream data stale — poll lagging" : "Upstream error"} withArrow position="bottom">
                <ThemeIcon variant="light" color="orange" size="sm" radius="sm">
                  <IconAlertTriangle size={12} />
                </ThemeIcon>
              </Tooltip>
            )}
            <Tooltip label="Toggle theme" position="bottom" withArrow openDelay={400}>
              <ActionIcon variant="subtle" size="sm" radius="md" onClick={() => toggleColorScheme()} color="gray">
                {colorScheme === "dark" ? <IconSun size={15} /> : <IconMoon size={15} />}
              </ActionIcon>
            </Tooltip>
          </Group>

        </Group>
      </AppShell.Header>

      {/* ── Sidebar ───────────────────────────────────────────────────── */}
      <AppShell.Navbar style={{ overflow: "hidden", transition: "width 180ms ease", borderRight: "1px solid var(--mantine-color-default-border)" }}>
        <AppShell.Section grow component={ScrollArea} pt="sm" pb={0} px={collapsed ? 6 : 8}>
          <Stack gap={0}>
            {navGroups.map((group, gi) => (
              <Box key={group.label} mb={gi < navGroups.length - 1 ? 4 : 0}>
                {!collapsed && (
                  <Text
                    size="10px" fw={700} tt="uppercase" c="dimmed"
                    style={{ letterSpacing: ".10em", padding: "8px 8px 4px" }}>
                    {group.label}
                  </Text>
                )}
                {collapsed && gi > 0 && <Divider my={6} />}
                <Stack gap={1}>
                  {group.items.map(item => collapsed ? (
                    <Tooltip key={item.id} label={item.label} position="right" withArrow openDelay={80}>
                      <ActionIcon
                        size={40}
                        variant={section === item.id ? "filled" : "subtle"}
                        color={section === item.id ? "blue" : "gray"}
                        onClick={() => nav(item.id)}
                        style={{ borderRadius: 8, width: "100%" }}
                      >
                        {item.icon}
                      </ActionIcon>
                    </Tooltip>
                  ) : (
                    <NavLink
                      key={item.id}
                      active={section === item.id}
                      label={<Text fz={13} fw={section === item.id ? 600 : 500}>{item.label}</Text>}
                      description={<Text fz={10} c="dimmed">{item.desc}</Text>}
                      leftSection={
                        <ThemeIcon
                          variant={section === item.id ? "filled" : "light"}
                          color={section === item.id ? "blue" : "gray"}
                          size="sm" radius="sm">
                          {item.icon}
                        </ThemeIcon>
                      }
                      onClick={() => nav(item.id)}
                      style={{ borderRadius: 8 }}
                    />
                  ))}
                </Stack>
              </Box>
            ))}
          </Stack>
        </AppShell.Section>

        {/* Footer links + status */}
        <AppShell.Section px={collapsed ? 6 : 8} pb="sm">
          <Divider mb={8} />
          <Stack gap={1} mb={8}>
            {footerLinks.map(fi => collapsed ? (
              <Tooltip key={fi.label} label={fi.label} position="right" withArrow openDelay={80}>
                <ActionIcon size={40} variant="subtle" color="gray" component="a"
                  href={fi.href} target={fi.target} style={{ borderRadius: 8, width: "100%" }}>
                  {fi.icon}
                </ActionIcon>
              </Tooltip>
            ) : (
              <NavLink
                key={fi.label}
                label={<Text fz={13} fw={500}>{fi.label}</Text>}
                description={<Text fz={10} c="dimmed">{fi.desc}</Text>}
                leftSection={<ThemeIcon variant="light" color="gray" size="sm" radius="sm">{fi.icon}</ThemeIcon>}
                component="a" href={fi.href} target={fi.target}
                style={{ borderRadius: 8 }}
              />
            ))}
          </Stack>

          <Divider mb={8} />

          {/* Credential + status footer */}
          {collapsed ? (
            <Stack gap={6} align="center">
              <Tooltip
                label={`${upstream.email ?? "no credential"} · poll ${status.pollAge ?? "—"} · ${upstream.ok ? "ok" : "issues"}`}
                position="right" withArrow multiline w={220}>
                <Box w={8} h={8} style={{ borderRadius: "50%", cursor: "default", background: `var(--mantine-color-${statusColor}-5)` }} />
              </Tooltip>
              <Tooltip label="Sign out" position="right" withArrow>
                <ActionIcon variant="subtle" color="red" size="sm" component="a" href="/admin/logout">
                  <IconLogout size={14} />
                </ActionIcon>
              </Tooltip>
            </Stack>
          ) : (
            <Box px={4}>
              {/* Credential row */}
              <Group gap={6} mb={4} wrap="nowrap">
                <Box w={7} h={7} style={{ borderRadius: "50%", flexShrink: 0, background: `var(--mantine-color-${statusColor}-5)` }} />
                <Text fz={11} c="dimmed" ff="Geist Mono, monospace" truncate style={{ flex: 1 }}>
                  {upstream.email ?? "no credential"}
                </Text>
              </Group>
              {/* Provider + poll */}
              <Group gap={6} mb={6} wrap="nowrap">
                <Badge size="xs" variant="light"
                  color={upstream.fallbackProvider === "deepseek" ? "violet" : upstream.fallbackProvider === "openrouter" ? "orange" : "blue"}>
                  {upstream.fallbackProvider === "deepseek" ? "DeepSeek" : upstream.fallbackProvider === "openrouter" ? "OpenRouter" : "Claude Max"}
                </Badge>
                <Text fz={10} c="dimmed" ff="Geist Mono, monospace">poll {status.pollAge ?? "—"}</Text>
              </Group>
              {/* Sign out */}
              <NavLink
                label={<Text fz={12} fw={500} c="red">Sign out</Text>}
                leftSection={<ThemeIcon variant="light" color="red" size="sm" radius="sm"><IconLogout size={13} /></ThemeIcon>}
                component="a" href="/admin/logout"
                style={{ borderRadius: 8 }}
              />
            </Box>
          )}
        </AppShell.Section>
      </AppShell.Navbar>

      {/* ── Main ──────────────────────────────────────────────────────── */}
      <AppShell.Main style={{ background: isDark ? "#0f1012" : "#f8f9fa" }}>
        <Box p={{ base: "sm", sm: "md", md: "xl" }} style={{ maxWidth: 1600, margin: "0 auto" }}>
          {section === "overview"   && <AdminOverview tokens={tokens} upstream={upstream} contextAlerts={status.contextAlerts} userImages={userImages} />}
          {section === "users"      && <AdminUsers tokens={tokens} />}
          {section === "logs"       && <RequestLog isAdmin={true} allowDestructive={true} />}
          {section === "stats"      && <AdminStats userImages={userImages} />}
          {section === "activity"   && <AdminUserActivity />}
          {section === "routing"    && <AdminModelRouting />}
          {section === "providers"  && <AdminProviders />}
          {section === "test"       && <AdminTest />}
          {section === "accounts"   && <AdminAccounts />}
          {section === "database"   && <AdminDatabase />}
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}
