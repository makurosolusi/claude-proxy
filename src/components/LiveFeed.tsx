import { useState, useEffect, useCallback, useRef } from "react";
import { Stack, Text, Box, Group, Badge, ScrollArea, Loader, useMantineColorScheme, Modal } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconBolt } from "@tabler/icons-react";
import { DetailContent } from "./tables/RequestLog";
import type { LogEntry } from "../contexts";
import { useStatus } from "../contexts";
import { MAX_LOGS } from "./LiveFeed.helpers";
import { FeedEntry, GroupedEntry, groupLogs } from "./LiveFeed.entries";

interface LiveFeedProps {
  wsSignal?: number;
}

export function LiveFeed({ wsSignal }: LiveFeedProps) {
  const [logs, setLogs]         = useState<LogEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [total, setTotal]       = useState(0);
  const [newIds, setNewIds]     = useState<Set<number>>(new Set());
  const [detail, setDetail]           = useState<LogEntry | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);
  const { colorScheme }         = useMantineColorScheme();
  const dark                    = colorScheme === "dark";
  const viewportRef             = useRef<HTMLDivElement>(null);
  const prevIdsRef              = useRef<Set<number>>(new Set());

  const showDetail = useCallback(async (log: LogEntry) => {
    setDetail(log);
    setDetailLoading(true);
    openModal();
    try {
      const r = await fetch(`/api/logs/${log.id}`);
      if (r.ok) setDetail(await r.json() as LogEntry);
    } finally {
      setDetailLoading(false);
    }
  }, [openModal]);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/logs?page=1&limit=${MAX_LOGS}`);
      if (!r.ok) return;
      const d = await r.json();
      const newLogs: LogEntry[] = d.logs || [];

      const incoming = new Set(newLogs.map(l => l.id));
      const fresh    = new Set<number>();
      for (const id of incoming) {
        if (!prevIdsRef.current.has(id)) fresh.add(id);
      }
      prevIdsRef.current = incoming;

      setLogs(newLogs);
      setTotal(d.total || 0);
      if (fresh.size > 0) {
        setNewIds(fresh);
        setTimeout(() => setNewIds(new Set()), 3000);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [load]);
  useEffect(() => {
    if (wsSignal === undefined) return;
    load();
  }, [wsSignal, load]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || newIds.size === 0) return;
    if (el.scrollTop < 60) el.scrollTo({ top: 0, behavior: "smooth" });
  }, [newIds]);

  const status     = useStatus();
  const [localUserImages, setLocalUserImages] = useState<Record<string, string>>({});
  useEffect(() => {
    fetch("/api/status").then(r => r.ok ? r.json() : null)
      .then(d => d?.userImages && setLocalUserImages(d.userImages))
      .catch(() => {});
  }, []);
  const userImages = (status?.userImages && Object.keys(status.userImages).length > 0)
    ? status.userImages
    : localUserImages;
  const groups    = groupLogs(logs, newIds);
  const errCount  = logs.filter(l => l.status >= 400).length;

  return (
    <Box style={{
      background: "var(--cp-surface)",
      border: "1px solid var(--cp-border)",
      borderRadius: 20,
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      height: "100%",
      minHeight: 0,
    }}>
      <Box style={{
        padding: "12px 14px 10px",
        borderBottom: "1px solid var(--cp-border)",
        flexShrink: 0,
        background: dark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.01)",
      }}>
        <Group justify="space-between" align="center">
          <Group gap={8}>
            <Box className="live-dot" />
            <Text fz={11} fw={700} tt="uppercase" style={{ letterSpacing: ".09em" }}>
              Live Feed
            </Text>
          </Group>
          <Group gap={6}>
            {loading && <Loader size={10} color="teal" />}
            {errCount > 0 && (
              <Badge size="xs" color="red" variant="light" style={{ fontSize: 10 }}>
                {errCount} err
              </Badge>
            )}
            {total > 0 && (
              <Text fz={10} c="dimmed" ff="Geist Mono, monospace">{total.toLocaleString()}</Text>
            )}
          </Group>
        </Group>
      </Box>

      <ScrollArea viewportRef={viewportRef} style={{ flex: 1 }} type="scroll" scrollbarSize={3}>
        {groups.length === 0 && !loading ? (
          <Stack align="center" py={40} gap={8}>
            <Box style={{
              width: 40, height: 40, borderRadius: 12,
              background: "var(--cp-surface-2)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <IconBolt size={18} color="var(--cp-text-3)" />
            </Box>
            <Text fz={12} c="dimmed">Belum ada request</Text>
          </Stack>
        ) : (
          groups.map(group => {
            const imageUrl = group.head.owner_name ? userImages[group.head.owner_name] : undefined;
            return group.entries.length === 1
              ? <FeedEntry
                  key={group.key}
                  log={group.head}
                  isNew={group.hasNew}
                  onClick={() => showDetail(group.head)}
                  imageUrl={imageUrl}
                />
              : <GroupedEntry
                  key={group.key}
                  group={group}
                  newIds={newIds}
                  onEntryClick={showDetail}
                  imageUrl={imageUrl}
                />;
          })
        )}
      </ScrollArea>

      <Box style={{
        padding: "8px 14px",
        borderTop: "1px solid var(--cp-border)",
        flexShrink: 0,
        background: dark ? "rgba(255,255,255,0.01)" : "rgba(0,0,0,0.01)",
      }}>
        <Group gap={6} align="center">
          <Box className="live-dot" style={{ width: 5, height: 5 }} />
          <Text fz={10} c="dimmed" style={{ letterSpacing: ".02em" }}>
            realtime · refresh 10s
          </Text>
        </Group>
      </Box>

      <Modal opened={modalOpened} onClose={closeModal} title="Request Detail" size="lg" centered>
        {detailLoading
          ? <Group justify="center" py="xl"><Loader size="sm" /></Group>
          : detail
          ? <DetailContent log={detail} />
          : <Text size="sm" c="dimmed">Gagal memuat detail.</Text>
        }
      </Modal>
    </Box>
  );
}
