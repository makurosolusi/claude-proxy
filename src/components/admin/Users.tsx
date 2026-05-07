import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Stack, SimpleGrid, Text, Group, Paper, TextInput, Textarea, Table,
  ThemeIcon, Box, Badge, ActionIcon, Tooltip, Modal, Button, Progress,
  Accordion, Loader, Alert, Avatar, Select, Switch, Divider, SegmentedControl,
} from "@mantine/core";
import {
  IconRefresh, IconPlayerPause, IconPlayerPlay, IconTrash, IconPencil,
  IconUserPlus, IconUsers, IconAlertTriangle, IconKey, IconRotate,
  IconPlus, IconCopy, IconCheck, IconSearch, IconArrowsSort, IconInfoCircle,
} from "@tabler/icons-react";
import { adminPost, fmtRel, avatarColor } from "../../utils";
import type { TokenStatus } from "../../contexts";
import { notifications } from "@mantine/notifications";
import { modals } from "@mantine/modals";

interface ApiToken {
  key: string; name: string; limit: number | null; used: number;
  paused: boolean; dynamic: boolean; today: number; alltime: number; pct: number;
  provider: string;
}
interface ApiUser {
  id: string; name: string; description: string; created_at: number;
  tokens: ApiToken[];
}

function nf(n: number) { return n.toLocaleString(); }
const ACT = 15;

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]?.toUpperCase() ?? "").join("") || "?";
}

function userAggregates(u: ApiUser) {
  const active = u.tokens.filter(t => !t.paused);
  const totalUsed   = u.tokens.reduce((a, t) => a + t.used, 0);
  const todayUsed   = u.tokens.reduce((a, t) => a + t.today, 0);
  const alltime     = u.tokens.reduce((a, t) => a + t.alltime, 0);
  const hasUnlimited = u.tokens.some(t => t.limit === null);
  const totalLimit  = hasUnlimited ? null : u.tokens.reduce((a, t) => a + (t.limit ?? 0), 0);
  const aggPct      = totalLimit && totalLimit > 0 ? Math.round((totalUsed / totalLimit) * 100) : 0;
  const maxPct      = u.tokens.reduce((a, t) => Math.max(a, t.pct), 0);
  const pausedCount = u.tokens.filter(t => t.paused).length;
  const overCount   = u.tokens.filter(t => t.pct > 100).length;
  return { active, totalUsed, todayUsed, alltime, totalLimit, aggPct, maxPct, pausedCount, overCount };
}

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
    try {
      await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: desc }),
      });
      notifications.show({ color: "teal", message: "User updated", autoClose: 2000 });
      onSaved();
      onClose();
    } catch {
      notifications.show({ color: "red", message: "Failed to update user", autoClose: 3000 });
    } finally {
      setSaving(false);
    }
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

