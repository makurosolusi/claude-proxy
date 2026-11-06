import { useState } from "react";
import { Paper, Group, Text, Badge, ActionIcon, Tooltip, ThemeIcon, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconKey, IconPlayerStop, IconPlayerPlay, IconPin, IconPinnedOff,
  IconPencil, IconCheck, IconX, IconAt,
} from "@tabler/icons-react";
import { fmtRel } from "../../utils";

export interface CredentialInfo {
  file: string; email: string; disabled: boolean; active: boolean;
  pinned: boolean; serving: boolean;
  label: string; created_at: string | null; last_refresh: string | null;
  last_used_at: string | null; email_resolved: boolean;
}

interface Props {
  cred: CredentialInfo;
  activating: string | null;
  toggling: string | null;
  onActivate: (email: string) => void;
  onSetDisabled: (file: string, disabled: boolean) => void;
  onChanged: () => void;
}

const LABEL_MAX = 60;

async function postJson(url: string, body: unknown): Promise<any> {
  const r = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    credentials: "include", body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({})) as any;
  if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

function Stamp({ prefix, iso, fallback }: { prefix: string; iso: string | null; fallback?: string }) {
  if (!iso) return fallback ? <Text span size="xs" c="dimmed">{prefix} {fallback}</Text> : null;
  const t = new Date(iso).getTime();
  return (
    <Tooltip label={new Date(t).toLocaleString()} withArrow>
      <Text span size="xs" c="dimmed">{prefix} {fmtRel(t)}</Text>
    </Tooltip>
  );
}

export function CredentialRow({ cred: c, activating, toggling, onActivate, onSetDisabled, onChanged }: Props) {
  const [editing, setEditing]     = useState(false);
  const [draft, setDraft]         = useState("");
  const [saving, setSaving]       = useState(false);
  const [resolving, setResolving] = useState(false);

  const startEdit = () => { setDraft(c.label); setEditing(true); };

  const saveLabel = async () => {
    setSaving(true);
    try {
      await postJson("/api/admin/credentials/label", { file: c.file, label: draft.trim() });
      setEditing(false);
      onChanged();
    } catch (e: any) {
      notifications.show({ color: "red", message: `Failed to save label: ${e.message}` });
    } finally { setSaving(false); }
  };

  const resolveEmail = async () => {
    setResolving(true);
    try {
      const d = await postJson("/api/admin/credentials/resolve-email", { file: c.file });
      notifications.show({
        color: d.changed ? "teal" : "yellow", autoClose: 3000,
        message: d.changed ? `Email resolved: ${d.email}` : "Email unchanged",
      });
      onChanged();
    } catch (e: any) {
      notifications.show({
        color: "red", autoClose: 6000,
        message: `Could not resolve email: ${e.message}. Set a label instead to identify this account.`,
      });
    } finally { setResolving(false); }
  };

  return (
    <Paper withBorder p="sm" radius="md" style={{ opacity: c.active ? 1 : 0.5 }}>
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
          <ThemeIcon variant="light" color={c.active ? "teal" : "gray"} size="md" radius="md">
            <IconKey size={16} />
          </ThemeIcon>
          <div style={{ minWidth: 0, flex: 1 }}>
            {editing ? (
              <Group gap={4} wrap="nowrap">
                <TextInput
                  size="xs" autoFocus maxLength={LABEL_MAX} placeholder="Label (empty = clear)"
                  value={draft} onChange={e => setDraft(e.currentTarget.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") saveLabel();
                    if (e.key === "Escape") setEditing(false);
                  }}
                  style={{ flex: 1 }}
                />
                <ActionIcon size="sm" variant="subtle" color="teal" loading={saving} onClick={saveLabel}>
                  <IconCheck size={14} />
                </ActionIcon>
                <ActionIcon size="sm" variant="subtle" color="gray" disabled={saving} onClick={() => setEditing(false)}>
                  <IconX size={14} />
                </ActionIcon>
              </Group>
            ) : (
              <Group gap={6} wrap="nowrap">
                <Text fw={500} size="sm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.label || c.email}
                </Text>
                {!c.email_resolved && <Badge size="xs" color="orange" variant="light">email unknown</Badge>}
              </Group>
            )}
            {c.label && <Text size="xs" c="dimmed" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{c.email}</Text>}
            <Text size="xs" c="dimmed" ff="monospace">{c.file}</Text>
            <Group gap="xs" mt={2}>
              <Stamp prefix="Login" iso={c.created_at} />
              <Stamp prefix="Last used" iso={c.last_used_at} fallback="never" />
              <Stamp prefix="Refreshed" iso={c.last_refresh} />
            </Group>
          </div>
        </Group>
        <Group gap="xs" wrap="nowrap">
          {c.serving && <Badge size="sm" color="green" variant="filled">serving</Badge>}
          {c.pinned  && <Badge size="sm" color="blue"  variant="light">pinned</Badge>}
          <Badge size="sm" color={c.active ? "teal" : "gray"} variant="light">
            {c.active ? "active" : "disabled"}
          </Badge>
          {!editing && (
            <Tooltip label="Edit label" withArrow>
              <ActionIcon size="sm" variant="subtle" color="gray" onClick={startEdit}>
                <IconPencil size={14} />
              </ActionIcon>
            </Tooltip>
          )}
          {!c.email_resolved && (
            <Tooltip label="Resolve email from Anthropic" withArrow>
              <ActionIcon size="sm" variant="subtle" color="orange" loading={resolving} onClick={resolveEmail}>
                <IconAt size={14} />
              </ActionIcon>
            </Tooltip>
          )}
          {c.active && (
            <Tooltip label={c.pinned ? "Back to auto" : "Use this account"} withArrow>
              <ActionIcon
                size="sm" variant="subtle" color={c.pinned ? "gray" : "blue"}
                loading={activating === (c.pinned ? "auto" : c.email)}
                onClick={() => onActivate(c.pinned ? "" : c.email)}
              >
                {c.pinned ? <IconPinnedOff size={14} /> : <IconPin size={14} />}
              </ActionIcon>
            </Tooltip>
          )}
          <Tooltip label={c.active ? "Disable credential" : "Enable credential"} withArrow>
            <ActionIcon
              size="sm" variant="subtle" color={c.active ? "red" : "teal"}
              loading={toggling === c.file}
              onClick={() => onSetDisabled(c.file, c.active)}
            >
              {c.active ? <IconPlayerStop size={14} /> : <IconPlayerPlay size={14} />}
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
    </Paper>
  );
}
