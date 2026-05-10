import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Stack, Text, Box, Group, Badge, Paper, Accordion,
  ThemeIcon, Loader, Center, Button, ScrollArea,
  useMantineColorScheme, Tooltip,
} from "@mantine/core";
import {
  IconArrowLeft, IconUser, IconRobot, IconClock, IconMessage, IconCoins,
} from "@tabler/icons-react";

interface Exchange {
  ts:           number;
  user:         string;
  assistant:    string;
  input_tokens: number;
  output_tokens:number;
  cache_read:   number;
  total_tokens: number;
}
interface Session {
  id: string; start_ts: number; end_ts: number;
  request_count: number; total_tokens: number;
  model: string; exchanges: Exchange[];
}

const nf = new Intl.NumberFormat();

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function TokenBadge({ ex }: { ex: Exchange }) {
  const lines = [
    `${nf.format(ex.input_tokens)} in  +  ${nf.format(ex.output_tokens)} out  =  ${nf.format(ex.total_tokens)} tok`,
    ex.cache_read ? `${nf.format(ex.cache_read)} cache read (not counted in quota)` : "",
  ].filter(Boolean).join("\n");
  return (
    <Tooltip label={lines} withArrow position="top" openDelay={100} multiline>
      <Badge
        size="xs" variant="light" color="gray" leftSection={<IconCoins size={10} />}
        style={{ cursor: "default", fontVariantNumeric: "tabular-nums" }}
        ff="monospace"
      >
        {nf.format(ex.total_tokens)}
      </Badge>
    </Tooltip>
  );
}

function ExchangeBlock({ ex, dark }: { ex: Exchange; dark: boolean }) {
  const hasUser = ex.user.trim().length > 0;
  const hasAI   = ex.assistant.trim().length > 0;

  if (!hasUser && !hasAI) return null;

  return (
    <Box style={{ borderBottom: `1px solid var(--mantine-color-default-border)`, paddingBottom: 16 }}>
      {/* timestamp + tokens */}
      <Group justify="space-between" mb={8}>
        <Text size="10px" c="dimmed" ff="monospace">
          {new Date(ex.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </Text>
        <TokenBadge ex={ex} />
      </Group>

      <Stack gap={8}>
        {/* User bubble */}
        {hasUser && (
          <Box style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
            <Group gap={5} justify="flex-end">
              <Text size="10px" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".06em" }}>User</Text>
              <ThemeIcon size="xs" variant="light" color="blue" radius="xl"><IconUser size={9} /></ThemeIcon>
            </Group>
            <Box style={{
              maxWidth: "92%", padding: "8px 12px",
              borderRadius: "12px 12px 2px 12px",
              background: dark ? "#1864ab" : "#228be6",
              color: "#fff", fontSize: 13, lineHeight: 1.6,
              whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}>
              {ex.user}
            </Box>
          </Box>
        )}

        {/* AI bubble */}
        {hasAI && (
          <Box style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3 }}>
            <Group gap={5}>
              <ThemeIcon size="xs" variant="light" color="teal" radius="xl"><IconRobot size={9} /></ThemeIcon>
              <Text size="10px" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".06em" }}>Claude</Text>
            </Group>
            <Box style={{
              maxWidth: "92%", padding: "8px 12px",
              borderRadius: "12px 12px 12px 2px",
              background: dark ? "#2c2e33" : "#f1f3f5",
              color: dark ? "#c1c2c5" : "#212529",
              fontSize: 13, lineHeight: 1.6,
              whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}>
              {ex.assistant}
            </Box>
          </Box>
        )}

        {!hasUser && !hasAI && (
          <Text size="xs" c="dimmed" ta="center">No transcript captured for this request.</Text>
        )}
      </Stack>
    </Box>
  );
}

