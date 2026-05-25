import { useState } from "react";
import {
  Paper, Group, Badge, ActionIcon, Collapse, Box, Text, SimpleGrid,
  Stack, Code, Overlay, Center, RingProgress, Button,
} from "@mantine/core";
import {
  IconAlertHexagon, IconAlertTriangle, IconChevronDown, IconChevronUp,
  IconX, IconActivity, IconBrain, IconBulb,
} from "@tabler/icons-react";
import type { ContextAlert } from "../contexts";

const nf = new Intl.NumberFormat();

function contextMessage(a: ContextAlert): {
  title: string; what: string; why: string;
  steps: { cmd?: string; label: string; desc: string }[];
} {
  const inp      = nf.format(a.input_tokens);
  const isCrit   = a.severity === "critical";
  const highRatio = a.ratio > 80 && a.input_tokens < 50_000;

  if (isCrit) return {
    title: `Context sangat besar — ${inp} tokens/request`,
    what:  `Setiap request dari user ini mengkonsumsi ~${inp} tokens hanya untuk membaca ulang riwayat percakapan. Ini menguras kuota dengan cepat.`,
    why:   "Session Claude Code telah berjalan lama dengan banyak tool call, baca file, atau output panjang yang terus terakumulasi di memory.",
    steps: [
      { cmd: "/clear",   label: "Reset total (tercepat)",    desc: "Hapus seluruh context. Mulai sesi baru dari nol. Gunakan jika task sudah selesai atau ingin ganti topik." },
      { cmd: "/compact", label: "Kompres context (aman)",    desc: "Buat ringkasan dari seluruh percakapan menjadi lebih kecil. Context tetap terjaga tapi lebih hemat." },
      { label: "Buka terminal baru",                         desc: "Buka jendela Claude Code baru untuk task berikutnya. Setara dengan /clear." },
    ],
  };

  if (highRatio) return {
    title: `Overhead besar — rasio ${a.ratio}× (in/out)`,
    what:  `Input tokens ${a.ratio}× lebih banyak dari output. Sebagian besar kuota habis untuk re-read context lama, bukan untuk menghasilkan jawaban baru.`,
    why:   "Percakapan sudah panjang tapi outputnya pendek-pendek. Ini tanda session perlu di-compact.",
    steps: [
      { cmd: "/compact", label: "Kompres context",           desc: "Buat ringkasan percakapan. Ideal untuk sesi panjang yang masih aktif." },
      { cmd: "/clear",   label: "Reset jika task selesai",   desc: "Jika task sudah selesai, lebih baik mulai sesi baru untuk task berikutnya." },
    ],
  };

  return {
    title: `Context mulai besar — ${inp} tokens/request`,
    what:  `Input tokens per request sudah ${inp}. Jika dibiarkan terus, penggunaan kuota akan membengkak di turn-turn berikutnya.`,
    why:   "Riwayat percakapan, hasil tool, dan file yang dibaca menumpuk di context setiap turn baru.",
    steps: [
      { cmd: "/compact", label: "Kompres sekarang (direkomendasikan)", desc: "Kompres riwayat sebelum makin besar. Lebih efektif dilakukan lebih awal." },
      { cmd: "/clear",   label: "Reset jika task sudah selesai",        desc: "Jika pekerjaan sudah selesai, mulai sesi baru untuk task berikutnya." },
      { label: "Hindari cat file besar",                                desc: "Baca file besar dengan targeted search (grep, head) daripada cat seluruh file." },
    ],
  };
}

function AlertStat({ label, value, accent, highlight }: {
  label: string; value: string; accent?: string; highlight?: boolean;
}) {
  return (
    <Box style={{
      background: "var(--cp-surface-2)", borderRadius: 8, padding: "8px 10px",
      border: highlight && accent ? `1px solid ${accent}33` : "1px solid var(--cp-border)",
      minWidth: 0,
    }}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".06em", lineHeight: 1.2 }}>{label}</Text>
      <Text fz={17} fw={800} ff="Geist Mono, monospace" truncate
        style={{ color: highlight && accent ? accent : undefined, lineHeight: 1.25, marginTop: 2 }}>
        {value}
      </Text>
    </Box>
  );
}

