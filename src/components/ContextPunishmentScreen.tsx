import { Box, Stack, Text, Group, Badge, Divider, Paper, Code } from "@mantine/core";
import { IconAlertHexagon, IconTerminal2, IconHeartHandshake } from "@tabler/icons-react";

const COMMANDS = [
  { cmd: "/compact", desc: "Kompres seluruh riwayat percakapan menjadi ringkasan padat. Context tetap tersedia tapi jauh lebih kecil. Ideal saat sesi masih aktif dan ingin lanjutkan pekerjaan." },
  { cmd: "/clear",   desc: "Hapus seluruh context percakapan. Mulai sesi baru dari nol. Gunakan jika task sudah selesai atau ingin ganti topik." },
];

function Cd({ children }: { children: string }) {
  return (
    <Code style={{ fontSize: 11, color: "#fca5a5", background: "rgba(239,68,68,0.18)", padding: "1px 6px", borderRadius: 4 }}>
      {children}
    </Code>
  );
}

export function ContextPunishmentScreen({ reason, blockedAt }: {
  reason?: string | null;
  blockedAt?: number | null;
}) {
  const fmtDate = (ts?: number | null) => ts
    ? new Date(ts).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })
    : "—";

  return (
    <>
      <style>{`
        @keyframes cp-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.5); }
          50%       { box-shadow: 0 0 0 20px rgba(239,68,68,0); }
        }
      `}</style>

      {/* Fullscreen overlay — scrollable, tidak bisa ditutup */}
      <Box style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "linear-gradient(160deg, #3b0000 0%, #7f1d1d 45%, #991b1b 70%, #450a0a 100%)",
        overflowY: "auto",
      }}>
        {/* Centering wrapper — padding besar atas-bawah agar konten tidak mepet */}
        <Box style={{
          minHeight: "100%",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "48px 16px",
          boxSizing: "border-box",
        }}>
          <Stack gap="xl" style={{ maxWidth: 620, width: "100%" }}>

            {/* ── Header ─────────────────────────────── */}
            <Stack align="center" gap="md">
              <Box style={{
                width: 88, height: 88, borderRadius: "50%",
                background: "rgba(239,68,68,0.2)",
                border: "2px solid rgba(239,68,68,0.55)",
                display: "flex", alignItems: "center", justifyContent: "center",
                animation: "cp-pulse 2.2s ease-in-out infinite",
                flexShrink: 0,
              }}>
                <IconAlertHexagon size={48} color="#fca5a5" />
              </Box>

              <Text fz={38} fw={900} c="white" ta="center" style={{ letterSpacing: "-0.03em", lineHeight: 1.1 }}>
                Akses Diblokir
              </Text>

              <Badge size="lg" color="red" variant="filled"
                style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".08em", padding: "6px 16px" }}>
                CONTEXT TERLALU BESAR
              </Badge>
            </Stack>

            {/* ── Alasan ─────────────────────────────── */}
            <Paper radius="md" p="md"
              style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(239,68,68,0.35)" }}>
              <Stack gap={6}>
                <Text fz={11} fw={700} tt="uppercase" c="#f87171" style={{ letterSpacing: ".1em" }}>Alasan blokir</Text>
                <Text fz={14} c="#fecaca" style={{ lineHeight: 1.65 }}>
                  {reason || "Context percakapan di terminal Claude Code kamu terlalu besar (>100.000 tokens per request). Ini menguras kuota bersama dengan sangat cepat."}
                </Text>
                {blockedAt && (
                  <Text fz={11} c="#f87171" mt={4}>Diblokir sejak: {fmtDate(blockedAt)}</Text>
                )}
              </Stack>
            </Paper>

            <Divider color="rgba(239,68,68,0.25)" />

            {/* ── Solusi ─────────────────────────────── */}
            <Stack gap="md">
              <Group gap={8} wrap="nowrap">
                <IconTerminal2 size={18} color="#fca5a5" style={{ flexShrink: 0 }} />
                <Text fz={14} fw={700} c="white">Jalankan salah satu perintah ini di terminal Claude Code:</Text>
              </Group>

              <Stack gap={10}>
                {COMMANDS.map(({ cmd, desc }) => (
                  <Paper key={cmd} radius="md" p="md"
                    style={{ background: "rgba(0,0,0,0.45)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    <Group gap="md" wrap="nowrap" align="flex-start">
                      <Box style={{
                        fontSize: 18, fontWeight: 900, color: "#fca5a5",
                        background: "rgba(239,68,68,0.18)",
                        padding: "4px 14px", borderRadius: 8, flexShrink: 0,
                        fontFamily: "Geist Mono, monospace", letterSpacing: "0.02em",
                        border: "1px solid rgba(239,68,68,0.3)",
                        lineHeight: 1.8,
                      }}>
                        {cmd}
                      </Box>
                      <Text fz={13} c="#fecaca" style={{ lineHeight: 1.65, paddingTop: 6 }}>{desc}</Text>
                    </Group>
                  </Paper>
                ))}
              </Stack>

              <Paper radius="md" p="sm"
                style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(239,68,68,0.15)" }}>
                <Text fz={12} c="#f87171" style={{ lineHeight: 1.65 }}>
                  <Text span fw={700} c="#fca5a5">Tips:</Text> Setelah menjalankan <Cd>/compact</Cd> atau <Cd>/clear</Cd>,
                  ukuran context akan berkurang drastis. Ini membantu semua pengguna mendapatkan kuota yang adil dan sesi tetap ringan.
                </Text>
              </Paper>
            </Stack>

            <Divider color="rgba(239,68,68,0.25)" />

            {/* ── Hubungi admin ───────────────────────── */}
            <Stack gap={8} align="center">
              <Group gap={8}>
                <IconHeartHandshake size={20} color="#fca5a5" />
                <Text fz={14} fw={700} c="#fca5a5">Hubungi admin untuk membuka blokir</Text>
              </Group>
              <Text fz={12} c="#f87171" ta="center" style={{ lineHeight: 1.7, maxWidth: 480 }}>
                Setelah menjalankan <Cd>/compact</Cd> atau <Cd>/clear</Cd>,
                beritahu admin agar akses kamu bisa dibuka kembali.
                Admin membuka blokir melalui:{" "}
                <Text span fw={700} c="#fca5a5">Admin → Users → [nama kamu] → Unblock</Text>.
              </Text>
            </Stack>

            {/* spacer bawah */}
            <Box style={{ height: 8 }} />

          </Stack>
        </Box>
      </Box>
    </>
  );
}
