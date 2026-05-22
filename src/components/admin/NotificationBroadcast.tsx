import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Stack, Text, Group, Paper, Textarea, ThemeIcon, Modal, Button, Radio,
  MultiSelect, Badge, ActionIcon, Tooltip, ScrollArea, Divider, Select,
} from "@mantine/core";
import {
  IconSend, IconTrash, IconUsers, IconUserCheck, IconBell, IconTerminal2, IconLayoutDashboard,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { modals } from "@mantine/modals";
import type { ApiUser } from "./UserModals";

type DeliverVia = "web" | "terminal" | "both";
type Priority   = "info" | "warning" | "critical";

type SentNotification = {
  id: string;
  message: string;
  created_at: number;
  created_by: string;
  target_type: "all" | "specific";
  target_ids: string[];
  dismissed_count: number;
  deliver_via: DeliverVia;
  priority:    Priority;
};

const DELIVER_LABEL: Record<DeliverVia, string> = {
  web:      "Web modal",
  terminal: "CLI inject",
  both:     "Web + CLI",
};
const DELIVER_COLOR: Record<DeliverVia, string> = {
  web: "blue", terminal: "orange", both: "violet",
};
const PRIORITY_COLOR: Record<Priority, string> = {
  info: "gray", warning: "yellow", critical: "red",
};

const MAX_LEN = 4000;

export function NotificationBroadcast({ apiUsers }: { apiUsers: ApiUser[] | null }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<SentNotification[] | null>(null);

  const reload = useCallback(async () => {
    const r = await fetch("/api/admin/notifications", { credentials: "include" });
    if (!r.ok) { setList([]); return; }
    const d = await r.json();
    setList(d.notifications ?? []);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const onDelete = (n: SentNotification) => {
    modals.openConfirmModal({
      title: "Delete notification",
      children: <Text size="sm">Hapus pemberitahuan ini? User yang belum close akan langsung kehilangan modal-nya.</Text>,
      labels: { confirm: "Delete", cancel: "Cancel" },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        const r = await fetch(`/api/admin/notifications/${encodeURIComponent(n.id)}`, {
          method: "DELETE", credentials: "include",
        });
        if (r.ok) {
          notifications.show({ color: "teal", message: "Notification deleted", autoClose: 2000 });
          reload();
        } else {
          notifications.show({ color: "red", message: "Failed to delete", autoClose: 3000 });
        }
      },
    });
  };

  return (
    <>
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="md">
          <Group gap="sm" wrap="nowrap" align="flex-start">
            <ThemeIcon variant="light" color="grape" size="lg" radius="md"><IconBell size={18} /></ThemeIcon>
            <div>
              <Text size="sm" fw={700}>Broadcast Notification</Text>
              <Text size="xs" c="dimmed" mt={2}>
                Kirim pemberitahuan modal ke semua user atau user tertentu. Realtime via WebSocket.
              </Text>
            </div>
          </Group>
          <Button leftSection={<IconSend size={14} />} variant="light" color="grape" onClick={() => setOpen(true)}>
            Send Notification
          </Button>
        </Group>

        {list && list.length > 0 && (
          <>
            <Divider my="sm" />
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb="xs" style={{ letterSpacing: ".08em" }}>
              Sent ({list.length})
            </Text>
            <ScrollArea.Autosize mah={240}>
              <Stack gap="xs">
                {list.map(n => (
                  <Paper key={n.id} withBorder p="sm" radius="sm">
                    <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
                      <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                        <Group gap="xs" wrap="wrap">
                          {n.target_type === "all"
                            ? <Badge size="xs" color="grape" variant="light" leftSection={<IconUsers size={11} />}>All users</Badge>
                            : <Badge size="xs" color="blue"  variant="light" leftSection={<IconUserCheck size={11} />}>{n.target_ids.length} user(s)</Badge>}
                          <Badge size="xs" color={DELIVER_COLOR[n.deliver_via]} variant="light"
                            leftSection={n.deliver_via === "terminal" ? <IconTerminal2 size={11} /> : <IconLayoutDashboard size={11} />}>
                            {DELIVER_LABEL[n.deliver_via]}
                          </Badge>
                          {n.priority !== "info" && (
                            <Badge size="xs" color={PRIORITY_COLOR[n.priority]} variant="filled">
                              {n.priority.toUpperCase()}
                            </Badge>
                          )}
                          <Text size="xs" c="dimmed">{new Date(n.created_at).toLocaleString()}</Text>
                          <Text size="xs" c="dimmed">· {n.dismissed_count} dismissed</Text>
                        </Group>
                        <Text size="sm" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                          {n.message}
                        </Text>
                      </Stack>
                      <Tooltip label="Delete">
                        <ActionIcon variant="subtle" color="red" onClick={() => onDelete(n)}>
                          <IconTrash size={15} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Paper>
                ))}
              </Stack>
            </ScrollArea.Autosize>
          </>
        )}
      </Paper>

      {open && (
        <NotificationComposeModal
          apiUsers={apiUsers}
          onClose={() => setOpen(false)}
          onSent={() => { setOpen(false); reload(); }}
        />
      )}
    </>
  );
}

function NotificationComposeModal({
  apiUsers, onClose, onSent,
}: { apiUsers: ApiUser[] | null; onClose: () => void; onSent: () => void }) {
  const [message, setMessage]     = useState("");
  const [target, setTarget]       = useState<"all" | "specific">("all");
  const [selected, setSelected]   = useState<string[]>([]);
  const [deliverVia, setDeliverVia] = useState<DeliverVia>("web");
  const [priority, setPriority]   = useState<Priority>("info");
  const [sending, setSending]     = useState(false);

  const userOptions = useMemo(() => {
    if (!apiUsers) return [];
    return apiUsers.map(u => ({
      value: u.id,
      label: `${u.name}${u.email ? ` · ${u.email}` : ""}`,
    }));
  }, [apiUsers]);

  const canSend =
    message.trim().length > 0 &&
    message.length <= MAX_LEN &&
    (target === "all" || selected.length > 0);

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const r = await fetch("/api/admin/notifications", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message.trim(),
          target_type: target,
          target_ids: target === "specific" ? selected : undefined,
          deliver_via: deliverVia,
          priority,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        notifications.show({ color: "red", title: "Failed", message: d?.error || "Failed to send", autoClose: 4000 });
        return;
      }
      notifications.show({ color: "teal", message: "Notification sent", autoClose: 2000 });
      onSent();
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal opened onClose={onClose} title="Send Notification" size="lg">
      <Stack gap="md">
        <div>
          <Text size="xs" fw={600} c="dimmed" mb={4}>Target</Text>
          <Radio.Group value={target} onChange={v => setTarget(v as "all" | "specific")}>
            <Stack gap={6}>
              <Radio value="all" label={<Group gap={6}><IconUsers size={14} /><Text size="sm">All users</Text></Group>} />
              <Radio value="specific" label={<Group gap={6}><IconUserCheck size={14} /><Text size="sm">Pilih user tertentu</Text></Group>} />
            </Stack>
          </Radio.Group>
        </div>

        {target === "specific" && (
          <MultiSelect
            label="Pilih user"
            placeholder={apiUsers ? "Cari nama / email…" : "Memuat user…"}
            data={userOptions}
            value={selected}
            onChange={setSelected}
            searchable
            clearable
            disabled={!apiUsers}
            nothingFoundMessage="No match"
            maxDropdownHeight={240}
          />
        )}

        <Textarea
          label="Message"
          placeholder="Tulis pemberitahuan untuk user…"
          value={message}
          onChange={e => setMessage(e.currentTarget.value)}
          autosize
          minRows={4}
          maxRows={12}
          error={message.length > MAX_LEN ? `Max ${MAX_LEN} chars (${message.length})` : undefined}
          description={`${message.length}/${MAX_LEN}`}
        />

        <Group grow align="flex-start">
          <Select
            label="Deliver via"
            description="Web = modal di dashboard. CLI = injeksi ke response terminal Claude Code."
            value={deliverVia}
            onChange={v => setDeliverVia((v as DeliverVia) || "web")}
            data={[
              { value: "web",      label: "Web modal only" },
              { value: "terminal", label: "CLI terminal only" },
              { value: "both",     label: "Web + CLI" },
            ]}
            allowDeselect={false}
          />
          <Select
            label="Priority"
            description="Affect icon + label di terminal (📢/⚠️/🚨)"
            value={priority}
            onChange={v => setPriority((v as Priority) || "info")}
            data={[
              { value: "info",     label: "Info (📢)" },
              { value: "warning",  label: "Warning (⚠️)" },
              { value: "critical", label: "Critical (🚨)" },
            ]}
            allowDeselect={false}
          />
        </Group>

        {(deliverVia === "terminal" || deliverVia === "both") && (
          <Paper withBorder p="xs" radius="sm" bg="var(--mantine-color-yellow-light)" style={{ borderColor: "var(--mantine-color-yellow-4)" }}>
            <Group gap={6} wrap="nowrap" align="flex-start">
              <IconTerminal2 size={14} color="var(--mantine-color-yellow-7)" />
              <Text size="xs" c="dimmed" style={{ lineHeight: 1.5 }}>
                Pesan akan disisipkan ke <Text span fw={700}>response /v1/messages</Text> berikutnya untuk
                setiap user target. Tidak akan double-deliver (tracking per user). Otomatis
                di-skip kalau request adalah tool_result continuation atau response berisi tool_use.
              </Text>
            </Group>
          </Paper>
        )}

        <Group justify="flex-end" mt="xs">
          <Button variant="subtle" color="gray" onClick={onClose}>Cancel</Button>
          <Button color="grape" leftSection={<IconSend size={14} />} loading={sending} disabled={!canSend} onClick={send}>
            Send
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
