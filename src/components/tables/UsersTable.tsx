import { useState } from "react";
import {
  Stack, Table, Badge, Progress, Group, Text, ActionIcon, Pagination, Tooltip, Box,
} from "@mantine/core";
import {
  IconRefresh, IconPencil, IconPlayerPause, IconPlayerPlay, IconTrash,
} from "@tabler/icons-react";
import { usageCls, pctColor, adminPost } from "../../utils";
import type { TokenStatus } from "../../contexts";

const USERS_PER_PAGE = 10;
const ACT_SZ = 15;

export function UsersTable({ tokens, isAdmin }: { tokens: Record<string, TokenStatus>; isAdmin: boolean }) {
  const [page, setPage] = useState(1);
  const entries  = Object.entries(tokens);
  const pages    = Math.max(1, Math.ceil(entries.length / USERS_PER_PAGE));
  const visible  = entries.slice((page - 1) * USERS_PER_PAGE, page * USERS_PER_PAGE);

  return (
    <Stack gap={0}>
    {/* Wrap table in scrollable container for mobile */}
    <Box style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
    <Table className="users-table" highlightOnHover withColumnBorders={false} withRowBorders style={{ minWidth: 480 }}>
      <Table.Thead>
        <Table.Tr>
          {["Token","Used","Today","Limit","Remaining","Usage",...(isAdmin?["Actions"]:[])].map(h => (
            <Table.Th key={h} style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", whiteSpace: "nowrap" }}>{h}</Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody id="token-rows">
        {visible.map(([k, tk]) => {
          const pct = tk.limit === null ? 0 : tk.pct;
          const cls = tk.paused ? "" : `u-${usageCls(pct)}`;
          const todayCls = tk.today > 20000 ? "pct-over" : tk.today > 10000 ? "pct-high" : tk.today > 5000 ? "pct-warn" : tk.today > 0 ? "pct-ok" : "";
          const label = isAdmin ? k : (tk.name || k);
          const lim = tk.limit === null ? "unlimited" : String(tk.limit);
          return (
            <Table.Tr key={k} id={`row-${k}`} className={cls} style={tk.paused ? { opacity: 0.45 } : {}}>
              <Table.Td data-label="Token" pl="md">
                <Group gap="xs" wrap="nowrap">
                  <Text size="sm" ff="monospace" id={`lbl-${k}`} style={{ whiteSpace: "nowrap" }}>{label}</Text>
                  {tk.paused && <Badge color="gray" size="xs">paused</Badge>}
                </Group>
              </Table.Td>
              <Table.Td data-label="Used">
                <Text size="sm" ff="monospace" c="dimmed" style={{ whiteSpace: "nowrap" }}>{tk.used.toLocaleString()}</Text>
              </Table.Td>
              <Table.Td data-label="Today">
                <Text size="sm" ff="monospace" fw={600} className={todayCls} style={{ whiteSpace: "nowrap" }}>
                  {tk.today ? tk.today.toLocaleString() : <Text span c="dimmed">—</Text>}
                </Text>
              </Table.Td>
              <Table.Td data-label="Limit">
                <Text size="sm" ff="monospace" c="dimmed" style={{ whiteSpace: "nowrap" }}>{tk.limit === null ? "∞" : tk.limit.toLocaleString()}</Text>
              </Table.Td>
              <Table.Td data-label="Remaining">
                <Text size="sm" ff="monospace" c="dimmed" style={{ whiteSpace: "nowrap" }}>{tk.remaining === null ? "∞" : tk.remaining.toLocaleString()}</Text>
              </Table.Td>
              <Table.Td data-label="Usage" style={{ minWidth: 120 }}>
                <Group gap="xs" className="bar-cell" wrap="nowrap">
                  <Progress value={Math.min(pct, 100)} color={pctColor(pct)} size="sm" style={{ flex: 1, minWidth: 60 }} animated={false} />
                  <Group gap={3} wrap="nowrap">
                    <Text component="span" size="xs" className={`pct-${usageCls(pct)}`}>{pct}%</Text>
                    {pct > 100 && <Badge size="xs" color="red" variant="filled" p="2px 4px">OVER</Badge>}
                  </Group>
                </Group>
              </Table.Td>
              {isAdmin && (
                <Table.Td data-label="Actions">
                  <Group gap={4} wrap="nowrap">
                    <Tooltip label="Reset usage" withArrow>
                      <ActionIcon variant="subtle" color="gray" size="sm"
                        onClick={() => adminPost("/admin/reset", { token: k })}>
                        <IconRefresh size={ACT_SZ} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Edit limit" withArrow>
                      <ActionIcon variant="subtle" color="gray" size="sm"
                        onClick={() => { const v = prompt("New limit:", lim); if (v) adminPost("/admin/token/edit", { token: k, limit: v }); }}>
                        <IconPencil size={ACT_SZ} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label={tk.paused ? "Resume" : "Pause"} withArrow>
                      <ActionIcon variant="subtle" color={tk.paused ? "teal" : "orange"} size="sm"
                        onClick={() => adminPost("/admin/token/pause", { token: k })}>
                        {tk.paused ? <IconPlayerPlay size={ACT_SZ} /> : <IconPlayerPause size={ACT_SZ} />}
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Delete" withArrow>
                      <ActionIcon variant="subtle" color="red" size="sm"
                        onClick={() => { if (confirm(`Delete ${k}?`)) adminPost("/admin/token/delete", { token: k }); }}>
                        <IconTrash size={ACT_SZ} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Table.Td>
              )}
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
    </Box>

    {pages > 1 && (
      <Group justify="space-between" p="sm" wrap="wrap" gap="xs" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
        <Pagination total={pages} value={page} onChange={setPage} size="sm" />
        <Text size="xs" c="dimmed">
          {`${(page - 1) * USERS_PER_PAGE + 1}–${Math.min(page * USERS_PER_PAGE, entries.length)} of ${entries.length} tokens`}
        </Text>
      </Group>
    )}
    </Stack>
  );
}
