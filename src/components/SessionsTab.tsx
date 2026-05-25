import { useState, useEffect } from "react";
import {
  Stack, Group, TextInput, ActionIcon, Box, Text, Paper,
  SimpleGrid, Badge,
} from "@mantine/core";
import {
  IconMessages, IconX, IconLayoutGrid, IconList,
} from "@tabler/icons-react";
import type { StatusResponse } from "../contexts";
import { useStatus } from "../contexts";
import { UserAvatar } from "./UserAvatar";
import { SessionsContent } from "./SessionHistory";

export function SessionsTab({ tokens }: { tokens: StatusResponse["tokens"] }) {
  const status = useStatus();
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">(() => {
    try { return (localStorage.getItem("sessions-view") as "grid" | "list") || "grid"; } catch { return "grid"; }
  });
  const [sessionCounts, setSessionCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch("/api/sessions/summary")
      .then(r => r.ok ? r.json() : {})
      .then(setSessionCounts)
      .catch(() => {});
  }, []);

  const userOptions = [...new Set(
    Object.values(tokens).map(tk => tk.owner_name || tk.token_label || tk.name).filter(Boolean)
  )].sort().map(n => ({ value: n, label: n }));

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <TextInput
          placeholder="Cari atau pilih user…"
          value={selectedUser || ""}
          onChange={e => setSelectedUser(e.currentTarget.value || null)}
          leftSection={<IconMessages size={14} />}
          rightSection={selectedUser ? (
            <Box style={{ cursor: "pointer", display: "flex" }} onClick={() => setSelectedUser(null)}>
              <IconX size={14} color="var(--cp-text-3)" />
            </Box>
          ) : null}
          size="sm"
          style={{ flex: 1 }}
        />
        {!selectedUser && (
          <Group gap={4}>
            <ActionIcon
              variant={viewMode === "grid" ? "filled" : "default"}
              color={viewMode === "grid" ? "blue" : "gray"}
              size="sm" radius="md"
              onClick={() => { setViewMode("grid"); try { localStorage.setItem("sessions-view", "grid"); } catch {} }}
            >
              <IconLayoutGrid size={14} />
            </ActionIcon>
            <ActionIcon
              variant={viewMode === "list" ? "filled" : "default"}
              color={viewMode === "list" ? "blue" : "gray"}
              size="sm" radius="md"
              onClick={() => { setViewMode("list"); try { localStorage.setItem("sessions-view", "list"); } catch {} }}
            >
              <IconList size={14} />
            </ActionIcon>
          </Group>
        )}
      </Group>

      {userOptions.length > 0 && !selectedUser && (
        <Stack gap="xs">
          <Text fz={11} fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: ".07em" }}>Pilih User</Text>
          {viewMode === "grid" ? (
            <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="xs">
              {userOptions.map(u => (
                <Paper key={u.value} withBorder p="sm" radius="md"
                  style={{ cursor: "pointer", transition: "all 0.15s" }}
                  onClick={() => setSelectedUser(u.value)}
                  className="cp-interactive">
                  <Group gap={8} wrap="nowrap">
                    <UserAvatar name={u.value} imageUrl={status?.userImages?.[u.value]} size={28} />
                    <Box style={{ minWidth: 0, flex: 1 }}>
                      <Text fz={12} fw={600} truncate>{u.value}</Text>
                      {sessionCounts[u.value] != null && (
                        <Text fz={10} c="dimmed">{sessionCounts[u.value]} session</Text>
                      )}
                    </Box>
                  </Group>
                </Paper>
              ))}
            </SimpleGrid>
          ) : (
            <Stack gap={4}>
              {userOptions.map(u => (
                <Paper key={u.value} withBorder px="md" py="xs" radius="md"
                  style={{ cursor: "pointer", transition: "all 0.15s" }}
                  onClick={() => setSelectedUser(u.value)}
                  className="cp-interactive">
                  <Group justify="space-between" wrap="nowrap">
                    <Group gap={8} wrap="nowrap">
                      <UserAvatar name={u.value} imageUrl={status?.userImages?.[u.value]} size={26} />
                      <Text fz={13} fw={600}>{u.value}</Text>
                    </Group>
                    {sessionCounts[u.value] != null && (
                      <Badge size="xs" variant="light" color="blue">{sessionCounts[u.value]} session</Badge>
                    )}
                  </Group>
                </Paper>
              ))}
            </Stack>
          )}
        </Stack>
      )}

      {selectedUser && (
        <Box>
          <Group gap="xs" mb="md">
            <Badge variant="light" color="blue" size="sm" ff="monospace"
              style={{ cursor: "pointer" }} onClick={() => setSelectedUser(null)}>
              ← {selectedUser}
            </Badge>
            <Text fz={11} c="dimmed">klik untuk ganti user</Text>
          </Group>
          <SessionsContent user={selectedUser} />
        </Box>
      )}
    </Stack>
  );
}