function SessionCard({ session, dark }: { session: Session; dark: boolean }) {
  const model    = session.model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
  const duration = fmtDuration(session.end_ts - session.start_ts);
  const hasData  = session.exchanges.some(e => e.user || e.assistant);

  return (
    <Accordion.Item value={session.id}>
      <Accordion.Control>
        <Group justify="space-between" wrap="wrap" gap="xs">
          <Group gap="sm">
            <ThemeIcon variant="light" color="blue" size="sm" radius="sm">
              <IconMessage size={12} />
            </ThemeIcon>
            <Box>
              <Text size="sm" fw={600}>{new Date(session.start_ts).toLocaleString()}</Text>
              <Group gap={6} mt={2}>
                <Badge size="xs" variant="light" color="gray" ff="monospace">{model}</Badge>
                <Text size="xs" c="dimmed">{session.request_count} req</Text>
                {session.end_ts > session.start_ts && (
                  <Group gap={4}>
                    <IconClock size={10} style={{ color: "var(--mantine-color-dimmed)" }} />
                    <Text size="xs" c="dimmed">{duration}</Text>
                  </Group>
                )}
              </Group>
            </Box>
          </Group>
          {/* Total tokens for session */}
          <Group gap={6}>
            <Tooltip label={`${nf.format(session.total_tokens)} total tokens in this session`} withArrow>
              <Badge size="sm" variant="light" color="violet" leftSection={<IconCoins size={11} />}
                ff="monospace" style={{ cursor: "default" }}>
                {nf.format(session.total_tokens)}
              </Badge>
            </Tooltip>
            <Badge size="sm" variant="outline" color={hasData ? "teal" : "gray"}>
              {session.exchanges.length} turns
            </Badge>
          </Group>
        </Group>
      </Accordion.Control>
      <Accordion.Panel>
        {!hasData ? (
          <Text size="sm" c="dimmed" ta="center" py="md">
            No conversation captured — request predates session history feature.
          </Text>
        ) : (
          <ScrollArea.Autosize mah={{ base: 380, sm: 520, md: 640 }} offsetScrollbars>
            <Stack gap={16} p="xs">
              {session.exchanges.map((ex, i) => (
                <ExchangeBlock key={i} ex={ex} dark={dark} />
              ))}
            </Stack>
          </ScrollArea.Autosize>
        )}
      </Accordion.Panel>
    </Accordion.Item>
  );
}

export function SessionHistory() {
  const { user } = useParams<{ user: string }>();
  const { colorScheme } = useMantineColorScheme();
  const dark = colorScheme === "dark";
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    fetch(`/api/sessions/${encodeURIComponent(user)}`)
      .then(r => r.json())
      .then((d: { sessions: Session[] }) => setSessions(d.sessions || []))
      .finally(() => setLoading(false));
  }, [user]);

  const displayUser = user ?? "";
  const grandTotal    = sessions.reduce((s, se) => s + se.total_tokens, 0);

  return (
    <Stack gap="xl" p={{ base: "xs", sm: "md" }} maw={860} mx="auto">
      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" wrap="wrap">
          <Box>
            <Group gap="xs" mb={4}>
              <Button component={Link} to="/" variant="subtle" size="xs"
                leftSection={<IconArrowLeft size={13} />} px={6}>
                Home
              </Button>
              <Text size="xs" c="dimmed">/</Text>
              <Text size="xs" c="dimmed" ff="monospace">{displayUser}</Text>
            </Group>
            <Text size="xl" fw={800} ff="monospace">{displayUser}</Text>
            <Group gap="md" mt={4}>
              <Text size="sm" c="dimmed">
                {loading ? "Loading…" : `${sessions.length} session${sessions.length !== 1 ? "s" : ""}`}
              </Text>
              {!loading && grandTotal > 0 && (
                <Badge variant="light" color="violet" leftSection={<IconCoins size={12} />}
                  ff="monospace" size="sm">
                  {nf.format(grandTotal)} total tokens
                </Badge>
              )}
            </Group>
          </Box>
          <ThemeIcon variant="light" color="blue" size="xl" radius="md">
            <IconUser size={20} />
          </ThemeIcon>
        </Group>
      </Paper>

      {loading ? (
        <Center py="xl"><Loader size="sm" /></Center>
      ) : sessions.length === 0 ? (
        <Paper withBorder p="xl" radius="md">
          <Text ta="center" c="dimmed">No sessions found for this user.</Text>
        </Paper>
      ) : (
        <Accordion variant="separated" radius="md">
          {sessions.map(s => (
            <SessionCard key={s.id} session={s} dark={dark} />
          ))}
        </Accordion>
      )}
    </Stack>
  );
}
