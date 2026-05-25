import { useState, useEffect } from "react";
import { Group, Box, Text } from "@mantine/core";
import { IconClock } from "@tabler/icons-react";

const DAY_ID = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
const MON_ID = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

export function ClockInline() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const hh  = String(now.getHours()).padStart(2, "0");
  const mm  = String(now.getMinutes()).padStart(2, "0");
  const ss  = String(now.getSeconds()).padStart(2, "0");
  const day = DAY_ID[now.getDay()];
  const date= `${now.getDate()} ${MON_ID[now.getMonth()]} ${now.getFullYear()}`;
  const tz  = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <Group gap={10} wrap="nowrap" align="center">
      <Box hiddenFrom="sm">
        <Text fz={16} fw={800} ff="Geist Mono, monospace" lh={1} style={{ letterSpacing: "-0.03em" }}>
          {hh}:{mm}
        </Text>
      </Box>
      <Box visibleFrom="sm">
        <Group gap={4} wrap="nowrap" align="center">
          <IconClock size={11} color="var(--cp-text-3)" />
          <Text fz={11} c="dimmed">{day}, {date}</Text>
        </Group>
        <Group gap={3} align="baseline" wrap="nowrap" mt={1}>
          <Text fz={19} fw={800} ff="Geist Mono, monospace" lh={1} style={{ letterSpacing: "-0.04em" }}>
            {hh}:{mm}
          </Text>
          <Text fz={12} ff="Geist Mono, monospace" lh={1} c="dimmed">:{ss}</Text>
          <Text fz={10} c="dimmed" ml={3}>{tz}</Text>
        </Group>
      </Box>
    </Group>
  );
}
