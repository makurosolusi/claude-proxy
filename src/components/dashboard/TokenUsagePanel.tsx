import { useEffect, useState } from "react";
import { Box, Group, Text, Badge, Progress, Stack, Tooltip, ThemeIcon, Paper, SimpleGrid, Pagination, Center } from "@mantine/core";
import { IconKey, IconAlertTriangle } from "@tabler/icons-react";
import type { StatusResponse, TokenStatus, UserInsight, ProfileResponse } from "../../contexts";
import { UserAvatar } from "../UserAvatar";
import { maskToken } from "../../utils";

const nf = new Intl.NumberFormat();
const PAGE_SIZE = 12;

interface TokenUsagePanelProps {
  tokens: StatusResponse["tokens"];
  profile: ProfileResponse | undefined;
  insights: Record<string, UserInsight>;
  userImages: Record<string, string> | undefined;
  isAdmin: boolean;
  view: "grid" | "list";
  setSelectedToken: (t: { key: string; tk: TokenStatus } | null) => void;
}

export function TokenUsagePanel({ tokens, profile, insights, userImages, isAdmin, view, setSelectedToken }: TokenUsagePanelProps) {
  const totalTokens = Object.keys(tokens).length;

  if (totalTokens === 0) {
    return (
      <Stack gap="xs" align="center" py="md">
        <ThemeIcon variant="light" color="gray" size="lg" radius="xl"><IconKey size={18} /></ThemeIcon>
        <Text size="sm" c="dimmed">No tokens configured yet</Text>
        {isAdmin && <Text size="xs" c="dimmed">Add a token below to start routing requests</Text>}
      </Stack>
    );
  }

  type Row = { key: string; tk: typeof tokens[string] };
  const groups = new Map<string, { ownerName: string; rows: Row[] }>();
  for (const [key, tk] of Object.entries(tokens)) {
    const gk = tk.user_id || `__orphan__:${key}`;
    const ownerName = tk.owner_name || "";
    if (!groups.has(gk)) groups.set(gk, { ownerName, rows: [] });
    groups.get(gk)!.rows.push({ key, tk });
  }
  const groupArr = Array.from(groups.entries()).map(([gk, g]) => {
    const totalUsed  = g.rows.reduce((s, r) => s + r.tk.used, 0);
    const totalLimit = g.rows.reduce((s, r) => s + (r.tk.limit ?? 0), 0);
    const hasInf     = g.rows.some(r => r.tk.limit == null);
    return {
      groupKey: gk, ownerName: g.ownerName,
      rows: g.rows.sort((a, b) => b.tk.used - a.tk.used),
      totalUsed, totalLimit, hasInf,
      isOrphan: gk.startsWith("__orphan__:"),
    };
  }).sort((a, b) => b.totalUsed - a.totalUsed);

  const totalPages = Math.ceil(groupArr.length / PAGE_SIZE);
  const [page, setPage] = useState(1);
  useEffect(() => { if (page > totalPages) setPage(1); }, [page, totalPages]);
  const safePage = Math.min(page, Math.max(1, totalPages));
  const visibleGroups = groupArr.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const renderGroup = (g: typeof groupArr[number]) => {
        const pctTotal   = g.hasInf ? 0 : g.totalLimit > 0 ? Math.min(100, Math.round((g.totalUsed / g.totalLimit) * 100)) : 0;
        const colorTotal = pctTotal >= 95 ? "red" : pctTotal >= 75 ? "orange" : pctTotal >= 50 ? "yellow" : "teal";
        const headerName  = g.isOrphan ? maskToken(g.rows[0]!.tk.token_label || g.rows[0]!.tk.label) : (g.ownerName || "Anonymous");
        const headerImage = g.isOrphan ? undefined : userImages?.[g.ownerName];
        return (
          <Paper key={g.groupKey} withBorder p={{ base: "sm", sm: "md" }} radius="md" style={{ overflow: "hidden" }}>
            <Group gap={8} wrap="nowrap" mb={4} align="center">
              <UserAvatar name={headerName} imageUrl={headerImage} size={24} />
              <Text size="sm" fw={700} truncate style={{ flex: 1, minWidth: 0 }}>{headerName}</Text>
              {g.rows.length > 1 && <Badge size="xs" variant="light" color="gray" style={{ flexShrink: 0 }}>{g.rows.length} tok</Badge>}
              <Text size="xs" ff="monospace" c="dimmed" ta="right" style={{ flexShrink: 0 }}>
                {nf.format(g.totalUsed)}{!g.hasInf && g.totalLimit > 0 && ` / ${nf.format(g.totalLimit)}`}
              </Text>
            </Group>
            <Progress value={pctTotal} color={colorTotal} size="sm" radius="xl" mb={8} />
            <Stack gap={6} pl={16}>
              {g.rows.map(({ key, tk }) => {
                const pct   = tk.limit == null ? 0 : Math.min(100, Math.round((tk.used / tk.limit) * 100));
                const color = tk.paused ? "gray" : pct >= 95 ? "red" : pct >= 75 ? "orange" : pct >= 50 ? "yellow" : "teal";
                const ins   = insights[key];
                const spike = (ins?.burnRate.spikeMultiple ?? 0) >= 2;
                const hoursL = ins?.burnRate.hoursLeft;
                const explicitLabel = tk.token_label || "";
                const modelShort    = (tk.activeModel || "").replace(/^claude-/, "").replace(/-\d{8}$/, "");
                const rowLabel      = explicitLabel || (modelShort ? `default · ${modelShort}` : "default");
                const isExplicit    = !!explicitLabel;
                return (
                  <Box key={key} style={{ cursor: "pointer" }} onClick={() => setSelectedToken({ key, tk })}>
                    <Group gap={6} wrap="nowrap" mb={3} align="center">
                      <Tooltip label={explicitLabel || `default token · ${tk.activeModel || "auto"}`} withArrow openDelay={400}>
                        <Text size="xs" ff="monospace" c="dimmed" truncate fs={isExplicit ? undefined : "italic"} style={{ flex: 1, minWidth: 0 }}>
                          {maskToken(rowLabel)}
                        </Text>
                      </Tooltip>
                      {spike && <Tooltip label="Spike hari ini >2× rata-rata" withArrow><IconAlertTriangle size={11} color="var(--mantine-color-orange-5)" /></Tooltip>}
                      {tk.activeProvider && tk.activeProvider !== "anthropic" && (
                        <Text size="10px" ff="monospace" style={{ flexShrink: 0 }}
                          c={tk.activeProvider === "deepseek" ? "violet" : tk.activeProvider === "openrouter" ? "orange" : "blue"}>
                          {tk.activeProvider}
                        </Text>
                      )}
                      {hoursL != null && hoursL < 12 && (
                        <Text size="10px" c={hoursL < 4 ? "red" : "orange"} ff="monospace" style={{ flexShrink: 0 }}>
                          {hoursL < 1 ? "<1h" : `~${hoursL.toFixed(0)}h`}
                        </Text>
                      )}
                      <Text size="xs" ff="monospace" c="dimmed" ta="right" style={{ flexShrink: 0 }}>
                        {nf.format(tk.used)}{tk.limit != null && ` / ${nf.format(tk.limit)}`}
                      </Text>
                    </Group>
                    <Progress value={pct} color={color} size="xs" radius="xl" />
                  </Box>
                );
              })}
            </Stack>
          </Paper>
        );
  };

  const pager = totalPages > 1 && (
    <Center mt="md">
      <Pagination total={totalPages} value={safePage} onChange={setPage} size="sm" radius="md" withEdges />
    </Center>
  );

  return (
    <Stack gap={0}>
      {view === "grid" ? (
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          {visibleGroups.map(renderGroup)}
        </SimpleGrid>
      ) : (
        <Stack gap="md">{visibleGroups.map(renderGroup)}</Stack>
      )}
      {pager}
    </Stack>
  );
}
