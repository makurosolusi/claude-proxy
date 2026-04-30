import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Routes, Route } from "react-router-dom";
import {
  Container, Group, Stack, Title, Text, Box, Button, Paper,
  ActionIcon, Tooltip, TextInput, useMantineColorScheme,
  SimpleGrid, Progress, ThemeIcon, Divider,
} from "@mantine/core";
import {
  IconSun, IconMoon, IconLogout, IconLogin,
  IconRefresh, IconPlayerPause, IconPencil, IconPlus,
  IconServer, IconUsers, IconActivity,
} from "@tabler/icons-react";
import { StatusCtx, ChatCtx } from "./contexts";
import type { StatusResponse, ChatMsg } from "./contexts";
import { pctColor, adminPost } from "./utils";
import { useStatus } from "./contexts";
import { LoadingScreen, NotFoundPage, RequireAdmin, UpstreamSection } from "./components/shared";
import { DailyHistory } from "./components/tables/DailyHistory";
import { RequestLog } from "./components/tables/RequestLog";
import { AdminDashboard } from "./components/admin/Dashboard";
import { MindPage } from "./components/MindPage";
import { FloatingChat } from "./components/FloatingChat";

function AddTokenInline() {
  const [k, setK] = useState(""); const [l, setL] = useState("40000");
  return (
    <Stack gap="xs" mb="xl">
      <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Add Token</Text>
      <Paper withBorder p="md">
        <Group align="flex-end" gap="sm">
          <TextInput label="Token Key" placeholder="sk-user-name" size="xs" w={220} value={k} onChange={e => setK(e.currentTarget.value)} />
          <TextInput label="Limit" size="xs" w={120} value={l} onChange={e => setL(e.currentTarget.value)} />
          <Button color="teal" size="xs" leftSection={<IconPlus size={13} />}
            onClick={() => { if (k.trim()) { adminPost("/admin/token/add", { token: k.trim(), limit: l }); setK(""); setL("40000"); } }}>
            Add Token
          </Button>
        </Group>
      </Paper>
    </Stack>
  );
}

