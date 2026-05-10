import { useState, useEffect } from "react";
import { Stack, Table, Text, Badge, Group, Pagination } from "@mantine/core";

const DAILY_PER_PAGE = 7;

export function DailyHistory({ isAdmin }: { isAdmin: boolean }) {
  const [data, setData]   = useState<{ date: string; total: number; by_user: Record<string, number> }[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [page, setPage]   = useState(1);

  useEffect(() => {
    fetch("/api/stats").then(r => r.json()).then(d => {
      setData(d.daily || []);
      setUsers(d.users || []);
      setPage(1);
    }).catch(() => {});
  }, []);

  const today    = new Date().toISOString().slice(0, 10);
  const allDates = [...data].reverse();
  const pages    = Math.max(1, Math.ceil(allDates.length / DAILY_PER_PAGE));
  const dates    = allDates.slice((page - 1) * DAILY_PER_PAGE, page * DAILY_PER_PAGE);

  if (!allDates.length) return <Text size="sm" c="dimmed" ta="center" p="xl">No data yet.</Text>;

  const cc = (v: number) => !v ? "dimmed" : v > 20000 ? "red" : v > 10000 ? "orange" : v > 5000 ? "yellow" : "teal";
  const totalAll = allDates.reduce((s, d) => s + d.total, 0);
  const nf = new Intl.NumberFormat();

  return (
    <Stack gap={0}>
      <Table.ScrollContainer minWidth={280}>
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>Date</Table.Th>
              {users.map(k => (
                <Table.Th key={k} style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>
                  {k}
                </Table.Th>
              ))}
              <Table.Th style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>Total</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {dates.map(d => {
              const row   = d.by_user || {};
              const total = d.total;
              const isToday = d.date === today;
              return (
                <Table.Tr key={d.date} style={isToday ? {
                  background: "light-dark(rgba(34,139,230,.06),rgba(34,139,230,.12))",
                  boxShadow: "inset 2px 0 0 var(--mantine-color-blue-5)",
                } : {}}>
                  <Table.Td pl="md">
                    <Group gap="xs" wrap="nowrap">
                      <Text size="sm" ff="monospace" fw={isToday ? 700 : 400}>
                        {d.date.slice(5)}
                      </Text>
                      {isToday && <Badge color="blue" variant="filled" size="xs">today</Badge>}
                    </Group>
                  </Table.Td>
                  {users.map(k => (
                    <Table.Td key={k}>
                      <Text size="sm" ff="monospace" fw={600} c={cc(row[k] || 0)}>
                        {row[k] ? nf.format(row[k]) : <Text span c="dimmed">—</Text>}
                      </Text>
                    </Table.Td>
                  ))}
                  <Table.Td>
                    <Text size="sm" ff="monospace" fw={700} c={cc(total)}>
                      {total ? nf.format(total) : <Text span c="dimmed">—</Text>}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <Group justify="space-between" p="sm" style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}>
        <Pagination total={pages} value={page} onChange={setPage} size="sm" />
        <Text size="xs" c="dimmed">
          {`${nf.format(totalAll)} tok total · ${allDates.length} days`}
          {pages > 1 && ` · page ${page}/${pages}`}
        </Text>
      </Group>
    </Stack>
  );
}
