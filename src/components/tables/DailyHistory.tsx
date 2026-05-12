import { useState, useEffect } from "react";
import { Stack, Table, Text, Badge, Group, Tooltip, Box, SegmentedControl } from "@mantine/core";
import { UserAvatar } from "../UserAvatar";

const DATE_WINDOWS = [7, 14, 30] as const;
type DateWindow = typeof DATE_WINDOWS[number];

export function DailyHistory({ isAdmin, userImages = {} }: { isAdmin: boolean; userImages?: Record<string, string> }) {
  const [data, setData]   = useState<{ date: string; total: number; by_user: Record<string, number> }[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [window, setWindow] = useState<DateWindow>(7);

  useEffect(() => {
    fetch("/api/stats").then(r => r.json()).then(d => {
      setData(d.daily || []);
      setUsers(d.users || []);
    }).catch(() => {});
  }, []);

  const _d = new Date();
  const today = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,"0")}-${String(_d.getDate()).padStart(2,"0")}`;

  // newest-first dates, sliced to selected window
  const allDates  = [...data].sort((a, b) => b.date.localeCompare(a.date));
  const dates     = allDates.slice(0, window);

  if (!allDates.length) return <Text size="sm" c="dimmed" ta="center" p="xl">No data yet.</Text>;

  const cc = (v: number) => !v ? "dimmed" : v > 500_000 ? "red" : v > 200_000 ? "orange" : v > 50_000 ? "yellow" : "teal";
  const nf = new Intl.NumberFormat();
  const totalAll = allDates.reduce((s, d) => s + d.total, 0);

  return (
    <Stack gap={0}>
      {/* Window selector */}
      <Group justify="flex-end" px="md" py="xs" style={{ borderBottom: "1px solid var(--mantine-color-default-border)" }}>
        <SegmentedControl
          size="xs"
          value={String(window)}
          onChange={v => setWindow(Number(v) as DateWindow)}
          data={DATE_WINDOWS.map(w => ({ label: `${w}d`, value: String(w) }))}
        />
      </Group>

      <Table.ScrollContainer minWidth={320}>
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              {/* User column */}
              <Table.Th style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", minWidth: 160 }}>
                User
              </Table.Th>
              {/* One column per date */}
              {dates.map(d => {
                const isToday = d.date === today;
                return (
                  <Table.Th key={d.date} ta="right" style={{ fontSize: 11, letterSpacing: ".04em", minWidth: 72 }}>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <Text fz={11} fw={isToday ? 700 : 400} ff="monospace">{d.date.slice(5)}</Text>
                      {isToday && <Badge color="blue" variant="filled" size="xs" px={4}>T</Badge>}
                    </Group>
                  </Table.Th>
                );
              })}
              <Table.Th ta="right" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", minWidth: 88 }}>
                Total
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {users.map(k => {
              const userTotal = dates.reduce((s, d) => s + (d.by_user[k] || 0), 0);
              return (
                <Table.Tr key={k}>
                  {/* User identity */}
                  <Table.Td>
                    <Group gap={8} wrap="nowrap">
                      <UserAvatar name={k} imageUrl={userImages[k]} size={24} />
                      <Tooltip label={k} withArrow openDelay={400} disabled={k.length <= 20}>
                        <Text size="sm" fw={600} truncate maw={140}>{k}</Text>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                  {/* Value per date */}
                  {dates.map(d => {
                    const v = d.by_user[k] || 0;
                    const isToday = d.date === today;
                    return (
                      <Table.Td key={d.date} ta="right"
                        style={isToday ? { background: "light-dark(rgba(34,139,230,.05),rgba(34,139,230,.10))" } : {}}>
                        <Text size="sm" ff="monospace" fw={v ? 600 : 400} c={cc(v)}>
                          {v ? nf.format(v) : <Text span c="dimmed" fz={11}>—</Text>}
                        </Text>
                      </Table.Td>
                    );
                  })}
                  {/* User total */}
                  <Table.Td ta="right">
                    <Text size="sm" ff="monospace" fw={700} c={cc(userTotal)}>
                      {userTotal ? nf.format(userTotal) : <Text span c="dimmed">—</Text>}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              );
            })}

            {/* Grand total row */}
            <Table.Tr style={{ borderTop: "2px solid var(--mantine-color-default-border)" }}>
              <Table.Td>
                <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".06em" }}>Total</Text>
              </Table.Td>
              {dates.map(d => {
                const isToday = d.date === today;
                return (
                  <Table.Td key={d.date} ta="right"
                    style={isToday ? { background: "light-dark(rgba(34,139,230,.05),rgba(34,139,230,.10))" } : {}}>
                    <Text size="sm" ff="monospace" fw={700} c={cc(d.total)}>
                      {d.total ? nf.format(d.total) : <Text span c="dimmed">—</Text>}
                    </Text>
                  </Table.Td>
                );
              })}
              <Table.Td ta="right">
                <Text size="sm" ff="monospace" fw={700}>
                  {nf.format(dates.reduce((s, d) => s + d.total, 0))}
                </Text>
              </Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <Group justify="flex-end" px="md" py="xs" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
        <Text size="xs" c="dimmed">
          {nf.format(totalAll)} tok total · {allDates.length} days
        </Text>
      </Group>
    </Stack>
  );
}