export function ContextAlertCard({ alert: a, onDismiss }: { alert: ContextAlert; onDismiss: () => void }) {
  const [open, setOpen] = useState(false);
  const isCrit   = a.severity === "critical";
  const color    = isCrit ? "red" : "orange";
  const colorHex = isCrit ? "#dc2626" : "#ea580c";
  const Icon     = isCrit ? IconAlertHexagon : IconAlertTriangle;
  const msg      = contextMessage(a);

  return (
    <Paper withBorder radius="md" style={{ borderColor: colorHex, borderLeftWidth: 3, overflow: "hidden" }}>
      <Group justify="space-between" wrap="nowrap" px="md" py="sm" gap="sm"
        style={{ background: `var(--mantine-color-${color}-light)`, cursor: "pointer" }}
        onClick={() => setOpen(o => !o)}>
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
          <Icon size={20} color={colorHex} style={{ flexShrink: 0 }} />
          <Box style={{ minWidth: 0, flex: 1 }}>
            <Group gap={6} mb={3} wrap="nowrap">
              <Badge color={color} variant="filled" size="xs" tt="uppercase" style={{ flexShrink: 0 }}>
                {isCrit ? "Critical" : "Warning"}
              </Badge>
              <Text size="xs" c="dimmed" ff="monospace" truncate>{a.label}</Text>
            </Group>
            <Text size="sm" fw={700} lh={1.35} style={{ letterSpacing: "-0.005em" }}>{msg.title}</Text>
          </Box>
        </Group>
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
          <Text size="xs" c="dimmed" visibleFrom="sm">{open ? "tutup" : "detail"}</Text>
          <ActionIcon size="sm" variant="subtle" color={color}
            onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
            aria-label={open ? "Collapse" : "Expand"}>
            {open ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
          </ActionIcon>
          <ActionIcon size="sm" variant="subtle" color="gray"
            onClick={e => { e.stopPropagation(); onDismiss(); }}
            aria-label="Dismiss alert">
            <IconX size={13} />
          </ActionIcon>
        </Group>
      </Group>

      <Collapse expanded={open}>
        <Box p="md" style={{ background: "var(--cp-surface)" }}>
          <Stack gap="lg">
            <Box>
              <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={8} style={{ letterSpacing: ".07em" }}>Metrik Request</Text>
              <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
                <AlertStat label="Input"  value={nf.format(a.input_tokens)}  accent={colorHex} highlight />
                <AlertStat label="Output" value={nf.format(a.output_tokens)} />
                <AlertStat label="Rasio"  value={`${a.ratio}×`} accent={colorHex} highlight={a.ratio >= 20} />
                <AlertStat label="Turns"  value={String(a.turns)} />
              </SimpleGrid>
            </Box>

            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
              <Box style={{ background: "var(--cp-surface-2)", borderRadius: 10, padding: "12px 14px", borderLeft: `2px solid ${colorHex}` }}>
                <Group gap={6} mb={6}>
                  <IconActivity size={13} color={colorHex} />
                  <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: ".06em", color: colorHex }}>Apa yang terjadi</Text>
                </Group>
                <Text size="sm" lh={1.55}>{msg.what}</Text>
              </Box>
              <Box style={{ background: "var(--cp-surface-2)", borderRadius: 10, padding: "12px 14px", borderLeft: "2px solid var(--cp-border)" }}>
                <Group gap={6} mb={6}>
                  <IconBrain size={13} color="var(--cp-text-3)" />
                  <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".06em" }}>Mengapa terjadi</Text>
                </Group>
                <Text size="sm" c="dimmed" lh={1.55}>{msg.why}</Text>
              </Box>
            </SimpleGrid>

            <Box>
              <Group gap={6} mb={8}>
                <IconBulb size={14} color="var(--mantine-color-yellow-6)" />
                <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: ".07em", color: "var(--mantine-color-yellow-7)" }}>Yang bisa dilakukan</Text>
              </Group>
              <Stack gap={6}>
                {msg.steps.map((s, i) => (
                  <Group key={i} gap="sm" align="flex-start" wrap="nowrap"
                    style={{ background: "var(--cp-surface-2)", borderRadius: 8, padding: "10px 12px", border: "1px solid var(--cp-border)" }}>
                    <Box style={{
                      flexShrink: 0, width: 22, height: 22, borderRadius: "50%",
                      background: colorHex + "1a", color: colorHex,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontWeight: 800, fontSize: 11, fontFamily: "Geist Mono, monospace", marginTop: 1,
                    }}>{i + 1}</Box>
                    <Box style={{ flex: 1, minWidth: 0 }}>
                      <Group gap={6} mb={3} wrap="wrap">
                        {s.cmd && (
                          <Code fz={12} fw={700} style={{ background: colorHex + "15", color: colorHex, padding: "2px 8px", borderRadius: 4 }}>{s.cmd}</Code>
                        )}
                        <Text size="sm" fw={600} lh={1.3}>{s.label}</Text>
                      </Group>
                      <Text size="xs" c="dimmed" lh={1.5}>{s.desc}</Text>
                    </Box>
                  </Group>
                ))}
              </Stack>
            </Box>
          </Stack>
        </Box>
      </Collapse>
    </Paper>
  );
}

