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
  IconPlugConnected, IconKey, IconDatabase, IconLogout,
  IconRoute, IconCloud,
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
import { AdminDb } from "./Db";
import { AdminModelRouting } from "./ModelRouting";
import { AdminProviders } from "./Providers";
type AdminSection = "overview" | "users" | "logs" | "stats" | "routing" | "providers" | "test" | "accounts" | "database";

function AdminStats() {
  return (
    <Stack gap="xl">
      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" wrap="wrap">
          <div>
            <Text size="sm" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }} mb={4}>Stats</Text>
            <Text size="xl" fw={800} ff="monospace">Daily Usage History</Text>
            <Text size="sm" c="dimmed" mt={2}>Per-user token usage breakdown · last 30 days</Text>
          </div>
        </Group>
      </Paper>

      <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
        <DailyHistory isAdmin={true} />
      </Paper>
    </Stack>
  );
}

export function AdminDashboard() {
  const status = useStatus()!;
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const [section, setSection] = useState<AdminSection>(() => {
    try { return (localStorage.getItem("admin-section") as AdminSection) || "overview"; }
    catch { return "overview"; }
  });
  const [mobileOpen, { toggle: toggleMobile, close }] = useDisclosure(false);
  const [collapsed,  { toggle: toggleCollapse }]      = useDisclosure(false);

  const { tokens, upstream } = status;
  const nav = (s: AdminSection) => {
    setSection(s);
    try { localStorage.setItem("admin-section", s); } catch {}
    close();
  };

  const SZ = 17;
  const navItems: { id: AdminSection; label: string; icon: React.ReactNode; desc: string }[] = [
    { id: "overview", label: "Overview",       icon: <IconLayoutDashboard size={SZ} />, desc: "Upstream & quick stats" },
    { id: "users",    label: "Users",          icon: <IconUsers           size={SZ} />, desc: "Token management"       },
    { id: "logs",     label: "Request Logs",   icon: <IconList            size={SZ} />, desc: "Activity & history"     },
    { id: "stats",    label: "Stats",          icon: <IconChartBar        size={SZ} />, desc: "Daily usage history"    },
    { id: "routing",   label: "Routing",        icon: <IconRoute           size={SZ} />, desc: "Model fallback rules"      },
    { id: "providers", label: "Providers",      icon: <IconCloud           size={SZ} />, desc: "Claude Max & DeepSeek config" },
    { id: "test",      label: "Test Connection",icon: <IconPlugConnected   size={SZ} />, desc: "Verify API connectivity"     },
    { id: "accounts", label: "Accounts",       icon: <IconKey             size={SZ} />, desc: "OAuth Claude accounts"   },
    { id: "database", label: "Database",       icon: <IconDatabase        size={SZ} />, desc: "Backup & restore DB"     },
  ];
  const footerItems: { icon: React.ReactNode; label: string; href: string; target?: string }[] = [
    { icon: <IconSitemap      size={SZ} />, label: "Mind Map",    href: "/mind", target: "_blank" },
    { icon: <IconExternalLink size={SZ} />, label: "Public View", href: "/",     target: undefined },
  ];

  const utilPct = upstream.fiveHour?.utilization ?? null;
  const sectionTitles: Record<AdminSection, string> = {
    overview: "Overview", users: "Users", logs: "Request Logs", stats: "Stats", routing: "Routing", providers: "Providers", test: "Test Connection", accounts: "Accounts", database: "Database",
  };
  const statusColor = upstream.ok ? "teal" : "red";
  const SIDEBAR_W   = collapsed ? 56 : 220;

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: SIDEBAR_W, breakpoint: "sm", collapsed: { mobile: !mobileOpen } }}
      padding={0}
      transitionDuration={200}
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Burger opened={mobileOpen} onClick={toggleMobile} hiddenFrom="sm" size="sm" />
            <Tooltip label={collapsed ? "Expand sidebar" : "Collapse sidebar"} position="bottom" withArrow openDelay={400}>
              <ActionIcon variant="subtle" size="sm" onClick={toggleCollapse} visibleFrom="sm">
                {collapsed ? <IconChevronsRight size={16} /> : <IconChevronsLeft size={16} />}
              </ActionIcon>
            </Tooltip>
            <Group gap={8} visibleFrom="sm">
              <Box style={{ width: 28, height: 28, background: "#228be6", borderRadius: 7,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Text span fz={10} fw={700} c="white" ff="monospace">CP</Text>
              </Box>
              <Text fw={800} ff="monospace" size="sm" style={{ letterSpacing: ".06em" }}>
                claude-proxy
              </Text>
              <Badge variant="light" color="blue" size="xs" tt="uppercase">admin</Badge>
            </Group>
            <Text fw={800} ff="monospace" size="sm" hiddenFrom="sm">
              claude-proxy
            </Text>
          </Group>
          <Group gap="sm">
            {utilPct !== null && (
              <Badge color={pctColor(utilPct)} variant="dot" size="sm">
                {utilPct.toFixed(0)}% upstream
              </Badge>
            )}
            <Text size="xs" fw={500} c="dimmed" visibleFrom="xs">{sectionTitles[section]}</Text>
            <Tooltip label="Toggle theme" position="bottom" withArrow openDelay={400}>
              <ActionIcon variant="default" size="md" radius="md" onClick={() => toggleColorScheme()}>
                {colorScheme === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar style={{ overflow: "hidden", transition: "width 200ms ease" }}>
        <AppShell.Section grow component={ScrollArea} p="xs" pt="md">
          {!collapsed && (
            <Box px="xs" mb="xs">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700} style={{ letterSpacing: ".1em" }}>Navigation</Text>
            </Box>
          )}
          <Stack gap={2} align={collapsed ? "center" : "stretch"}>
            {navItems.map(item => collapsed ? (
              <Tooltip key={item.id} label={item.label} position="right" withArrow openDelay={100}>
                <ActionIcon
                  size={40}
                  variant={section === item.id ? "filled" : "subtle"}
                  color={section === item.id ? "blue" : "gray"}
                  onClick={() => nav(item.id)}
                  style={{ borderRadius: 8 }}
                >
                  <Text size="md" style={{ lineHeight: 1 }}>{item.icon}</Text>
                </ActionIcon>
              </Tooltip>
            ) : (
              <NavLink
                key={item.id}
                active={section === item.id}
                label={item.label}
                description={item.desc}
                leftSection={item.icon}
                onClick={() => nav(item.id)}
                style={{ borderRadius: 6 }}
              />
            ))}
          </Stack>
        </AppShell.Section>

        <AppShell.Section p="xs" pb="md">
          <Divider mb="xs" />
          <Stack gap={2} align={collapsed ? "center" : "stretch"}>
            {footerItems.map(fi => collapsed ? (
              <Tooltip key={fi.label} label={fi.label} position="right" withArrow openDelay={100}>
                <ActionIcon
                  size={40}
                  variant="subtle"
                  color="gray"
                  component="a"
                  href={fi.href}
                  target={fi.target}
                  style={{ borderRadius: 8 }}
                >
                  <Text size="md" style={{ lineHeight: 1 }}>{fi.icon}</Text>
                </ActionIcon>
              </Tooltip>
            ) : (
              <NavLink
                key={fi.label}
                label={fi.label}
                description={fi.label === "Mind Map" ? "Request graph visualization" : "Public status dashboard"}
                leftSection={fi.icon}
                component="a"
                href={fi.href}
                target={fi.target}
                style={{ borderRadius: 6 }}
              />
            ))}
          </Stack>
          <Divider my="xs" />
          {collapsed ? (
            <Stack gap={6} align="center" py={4}>
              <Tooltip label={`${upstream.email ?? "no credential"} · poll ${status.pollAge}`} position="right" withArrow multiline w={200}>
                <Box w={10} h={10} style={{ borderRadius: "50%", cursor: "default", background: `var(--mantine-color-${statusColor}-5)` }} />
              </Tooltip>
              <ActionIcon variant="subtle" color="red" size="sm" component="a" href="/admin/logout">
                <IconLogout size={14} />
              </ActionIcon>
            </Stack>
          ) : (
            <Box px="xs" py={4}>
              <Group gap="xs" mb={4} align="center">
                <Box w={8} h={8} style={{ borderRadius: "50%", flexShrink: 0, background: `var(--mantine-color-${statusColor}-5)` }} />
                <Text size="xs" c="dimmed" ff="monospace" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                  {upstream.email ?? "no credential"}
                </Text>
              </Group>
              <Group gap="xs" mb={6} align="center" wrap="nowrap">
                <ThemeIcon variant="light" color={upstream.fallbackProvider === "deepseek" ? "violet" : "blue"} size="xs" radius="sm">
                  <IconCloud size={10} />
                </ThemeIcon>
                <Text size="10px" c="dimmed" ff="monospace">
                  {upstream.fallbackProvider === "deepseek" ? "DeepSeek" : "Claude Max"}
                </Text>
              </Group>
              <Group gap="xs" justify="space-between" align="center">
                <Text size="10px" c="dimmed" ff="monospace">poll {status.pollAge}</Text>
                <ActionIcon variant="subtle" color="red" size="xs" component="a" href="/admin/logout">
                  <IconLogout size={13} />
                </ActionIcon>
              </Group>
            </Box>
          )}
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        <Box p="lg">
          {section === "overview"  && <AdminOverview tokens={tokens} upstream={upstream} />}
          {section === "users"     && <AdminUsers tokens={tokens} />}
          {section === "logs"      && <RequestLog isAdmin={true} />}
          {section === "stats"     && <AdminStats />}
          {section === "routing"    && <AdminModelRouting />}
          {section === "providers" && <AdminProviders />}
          {section === "test"      && <AdminTest />}
          {section === "accounts"  && <AdminAccounts />}
          {section === "database"  && <AdminDb />}
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}
