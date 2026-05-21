import { Box, Stack, Text, Group, Badge, ThemeIcon, Divider, Paper, Code } from "@mantine/core";
import { IconAlertHexagon, IconTerminal2, IconHeartHandshake } from "@tabler/icons-react";

const COMMANDS = [
  { cmd: "/compact", desc: "Kompres seluruh riwayat percakapan menjadi ringkasan padat. Context tetap tersedia tapi jauh lebih kecil. Ideal saat sesi masih aktif dan ingin lanjutkan pekerjaan." },
  { cmd: "/clear",   desc: "Hapus seluruh context percakapan. Mulai sesi baru dari nol. Gunakan jika task sudah selesai atau ingin ganti topik." },
];

export function ContextPunishmentScreen({ reason, blockedAt }: {
  reason?: string | null;
  blockedAt?: number | null;
}) {
  const fmtDate = (ts?: number | null) => ts
    ? new Date(ts).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })
    : "—";

  return (
    <Box
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "linear-gradient(160deg, #3b0000 0%, #7f1d1d 40%, #991b1b 70%, #450a0a 100%)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "24px 16px",
        overflow: "auto",
      }}
    >
      <Stack gap="xl" style={{ maxWidth: 640, width: "100%" }}>

        {/* Icon + judul */}
        <Stack align="center" gap="md">
          <Box style={{
            width: 80, height: 80, borderRadius: "50%",
            background: "rgba(239,68,68,0.25)",
            border: "2px solid rgba(239,68,68,0.6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            animation: "pulse 2s infinite",
          }}>
            <IconAlertHexagon size={44} color="#fca5a5" />
          </Box>
          <Text fz={36} fw={900} c="white" ta="center" style={{ letterSpacing: "-0.03em", lineHeight: 1.1 }}>
            Akses Diblokir
          </Text>
          <Badge size="lg" color="red" variant="filled" style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".05em" }}>
            CONTEXT TERLALU BESAR
          </Badge>
        </Stack>

        {/* Alasan blokir */}
        <Paper radius="md" p="md" style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(239,68,68,0.3)" }}>
          <Stack gap="xs">
            <Text fz={12} fw={700} tt="uppercase" c="red.3" style={{ letterSpacing: ".1em" }}>Alasan blokir</Text>
            <Text fz={14} c="red.1" style={{ lineHeight: 1.6 }}>
              {reason || "Context percakapan di terminal Claude Code kamu terlalu besar, melebihi 100.000 tokens per request. Ini menguras kuota bersama dengan sangat cepat."}
            </Text>
            {blockedAt && (
              <Text fz={11} c="red.4">Diblokir sejak {fmtDate(blockedAt)}</Text>
            )}
          </Stack>
        </Paper>

        <Divider color="rgba(239,68,68,0.3)" />

        {/* Apa yang harus dilakukan */}
        <Stack gap="md">
          <Group gap={8}>
            <ThemeIcon size="sm" color="red" variant="light" radius="sm">
              <IconTerminal2 size={14} />
            </ThemeIcon>
            <Text fz={15} fw={700} c="white">Jalankan salah satu perintah ini di terminal Claude Code:</Text>
          </Group>

          <Stack gap="sm">
            {COMMANDS.map(({ cmd, desc }) => (
              <Paper key={cmd} radius="md" p="md"
                style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(239,68,68,0.25)" }}>
                <Group gap="md" wrap="nowrap" align="flex-start">
                  <Code
                    style={{
                      fontSize: 20, fontWeight: 900, color: "#fca5a5",
                      background: "rgba(239,68,68,0.15)",
                      padding: "4px 12px", borderRadius: 8, flexShrink: 0,
                      fontFamily: "Geist Mono, monospace",
                    }}
                  >
                    {cmd}
                  </Code>
                  <Text fz={13} c="red.2" style={{ lineHeight: 1.6, paddingTop: 4 }}>{desc}</Text>
                </Group>
              </Paper>
            ))}
          </Stack>

          <Paper radius="md" p="sm" style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(239,68,68,0.2)" }}>
            <Text fz={12} c="red.3" style={{ lineHeight: 1.6 }}>
              <Text span fw={700} c="red.2">Tips:</Text> Setelah menjalankan <Code style={{ fontSize: 11, color: "#fca5a5", background: "rgba(239,68,68,0.15)" }}>/compact</Code> atau <Code style={{ fontSize: 11, color: "#fca5a5", background: "rgba(239,68,68,0.15)" }}>/clear</Code>, context kamu akan berkurang drastis.
              Ini membantu semua pengguna mendapatkan kuota yang adil.
            </Text>
          </Paper>
        </Stack>

        <Divider color="rgba(239,68,68,0.3)" />

        {/* Hubungi admin */}
        <Stack gap="xs" align="center">
          <Group gap={8}>
            <IconHeartHandshake size={18} color="#fca5a5" />
            <Text fz={14} fw={700} c="red.2">Hubungi admin untuk membuka blokir</Text>
          </Group>
          <Text fz={12} c="red.4" ta="center" style={{ lineHeight: 1.6 }}>
            Setelah menjalankan <Code style={{ fontSize: 11, color: "#fca5a5", background: "rgba(239,68,68,0.15)" }}>/compact</Code> atau <Code style={{ fontSize: 11, color: "#fca5a5", background: "rgba(239,68,68,0.15)" }}>/clear</Code>,
            beritahu admin agar akses kamu bisa dibuka kembali.
            Admin dapat membuka blokir melalui <Text span fw={700} c="red.2">Admin → Users → [nama kamu] → Unblock</Text>.
          </Text>
        </Stack>

      </Stack>

      <style>{`
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); }
          50%       { box-shadow: 0 0 0 16px rgba(239,68,68,0); }
        }
      `}</style>
    </Box>
  );
}
