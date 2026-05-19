import { useState, useMemo } from "react";
import {
  Box, Group, Stack, Text, Button, TextInput, Select, Badge, ActionIcon,
  Pagination, Paper, Divider, Title, Tooltip, Center, ThemeIcon,
} from "@mantine/core";
import {
  IconBell, IconSearch, IconTrash, IconChecks, IconBellOff, IconChevronLeft,
  IconSortAscending, IconSortDescending,
} from "@tabler/icons-react";
import { useNotifications, type AppNotification } from "../contexts";
import { fmtRel } from "../utils";

const PAGE_SIZE = 20;

const COLOR_STYLE: Record<string, { bg: string; border: string; dot: string }> = {
  red:    { bg: "var(--mantine-color-red-light)",    border: "var(--mantine-color-red-4)",    dot: "var(--mantine-color-red-6)" },
  orange: { bg: "var(--mantine-color-orange-light)", border: "var(--mantine-color-orange-4)", dot: "var(--mantine-color-orange-6)" },
  teal:   { bg: "var(--mantine-color-teal-light)",   border: "var(--mantine-color-teal-4)",   dot: "var(--mantine-color-teal-6)" },
  blue:   { bg: "var(--mantine-color-blue-light)",   border: "var(--mantine-color-blue-4)",   dot: "var(--mantine-color-blue-6)" },
};

function NotificationRow({ n }: { n: AppNotification }) {
  const cs = COLOR_STYLE[n.color] ?? COLOR_STYLE.blue;
  return (
    <Paper
      withBorder radius="md" px="md" py="sm"
      style={{
        borderColor: n.read ? "var(--cp-border)" : cs.border,
        background: n.read ? undefined : cs.bg,
        transition: "background 0.2s",
      }}
    >
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <Box
          style={{
            width: 8, height: 8, borderRadius: "50%", marginTop: 6, flexShrink: 0,
            background: n.read ? "var(--cp-text-3)" : cs.dot,
          }}
        />
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Group justify="space-between" gap="xs" wrap="nowrap">
            <Text fz={13} fw={600} style={{ letterSpacing: "-0.01em" }}>{n.title}</Text>
            <Text fz={11} c="dimmed" ff="Geist Mono, monospace" style={{ flexShrink: 0 }}>
              {fmtRel(n.ts)}
            </Text>
          </Group>
          <Text fz={12} c="dimmed" mt={2} style={{ wordBreak: "break-word" }}>{n.message}</Text>
        </Box>
      </Group>
    </Paper>
  );
}

type SortKey = "newest" | "oldest" | "unread";

export function NotificationsPage({ isSuperAdmin = false }: { isSuperAdmin?: boolean }) {
  const { items, unread, markAllRead, clearAll } = useNotifications();
  const [search, setSearch] = useState("");
  const [sort, setSort]     = useState<SortKey>("newest");
  const [page, setPage]     = useState(1);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q
      ? items.filter(n => n.title.toLowerCase().includes(q) || n.message.toLowerCase().includes(q))
      : [...items];

    if (sort === "newest")  list.sort((a, b) => b.ts - a.ts);
    if (sort === "oldest")  list.sort((a, b) => a.ts - b.ts);
    if (sort === "unread")  list.sort((a, b) => {
      if (a.read !== b.read) return a.read ? 1 : -1;
      return b.ts - a.ts;
    });
    return list;
  }, [items, search, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function handleSearch(v: string) { setSearch(v); setPage(1); }
  function handleSort(v: string | null) { if (v) { setSort(v as SortKey); setPage(1); } }

  return (
    <Box px={{ base: 12, sm: 24 }} pt="xl" pb="xl" style={{ maxWidth: 900, margin: "0 auto" }}>
      <Stack gap="lg">
        {/* Header */}
        <Group justify="space-between" wrap="wrap" gap="sm">
          <Group gap="sm">
            <Button
              component="a" href="/" variant="subtle" size="xs" radius="lg"
              leftSection={<IconChevronLeft size={13} />}
              style={{ fontWeight: 600, fontSize: 12, color: "var(--cp-text-2)" }}
            >
              Kembali
            </Button>
            <Divider orientation="vertical" />
            <Group gap={8}>
              <ThemeIcon size="sm" variant="light" color="blue" radius="md">
                <IconBell size={14} />
              </ThemeIcon>
              <Title order={5} style={{ letterSpacing: "-0.02em" }}>Notifikasi</Title>
              {unread > 0 && (
                <Badge size="sm" color="red" variant="filled" circle>{unread}</Badge>
              )}
            </Group>
          </Group>

          <Group gap="xs">
            {unread > 0 && (
              <Tooltip label="Tandai semua sudah dibaca" withArrow position="bottom">
                <Button size="xs" variant="light" color="teal" radius="lg"
                  leftSection={<IconChecks size={13} />}
                  onClick={markAllRead}>
                  Baca semua
                </Button>
              </Tooltip>
            )}
            {isSuperAdmin && items.length > 0 && (
              <Tooltip label="Hapus semua notifikasi" withArrow position="bottom">
                <Button size="xs" variant="light" color="red" radius="lg"
                  leftSection={<IconTrash size={13} />}
                  onClick={clearAll}>
                  Hapus semua
                </Button>
              </Tooltip>
            )}
          </Group>
        </Group>

        {/* Search + Sort bar */}
        <Group gap="sm" wrap="nowrap">
          <TextInput
            placeholder="Cari notifikasi..."
            value={search}
            onChange={e => handleSearch(e.currentTarget.value)}
            leftSection={<IconSearch size={14} />}
            radius="lg" size="sm"
            style={{ flex: 1 }}
          />
          <Select
            value={sort}
            onChange={handleSort}
            data={[
              { value: "newest", label: "Terbaru" },
              { value: "oldest", label: "Terlama" },
              { value: "unread", label: "Belum dibaca" },
            ]}
            leftSection={sort === "oldest" ? <IconSortAscending size={14} /> : <IconSortDescending size={14} />}
            radius="lg" size="sm"
            style={{ width: 160, flexShrink: 0 }}
          />
        </Group>

        {/* Stats row */}
        <Group gap="lg" wrap="wrap">
          <Text fz={12} c="dimmed">
            <Text span fw={600} c="inherit">{items.length}</Text> total
          </Text>
          <Text fz={12} c="dimmed">
            <Text span fw={600} c={unread > 0 ? "red" : "inherit"}>{unread}</Text> belum dibaca
          </Text>
          {search && (
            <Text fz={12} c="dimmed">
              <Text span fw={600} c="blue">{filtered.length}</Text> hasil pencarian
            </Text>
          )}
        </Group>

        <Divider />

        {/* List */}
        {paginated.length === 0 ? (
          <Center py={60}>
            <Stack align="center" gap="xs">
              <ThemeIcon size={48} variant="light" color="gray" radius="xl">
                <IconBellOff size={24} />
              </ThemeIcon>
              <Text c="dimmed" fz={13} ta="center">
                {search ? "Tidak ada notifikasi yang cocok" : "Belum ada notifikasi"}
              </Text>
            </Stack>
          </Center>
        ) : (
          <Stack gap="xs">
            {paginated.map(n => <NotificationRow key={n.id} n={n} />)}
          </Stack>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <Group justify="center" pt="sm">
            <Pagination
              total={totalPages} value={page} onChange={setPage}
              size="sm" radius="lg"
            />
          </Group>
        )}
      </Stack>
    </Box>
  );
}
