import { useState, useEffect } from "react";
import { Box, Group, Text, Code, Badge } from "@mantine/core";
import { IconAlertTriangle, IconTerminal2 } from "@tabler/icons-react";

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "habis";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function GraceBanner({ graceUntil }: { graceUntil: number }) {
  const [remaining, setRemaining] = useState(() => graceUntil - Date.now());

  useEffect(() => {
    const t = setInterval(() => setRemaining(graceUntil - Date.now()), 1000);
    return () => clearInterval(t);
  }, [graceUntil]);

  const urgent = remaining < 5 * 60 * 1000; // < 5 menit

  return (
    <Box style={{
      position: "sticky", top: 0, zIndex: 200,
      background: urgent
        ? "rgba(120, 53, 15, 0.82)"
        : "rgba(78, 63, 0, 0.78)",
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      borderBottom: urgent
        ? "1px solid rgba(251,146,60,0.5)"
        : "1px solid rgba(234,179,8,0.35)",
      transition: "background 1s ease",
    }}>
      <Box px={{ base: 12, sm: 24 }} py={8} style={{ maxWidth: 1800, margin: "0 auto" }}>
        <Group justify="space-between" wrap="nowrap" gap="md">
          <Group gap={10} wrap="nowrap" style={{ minWidth: 0 }}>
            <IconAlertTriangle size={16} color={urgent ? "#fb923c" : "#eab308"} style={{ flexShrink: 0 }} />
            <Group gap={6} wrap="wrap">
              <Text fz={13} fw={700} c={urgent ? "orange.3" : "yellow.3"}>
                Mode Compact Aktif
              </Text>
              <Text fz={12} c={urgent ? "orange.4" : "yellow.5"} visibleFrom="sm">
                — Segera jalankan
              </Text>
              <Group gap={4} visibleFrom="sm">
                <Code style={{ fontSize: 11, color: "#fde68a", background: "rgba(234,179,8,0.2)", padding: "1px 7px", borderRadius: 4 }}>
                  /compact
                </Code>
                <Text fz={11} c={urgent ? "orange.5" : "yellow.6"}>atau</Text>
                <Code style={{ fontSize: 11, color: "#fde68a", background: "rgba(234,179,8,0.2)", padding: "1px 7px", borderRadius: 4 }}>
                  /clear
                </Code>
                <Text fz={12} c={urgent ? "orange.4" : "yellow.5"}>di terminal Claude Code</Text>
              </Group>
            </Group>
          </Group>

          <Group gap={8} wrap="nowrap" style={{ flexShrink: 0 }}>
            <Group gap={4} wrap="nowrap">
              <IconTerminal2 size={13} color={urgent ? "#fb923c" : "#eab308"} />
              <Text fz={11} c="dimmed" visibleFrom="xs">Sisa waktu:</Text>
            </Group>
            <Badge
              size="sm"
              color={urgent ? "orange" : "yellow"}
              variant="filled"
              style={{ fontFamily: "Geist Mono, monospace", fontWeight: 800, fontSize: 13, minWidth: 56, textAlign: "center" }}
            >
              {fmtCountdown(remaining)}
            </Badge>
          </Group>
        </Group>
      </Box>
    </Box>
  );
}
