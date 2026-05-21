import { useState, useEffect, useCallback, useRef } from "react";
import { Modal, Text, Group, Button, ThemeIcon, Badge, Stack } from "@mantine/core";
import { IconBell, IconX } from "@tabler/icons-react";

type PendingNotification = {
  id: string;
  message: string;
  created_at: number;
  created_by: string;
  target_type: "all" | "specific";
  target_ids: string[];
};

// Centered, attention-grabbing modal that surfaces admin broadcasts to users.
// One notification at a time, oldest-first; closing dismisses on the server
// and (if more remain) advances to the next.
export function UserNotificationModal({ refreshSignal }: { refreshSignal: number }) {
  const [queue, setQueue]       = useState<PendingNotification[]>([]);
  const [busy, setBusy]         = useState(false);
  const inflight                = useRef(false);

  const reload = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const r = await fetch("/api/notifications/pending", { credentials: "include" });
      if (!r.ok) { setQueue([]); return; }
      const d = await r.json();
      const list: PendingNotification[] = Array.isArray(d.notifications) ? d.notifications : [];
      setQueue(list);
    } catch { setQueue([]); }
    finally { inflight.current = false; }
  }, []);

  useEffect(() => { reload(); }, [reload, refreshSignal]);

  const current = queue[0] ?? null;

  const dismiss = async () => {
    if (!current || busy) return;
    setBusy(true);
    try {
      await fetch(`/api/notifications/${encodeURIComponent(current.id)}/dismiss`, {
        method: "POST", credentials: "include",
      });
      setQueue(prev => prev.slice(1));
    } finally { setBusy(false); }
  };

  if (!current) return null;

  return (
    <Modal
      opened
      onClose={dismiss}
      withCloseButton={false}
      centered
      size="lg"
      padding="xl"
      radius="md"
      overlayProps={{ backgroundOpacity: 0.55, blur: 3 }}
      closeOnClickOutside={false}
      closeOnEscape={false}
      title={
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon variant="light" color="grape" size="lg" radius="md"><IconBell size={20} /></ThemeIcon>
          <div>
            <Text fw={700} size="md">Pemberitahuan dari Admin</Text>
            <Text size="xs" c="dimmed">{new Date(current.created_at).toLocaleString()}</Text>
          </div>
        </Group>
      }
    >
      <Stack gap="lg">
        <Text size="md" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6 }}>
          {current.message}
        </Text>

        <Group justify="space-between" align="center">
          {queue.length > 1
            ? <Badge variant="light" color="gray" size="sm">+{queue.length - 1} lagi setelah ini</Badge>
            : <div />}
          <Button color="grape" leftSection={<IconX size={14} />} loading={busy} onClick={dismiss}>
            Saya mengerti
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
