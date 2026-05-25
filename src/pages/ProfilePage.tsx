import { useState, useEffect } from "react";
import { useMantineColorScheme } from "@mantine/core";
import {
  Box, Container, Stack, Group, Text, Paper, SimpleGrid, Badge,
  ThemeIcon, Button, Tooltip, ActionIcon, Progress, Anchor, Loader,
} from "@mantine/core";
import { IconSun, IconMoon, IconLogout, IconLogin, IconKey, IconUsers } from "@tabler/icons-react";
import type { ProfileResponse } from "../contexts";
import { resolveProvider, shortenModel, type ProviderInfo } from "../providerDisplay";
import { signInWithGoogle, maskToken } from "../utils";
import { UserAvatar } from "../components/UserAvatar";
import { CopyButton } from "../components/CopyButton";
import { LoadingScreen } from "../components/shared";

const nf = new Intl.NumberFormat();

export function ProfilePage() {
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const isDark   = colorScheme === "dark";
  const baseUrl  = window.location.origin;

  useEffect(() => {
    fetch("/api/profile", { credentials: "include" })
      .then(r => r.json())
      .then(d => { setProfile(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const customProviders: ProviderInfo[] = (profile?.custom_providers ?? [])
    .map(p => ({ id: p.id, name: p.name, color: p.color || "gray" }));

  if (loading) return (
    <Box style={{ minHeight: "100vh", background: isDark ? "#0f1012" : "#f0f2f5" }}>
      <Container size="sm" py={{ base: "md", sm: "xl" }} px={{ base: "sm", sm: "md" }}>
        <Group justify="center" py="xl"><Loader size="md" /></Group>
      </Container>
    </Box>
  );

  if (!profile?.authenticated) return (
    <Box style={{ minHeight: "100vh", background: isDark ? "#0f1012" : "#f0f2f5" }}>
      <Container size="sm" py={{ base: "md", sm: "xl" }} px={{ base: "sm", sm: "md" }}>
        <Paper withBorder p="lg" radius="md" ta="center">
          <Stack gap="md" align="center">
            <ThemeIcon variant="light" color="gray" size="xl" radius="xl"><IconKey size={22} /></ThemeIcon>
            <Text size="lg" fw={700}>Not signed in</Text>
            <Button onClick={() => signInWithGoogle()} color="blue" size="sm" radius="md" leftSection={<IconLogin size={16} />}>
              Sign in with Google
            </Button>
            <Anchor href="/" size="xs" c="dimmed">← Dashboard</Anchor>
          </Stack>
        </Paper>
      </Container>
    </Box>
  );

  const tkEntries     = Object.entries(profile.tokens ?? {});
  const totalToday    = tkEntries.reduce((s, [, t]) => s + (t.today   ?? 0), 0);
  const totalAlltime  = tkEntries.reduce((s, [, t]) => s + (t.alltime ?? 0), 0);
  const roleColor     = profile.role === "SUPER_ADMIN" ? "red" : profile.role === "ADMIN" ? "orange" : "blue";
  const roleLabel     = profile.role === "SUPER_ADMIN" ? "Super Admin" : profile.role === "ADMIN" ? "Admin" : "User";
  const codeBg        = isDark ? "#1a1b1e" : "#f1f3f5";
  const codeFg        = isDark ? "#c9cace" : "#2c2e33";

  return (
    <Box style={{ minHeight: "100vh", background: isDark ? "#0f1012" : "#f0f2f5" }}>
      <Container size="sm" py={{ base: "md", sm: "xl" }} px={{ base: "sm", sm: "md" }}>
        <Stack gap="lg">

          <Paper withBorder p="lg" radius="md">
            <Group justify="space-between" wrap="wrap" gap="sm">
              <Group gap="md">
                <UserAvatar name={profile.name || profile.email || "?"} imageUrl={profile.image} size={46} />
                <div>
                  <Group gap={6} align="center">
                    <Text size="md" fw={700}>{profile.name}</Text>
                    <Badge size="xs" color={roleColor} variant="light" radius="sm">{roleLabel}</Badge>
                  </Group>
                  <Text size="xs" c="dimmed">{profile.email}</Text>
                </div>
              </Group>
              <Group gap="xs">
                <ActionIcon variant="default" size="lg" radius="md" onClick={() => toggleColorScheme()}>
                  {colorScheme === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
                </ActionIcon>
                <Button component="a" href="/" variant="default" size="xs" radius="md">Dashboard</Button>
                <Button component="a" href="/auth/logout" variant="subtle" color="red" size="xs" radius="md" leftSection={<IconLogout size={13} />}>Sign out</Button>
              </Group>
            </Group>
          </Paper>

          <SimpleGrid cols={3} spacing="sm">
            {[
              { label: "API Keys", value: tkEntries.length },
              { label: "Today",    value: nf.format(totalToday) },
              { label: "All-Time", value: nf.format(totalAlltime) },
            ].map(s => (
              <Paper key={s.label} withBorder p="md" radius="md">
                <Text size="xs" c="dimmed" tt="uppercase" fw={700} style={{ letterSpacing: ".06em" }}>{s.label}</Text>
                <Text size="xl" fw={700} ff="monospace" mt={2}>{s.value}</Text>
              </Paper>
            ))}
          </SimpleGrid>

          {tkEntries.length === 0 ? (
            <Paper withBorder p="xl" radius="md" ta="center">
              <Text size="sm" c="dimmed">No API key assigned yet. Please contact the admin.</Text>
            </Paper>
          ) : (
            <Stack gap="sm">
              <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>API Keys</Text>
              {tkEntries.map(([key, tk]) => {
                const pct   = tk.limit == null ? 0 : Math.min(100, tk.pct);
                const color = tk.paused ? "gray" : pct >= 95 ? "red" : pct >= 75 ? "orange" : pct >= 50 ? "yellow" : "teal";
                const literalInfo   = resolveProvider(tk.provider || "inherit", customProviders);
                const effectiveInfo = resolveProvider(tk.effective_provider || "anthropic", customProviders);
                const showInfo = tk.provider === "inherit" ? effectiveInfo : literalInfo;
                const pn = showInfo.name;
                const pc = showInfo.color;
                const showEffectiveTooltip = tk.provider === "inherit" && tk.effective_provider !== "anthropic";
                return (
                  <Paper key={key} withBorder p="md" radius="md"
                    style={{ borderColor: tk.paused ? "var(--mantine-color-orange-4)" : undefined, opacity: tk.paused ? 0.85 : 1 }}>
                    <Stack gap="sm">
                      {tk.paused && (
                        <Group gap="xs" p="xs" style={{ background: isDark ? "rgba(255,140,0,.08)" : "rgba(255,140,0,.06)", borderRadius: 6 }}>
                          <Text size="xs" c="orange" fw={600}>Pending activation — contact the admin to enable this key.</Text>
                        </Group>
                      )}
                      {(tk.label || tk.description) && (
                        <div>
                          {tk.label && <Text size="sm" fw={700} ff="monospace" style={{ letterSpacing: "-0.01em" }}>{tk.label}</Text>}
                          {tk.description && <Text size="xs" c="dimmed" mt={2}>{tk.description}</Text>}
                        </div>
                      )}
                      <Group justify="space-between" wrap="nowrap" gap="sm">
                        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                          <ThemeIcon variant="light" color={tk.paused ? "orange" : "blue"} size="sm" radius="sm">
                            <IconKey size={12} />
                          </ThemeIcon>
                          <Text size="xs" ff="monospace" c="dimmed">
                            {key.slice(0, 6)}{"•".repeat(20)}{key.slice(-4)}
                          </Text>
                        </Group>
                        <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
                          <CopyButton value={key} />
                          <Tooltip withArrow label={tk.provider === "inherit"
                            ? `Provider: Auto (routes to ${effectiveInfo.name})`
                            : `Provider: ${pn} (explicitly assigned)`}>
                            <Badge size="xs" color={pc} variant={showEffectiveTooltip ? "outline" : "light"}>
                              {tk.provider === "inherit" ? `Auto → ${effectiveInfo.name}` : pn}
                            </Badge>
                          </Tooltip>
                          {tk.pinned_model && (
                            <Tooltip withArrow label={`Pinned model: ${tk.pinned_model}`}>
                              <Badge size="xs" color={pc} variant="outline">{shortenModel(tk.pinned_model, 16)}</Badge>
                            </Tooltip>
                          )}
                          <Badge size="xs" color={tk.paused ? "orange" : "teal"} variant="light">
                            {tk.paused ? "Inactive" : "Active"}
                          </Badge>
                        </Group>
                      </Group>
                      {!tk.paused && (
                        <div>
                          <Group justify="space-between" mb={4}>
                            <Text size="xs" c="dimmed">Quota this window</Text>
                            <Text size="xs" ff="monospace">
                              {nf.format(tk.used)} / {tk.limit == null ? "∞" : nf.format(tk.limit)} tokens
                              {tk.limit != null && <> · <Text span c={color}>{pct}%</Text></>}
                            </Text>
                          </Group>
                          <Progress value={pct} color={color} size="sm" radius="xl" />
                        </div>
                      )}
                      <Group gap="xl">
                        <div>
                          <Text size="xs" c="dimmed">Today</Text>
                          <Text size="xs" ff="monospace" fw={600}>{nf.format(tk.today)} tokens</Text>
                        </div>
                        <div>
                          <Text size="xs" c="dimmed">All-time</Text>
                          <Text size="xs" ff="monospace" fw={600}>{nf.format(tk.alltime)} tokens</Text>
                        </div>
                      </Group>
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>
          )}

          {tkEntries.length > 0 && (() => {
            const firstKey = tkEntries[0]![0];
            const envExample    = `export ANTHROPIC_API_KEY="${firstKey}"\nexport ANTHROPIC_BASE_URL="${baseUrl}"`;
            const configExample = `claude config set apiKey "${firstKey}"\nclaude config set baseUrl "${baseUrl}"`;
            const border = `1px solid var(--mantine-color-default-border)`;
            return (
              <Stack gap="sm">
                <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Claude Code — Setup</Text>
                <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
                  <Stack gap={0}>
                    <Box px="md" py="sm" style={{ borderBottom: border }}>
                      <Group justify="space-between" mb={6}>
                        <div>
                          <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: ".06em" }}>Option 1 — Environment variables</Text>
                          <Text size="xs" c="dimmed" mt={2}>Add to your <Text span ff="monospace">.bashrc</Text> / <Text span ff="monospace">.zshrc</Text></Text>
                        </div>
                        <CopyButton value={envExample} />
                      </Group>
                      <Box style={{ background: codeBg, borderRadius: 6, padding: "10px 12px" }}>
                        <Text size="xs" ff="monospace" style={{ color: codeFg, whiteSpace: "pre" }}>{envExample}</Text>
                      </Box>
                    </Box>
                    <Box px="md" py="sm">
                      <Group justify="space-between" mb={6}>
                        <div>
                          <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: ".06em" }}>Option 2 — Claude Code config</Text>
                          <Text size="xs" c="dimmed" mt={2}>Run once in your terminal</Text>
                        </div>
                        <CopyButton value={configExample} />
                      </Group>
                      <Box style={{ background: codeBg, borderRadius: 6, padding: "10px 12px" }}>
                        <Text size="xs" ff="monospace" style={{ color: codeFg, whiteSpace: "pre" }}>{configExample}</Text>
                      </Box>
                    </Box>
                  </Stack>
                </Paper>
                <Text size="xs" c="dimmed">After setup, run <Text span ff="monospace">claude</Text> as usual — requests will be routed through this proxy.</Text>
              </Stack>
            );
          })()}

        </Stack>
      </Container>
    </Box>
  );
}
