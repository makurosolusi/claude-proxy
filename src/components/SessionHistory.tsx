import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Stack, Text, Box, Group, Badge, Paper, Accordion,
  ThemeIcon, Loader, Center, Button, Divider, ScrollArea,
  useMantineColorScheme,
} from "@mantine/core";
import { IconArrowLeft, IconUser, IconRobot, IconClock, IconMessage } from "@tabler/icons-react";
import { fmtRel } from "../utils";

interface ConvTurn { role: "user" | "assistant"; text: string; }
interface Session {
  id: string; start_ts: number; end_ts: number;
  request_count: number; total_tokens: number;
  model: string; turns: ConvTurn[];
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function TurnBubble({ turn, dark }: { turn: ConvTurn; dark: boolean }) {
  const isUser = turn.role === "user";
  return (
    <Box
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        gap: 4,
      }}
    >
      <Group gap={6} justify={isUser ? "flex-end" : "flex-start"}>
        <ThemeIcon
          size="xs" variant="light"
          color={isUser ? "blue" : "teal"}
          radius="xl"
        >
          {isUser ? <IconUser size={10} /> : <IconRobot size={10} />}
        </ThemeIcon>
        <Text size="10px" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".06em" }}>
          {isUser ? "User" : "Claude"}
        </Text>
      </Group>
      <Box
        style={{
          maxWidth: "88%",
          padding: "8px 12px",
          borderRadius: isUser ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
          background: isUser
            ? (dark ? "#1864ab" : "#228be6")
            : (dark ? "#2c2e33" : "#f1f3f5"),
          color: isUser ? "#fff" : (dark ? "#c1c2c5" : "#212529"),
          fontSize: 13,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {turn.text}
      </Box>
    </Box>
  );
}

function SessionCard({ session, dark }: { session: Session; dark: boolean }) {
  const model = session.model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
  const duration = fmtDuration(session.end_ts - session.start_ts);
  const hasTurns = session.turns.length > 0;

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
                <Text size="xs" c="dimmed">{session.request_count} req · {session.total_tokens.toLocaleString()} tok</Text>
                {session.end_ts > session.start_ts && (
                  <Group gap={4}>
                    <IconClock size={10} style={{ color: "var(--mantine-color-dimmed)" }} />
                    <Text size="xs" c="dimmed">{duration}</Text>
                  </Group>
                )}
              </Group>
            </Box>
          </Group>
          <Badge size="sm" variant="outline" color={hasTurns ? "teal" : "gray"}>
            {session.turns.length} turns
          </Badge>
        </Group>
      </Accordion.Control>
      <Accordion.Panel>
        {!hasTurns ? (
          <Text size="sm" c="dimmed" ta="center" py="md">
            No conversation captured — older requests don't have transcript data.
          </Text>
        ) : (
          <ScrollArea.Autosize mah={600} offsetScrollbars>
            <Stack gap="md" p="xs">
              {session.turns.map((turn, i) => (
                <TurnBubble key={i} turn={turn} dark={dark} />
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

  const displayUser = (user ?? "").replace(/^sk-user-/, "");

  return (
    <Stack gap="xl" p="md" maw={860} mx="auto">
      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" wrap="wrap">
          <Box>
            <Group gap="xs" mb={4}>
              <Button
                component={Link} to="/logs" variant="subtle" size="xs"
                leftSection={<IconArrowLeft size={13} />} px={6}
              >
                Logs
              </Button>
              <Text size="xs" c="dimmed">/</Text>
              <Text size="xs" c="dimmed" ff="monospace">{displayUser}</Text>
            </Group>
            <Text size="xl" fw={800} ff="monospace">{displayUser}</Text>
            <Text size="sm" c="dimmed" mt={2}>
              {loading ? "Loading…" : `${sessions.length} session${sessions.length !== 1 ? "s" : ""}`}
            </Text>
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
