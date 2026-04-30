import { useState } from "react";
import { Stack, SimpleGrid, Text, Group, Paper, TextInput, Table, ThemeIcon, Box } from "@mantine/core";
import { IconRefresh, IconPlayerPause, IconUserPlus, IconUsers, IconPlayerTrackNext, IconAlertTriangle } from "@tabler/icons-react";
import { adminPost } from "../../utils";
import type { TokenStatus } from "../../contexts";
import { UsersTable } from "../tables/UsersTable";

export function AdminUsers({ tokens }: { tokens: Record<string, TokenStatus> }) {
  const [newKey, setNewKey]     = useState("");
  const [newLimit, setNewLimit] = useState("40000");

  const handleAdd = async () => {
    if (!newKey.trim()) return;
    await adminPost("/admin/token/add", { token: newKey.trim(), limit: newLimit });
    setNewKey(""); setNewLimit("40000");
  };

  const entries    = Object.entries(tokens);
  const total      = entries.length;
  const active     = entries.filter(([_, t]) => t.used > 0).length;
  const paused     = entries.filter(([_, t]) => t.paused).length;
  const overLimit  = entries.filter(([_, t]) => t.pct > 100).length;

  return (
    <Stack gap="xl">
      {/* ── Page Header ─────────────────────────────────────── */}
      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" wrap="wrap">
          <div>
            <Text size="sm" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }} mb={4}>Token Management</Text>
            <Text size="xl" fw={800} ff="monospace">Users & Tokens</Text>
            <Text size="sm" c="dimmed" mt={2}>{total} tokens configured · {active} active this window</Text>
          </div>
          <Group gap="xs">
            <Paper withBorder p="xs" radius="md" style={{ background: "transparent" }}>
              <Group gap="xs">
                <IconUsers size={14} color="var(--mantine-color-dimmed)" />
                <Text size="xs" fw={600} ff="monospace">{total}</Text>
                <Text size="xs" c="dimmed">total</Text>
              </Group>
            </Paper>
            {paused > 0 && (
              <Paper withBorder p="xs" radius="md" style={{ background: "transparent" }}>
                <Group gap="xs">
                  <IconPlayerPause size={14} color="var(--mantine-color-orange-5)" />
                  <Text size="xs" fw={600} ff="monospace" c="orange">{paused}</Text>
                  <Text size="xs" c="dimmed">paused</Text>
                </Group>
              </Paper>
            )}
            {overLimit > 0 && (
              <Paper withBorder p="xs" radius="md" style={{ background: "transparent" }}>
                <Group gap="xs">
                  <IconAlertTriangle size={14} color="var(--mantine-color-red-5)" />
                  <Text size="xs" fw={600} ff="monospace" c="red">{overLimit}</Text>
                  <Text size="xs" c="dimmed">over</Text>
                </Group>
              </Paper>
            )}
          </Group>
        </Group>
      </Paper>

      {/* ── Bulk Actions ────────────────────────────────────── */}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        <Paper withBorder p="sm" radius="md" style={{ cursor: "pointer" }}
          onClick={() => { if (confirm("Reset all token usage?")) adminPost("/admin/reset", { all: "true" }); }}>
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon variant="light" color="gray" size="lg" radius="md">
              <IconRefresh size={18} />
            </ThemeIcon>
            <div>
              <Text size="sm" fw={600}>Reset All Usage</Text>
              <Text size="xs" c="dimmed">Zero out window counters for all tokens</Text>
            </div>
          </Group>
        </Paper>
        <Paper withBorder p="sm" radius="md" style={{ cursor: "pointer" }}
          onClick={() => adminPost("/admin/token/pause", { all: "true" })}>
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon variant="light" color="orange" size="lg" radius="md">
              <IconPlayerPause size={18} />
            </ThemeIcon>
            <div>
              <Text size="sm" fw={600}>Pause All Tokens</Text>
              <Text size="xs" c="dimmed">Suspend all tokens — requests will be rejected</Text>
            </div>
          </Group>
        </Paper>
      </SimpleGrid>

      {/* ── Token Table ─────────────────────────────────────── */}
      <Stack gap="xs">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>All Tokens</Text>
        <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
          <Table.ScrollContainer minWidth={500}>
            <UsersTable tokens={tokens} isAdmin={true} />
          </Table.ScrollContainer>
        </Paper>
      </Stack>

      {/* ── Add Token ───────────────────────────────────────── */}
      <Stack gap="xs">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Add New Token</Text>
        <Paper withBorder p="lg" radius="md">
          <Group gap="sm" mb="md" wrap="nowrap">
            <ThemeIcon variant="light" color="teal" size="lg" radius="md" style={{ flexShrink: 0 }}>
              <IconUserPlus size={18} />
            </ThemeIcon>
            <div>
              <Text size="sm" fw={600}>Create a new API token</Text>
              <Text size="xs" c="dimmed">Tokens are used by clients to authenticate with the proxy API.</Text>
            </div>
          </Group>
          <Group align="flex-end" gap="sm" wrap="wrap">
            <TextInput
              label="Token key"
              placeholder="sk-user-name"
              size="sm"
              w={240}
              value={newKey}
              onChange={e => setNewKey(e.currentTarget.value)}
              onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
            />
            <TextInput
              label="Limit"
              size="sm"
              w={140}
              value={newLimit}
              onChange={e => setNewLimit(e.currentTarget.value)}
              onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
            />
            <Box mb={3}>
              <ThemeIcon variant="filled" color="teal" size="lg" radius="md" style={{ cursor: "pointer" }}
                onClick={handleAdd}>
                <IconPlayerTrackNext size={18} />
              </ThemeIcon>
            </Box>
          </Group>
        </Paper>
      </Stack>
    </Stack>
  );
}