function Dashboard({ isAdmin }: { isAdmin: boolean }) {
  const status = useStatus()!;
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const { tokens, upstream } = status;

  // Dynamic background: radial gradient from bottom grows more intense as
  // upstream 5h utilization rises. Starts at 20%, full intensity at 90%.
  const utilPct = upstream?.fiveHour?.utilization ?? 0;
  const t       = Math.max(0, Math.min(1, (utilPct - 20) / 70));
  const isDark  = colorScheme === "dark" ||
    (colorScheme === "auto" && typeof window !== "undefined" &&
     window.matchMedia("(prefers-color-scheme: dark)").matches);
  const pageBg  = useMemo(() => {
    if (t <= 0) return undefined;
    if (isDark) {
      const a1 = (t * 0.95).toFixed(3);
      const a2 = (t * 0.75).toFixed(3);
      const a3 = (t * 0.30).toFixed(3);
      return [
        `radial-gradient(ellipse 150% 90% at 50% 100%,`,
        ` rgba(100,6,6,${a1}) 0%,`,
        ` rgba(70,5,5,${a2}) 45%,`,
        ` rgba(40,4,4,${a3}) 70%,`,
        ` transparent 90%)`,
      ].join("");
    } else {
      const a1 = (t * 0.30).toFixed(3);
      const a2 = (t * 0.18).toFixed(3);
      const a3 = (t * 0.07).toFixed(3);
      return [
        `radial-gradient(ellipse 150% 90% at 50% 100%,`,
        ` rgba(220,40,40,${a1}) 0%,`,
        ` rgba(200,30,30,${a2}) 45%,`,
        ` rgba(180,20,20,${a3}) 70%,`,
        ` transparent 90%)`,
      ].join("");
    }
  }, [t, isDark]);

  const todayTotal = Object.values(tokens).reduce((sum, tk: any) => sum + (tk.today || 0), 0);
  const activeTokens = Object.values(tokens).filter(tk => tk.used > 0).length;
  const totalTokens = Object.keys(tokens).length;
  const nf = new Intl.NumberFormat();
  const upstreamOk = upstream?.ok;
  const systemStatus = upstreamOk === undefined ? "connecting" : upstreamOk ? "operational" : "degraded";
  const statusColor = systemStatus === "operational" ? "teal" : systemStatus === "degraded" ? "orange" : "gray";
  const upstreamDot = systemStatus === "operational" ? "teal.5" : systemStatus === "degraded" ? "orange.5" : "gray.5";

  return (
    <Box style={{ minHeight: "100vh", background: pageBg, backgroundAttachment: "fixed", transition: "background 3s ease" }}>
    <Container size="md" py="xl">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <Paper withBorder p="lg" radius="lg" mb="lg"
        style={{ borderColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)" }}>
        <Group justify="space-between" wrap="wrap">
          <Group gap="md">
            <Box style={{ width: 48, height: 48, background: "#228be6", borderRadius: 12,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Text span fz={16} fw={800} c="white" ff="monospace">CP</Text>
            </Box>
            <div>
              <Title order={3} ff="monospace" lh={1.2}>claude-proxy</Title>
              <Text size="sm" c="dimmed" mt={2}>
                Claude Max proxy · multi-user API key with quota management
              </Text>
            </div>
          </Group>
          <Group gap="xs">
            <Tooltip label="Toggle theme" position="bottom" withArrow openDelay={400}>
              <ActionIcon variant="default" size="lg" radius="md" onClick={() => toggleColorScheme()}>
                {colorScheme === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
              </ActionIcon>
            </Tooltip>
            {isAdmin
              ? <Button component="a" href="/admin/logout" variant="default" size="xs" radius="md" leftSection={<IconLogout size={13} />}>Sign out</Button>
              : status.isAdmin
              ? <Button component="a" href="/admin" variant="light" size="xs" radius="md" leftSection={<IconLogin size={13} />}>Admin</Button>
              : <Button component="a" href="/admin/login" variant="light" size="xs" radius="md" leftSection={<IconLogin size={13} />}>Sign in</Button>
            }
          </Group>
        </Group>
      </Paper>

      {/* ── Quick Stats ──────────────────────────────────────── */}
      <SimpleGrid cols={{ base: 1, xs: 3 }} mb="lg">
        <Paper withBorder p="md" radius="md">
          <Group gap="sm" mb={6}>
            <ThemeIcon variant="light" color="blue" size="md" radius="md">
              <IconActivity size={16} />
            </ThemeIcon>
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Today</Text>
          </Group>
          <Text fz={24} fw={700} ff="monospace">{nf.format(todayTotal)}</Text>
          <Text size="xs" c="dimmed" mt={2}>tokens used across all users</Text>
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Group gap="sm" mb={6}>
            <ThemeIcon variant="light" color="teal" size="md" radius="md">
              <IconUsers size={16} />
            </ThemeIcon>
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Active</Text>
          </Group>
          <Text fz={24} fw={700} ff="monospace">{activeTokens}<Text span fz="md" fw={400} c="dimmed"> / {totalTokens}</Text></Text>
          <Text size="xs" c="dimmed" mt={2}>tokens with usage this window</Text>
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Group gap="sm" mb={6}>
            <ThemeIcon variant="light" color={statusColor} size="md" radius="md">
              <IconServer size={16} />
            </ThemeIcon>
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>System</Text>
          </Group>
          <Group gap="xs">
            <Box w={8} h={8} style={{ borderRadius: "50%", background: `var(--mantine-color-${upstreamDot})`, flexShrink: 0 }} />
            <Text fz={16} fw={600} ff="monospace" tt="capitalize">{systemStatus}</Text>
          </Group>
          <Text size="xs" c="dimmed" mt={2}>
            {systemStatus === "operational" ? "All systems normal" : systemStatus === "degraded" ? "Upstream issues detected" : "Waiting for poll…"}
          </Text>
        </Paper>
      </SimpleGrid>

      {/* ── Upstream Health ──────────────────────────────────── */}
      <Stack gap="xs" mb="lg">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Upstream Health</Text>
        <Paper withBorder p="md" radius="md">
          <UpstreamSection upstream={upstream} isAdmin={isAdmin} />
        </Paper>
      </Stack>

      {/* ── Token Usage Overview ─────────────────────────────── */}
      <Stack gap="xs" mb="lg">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>
          Token Usage
        </Text>
        <Paper withBorder p="md" radius="md" style={{ overflow: "hidden" }}>
          {totalTokens === 0 ? (
            <Text size="sm" c="dimmed" ta="center" py="md">No tokens configured</Text>
          ) : (
            <Stack gap="sm">
              {Object.entries(tokens).slice(0, isAdmin ? 20 : 6).map(([key, tk]) => {
                const pct = tk.limit == null ? 0 : Math.min(100, Math.round((tk.used / tk.limit) * 100));
                const color = tk.paused ? "gray" : pct >= 95 ? "red" : pct >= 75 ? "orange" : pct >= 50 ? "yellow" : "teal";
                return (
                  <Group key={key} gap="sm" wrap="nowrap">
                    <Text size="xs" ff="monospace" style={{ minWidth: isAdmin ? 140 : 90, maxWidth: isAdmin ? 180 : 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {isAdmin ? key : key.slice(0, 12) + "…"}
                    </Text>
                    <Progress value={pct} color={color} size="md" radius="sm" style={{ flex: 1 }} />
                    <Text size="xs" ff="monospace" c="dimmed" style={{ minWidth: 70, textAlign: "right" }}>
                      {nf.format(tk.used)}{tk.limit != null && ` / ${nf.format(tk.limit)}`}
                    </Text>
                  </Group>
                );
              })}
            </Stack>
          )}
        </Paper>
      </Stack>

      {/* ── Request Log (public shows compact preview) ───────── */}
      <RequestLog isAdmin={isAdmin} />

      {/* ── Admin-only sections ──────────────────────────────── */}
      {isAdmin && (
        <>
          <Divider my="lg" />

          <Group gap="xs" mb="lg">
            <Button variant="light" color="gray" size="xs" leftSection={<IconRefresh size={13} />}
              onClick={() => { if (confirm("Reset all?")) adminPost("/admin/reset", { all: "true" }); }}>Reset All</Button>
            <Button variant="light" color="orange" size="xs" leftSection={<IconPlayerPause size={13} />}
              onClick={() => adminPost("/admin/token/pause", { all: "true" })}>Pause All</Button>
            <Button variant="light" color="blue" size="xs" leftSection={<IconPencil size={13} />}
              onClick={() => { const v = prompt("New limit for all:"); if (v) adminPost("/admin/token/edit-all", { limit: v }); }}>Edit All Limits</Button>
          </Group>

          <AddTokenInline />

          <Stack gap="xs" mb="xl">
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Daily History</Text>
            <Paper withBorder style={{ overflow: "hidden" }}>
              <DailyHistory isAdmin={isAdmin} />
            </Paper>
          </Stack>
        </>
      )}
    </Container>
    <FloatingChat />
    </Box>
  );
}

export function App() {
  const [status, setStatus]     = useState<StatusResponse | null>(null);
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const sendChat = useCallback((nick: string, text: string) => {
    wsRef.current?.send(JSON.stringify({ type: "chat", nick, text }));
  }, []);

  useEffect(() => {
    let ws: WebSocket, dead = false;
    function connect() {
      if (dead) return;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${location.host}/ws`);
      wsRef.current = ws;
      ws.onmessage = e => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === "chat_history")  { setChatMsgs(data.messages); return; }
          if (data.type === "chat_message")  { setChatMsgs(prev => [...prev.slice(-99), data.message]); return; }
          if (data.type === "chat_clear")    { setChatMsgs([]); return; }
          setStatus(data);
        } catch {}
      };
      ws.onclose = () => { if (!dead) setTimeout(connect, 3000); };
    }
    connect();
    return () => { dead = true; ws?.close(); };
  }, []);

  return (
    <ChatCtx.Provider value={{ messages: chatMsgs, send: sendChat }}>
      <StatusCtx.Provider value={status}>
        <Routes>
          <Route path="/" element={
            status ? <Dashboard isAdmin={false} /> : <LoadingScreen />
          } />
          <Route path="/admin" element={
            <RequireAdmin>
              <AdminDashboard />
            </RequireAdmin>
          } />
          <Route path="/mind" element={<MindPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </StatusCtx.Provider>
    </ChatCtx.Provider>
  );
}