function DeleteUserModal({ user, onClose, onDone }: { user: ApiUser; onClose: () => void; onDone: () => void }) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const tokenCount = user.tokens.length;
  const requiresType = tokenCount > 0;
  const canDelete = !requiresType || confirmText.trim() === user.name;

  const doDelete = async () => {
    if (!canDelete) return;
    setBusy(true);
    await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE" });
    setBusy(false);
    onDone();
    onClose();
  };

  return (
    <Modal opened onClose={onClose} title="Delete User" size="sm">
      <Stack gap="sm">
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
          {tokenCount === 0 ? (
            <>This will permanently delete <b>{user.name}</b>.</>
          ) : (
            <>Deleting <b>{user.name}</b> will also delete <b>{tokenCount} token{tokenCount !== 1 ? "s" : ""}</b>. Any client using these tokens will start receiving 401 errors.</>
          )}
        </Alert>
        {requiresType && (
          <TextInput
            label={<>Type <b>{user.name}</b> to confirm</>}
            value={confirmText}
            onChange={e => setConfirmText(e.currentTarget.value)}
            placeholder={user.name}
            autoFocus
          />
        )}
        <Group justify="flex-end" mt="xs">
          <Button variant="subtle" color="gray" onClick={onClose}>Cancel</Button>
          <Button color="red" loading={busy} disabled={!canDelete} onClick={doDelete}
            leftSection={<IconTrash size={14} />}>
            Delete user
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function EditLimitModal({ token, onClose, onSaved }: { token: ApiToken; onClose: () => void; onSaved: () => void }) {
  const [unlimited, setUnlimited] = useState(token.limit === null);
  const [limit, setLimit] = useState(token.limit === null ? "40000" : String(token.limit));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const value = unlimited ? "unlimited" : limit.trim();
    if (!value) return;
    if (!unlimited && (!/^\d+$/.test(value) || Number(value) <= 0)) return;
    setBusy(true);
    await adminPost("/admin/token/edit", { token: token.key, limit: value });
    setBusy(false);
    onSaved();
    onClose();
  };

  return (
    <Modal opened onClose={onClose} title="Edit Token Limit" size="sm">
      <Stack gap="sm">
        <Box>
          <Text size="xs" c="dimmed" mb={2}>Token</Text>
          <Text size="sm" ff="monospace">{token.key}</Text>
        </Box>
        <Switch
          label="Unlimited"
          checked={unlimited}
          onChange={e => setUnlimited(e.currentTarget.checked)}
        />
        {!unlimited && (
          <TextInput
            label="Window limit (tokens)"
            description="Max input+output tokens per 5-hour window"
            value={limit}
            onChange={e => setLimit(e.currentTarget.value.replace(/[^\d]/g, ""))}
            onKeyDown={e => { if (e.key === "Enter") save(); }}
            autoFocus
          />
        )}
        <Group justify="flex-end" mt="xs">
          <Button variant="subtle" color="gray" onClick={onClose}>Cancel</Button>
          <Button color="teal" loading={busy} onClick={save}>Save</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function EditAllLimitsModal({ user, onClose, onSaved }: { user: ApiUser; onClose: () => void; onSaved: () => void }) {
  const firstLimit = user.tokens[0]?.limit ?? null;
  const mixedLimits = user.tokens.some(t => t.limit !== firstLimit);
  const [unlimited, setUnlimited] = useState(firstLimit === null && !mixedLimits);
  const [limit, setLimit]         = useState(firstLimit !== null ? String(firstLimit) : "40000");
  const [busy, setBusy]           = useState(false);

  const save = async () => {
    const value = unlimited ? "unlimited" : limit.trim();
    if (!value || (!unlimited && (!/^\d+$/.test(value) || Number(value) <= 0))) return;
    setBusy(true);
    try {
      await Promise.all(user.tokens.map(t => adminPost("/admin/token/edit", { token: t.key, limit: value })));
      notifications.show({ color: "teal", message: `All ${user.tokens.length} token(s) set to ${unlimited ? "unlimited" : value}`, autoClose: 2000 });
      onSaved();
      onClose();
    } catch {
      notifications.show({ color: "red", message: "Failed to update limits", autoClose: 3000 });
    } finally { setBusy(false); }
  };

  return (
    <Modal opened onClose={onClose} title={`Edit All Limits — ${user.name}`} size="sm">
      <Stack gap="sm">
        <Text size="xs" c="dimmed">
          Apply the same limit to all <b>{user.tokens.length}</b> token{user.tokens.length !== 1 ? "s" : ""} for this user.
          {mixedLimits && <Text span c="orange"> Current limits are mixed.</Text>}
        </Text>
        <Switch label="Unlimited" checked={unlimited} onChange={e => setUnlimited(e.currentTarget.checked)} />
        {!unlimited && (
          <TextInput
            label="Window limit (tokens)"
            description="Max input+output tokens per 5-hour window"
            value={limit}
            onChange={e => setLimit(e.currentTarget.value.replace(/[^\d]/g, ""))}
            onKeyDown={e => { if (e.key === "Enter") save(); }}
            autoFocus
          />
        )}
        <Group justify="flex-end" mt="xs">
          <Button variant="subtle" color="gray" onClick={onClose}>Cancel</Button>
          <Button color="teal" loading={busy} onClick={save}>Apply to all</Button>
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

function AddTokenModal({ user, onClose, onDone }: { user: ApiUser; onClose: () => void; onDone: () => void }) {
  const [key, setKey]       = useState(`sk-user-${user.name.toLowerCase().replace(/\s+/g, "-")}`);
  const [limit, setLimit]   = useState("40000");
  const [unlimited, setUnlimited] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!key.trim()) return;
    setSaving(true);
    await adminPost("/admin/token/add", {
      token: key.trim(),
      limit: unlimited ? "unlimited" : limit,
      user_id: user.id,
    });
    setSaving(false);
    onDone();
    onClose();
  };

  return (
    <Modal opened onClose={onClose} title={`Add Token to ${user.name}`} size="sm">
      <Stack gap="sm">
        <TextInput label="Token key" placeholder="sk-user-name" value={key} autoFocus
          onChange={e => setKey(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") save(); }} />
        <Switch label="Unlimited" checked={unlimited} onChange={e => setUnlimited(e.currentTarget.checked)} />
        {!unlimited && (
          <TextInput label="Window limit (tokens)" value={limit}
            onChange={e => setLimit(e.currentTarget.value.replace(/[^\d]/g, ""))}
            onKeyDown={e => { if (e.key === "Enter") save(); }} />
        )}
        <Group justify="flex-end" mt="xs">
          <Button variant="subtle" color="gray" onClick={onClose}>Cancel</Button>
          <Button color="teal" loading={saving} onClick={save} leftSection={<IconPlus size={14} />}>Add Token</Button>
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
  const inFlight = { current: false };

  const save = async () => {
    if (!name.trim() || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), description: desc }),
    });
    const data = await res.json() as any;
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
        <TextInput label="Display Name" placeholder="Alice" value={name} autoFocus
          onChange={e => setName(e.currentTarget.value)} />
        <Textarea label="Description" placeholder="Optional notes" value={desc}
          onChange={e => setDesc(e.currentTarget.value)} rows={2} />
        <Divider label="Initial token (optional)" labelPosition="center" />
        <TextInput label="Token Key" placeholder="sk-user-alice" value={key}
          onChange={e => setKey(e.currentTarget.value)} />
        {key && (
          <TextInput label="Token Limit" value={limit}
            onChange={e => setLimit(e.currentTarget.value.replace(/[^\d]/g, ""))} />
        )}
        <Group justify="flex-end" mt="xs">
          <Button variant="subtle" color="gray" onClick={onClose}>Cancel</Button>
          <Button color="teal" loading={saving} onClick={save} leftSection={<IconUserPlus size={14} />}>Create</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function EditAllLimitsGlobalModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [unlimited, setUnlimited] = useState(false);
  const [limit, setLimit]         = useState("40000");
  const [busy, setBusy]           = useState(false);

  const save = async () => {
    const value = unlimited ? "unlimited" : limit.trim();
    if (!value || (!unlimited && (!/^\d+$/.test(value) || Number(value) <= 0))) return;
    setBusy(true);
    try {
      await adminPost("/admin/token/edit-all", { limit: value });
      notifications.show({ color: "teal", message: `All tokens set to ${unlimited ? "unlimited" : Number(value).toLocaleString()}`, autoClose: 2000 });
      onSaved();
      onClose();
    } catch {
      notifications.show({ color: "red", message: "Failed to update limits", autoClose: 3000 });
    } finally { setBusy(false); }
  };

  return (
    <Modal opened onClose={onClose} title="Edit All Limits — Global" size="sm">
      <Stack gap="sm">
        <Text size="xs" c="dimmed">Apply the same limit to <b>every token</b> across all users.</Text>
        <Switch label="Unlimited" checked={unlimited} onChange={e => setUnlimited(e.currentTarget.checked)} />
        {!unlimited && (
          <TextInput
            label="Window limit (tokens)"
            description="Max input+output tokens per 5-hour window"
            value={limit}
            onChange={e => setLimit(e.currentTarget.value.replace(/[^\d]/g, ""))}
            onKeyDown={e => { if (e.key === "Enter") save(); }}
            autoFocus
          />
        )}
        <Group justify="flex-end" mt="xs">
          <Button variant="subtle" color="gray" onClick={onClose}>Cancel</Button>
          <Button color="blue" loading={busy} onClick={save}>Apply to all</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

type SortKey = "name" | "usage" | "tokens" | "newest";

export function AdminUsers({ tokens: tokenStatuses }: { tokens: Record<string, TokenStatus> }) {
  const [apiUsers, setApiUsers]       = useState<ApiUser[] | null>(null);
  const [editUser, setEditUser]           = useState<ApiUser | null>(null);
  const [deleteUser, setDeleteUser]       = useState<ApiUser | null>(null);
  const [rotateToken, setRotateToken]     = useState<ApiToken | null>(null);
  const [editLimit, setEditLimit]         = useState<ApiToken | null>(null);
  const [editAllLimits, setEditAllLimits]         = useState<ApiUser | null>(null);
  const [showEditAllGlobal, setShowEditAllGlobal] = useState(false);
  const [addTokenTo, setAddTokenTo]               = useState<ApiUser | null>(null);
  const [showCreate, setShowCreate]               = useState(false);
  const [search, setSearch]           = useState("");
  const [sort, setSort]               = useState<SortKey>("usage");
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [rowAction, setRowAction]           = useState<{ key: string; act: string } | null>(null);
  const [bulkAction, setBulkAction]         = useState<"reset" | "pause" | "purge" | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch("/api/admin/users");
    setApiUsers(await res.json());
  }, []);

  const runRowAction = async (key: string, act: string, fn: () => Promise<void>, msg: string) => {
    setRowAction({ key, act });
    try {
      await fn(); await reload();
      notifications.show({ color: "teal", message: msg, autoClose: 2000 });
    } catch (e: any) {
      notifications.show({ color: "red", title: "Error", message: e.message || "Action failed", autoClose: 4000 });
    } finally { setRowAction(null); }
  };

  const runBulkAction = async (act: "reset" | "pause" | "purge", fn: () => Promise<void>, msg: string) => {
    setBulkAction(act);
    try {
      await fn(); await reload();
      notifications.show({ color: "teal", message: msg, autoClose: 2000 });
    } catch (e: any) {
      notifications.show({ color: "red", title: "Error", message: e.message || "Action failed", autoClose: 4000 });
    } finally { setBulkAction(null); }
  };

  useEffect(() => { reload(); }, [reload]);

  const filteredUsers = useMemo(() => {
    if (!apiUsers) return null;
    const q = search.trim().toLowerCase();
    let list = apiUsers;
    if (q) {
      list = list.filter(u =>
        u.name.toLowerCase().includes(q) ||
        u.description.toLowerCase().includes(q) ||
        u.tokens.some(t => t.key.toLowerCase().includes(q))
      );
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sort) {
        case "name":   return a.name.localeCompare(b.name);
        case "tokens": return b.tokens.length - a.tokens.length;
        case "newest": return b.created_at - a.created_at;
        case "usage":
        default: {
          const ua = userAggregates(a).totalUsed;
          const ub = userAggregates(b).totalUsed;
          return ub - ua;
        }
      }
    });
    return sorted;
  }, [apiUsers, search, sort]);

  const entries    = Object.entries(tokenStatuses);
  const total      = entries.length;
  const paused     = entries.filter(([, t]) => t.paused).length;
  const overLimit  = entries.filter(([, t]) => t.pct > 100).length;

  return (
    <Stack gap="xl">
      {editUser          && <EditUserModal       user={editUser}       onClose={() => setEditUser(null)}             onSaved={reload} />}
      {deleteUser        && <DeleteUserModal     user={deleteUser}     onClose={() => setDeleteUser(null)}           onDone={reload} />}
      {rotateToken       && <RotateModal         token={rotateToken}   onClose={() => setRotateToken(null)}          onDone={reload} />}
      {editLimit         && <EditLimitModal      token={editLimit}     onClose={() => setEditLimit(null)}            onSaved={reload} />}
      {editAllLimits     && <EditAllLimitsModal  user={editAllLimits}  onClose={() => setEditAllLimits(null)}        onSaved={reload} />}
      {showEditAllGlobal && <EditAllLimitsGlobalModal onClose={() => setShowEditAllGlobal(false)} onSaved={reload} />}
      {addTokenTo        && <AddTokenModal       user={addTokenTo}     onClose={() => setAddTokenTo(null)}           onDone={reload} />}
      {showCreate        && <CreateUserModal     onClose={() => setShowCreate(false)}                                onDone={reload} />}

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
          onClick={() => setShowEditAllGlobal(true)}>
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon variant="light" color="blue" size="lg" radius="md"><IconPencil size={18} /></ThemeIcon>
            <div>
              <Text size="sm" fw={600}>Edit All Limits</Text>
              <Text size="xs" c="dimmed">Set a uniform quota for every token</Text>
            </div>
          </Group>
        </Paper>
        {([
          { act: "reset" as const, color: "gray",   icon: <IconRefresh size={18} />,     label: "Reset All Usage",    desc: "Zero out window counters for all tokens" },
          { act: "pause" as const, color: "orange", icon: <IconPlayerPause size={18} />, label: "Pause All Tokens",   desc: "Suspend all tokens temporarily" },
          { act: "purge" as const, color: "red",    icon: <IconTrash size={18} />,       label: "Purge Orphan Users", desc: "Delete users with no tokens" },
        ]).map(({ act, color, icon, label, desc }) => {
          const busy = bulkAction === act;
          const doAction = () => runBulkAction(act, async () => {
            if (act === "reset") await adminPost("/admin/reset", { all: "true" });
            else if (act === "pause") await adminPost("/admin/token/pause", { all: "true" });
            else { const r = await fetch("/admin/users/purge-orphans", { method: "POST" }); await r.json(); }
          }, act === "reset" ? "All usage reset" : act === "pause" ? "All tokens paused/resumed" : "Orphan users removed");
          return (
            <Paper key={act} withBorder p="sm" radius="md"
              style={{ cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}
              onClick={busy ? undefined : () => {
                if (act === "reset") modals.openConfirmModal({
                  title: "Reset All Usage",
                  children: <Text size="sm">Zero out all token counters? This cannot be undone.</Text>,
                  labels: { confirm: "Reset", cancel: "Cancel" },
                  confirmProps: { color: "red" },
                  onConfirm: doAction,
                });
                else if (act === "purge") modals.openConfirmModal({
                  title: "Purge Orphan Users",
                  children: <Text size="sm">Delete all users with no tokens? This cannot be undone.</Text>,
                  labels: { confirm: "Purge", cancel: "Cancel" },
                  confirmProps: { color: "red" },
                  onConfirm: doAction,
                });
                else doAction();
              }}>
              <Group gap="sm" wrap="nowrap">
                <ThemeIcon variant="light" color={color} size="lg" radius="md">
                  {busy ? <Loader size={16} color="var(--mantine-color-dimmed)" /> : icon}
                </ThemeIcon>
                <div>
                  <Text size="sm" fw={600}>{label}</Text>
                  <Text size="xs" c="dimmed">{desc}</Text>
                </div>
              </Group>
            </Paper>
          );
        })}
      </SimpleGrid>

      {/* Users list */}
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap" gap="sm">
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Users</Text>
          <Button size="xs" variant="filled" color="teal" leftSection={<IconUserPlus size={13} />}
            onClick={() => setShowCreate(true)}>Create User</Button>
        </Group>

        <Group gap="sm" wrap="wrap">
          <TextInput
            placeholder="Search by name, description, or token key…"
            value={search}
            onChange={e => setSearch(e.currentTarget.value)}
            leftSection={<IconSearch size={14} />}
            size="sm"
            style={{ flex: 1, minWidth: 220 }}
          />
          <Select
            value={sort}
            onChange={v => v && setSort(v as SortKey)}
            data={[
              { value: "usage",  label: "Most usage" },
              { value: "name",   label: "Name (A→Z)" },
              { value: "tokens", label: "Token count" },
              { value: "newest", label: "Newest" },
            ]}
            leftSection={<IconArrowsSort size={14} />}
            size="sm"
            allowDeselect={false}
            w={170}
          />
        </Group>

        {filteredUsers === null ? (
          <Group justify="center" py="xl"><Loader size="sm" /></Group>
        ) : filteredUsers.length === 0 ? (
          <Paper withBorder p="lg" radius="md" ta="center">
            <Text c="dimmed" size="sm">
              {search ? `No users match "${search}".` : "No users yet. Create one to get started."}
            </Text>
          </Paper>
        ) : (
          <Accordion variant="separated" radius="md" multiple>
            {filteredUsers.map(u => {
              const agg = userAggregates(u);
              const limitLabel = agg.totalLimit === null ? "∞" : nf(agg.totalLimit);
              const barColor = agg.maxPct >= 95 ? "red" : agg.maxPct >= 75 ? "orange" : agg.aggPct >= 50 ? "yellow" : "teal";

              return (
                <Accordion.Item key={u.id} value={u.id}>
                  <Accordion.Control>
                    <Group gap="md" wrap="nowrap" align="center">
                      <Avatar color={avatarColor(u.name)} radius="xl" size="md">{initials(u.name)}</Avatar>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Group gap="xs" wrap="nowrap">
                          <Text size="sm" fw={700} truncate>{u.name}</Text>
                          <Badge size="xs" variant="light" color="gray">
                            {u.tokens.length} token{u.tokens.length !== 1 ? "s" : ""}
                          </Badge>
                          {agg.pausedCount > 0 && (
                            <Badge size="xs" variant="light" color="orange" leftSection={<IconPlayerPause size={10} />}>
                              {agg.pausedCount} paused
                            </Badge>
                          )}
                          {agg.overCount > 0 && (
                            <Badge size="xs" variant="light" color="red" leftSection={<IconAlertTriangle size={10} />}>
                              {agg.overCount} over
                            </Badge>
                          )}
                        </Group>
                        <Group gap="md" wrap="nowrap" mt={4}>
                          <Text size="xs" c="dimmed" ff="monospace" style={{ whiteSpace: "nowrap" }}>
                            {nf(agg.totalUsed)} / {limitLabel}
                          </Text>
                          {agg.todayUsed > 0 && (
                            <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                              today <Text span ff="monospace" c="bright">{nf(agg.todayUsed)}</Text>
                            </Text>
                          )}
                        </Group>
                      </div>

                      <Box visibleFrom="sm" style={{ width: 140 }}>
                        <Group gap={6} wrap="nowrap" justify="flex-end">
                          <Progress
                            value={Math.min(agg.aggPct || agg.maxPct, 100)}
                            color={barColor}
                            size="sm"
                            style={{ flex: 1 }}
                          />
                          <Text size="xs" c="dimmed" ff="monospace" style={{ width: 38, textAlign: "right" }}>
                            {agg.totalLimit === null ? "—" : `${agg.aggPct}%`}
                          </Text>
                        </Group>
                      </Box>

                      <Group gap={2} wrap="nowrap" onClick={e => e.stopPropagation()}>
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
                            onClick={(e: React.MouseEvent) => { e.stopPropagation(); setDeleteUser(u); }}
                            aria-label="Delete user" role="button" tabIndex={0}
                            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setDeleteUser(u); } }}>
                            <IconTrash size={ACT} />
                          </Box>
                        </Tooltip>
                      </Group>
                    </Group>
                  </Accordion.Control>

                  <Accordion.Panel>
                    <Stack gap="sm">
                      {/* User metadata strip */}
                      <Paper withBorder={false} bg="var(--mantine-color-default-hover)" p="sm" radius="sm">
                        <Group gap="lg" wrap="wrap">
                          <Box>
                            <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".05em" }}>Created</Text>
                            <Text size="sm">{fmtRel(u.created_at)}</Text>
                          </Box>
                          <Box>
                            <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".05em" }}>All-time</Text>
                            <Text size="sm" ff="monospace">{nf(agg.alltime)}</Text>
                          </Box>
                          <Box>
                            <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".05em" }}>Today</Text>
                            <Text size="sm" ff="monospace">{nf(agg.todayUsed)}</Text>
                          </Box>
                          {u.description && (
                            <Box style={{ flex: 1, minWidth: 200 }}>
                              <Group gap={4} mb={2}>
                                <IconInfoCircle size={11} color="var(--mantine-color-dimmed)" />
                                <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".05em" }}>Notes</Text>
                              </Group>
                              <Text size="sm">{u.description}</Text>
                            </Box>
                          )}
                        </Group>
                      </Paper>

                      <Group justify="space-between">
                        <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: ".05em" }}>Tokens</Text>
                        <Group gap="xs">
                          {u.tokens.length > 0 && (
                            <Button size="xs" variant="subtle" color="gray" leftSection={<IconPencil size={12} />}
                              onClick={() => setEditAllLimits(u)}>Edit All Limits</Button>
                          )}
                          <Button size="xs" variant="light" color="blue" leftSection={<IconPlus size={12} />}
                            onClick={() => setAddTokenTo(u)}>Add Token</Button>
                        </Group>
                      </Group>

                      {u.tokens.length === 0 ? (
                        <Paper withBorder p="md" radius="sm" ta="center">
                          <Stack gap="xs" align="center">
                            <ThemeIcon variant="light" color="gray" size="lg" radius="xl">
                              <IconKey size={16} />
                            </ThemeIcon>
                            <Text size="sm" c="dimmed">This user has no tokens yet.</Text>
                            <Button size="xs" variant="light" color="teal"
                              leftSection={<IconPlus size={12} />}
                              onClick={() => setAddTokenTo(u)}>Create first token</Button>
                          </Stack>
                        </Paper>
                      ) : (
                        <Box style={{ overflowX: "auto" }}>
                          <Table withRowBorders withColumnBorders={false} highlightOnHover verticalSpacing="xs">
                            <Table.Thead>
                              <Table.Tr>
                                {["Token Key","Used","Today","Limit","Usage","Provider","Actions"].map(h => (
                                  <Table.Th key={h} style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", whiteSpace: "nowrap" }}>{h}</Table.Th>
                                ))}
                              </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                              {u.tokens.map(tk => (
                                <Table.Tr key={tk.key} style={tk.paused ? { opacity: 0.5 } : {}}>
                                  <Table.Td>
                                    <Group gap={4} wrap="nowrap">
                                      <IconKey size={12} color="var(--mantine-color-dimmed)" />
                                      <Text size="xs" ff="monospace" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{tk.key}</Text>
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
                                  <Table.Td style={{ minWidth: 220 }}>
                                    <Group gap="xs" wrap="nowrap" align="center">
                                      <SegmentedControl
                                        size="xs"
                                        value={tk.provider || "inherit"}
                                        disabled={savingProvider === tk.key}
                                        onChange={async v => {
                                          setSavingProvider(tk.key);
                                          try {
                                            const r = await fetch("/admin/token/provider", {
                                              method: "POST",
                                              headers: { "Content-Type": "application/x-www-form-urlencoded" },
                                              body: new URLSearchParams({ token: tk.key, provider: v }),
                                            });
                                            const d = await r.json() as any;
                                            if (!d.ok) {
                                              notifications.show({ color: "red", title: "Cannot switch provider", message: d.error || "Failed", autoClose: 5000 });
                                              return;
                                            }
                                            await reload();
                                            notifications.show({ color: "teal", message: `Provider set to ${v === "inherit" ? "Auto" : v}`, autoClose: 2000 });
                                          } catch (e: any) {
                                            notifications.show({ color: "red", title: "Error", message: e.message || "Failed to update provider", autoClose: 4000 });
                                          } finally {
                                            setSavingProvider(null);
                                          }
                                        }}
                                        data={[
                                          { label: "Auto",       value: "inherit"    },
                                          { label: "Claude",     value: "anthropic"  },
                                          { label: "DeepSeek",   value: "deepseek"   },
                                          { label: "OpenRouter", value: "openrouter" },
                                        ]}
                                      />
                                      {savingProvider === tk.key && <Loader size={12} />}
                                    </Group>
                                  </Table.Td>
                                  <Table.Td>
                                    <Group gap={4} wrap="nowrap">
                                      <Tooltip label="Reset usage" withArrow>
                                        <ActionIcon variant="subtle" color="gray" size="sm"
                                          loading={rowAction?.key === tk.key && rowAction.act === "reset"}
                                          onClick={() => modals.openConfirmModal({
                                            title: "Reset usage",
                                            children: <Text size="sm">Reset usage counter for <b>{tk.key}</b>?</Text>,
                                            labels: { confirm: "Reset", cancel: "Cancel" },
                                            confirmProps: { color: "gray" },
                                            onConfirm: () => runRowAction(tk.key, "reset", () => adminPost("/admin/reset", { token: tk.key }), "Usage reset"),
                                          })}>
                                          <IconRefresh size={ACT} />
                                        </ActionIcon>
                                      </Tooltip>
                                      <Tooltip label="Edit limit" withArrow>
                                        <ActionIcon variant="subtle" color="gray" size="sm"
                                          onClick={() => setEditLimit(tk)}>
                                          <IconPencil size={ACT} />
                                        </ActionIcon>
                                      </Tooltip>
                                      <Tooltip label={tk.paused ? "Resume" : "Pause"} withArrow>
                                        <ActionIcon variant="subtle" color={tk.paused ? "teal" : "orange"} size="sm"
                                          loading={rowAction?.key === tk.key && rowAction.act === "pause"}
                                          onClick={() => runRowAction(tk.key, "pause", () => adminPost("/admin/token/pause", { token: tk.key }), tk.paused ? "Token resumed" : "Token paused")}>
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
                                          loading={rowAction?.key === tk.key && rowAction.act === "delete"}
                                          onClick={() => modals.openConfirmModal({
                                            title: "Delete token",
                                            children: <Text size="sm">Delete <b>{tk.key}</b>? Clients using this token will get 401.</Text>,
                                            labels: { confirm: "Delete", cancel: "Cancel" },
                                            confirmProps: { color: "red" },
                                            onConfirm: () => runRowAction(tk.key, "delete", () => adminPost("/admin/token/delete", { token: tk.key }), "Token deleted"),
                                          })}>
                                          <IconTrash size={ACT} />
                                        </ActionIcon>
                                      </Tooltip>
                                    </Group>
                                  </Table.Td>
                                </Table.Tr>
                              ))}
                            </Table.Tbody>
                          </Table>
                        </Box>
                      )}
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              );
            })}
          </Accordion>
        )}
      </Stack>
    </Stack>
  );
}
