import { useState, useEffect, useCallback } from "react";
import {
  Stack, SimpleGrid, Text, Group, Paper, TextInput, Textarea, Table,
  ThemeIcon, Box, Badge, ActionIcon, Tooltip, Modal, Button, Progress,
  Accordion, Loader, Alert,
} from "@mantine/core";
import {
  IconRefresh, IconPlayerPause, IconPlayerPlay, IconTrash, IconPencil,
  IconUserPlus, IconUsers, IconAlertTriangle, IconKey, IconRotate,
  IconPlus, IconCopy, IconCheck,
} from "@tabler/icons-react";
import { adminPost } from "../../utils";
import type { TokenStatus } from "../../contexts";

interface ApiToken {
  key: string; name: string; limit: number | null; used: number;
  paused: boolean; dynamic: boolean; today: number; alltime: number; pct: number;
}
interface ApiUser {
  id: string; name: string; description: string; created_at: number;
  tokens: ApiToken[];
}

function nf(n: number) { return n.toLocaleString(); }
const ACT = 15;

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <ActionIcon variant="subtle" color={copied ? "teal" : "gray"} size="sm"
      onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
      {copied ? <IconCheck size={ACT} /> : <IconCopy size={ACT} />}
    </ActionIcon>
  );
}

function EditUserModal({ user, onClose, onSaved }: { user: ApiUser; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(user.name);
  const [desc, setDesc] = useState(user.description);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), description: desc }),
    });
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal opened onClose={onClose} title={`Edit User: ${user.name}`} size="sm">
      <Stack gap="sm">
        <TextInput label="Display Name" value={name} onChange={e => setName(e.currentTarget.value)}
          onKeyDown={e => { if (e.key === "Enter") save(); }} />
        <Textarea label="Description" value={desc} onChange={e => setDesc(e.currentTarget.value)}
          placeholder="Optional notes about this user" rows={3} />
        <Group justify="flex-end" mt="xs">
          <Button variant="subtle" color="gray" onClick={onClose}>Cancel</Button>
          <Button color="teal" loading={saving} onClick={save}>Save</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function RotateModal({ token, onClose, onDone }: { token: ApiToken; onClose: () => void; onDone: () => void }) {
  const [newKey, setNewKey] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

  const rotate = async () => {
    setRotating(true);
    const res = await fetch("/admin/token/rotate", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: token.key, new_key: newKey.trim() }),
    });
    const data = await res.json() as any;
    setRotating(false);
    if (data.ok) { setResult(data.newKey); onDone(); }
  };

  return (
    <Modal opened onClose={onClose} title="Rotate Token" size="sm">
      <Stack gap="sm">
        <Alert color="orange" title="Warning">
          Old key <code>{token.key}</code> will be deactivated. All clients must update to the new key.
        </Alert>
        <TextInput
          label="New token key"
          placeholder={`${token.key}-v2 (leave blank to auto-generate)`}
          value={newKey}
          onChange={e => setNewKey(e.currentTarget.value)}
        />
        {result && (
          <Paper withBorder p="sm" radius="sm" bg="var(--mantine-color-teal-light)">
            <Group gap="xs" wrap="nowrap">
              <Text size="sm" ff="monospace" style={{ flex: 1 }}>{result}</Text>
              <CopyButton value={result} />
            </Group>
            <Text size="xs" c="dimmed" mt={4}>New key is active. Copy and distribute to the user.</Text>
          </Paper>
        )}
        {!result && (
          <Group justify="flex-end" mt="xs">
            <Button variant="subtle" color="gray" onClick={onClose}>Cancel</Button>
            <Button color="orange" loading={rotating} onClick={rotate}>Rotate</Button>
          </Group>
        )}
        {result && (
          <Button fullWidth color="teal" onClick={onClose}>Done</Button>
        )}
      </Stack>
    </Modal>
  );
}

