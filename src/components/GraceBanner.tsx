import { useState, useEffect } from "react";
import { Box, Group, Text, Code } from "@mantine/core";
import { IconAlertTriangle, IconHourglass } from "@tabler/icons-react";

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "habis";
  const s   = Math.floor(ms / 1000);
  const m   = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function GraceBanner({ graceUntil }: { graceUntil: number }) {
  const [remaining, setRemaining] = useState(() => graceUntil - Date.now());

  useEffect(() => {
    const t = setInterval(() => setRemaining(graceUntil - Date.now()), 1000);
    return () => clearInterval(t);
  }, [graceUntil]);

  const urgent  = remaining < 5 * 60 * 1000;   // < 5 menit
  const critical = remaining < 60 * 1000;       // < 1 menit

  // High-contrast badge colors. Yellow-on-yellow was invisible — switched to
  // solid dark pill with bright yellow text so countdown reads at a glance.
  const badgeBg     = critical ? "#7f1d1d" : urgent ? "#7c2d12" : "#1c1917";
  const badgeBorder = critical ? "#dc2626" : urgent ? "#f97316" : "#facc15";
  const badgeText   = critical ? "#fecaca" : urgent ? "#fed7aa" : "#fde68a";

  return (
    <Box style={{
      position: "sticky", top: 0, zIndex: 200,
      background: urgent
        ? "rgba(120, 53, 15, 0.88)"
        : "rgba(78, 63, 0, 0.85)",
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      borderBottom: urgent
        ? "1px solid rgba(251,146,60,0.5)"
        : "1px solid rgba(234,179,8,0.4)",
      transition: "background 1s ease",
    }}>
      <Box px={{ base: 12, sm: 24 }} py={10} style={{ maxWidth: 1800, margin: "0 auto" }}>
        <Group justify="space-between" wrap="nowrap" gap="md">
          <Group gap={10} wrap="nowrap" style={{ minWidth: 0 }}>
            <IconAlertTriangle size={18} color={urgent ? "#fb923c" : "#eab308"} style={{ flexShrink: 0 }} />
            <Group gap={6} wrap="wrap">
              <Text fz={14} fw={700} c={urgent ? "orange.3" : "yellow.3"}>
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

          {/* Countdown — large, high-contrast, animated when critical */}
          <Group gap={10} wrap="nowrap" style={{ flexShrink: 0 }} align="center">
            <Group gap={6} wrap="nowrap" visibleFrom="xs">
              <IconHourglass size={16} color={urgent ? "#fb923c" : "#eab308"} />
              <Text fz={12} fw={600} c={urgent ? "orange.3" : "yellow.4"} tt="uppercase" style={{ letterSpacing: ".05em" }}>
                Sisa waktu
              </Text>
            </Group>
            <Box
              style={{
                background:   badgeBg,
                border:       `2px solid ${badgeBorder}`,
                color:        badgeText,
                padding:      "6px 18px",
                borderRadius: 10,
                fontFamily:   "Geist Mono, monospace",
                fontWeight:   900,
                fontSize:     22,
                lineHeight:   1,
                minWidth:     94,
                textAlign:    "center",
                boxShadow:    critical ? "0 0 12px rgba(220,38,38,0.45)" : "none",
                animation:    critical ? "cp-grace-pulse 1.2s ease-in-out infinite" : "none",
                transition:   "all 0.3s",
              }}
            >
              {fmtCountdown(remaining)}
            </Box>
          </Group>
        </Group>
      </Box>

      <style>{`
        @keyframes cp-grace-pulse {
          0%, 100% { box-shadow: 0 0 12px rgba(220,38,38,0.45); transform: scale(1); }
          50%       { box-shadow: 0 0 22px rgba(220,38,38,0.75); transform: scale(1.04); }
        }
      `}</style>
    </Box>
  );
}
