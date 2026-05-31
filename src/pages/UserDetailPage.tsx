import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Stack, Text, Group, Paper, TextInput, Textarea, Box, Badge, Button,
  ActionIcon, Tooltip, Alert, Divider, Anchor,
} from "@mantine/core";
import {
  IconArrowLeft, IconPlayerPause, IconCheck, IconBan, IconTrash,
  IconAlertTriangle, IconPlus, IconLockOpen, IconHourglass, IconExternalLink,
} from "@tabler/icons-react";
import { adminPost, fmtRel } from "../utils";
import { notifications } from "@mantine/notifications";
import { modals } from "@mantine/modals";
import { UserAvatar } from "../components/UserAvatar";
import { AddTokenModal } from "../components/admin/UserModals";
import type { ApiUser, ApiToken } from "../components/admin/UserModals";

function nf(n: number) { return n.toLocaleString(); }

const STATUS_COLOR: Record<string, string> = { approved: "teal", pending: "yellow", blocked: "red" };

export function UserDetailPage({ userId }: { userId: string }) {
  const navigate = useNavigate();

  const [u, setU]           = useState<ApiUser | null>(null);
  const [fetching, setFetching] = useState(true);
  const [addToken, setAddToken] = useState(false);

  const reload = useCallback(async () => {
    try {
      const d = await (await fetch("/api/admin/users")).json();
      const users: ApiUser[] = d.users ?? d;
      setU(users.find(x => x.id === userId) ?? null);
    } catch { setU(null); }
    finally { setFetching(false); }
  }, [userId]);

  useEffect(() => { reload(); }, [reload]);

  const [name, setName]   = useState("");
  const [email, setEmail] = useState("");
  const [desc, setDesc]   = useState("");
  useEffect(() => {
    if (!u) return;
    setName(u.name); setEmail(u.email || ""); setDesc(u.description || "");
  }, [u]);

  const [savingProfile, setSavingProfile] = useState(false);
  const [statusBusy, setStatusBusy]       = useState<string | null>(null);

  const profileDirty = u && (name !== u.name || desc !== (u.description || "") || email !== (u.email || ""));

  const saveProfile = async () => {
    if (!u || !name.trim()) return;
    setSavingProfile(true);
    try {
      await fetch(`/api/admin/users/${encodeURIComponent(u.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: desc }),
      });
      if (email.trim() && email.trim() !== (u.email || "")) {
        await adminPost("/admin/user/set-email", { user_id: u.id, email: email.trim() });
      }
      await reload();
      notifications.show({ color: "teal", message: "User updated", autoClose: 2000 });
    } catch {
      notifications.show({ color: "red", message: "Failed to update user", autoClose: 3000 });
    } finally { setSavingProfile(false); }
  };

  const setStatus = async (status: "approved" | "blocked" | "pending") => {
    if (!u) return;
    setStatusBusy(status);
    try {
      await adminPost("/admin/user/set-status", { user_id: u.id, status });
      await reload();
    } catch {
      notifications.show({ color: "red", message: "Failed", autoClose: 3000 });
    } finally { setStatusBusy(null); }
  };

  const doDelete = () => {
    if (!u) return;
    modals.openConfirmModal({
      title: "Delete User",
      children: <Text size="sm">Delete <b>{u.name}</b>? All {u.tokens.length} token{u.tokens.length !== 1 ? "s" : ""} will also be deleted.</Text>,
      labels: { confirm: "Delete", cancel: "Cancel" },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        await fetch(`/api/admin/users/${encodeURIComponent(u.id)}`, { method: "DELETE" });
        notifications.show({ color: "teal", message: "User deleted", autoClose: 2000 });
        navigate("/admin");
      },
    });
  };

  const unblockContext = async () => {
    if (!u) return;
    await adminPost("/admin/user/unblock-context", { user_id: u.id });
    reload();
  };

  const forceGrace = async () => {
    if (!u) return;
    await adminPost("/admin/user/context-grace", { user_id: u.id });
    reload();
  };

  if (fetching) return <Text size="sm" c="dimmed">Loading…</Text>;
  if (!u)       return <Stack gap="xs"><Text>User not found.</Text><Button size="xs" variant="subtle" onClick={() => navigate("/admin")}>Back</Button></Stack>;

  const graceActive = !!(u.context_block_grace_until && u.context_block_grace_until > Date.now());

  return (
    <>
      {addToken && <AddTokenModal user={u} onClose={() => setAddToken(false)} onDone={reload} />}
      <Stack gap="md" maw={640}>
        {/* Header */}
        <Group gap="xs" align="center">
          <ActionIcon variant="subtle" color="gray" onClick={() => navigate("/admin")}><IconArrowLeft size={16} /></ActionIcon>
          <UserAvatar name={u.name} size={28} />
          <Text fw={600}>{u.name}</Text>
          <Badge size="xs" color={STATUS_COLOR[u.status] || "gray"} variant="light">{u.status}</Badge>
          {u.role !== "USER" && <Badge size="xs" color="blue" variant="filled">{u.role}</Badge>}
        </Group>

        {/* Context block alert */}
        {u.context_blocked_at && (
          <Alert color={graceActive ? "yellow" : "red"} variant="light" icon={<IconAlertTriangle size={14} />} p="sm">
            <Group justify="space-between" wrap="nowrap" gap="xs">
              <Stack gap={2}>
                <Text size="xs" fw={700}>{graceActive ? "⏳ Grace aktif" : "⛔ Context Block aktif"}</Text>
                <Text size="xs" c="dimmed">{u.context_block_reason}</Text>
              </Stack>
              <Group gap={4} wrap="nowrap">
                <Button size="xs" color="yellow" variant="light" leftSection={<IconHourglass size={11} />} onClick={forceGrace}>30m Grace</Button>
                <Button size="xs" color="red" variant="filled" leftSection={<IconLockOpen size={11} />} onClick={unblockContext}>Unblock</Button>
              </Group>
            </Group>
          </Alert>
        )}

        {/* Profile */}
        <Paper withBorder p="sm" radius="sm">
          <Stack gap="xs">
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: ".05em" }}>Profile</Text>
            <TextInput label="Name" value={name} onChange={e => setName(e.currentTarget.value)} />
            <TextInput label="Google Email" value={email} onChange={e => setEmail(e.currentTarget.value)}
              placeholder="user@gmail.com" description="Links this user to a Google OAuth account" />
            <Textarea label="Description" rows={2} value={desc} onChange={e => setDesc(e.currentTarget.value)} placeholder="Optional notes" />
            <Group gap="xs" wrap="wrap">
              <Box><Text size="xs" c="dimmed">Joined</Text><Text size="xs">{fmtRel(u.created_at)}</Text></Box>
              <Box><Text size="xs" c="dimmed">ID</Text><Text size="xs" ff="monospace">{u.id}</Text></Box>
            </Group>
            {profileDirty && (
              <Group justify="flex-end">
                <Button size="xs" variant="subtle" onClick={() => { setName(u.name); setEmail(u.email || ""); setDesc(u.description || ""); }}>Revert</Button>
                <Button size="xs" color="teal" loading={savingProfile} onClick={saveProfile}>Save</Button>
              </Group>
            )}
          </Stack>
        </Paper>

        {/* Tokens */}
        <Paper withBorder p="sm" radius="sm">
          <Stack gap="xs">
            <Group justify="space-between">
              <Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: ".05em" }}>Tokens ({u.tokens.length})</Text>
              <Button size="xs" variant="light" color="blue" leftSection={<IconPlus size={11} />} onClick={() => setAddToken(true)}>Add</Button>
            </Group>
            {u.tokens.length === 0 && <Text size="xs" c="dimmed">No tokens yet.</Text>}
            {u.tokens.map((tk: ApiToken) => (
              <TokenRow key={tk.key} tk={tk} onOpen={() => navigate("/admin/token/" + encodeURIComponent(tk.key))} />
            ))}
          </Stack>
        </Paper>

        {/* Actions */}
        <Paper withBorder p="sm" radius="sm">
          <Stack gap="xs">
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: ".05em" }}>Actions</Text>
            <Group gap="xs" wrap="wrap">
              {u.status !== "approved" && (
                <Button size="xs" variant="light" color="teal" leftSection={<IconCheck size={13} />}
                  loading={statusBusy === "approved"} onClick={() => setStatus("approved")}>
                  Approve
                </Button>
              )}
              {u.status !== "blocked" && (
                <Button size="xs" variant="light" color="orange" leftSection={<IconBan size={13} />}
                  loading={statusBusy === "blocked"} onClick={() => setStatus("blocked")}>
                  Block
                </Button>
              )}
              {u.status !== "pending" && (
                <Button size="xs" variant="subtle" color="gray" leftSection={<IconPlayerPause size={13} />}
                  loading={statusBusy === "pending"} onClick={() => setStatus("pending")}>
                  Set Pending
                </Button>
              )}
              <Button size="xs" variant="light" color="red" leftSection={<IconTrash size={13} />} onClick={doDelete}>
                Delete User
              </Button>
            </Group>
          </Stack>
        </Paper>
      </Stack>
    </>
  );
}

function TokenRow({ tk, onOpen }: { tk: ApiToken; onOpen: () => void }) {
  const pct = tk.limit === null ? 0 : Math.min(100, Math.round((tk.used / tk.limit) * 100));
  const color = tk.paused ? "gray" : pct >= 95 ? "red" : pct >= 75 ? "orange" : "teal";
  return (
    <Group justify="space-between" wrap="nowrap" gap="xs"
      style={{ padding: "6px 8px", borderRadius: 6, background: "var(--mantine-color-default-hover)", cursor: "pointer" }}
      onClick={onOpen}>
      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Group gap={4} wrap="nowrap">
          <Text size="xs" ff="monospace" truncate style={{ flex: 1 }}>{tk.label || tk.key.slice(-12)}</Text>
          {tk.paused && <Badge size="xs" color="gray" variant="light">paused</Badge>}
        </Group>
        <Text size="xs" c="dimmed" ff="monospace">{nf(tk.used)} / {tk.limit === null ? "∞" : nf(tk.limit)} tokens · {pct}%</Text>
      </Stack>
      <Tooltip label="Token Details" withArrow>
        <ActionIcon size="xs" variant="subtle" color={color} onClick={e => { e.stopPropagation(); onOpen(); }}>
          <IconExternalLink size={13} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