function AddTokenModal({ users, onClose, onDone }: { users: ApiUser[]; onClose: () => void; onDone: () => void }) {
  const [userId, setUserId] = useState(users[0]?.id || "");
  const [key, setKey]       = useState("");
  const [limit, setLimit]   = useState("40000");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!key.trim()) return;
    setSaving(true);
    await adminPost("/admin/token/add", { token: key.trim(), limit, user_id: userId });
    setSaving(false);
    onDone();
    onClose();
  };

  return (
    <Modal opened onClose={onClose} title="Add Token to User" size="sm">
      <Stack gap="sm">
        <Box>
          <Text size="xs" fw={600} c="dimmed" mb={4} tt="uppercase" style={{ letterSpacing: ".06em" }}>User</Text>
          <Stack gap={4}>
            {users.map(u => (
              <Paper key={u.id} withBorder p="xs" radius="sm"
                style={{ cursor: "pointer", background: userId === u.id ? "var(--mantine-color-blue-light)" : undefined }}
                onClick={() => setUserId(u.id)}>
                <Text size="sm" fw={userId === u.id ? 700 : 400}>{u.name}</Text>
              </Paper>
            ))}
          </Stack>
        </Box>
        <TextInput label="Token key" placeholder="sk-user-name" value={key}
          onChange={e => setKey(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") save(); }} />
        <TextInput label="Limit" value={limit}
          onChange={e => setLimit(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") save(); }} />
        <Group justify="flex-end" mt="xs">
          <Button variant="subtle" color="gray" onClick={onClose}>Cancel</Button>
          <Button color="teal" loading={saving} onClick={save}>Add Token</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function CreateUserModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName]   = useState("");
  const [desc, setDesc]   = useState("");
  const [key, setKey]     = useState("");
  const [limit, setLimit] = useState("40000");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    // Create user first
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), description: desc }),
    });
    const data = await res.json() as any;
    // If token key is provided, add token linked to new user
    if (data.ok && key.trim()) {
      await adminPost("/admin/token/add", { token: key.trim(), limit, user_id: data.user.id, name: name.trim() });
    }
    setSaving(false);
    onDone();
    onClose();
  };

  return (
    <Modal opened onClose={onClose} title="Create New User" size="sm">
      <Stack gap="sm">
        <TextInput label="Display Name" placeholder="Alice" value={name}
          onChange={e => setName(e.currentTarget.value)} />
        <Textarea label="Description" placeholder="Optional notes" value={desc}
          onChange={e => setDesc(e.currentTarget.value)} rows={2} />
        <TextInput label="Initial Token Key" placeholder="sk-user-alice (optional)" value={key}
          onChange={e => setKey(e.currentTarget.value)} />
        {key && (
          <TextInput label="Token Limit" value={limit}
            onChange={e => setLimit(e.currentTarget.value)} />
        )}
        <Group justify="flex-end" mt="xs">
          <Button variant="subtle" color="gray" onClick={onClose}>Cancel</Button>
          <Button color="teal" loading={saving} onClick={save}>Create</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function AdminUsers({ tokens: tokenStatuses }: { tokens: Record<string, TokenStatus> }) {
  const [apiUsers, setApiUsers]   = useState<ApiUser[] | null>(null);
  const [editUser, setEditUser]   = useState<ApiUser | null>(null);
  const [rotateToken, setRotateToken] = useState<ApiToken | null>(null);
  const [showCreate, setShowCreate]   = useState(false);
  const [showAddTok, setShowAddTok]   = useState(false);

  const reload = useCallback(async () => {
    const res = await fetch("/api/admin/users");
    setApiUsers(await res.json());
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const deleteUser = async (u: ApiUser) => {
    if (!confirm(`Delete user "${u.name}" and all their tokens?`)) return;
    await fetch(`/api/admin/users/${encodeURIComponent(u.id)}`, { method: "DELETE" });
    reload();
  };

  const entries    = Object.entries(tokenStatuses);
  const total      = entries.length;
  const paused     = entries.filter(([, t]) => t.paused).length;
  const overLimit  = entries.filter(([, t]) => t.pct > 100).length;

  return (
    <Stack gap="xl">
      {editUser    && <EditUserModal user={editUser}     onClose={() => setEditUser(null)}    onSaved={reload} />}
      {rotateToken && <RotateModal   token={rotateToken} onClose={() => setRotateToken(null)} onDone={reload} />}
      {showCreate  && <CreateUserModal onClose={() => setShowCreate(false)} onDone={reload} />}
      {showAddTok  && apiUsers && <AddTokenModal users={apiUsers} onClose={() => setShowAddTok(false)} onDone={reload} />}

      {/* Header */}
      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" wrap="wrap">
          <div>
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }} mb={4}>User Management</Text>
            <Text size="xl" fw={800} ff="monospace">Users & Tokens</Text>
            <Text size="sm" c="dimmed" mt={2}>{total} token(s) · {apiUsers?.length ?? "…"} user(s)</Text>
          </div>
          <Group gap="xs">
            {paused > 0 && (
              <Paper withBorder p="xs" radius="md">
                <Group gap="xs">
                  <IconPlayerPause size={14} color="var(--mantine-color-orange-5)" />
                  <Text size="xs" fw={600} c="orange">{paused}</Text>
                  <Text size="xs" c="dimmed">paused</Text>
                </Group>
              </Paper>
            )}
            {overLimit > 0 && (
              <Paper withBorder p="xs" radius="md">
                <Group gap="xs">
                  <IconAlertTriangle size={14} color="var(--mantine-color-red-5)" />
                  <Text size="xs" fw={600} c="red">{overLimit}</Text>
                  <Text size="xs" c="dimmed">over</Text>
                </Group>
              </Paper>
            )}
          </Group>
        </Group>
      </Paper>

      {/* Bulk actions */}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        <Paper withBorder p="sm" radius="md" style={{ cursor: "pointer" }}
          onClick={() => { if (confirm("Reset all token usage?")) adminPost("/admin/reset", { all: "true" }); }}>
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon variant="light" color="gray" size="lg" radius="md"><IconRefresh size={18} /></ThemeIcon>
            <div>
              <Text size="sm" fw={600}>Reset All Usage</Text>
              <Text size="xs" c="dimmed">Zero out window counters for all tokens</Text>
            </div>
          </Group>
        </Paper>
        <Paper withBorder p="sm" radius="md" style={{ cursor: "pointer" }}
          onClick={() => adminPost("/admin/token/pause", { all: "true" })}>
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon variant="light" color="orange" size="lg" radius="md"><IconPlayerPause size={18} /></ThemeIcon>
            <div>
              <Text size="sm" fw={600}>Pause All Tokens</Text>
              <Text size="xs" c="dimmed">Suspend all tokens temporarily</Text>
            </div>
          </Group>
        </Paper>
      </SimpleGrid>

      {/* Users list */}
      <Stack gap="xs">
        <Group justify="space-between">
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Users</Text>
          <Group gap="xs">
            <Button size="xs" variant="light" color="blue" leftSection={<IconPlus size={13} />}
              onClick={() => setShowAddTok(true)}>Add Token</Button>
            <Button size="xs" variant="filled" color="teal" leftSection={<IconUserPlus size={13} />}
              onClick={() => setShowCreate(true)}>Create User</Button>
          </Group>
        </Group>

        {apiUsers === null ? (
          <Group justify="center" py="xl"><Loader size="sm" /></Group>
        ) : apiUsers.length === 0 ? (
          <Paper withBorder p="lg" radius="md" ta="center">
            <Text c="dimmed" size="sm">No users yet. Create one to get started.</Text>
          </Paper>
        ) : (
          <Accordion variant="separated" radius="md">
            {apiUsers.map(u => (
              <Accordion.Item key={u.id} value={u.id}>
                <Accordion.Control>
                  <Group gap="sm" wrap="nowrap">
                    <ThemeIcon variant="light" color="blue" size="md" radius="md">
                      <IconUsers size={14} />
                    </ThemeIcon>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Group gap="xs" wrap="nowrap">
                        <Text size="sm" fw={700} truncate>{u.name}</Text>
                        <Badge size="xs" variant="dot" color="gray">{u.tokens.length} token{u.tokens.length !== 1 ? "s" : ""}</Badge>
                      </Group>
                      {u.description && <Text size="xs" c="dimmed" truncate>{u.description}</Text>}
                    </div>
                    <Group gap="xs" wrap="nowrap" onClick={e => e.stopPropagation()}>
                      <Tooltip label="Edit user" withArrow>
                        <Box component="span"
                          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: "var(--mantine-radius-sm)", cursor: "pointer", color: "var(--mantine-color-gray-light-color)" }}
                          onClick={(e: React.MouseEvent) => { e.stopPropagation(); setEditUser(u); }}
                          aria-label="Edit user" role="button" tabIndex={0}
                          onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setEditUser(u); } }}>
                          <IconPencil size={ACT} />
                        </Box>
                      </Tooltip>
                      <Tooltip label="Delete user" withArrow>
                        <Box component="span"
                          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: "var(--mantine-radius-sm)", cursor: "pointer", color: "var(--mantine-color-red-light-color)" }}
                          onClick={(e: React.MouseEvent) => { e.stopPropagation(); deleteUser(u); }}
                          aria-label="Delete user" role="button" tabIndex={0}
                          onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); deleteUser(u); } }}>
                          <IconTrash size={ACT} />
                        </Box>
                      </Tooltip>
                    </Group>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  {u.tokens.length === 0 ? (
                    <Text size="sm" c="dimmed" ta="center" py="md">No tokens for this user.</Text>
                  ) : (
                    <Table withRowBorders withColumnBorders={false} highlightOnHover>
                      <Table.Thead>
                        <Table.Tr>
                          {["Token Key","Used","Today","Limit","Usage","Actions"].map(h => (
                            <Table.Th key={h} style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>{h}</Table.Th>
                          ))}
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {u.tokens.map(tk => (
                          <Table.Tr key={tk.key} style={tk.paused ? { opacity: 0.5 } : {}}>
                            <Table.Td>
                              <Group gap={4} wrap="nowrap">
                                <IconKey size={12} color="var(--mantine-color-dimmed)" />
                                <Text size="xs" ff="monospace">{tk.key}</Text>
                                <CopyButton value={tk.key} />
                                {tk.paused && <Badge size="xs" color="gray">paused</Badge>}
                              </Group>
                            </Table.Td>
                            <Table.Td><Text size="xs" ff="monospace" c="dimmed">{nf(tk.used)}</Text></Table.Td>
                            <Table.Td><Text size="xs" ff="monospace">{tk.today ? nf(tk.today) : "—"}</Text></Table.Td>
                            <Table.Td><Text size="xs" ff="monospace" c="dimmed">{tk.limit === null ? "∞" : nf(tk.limit)}</Text></Table.Td>
                            <Table.Td style={{ minWidth: 120 }}>
                              <Group gap="xs" wrap="nowrap">
                                <Progress value={Math.min(tk.pct, 100)} color={tk.pct >= 95 ? "red" : tk.pct >= 75 ? "orange" : "teal"}
                                  size="sm" style={{ flex: 1 }} />
                                <Text size="xs" c="dimmed" ff="monospace">{tk.pct}%</Text>
                              </Group>
                            </Table.Td>
                            <Table.Td>
                              <Group gap={4} wrap="nowrap">
                                <Tooltip label="Reset usage" withArrow>
                                  <ActionIcon variant="subtle" color="gray" size="sm"
                                    onClick={() => adminPost("/admin/reset", { token: tk.key }).then(reload)}>
                                    <IconRefresh size={ACT} />
                                  </ActionIcon>
                                </Tooltip>
                                <Tooltip label="Edit limit" withArrow>
                                  <ActionIcon variant="subtle" color="gray" size="sm"
                                    onClick={() => { const v = prompt("New limit:", tk.limit === null ? "unlimited" : String(tk.limit)); if (v) adminPost("/admin/token/edit", { token: tk.key, limit: v }).then(reload); }}>
                                    <IconPencil size={ACT} />
                                  </ActionIcon>
                                </Tooltip>
                                <Tooltip label={tk.paused ? "Resume" : "Pause"} withArrow>
                                  <ActionIcon variant="subtle" color={tk.paused ? "teal" : "orange"} size="sm"
                                    onClick={() => adminPost("/admin/token/pause", { token: tk.key }).then(reload)}>
                                    {tk.paused ? <IconPlayerPlay size={ACT} /> : <IconPlayerPause size={ACT} />}
                                  </ActionIcon>
                                </Tooltip>
                                <Tooltip label="Rotate (generate new key)" withArrow>
                                  <ActionIcon variant="subtle" color="blue" size="sm"
                                    onClick={() => setRotateToken(tk)}>
                                    <IconRotate size={ACT} />
                                  </ActionIcon>
                                </Tooltip>
                                <Tooltip label="Delete token" withArrow>
                                  <ActionIcon variant="subtle" color="red" size="sm"
                                    onClick={() => { if (confirm(`Delete ${tk.key}?`)) adminPost("/admin/token/delete", { token: tk.key }).then(reload); }}>
                                    <IconTrash size={ACT} />
                                  </ActionIcon>
                                </Tooltip>
                              </Group>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  )}
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        )}
      </Stack>
    </Stack>
  );
}