export function ContextAlertOverlay({ alerts, onDismiss }: {
  alerts: ContextAlert[];
  onDismiss: (key: string) => void;
}) {
  const worst = alerts[0];
  if (!worst) return null;

  const isCrit  = worst.severity === "critical";
  const msg     = contextMessage(worst);
  const color   = isCrit ? "#dc2626" : "#ea580c";
  const bgColor = isCrit ? "rgba(220,38,38,0.08)" : "rgba(234,88,12,0.07)";
  const Icon    = isCrit ? IconAlertHexagon : IconAlertTriangle;
  const key     = worst.label + worst.ts;

  return (
    <>
      <Overlay backgroundOpacity={0.75} blur={6} zIndex={300} />
      <Center style={{ position: "fixed", inset: 0, zIndex: 301, padding: 16 }}>
        <Box style={{
          width: "100%", maxWidth: 520,
          background: "var(--mantine-color-body)", borderRadius: 20,
          border: `2px solid ${color}`,
          boxShadow: `0 0 60px ${color}40, 0 24px 48px rgba(0,0,0,0.4)`,
          overflow: "hidden",
        }}>
          <Box style={{ height: 6, background: `linear-gradient(90deg, ${color}, ${color}99)` }} />
          <Stack gap={0} p="xl">
            <Group gap="md" mb="lg" align="flex-start">
              <RingProgress size={72} thickness={6} roundCaps
                sections={[{ value: Math.min(100, worst.ratio), color }]}
                label={<Center><Icon size={22} color={color} /></Center>}
              />
              <Box style={{ flex: 1 }}>
                <Group gap="xs" mb={4}>
                  <Badge color={isCrit ? "red" : "orange"} variant="filled" size="sm" tt="uppercase">
                    {isCrit ? "⚠ Critical" : "⚠ Warning"}
                  </Badge>
                  <Text size="xs" c="dimmed" ff="monospace">{worst.label}</Text>
                </Group>
                <Text fw={800} fz={18} lh={1.3} style={{ letterSpacing: "-0.02em" }}>{msg.title}</Text>
              </Box>
            </Group>

            <SimpleGrid cols={3} mb="lg" style={{ background: bgColor, borderRadius: 12, padding: "12px 16px" }}>
              {[
                { label: "Input",  val: nf.format(worst.input_tokens),  colored: true },
                { label: "Output", val: nf.format(worst.output_tokens), colored: false },
                { label: "Rasio",  val: `${worst.ratio}×`,              colored: true },
              ].map(({ label, val, colored }) => (
                <Box key={label}>
                  <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".06em" }}>{label}</Text>
                  <Text fw={700} ff="monospace" fz={16} style={{ color: colored ? color : undefined }}>{val}</Text>
                </Box>
              ))}
            </SimpleGrid>

            <Stack gap="sm" mb="lg">
              <Box>
                <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={4} style={{ letterSpacing: ".06em" }}>Apa yang terjadi</Text>
                <Text size="sm" lh={1.6}>{msg.what}</Text>
              </Box>
              <Box>
                <Text size="xs" fw={700} tt="uppercase" c="dimmed" mb={4} style={{ letterSpacing: ".06em" }}>Mengapa</Text>
                <Text size="sm" c="dimmed" lh={1.6}>{msg.why}</Text>
              </Box>
            </Stack>

            <Stack gap="sm" mb="xl">
              <Group gap="xs">
                <IconBulb size={14} color="var(--mantine-color-yellow-5)" />
                <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".06em" }}>Yang bisa dilakukan sekarang</Text>
              </Group>
              {msg.steps.map((s, i) => (
                <Group key={i} gap="sm" align="flex-start" wrap="nowrap"
                  style={{ background: "var(--mantine-color-default-hover)", borderRadius: 10, padding: "10px 14px" }}>
                  <Badge variant="outline" color="gray" size="sm" style={{ flexShrink: 0, marginTop: 2 }}>{i + 1}</Badge>
                  <Box>
                    <Group gap="xs" mb={2}>
                      {s.cmd && <Code fz="sm" fw={700}>{s.cmd}</Code>}
                      <Text size="sm" fw={600}>{s.label}</Text>
                    </Group>
                    <Text size="xs" c="dimmed">{s.desc}</Text>
                  </Box>
                </Group>
              ))}
            </Stack>

            <Group gap="sm">
              <Button flex={1} color={isCrit ? "red" : "orange"} size="md" radius="xl" fw={700}
                onClick={() => onDismiss(key)}>
                Saya Mengerti — Akan Saya Tangani
              </Button>
              {alerts.length > 1 && (
                <Text size="xs" c="dimmed" ta="center">+{alerts.length - 1} alert lain</Text>
              )}
            </Group>
          </Stack>
        </Box>
      </Center>
    </>
  );
}
