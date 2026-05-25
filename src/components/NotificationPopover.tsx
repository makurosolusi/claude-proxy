import { useState } from "react";
import {
  Popover, Tooltip, Indicator, ActionIcon, Box, Group, Badge,
  Text, Stack, ScrollArea, Divider, Button,
} from "@mantine/core";
import { IconBell, IconBellOff, IconChecks, IconExternalLink } from "@tabler/icons-react";
import { useNotifications } from "../contexts";
import { fmtRel } from "../utils";

const NOTIF_COLOR_DOT: Record<string, string> = {
  red: "var(--mantine-color-red-6)", orange: "var(--mantine-color-orange-6)",
  teal: "var(--mantine-color-teal-6)", blue: "var(--mantine-color-blue-6)",
};

export function NotificationPopover() {
  const { items, unread, markAllRead } = useNotifications();
  const [opened, setOpened] = useState(false);
  const recent = items.slice(0, 8);

  return (
    <Popover
      opened={opened} onChange={setOpened}
      position="bottom-end" offset={8} withArrow arrowSize={10}
      shadow="md" radius="md" width={340}
    >
      <Popover.Target>
        <Tooltip label="Notifikasi" position="bottom" withArrow openDelay={600} disabled={opened}>
          <Indicator label={unread > 99 ? "99+" : unread} size={16} disabled={unread === 0} color="red" style={{ display: "flex" }}>
            <ActionIcon variant="subtle" size="md" radius="lg"
              style={{ color: "var(--cp-text-2)" }}
              onClick={() => setOpened(o => !o)}>
              <IconBell size={15} />
            </ActionIcon>
          </Indicator>
        </Tooltip>
      </Popover.Target>

      <Popover.Dropdown p={0} style={{ overflow: "hidden" }}>
        <Group justify="space-between" px={14} py={10} style={{ borderBottom: "1px solid var(--cp-border)" }}>
          <Group gap={8}>
            <IconBell size={14} style={{ color: "var(--cp-text-2)" }} />
            <Text fz={13} fw={700} style={{ letterSpacing: "-0.01em" }}>Notifikasi</Text>
            {unread > 0 && <Badge size="xs" color="red" variant="filled" circle>{unread}</Badge>}
          </Group>
          {unread > 0 && (
            <Tooltip label="Tandai semua dibaca" withArrow>
              <ActionIcon size="xs" variant="subtle" color="teal" onClick={markAllRead}>
                <IconChecks size={13} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>

        {recent.length === 0 ? (
          <Stack align="center" gap={6} py={28}>
            <IconBellOff size={24} style={{ color: "var(--cp-text-3)" }} />
            <Text fz={12} c="dimmed">Belum ada notifikasi</Text>
          </Stack>
        ) : (
          <ScrollArea.Autosize mah={320} scrollbarSize={4}>
            <Stack gap={0}>
              {recent.map((n, i) => (
                <Box key={n.id}>
                  {i > 0 && <Divider />}
                  <Box px={14} py={10}
                    style={{ borderLeft: n.read ? "3px solid transparent" : `3px solid ${NOTIF_COLOR_DOT[n.color] ?? NOTIF_COLOR_DOT.blue}` }}>
                    <Group gap={8} wrap="nowrap" align="flex-start">
                      <Box style={{
                        width: 7, height: 7, borderRadius: "50%", flexShrink: 0, marginTop: 5,
                        background: n.read ? "var(--cp-text-3)" : (NOTIF_COLOR_DOT[n.color] ?? NOTIF_COLOR_DOT.blue),
                        opacity: n.read ? 0.4 : 1,
                      }} />
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Group justify="space-between" gap={4} wrap="nowrap">
                          <Text fz={12} fw={n.read ? 500 : 700} truncate>{n.title}</Text>
                          <Text fz={10} c="dimmed" ff="Geist Mono, monospace" style={{ flexShrink: 0 }}>{fmtRel(n.ts)}</Text>
                        </Group>
                        <Text fz={11} c="dimmed" lineClamp={2} mt={2}>{n.message}</Text>
                      </Box>
                    </Group>
                  </Box>
                </Box>
              ))}
            </Stack>
          </ScrollArea.Autosize>
        )}

        <Box px={14} py={10} style={{ borderTop: "1px solid var(--cp-border)" }}>
          <Button component="a" href="/notifications" variant="light" size="xs" radius="lg" fullWidth
            rightSection={<IconExternalLink size={12} />}
            style={{ fontWeight: 600, fontSize: 12 }}
            onClick={() => setOpened(false)}>
            Lihat semua notifikasi
          </Button>
        </Box>
      </Popover.Dropdown>
    </Popover>
  );
}
