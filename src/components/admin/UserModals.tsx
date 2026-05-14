import { useState } from "react";
import {
  Stack, Text, Group, Paper, TextInput, Textarea,
  ActionIcon, Modal, Button, Alert, Switch,
} from "@mantine/core";
import {
  IconAlertTriangle, IconPlus, IconCopy, IconCheck, IconTrash,
} from "@tabler/icons-react";
import { adminPost } from "../../utils";
import { notifications } from "@mantine/notifications";

export interface ApiToken {
  key: string; name: string; limit: number | null; used: number;
  paused: boolean; dynamic: boolean; today: number; alltime: number; pct: number;
  provider: string;
  label: string; description: string; pinned_model: string;
}
export interface ApiUser {
  id: string; name: string; email: string; description: string; created_at: number;
  role: string; status: "pending" | "approved" | "blocked";
  tokens: ApiToken[];
}

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <ActionIcon variant="subtle" color={copied ? "teal" : "gray"} size="sm"
      onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
      {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
    </ActionIcon>
  );
}

export function EditUserModal({ user, onClose, onSaved }: { user: ApiUser; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email || "");
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
      if (email.trim() && email.trim() !== (user.email || "")) {
        const form = new URLSearchParams();
        form.set("user_id", user.id);
        form.set("email", email.trim());
        await fetch("/admin/user/set-email", { method: "POST", body: form });
      }
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
        <TextInput label="Google Email" value={email} onChange={e => setEmail(e.currentTarget.value)}
          placeholder="user@gmail.com" type="email"
          description="Link this user to a Google account for OAuth login" />
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

export function DeleteUserModal({ user, onClose, onDone }: { user: ApiUser; onClose: () => void; onDone: () => void }) {
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

export function EditAllLimitsModal({ user, onClose, onSaved }: { user: ApiUser; onClose: () => void; onSaved: () => void }) {
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

export function RotateModal({ token, onClose, onDone }: { token: ApiToken; onClose: () => void; onDone: () => void }) {
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

export function AddTokenModal({ user, onClose, onDone }: { user: ApiUser; onClose: () => void; onDone: () => void }) {
  const [key, setKey]             = useState("");
  const [limit, setLimit]         = useState("40000");
  const [unlimited, setUnlimited] = useState(false);
  const [label, setLabel]         = useState("");
  const [description, setDesc]    = useState("");
  const [saving, setSaving]       = useState(false);

  const save = async () => {
    setSaving(true);
    await adminPost("/admin/token/add", {
      token: key.trim(),
      limit: unlimited ? "unlimited" : limit,
      user_id: user.id,
      label: label.trim(),
      description: description.trim(),
    });
    setSaving(false);
    onDone();
    onClose();
  };

  return (
    <Modal opened onClose={onClose} title={`Add Token to ${user.name}`} size="sm">
      <Stack gap="sm">
        <TextInput label="Token key" placeholder="sk-cp-… (leave blank to auto-generate)" value={key} autoFocus
          onChange={e => setKey(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") save(); }} />
        <TextInput label="Label" placeholder={`e.g. ${user.name} — Code review`} value={label}
          description="Display name for this token (falls back to user name if empty)"
          onChange={e => setLabel(e.currentTarget.value)} />
        <Textarea label="Description" placeholder="Optional notes about this token's purpose" rows={2}
          value={description} onChange={e => setDesc(e.currentTarget.value)} />
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


export function EditAllLimitsGlobalModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
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
