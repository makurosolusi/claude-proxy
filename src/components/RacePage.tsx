import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import ReactECharts from "echarts-for-react";
import {
  Box, Center, Text, ActionIcon, Group, Stack, Tooltip, Badge,
  useMantineColorScheme,
} from "@mantine/core";
import {
  IconHome, IconPlayerPlay, IconPlayerPause, IconRefresh,
  IconChevronLeft, IconChevronRight, IconFlag, IconAlertCircle,
} from "@tabler/icons-react";
import { LoadingScreen } from "./shared";

interface RaceFrame {
  time: string;
  values: Record<string, number>;
  requests: Record<string, number>;
}
interface RaceData {
  frames: RaceFrame[];
  users: string[];
  granularity: "hour" | "day";
}

const FACES = [
  "😀", "😎", "🥳", "🤖", "👻", "🐱", "🦊", "🐸", "🦁", "🐨",
];

const PALETTE = [
  "#5470c6", "#ee6666", "#91cc75", "#fac858",
  "#73c0de", "#3ba272", "#fc8452", "#9a60b4",
  "#ea7ccc", "#f0a500",
];

// ms per frame: index 0 = fastest
const SPEEDS     = [300, 800, 1500, 3000];
const SPEED_LBLS = ["4×", "2×", "1×", "½×"];
const TOP_N      = 10;

function fmtVal(v: number): string {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000)     return (v / 1_000).toFixed(1) + "K";
  return String(v);
}

function fmtTime(t: string, granularity: "hour" | "day"): string {
  if (granularity === "hour") {
    const [date, hh] = t.split(" ");
    const [, mm, dd] = date.split("-");
    return `${mm}-${dd} ${hh ?? "00"}:00`;
  }
  const [, mm, dd] = t.split("-");
  return `${mm}-${dd}`;
}

function labelUser(key: string): string {
  return key.replace(/^sk-user-/, "");
}

export function RacePage() {
  const [data,     setData]     = useState<RaceData | null>(null);
  const [err,      setErr]      = useState(false);
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing,  setPlaying]  = useState(false);
  const [speedIdx, setSpeedIdx] = useState(2);
  const { colorScheme } = useMantineColorScheme();
  const dark = colorScheme === "dark" ||
    (colorScheme === "auto" && typeof window !== "undefined" &&
     window.matchMedia("(prefers-color-scheme: dark)").matches);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/race")
      .then(r => r.json())
      .then((d: RaceData) => { setData(d); setFrameIdx(0); setPlaying(true); })
      .catch(() => setErr(true));
  }, []);

  const total   = data?.frames.length ?? 0;
  const atEnd   = total > 0 && frameIdx >= total - 1;
  const progress = total > 1 ? (frameIdx / (total - 1)) * 100 : 100;

  const restart = useCallback(() => { setFrameIdx(0); setPlaying(true); }, []);

  const step = useCallback((dir: 1 | -1) => {
    setPlaying(false);
    setFrameIdx(i => Math.max(0, Math.min((data?.frames.length ?? 1) - 1, i + dir)));
  }, [data]);

  // Ticker
  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (!data || !playing) return;
    tickRef.current = setInterval(() => {
      setFrameIdx(i => {
        if (i >= data.frames.length - 1) { setPlaying(false); return i; }
        return i + 1;
      });
    }, SPEEDS[speedIdx]);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [data, playing, speedIdx]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!data) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          if (atEnd) restart(); else setPlaying(p => !p);
          break;
        case "r": case "R": restart(); break;
        case "ArrowRight": e.preventDefault(); step(1);  break;
        case "ArrowLeft":  e.preventDefault(); step(-1); break;
        case "ArrowUp":    e.preventDefault(); setSpeedIdx(s => Math.max(0, s - 1)); break;
        case "ArrowDown":  e.preventDefault(); setSpeedIdx(s => Math.min(SPEEDS.length - 1, s + 1)); break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [data, atEnd, restart, step]);

  // Click-to-scrub on progress bar
  const handleProgressClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!data || total < 2) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setPlaying(false);
    setFrameIdx(Math.round(pct * (total - 1)));
  }, [data, total]);

  // ECharts option
  const option = useMemo(() => {
    if (!data || !data.frames.length) return {};
    const fi = Math.min(frameIdx, data.frames.length - 1);
    const f  = data.frames[fi];

    const userColor = new Map<string, string>();
    const userFace  = new Map<string, string>();
    data.users.forEach((u, i) => {
      userColor.set(u, PALETTE[i % PALETTE.length]);
      userFace.set(u, FACES[i % FACES.length]);
    });

    const ranked = [...data.users]
      .filter(u => (f.values[u] ?? 0) > 0)
      .sort((a, b) => (f.values[b] ?? 0) - (f.values[a] ?? 0))
      .slice(0, TOP_N);

    const bg      = dark ? "#1a1b1e" : "#fafbfc";
    const textClr  = dark ? "#c1c2c5" : "#333";
    const mutedClr = dark ? "#5c5f66" : "#aaa";
    const gridClr  = dark ? "#2c2e33" : "#ebebeb";
    const dur      = SPEEDS[speedIdx];

    // Rank medals for top 3
    const medals = ["🥇", "🥈", "🥉"];

    return {
      backgroundColor: bg,
      grid: { top: 20, bottom: 20, left: 8, right: 8, containLabel: true },

      xAxis: {
        max: "dataMax",
        axisLabel: {
          color: mutedClr, fontFamily: "monospace", fontSize: 10,
          formatter: fmtVal,
        },
        splitLine: { lineStyle: { color: gridClr, type: "dashed" } },
        axisTick:  { show: false },
        axisLine:  { show: false },
      },

      yAxis: {
        type: "category",
        data: ranked.map((u, i) =>
          i < 3 && atEnd
            ? `${medals[i]} ${userFace.get(u)} ${labelUser(u)}`
            : `${userFace.get(u)} ${labelUser(u)}`
        ),
        inverse: true,
        animationDuration: 200,
        animationDurationUpdate: Math.round(dur * 0.8),
        axisLabel: {
          color: textClr, fontFamily: "monospace",
          fontSize: 13, fontWeight: "bold",
          margin: 12,
        },
        axisLine: { show: false },
        axisTick: { show: false },
      },

      series: [{
        realtimeSort: true,
        type: "bar",
        data: ranked.map((u) => ({
          value: f.values[u] ?? 0,
          itemStyle: {
            color: userColor.get(u) ?? "#888",
            borderRadius: [0, 6, 6, 0],
          },
          label: {
            show: true,
            position: "right",
            distance: 8,
            valueAnimation: true,
            fontFamily: "monospace",
            fontSize: 11,
            color: mutedClr,
            formatter: (p: any) =>
              `${fmtVal(p.value)}  ·  ${fmtVal(f.requests[u] ?? 0)} req`,
          },
        })),
        barMaxWidth: 48,
        barCategoryGap: "30%",
        emphasis: { disabled: true },
      }],

      graphic: [{
        type: "text",
        right: 20,
        bottom: 20,
        z: 0,
        style: {
          text: fmtTime(f.time, data.granularity),
          font: `bold 52px monospace`,
          fill: dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
          textAlign: "right",
        },
      }],

      animationDuration: 0,
      animationDurationUpdate: Math.round(dur * 0.85),
      animationEasing: "linear" as const,
      animationEasingUpdate: "linear" as const,
    };
  }, [data, frameIdx, speedIdx, dark, atEnd]);

  const isEmpty = data && !data.frames.length;

  const border = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)";
  const glass  = dark ? "rgba(26,27,30,0.94)" : "rgba(250,251,252,0.94)";
  const sub    = dark ? "#909296" : "#555";
  const dim    = dark ? "#5c5f66" : "#aaa";

  return (
    <Box style={{
      background: dark ? "#1a1b1e" : "#fafbfc",
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <Box style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 16px",
        borderBottom: `1px solid ${border}`,
        background: glass, backdropFilter: "blur(8px)",
        flexShrink: 0,
      }}>
        <Tooltip label="Home" position="right" withArrow openDelay={500}>
          <ActionIcon component="a" href="/" variant="subtle" color="gray" size="md" radius="md">
            <IconHome size={16} />
          </ActionIcon>
        </Tooltip>

        <Group gap="xs" align="center">
          <IconFlag size={13} style={{ color: "#9a60b4", flexShrink: 0 }} />
          <Text ff="monospace" fw={700} size="sm"
            style={{ color: sub, letterSpacing: ".1em", textTransform: "uppercase" }}>
            Token Race
          </Text>
          {data && (
            <Badge size="xs" variant="light" color="violet" radius="sm" ff="monospace">
              {data.granularity === "hour" ? "hourly" : "daily"}
            </Badge>
          )}
          {data && total > 0 && (
            <Badge size="xs" variant="dot" color={playing ? "teal" : atEnd ? "violet" : "gray"} radius="sm">
              {playing ? "playing" : atEnd ? "finished" : "paused"}
            </Badge>
          )}
        </Group>

        {/* right spacer matches left icon */}
        <Box style={{ width: 32 }} />
      </Box>

      {/* ── States ──────────────────────────────────────────────────── */}
      {!data && !err && <LoadingScreen />}

      {err && (
        <Center style={{ flex: 1 }}>
          <Stack align="center" gap="sm">
            <IconAlertCircle size={36} style={{ color: dim }} />
            <Text ff="monospace" c="dimmed" size="sm">failed to load race data</Text>
          </Stack>
        </Center>
      )}

      {isEmpty && (
        <Center style={{ flex: 1 }}>
          <Stack align="center" gap="sm">
            <IconFlag size={36} style={{ color: dim }} />
            <Text size="lg" fw={700} style={{ color: sub }}>no data yet</Text>
            <Text size="sm" ff="monospace" style={{ color: dim }}>
              make some requests first, then reload
            </Text>
          </Stack>
        </Center>
      )}

      {/* ── Chart ───────────────────────────────────────────────────── */}
      {data && !isEmpty && (
        <>
          <Box style={{ flex: 1, minHeight: 0, position: "relative" }}>
            <ReactECharts
              option={option}
              style={{ height: "100%", width: "100%" }}
              opts={{ renderer: "canvas" }}
              notMerge={false}
            />

            {/* FINAL badge overlay */}
            {atEnd && (
              <Box style={{
                position: "absolute", top: 14, right: 16,
                padding: "4px 12px",
                background: dark ? "rgba(154,96,180,0.15)" : "rgba(154,96,180,0.10)",
                border: "1px solid rgba(154,96,180,0.35)",
                borderRadius: 6,
              }}>
                <Text ff="monospace" size="xs" fw={800} c="violet" style={{ letterSpacing: ".12em" }}>
                  FINAL
                </Text>
              </Box>
            )}
          </Box>

          {/* ── Controls bar ────────────────────────────────────────── */}
          <Box style={{
            background: glass, backdropFilter: "blur(8px)",
            borderTop: `1px solid ${border}`,
            padding: "8px 16px 12px",
            flexShrink: 0,
          }}>
            {/* Progress bar — clickable scrub */}
            <Tooltip label="Click to jump" position="top" withArrow openDelay={600}>
              <Box
                onClick={handleProgressClick}
                style={{
                  height: 6, background: dark ? "#2c2e33" : "#e9ecef",
                  borderRadius: 3, marginBottom: 10, overflow: "hidden",
                  cursor: "pointer",
                }}
              >
                <Box style={{
                  height: "100%",
                  width: `${progress}%`,
                  background: atEnd
                    ? "linear-gradient(90deg, #5470c6, #9a60b4, #ea7ccc)"
                    : "linear-gradient(90deg, #5470c6, #9a60b4)",
                  borderRadius: 3,
                  transition: playing ? `width ${SPEEDS[speedIdx] * 0.85}ms linear` : "none",
                }} />
              </Box>
            </Tooltip>

            <Group justify="space-between" align="center" wrap="nowrap">
              {/* Current time */}
              <Text ff="monospace" size="xs" fw={600} style={{ color: sub, minWidth: 90 }}>
                {data.frames[frameIdx] ? fmtTime(data.frames[frameIdx].time, data.granularity) : ""}
              </Text>

              {/* Playback controls */}
              <Group gap={6} align="center" wrap="nowrap">
                <Tooltip label="Step back  ←" withArrow openDelay={400}>
                  <ActionIcon
                    variant="subtle" color="gray" size="sm" radius="md"
                    onClick={() => step(-1)}
                    disabled={frameIdx === 0}
                  >
                    <IconChevronLeft size={14} />
                  </ActionIcon>
                </Tooltip>

                <Tooltip
                  label={atEnd ? "Restart  R" : playing ? "Pause  Space" : "Play  Space"}
                  withArrow openDelay={300}
                >
                  <ActionIcon
                    variant="filled" color="violet" size="lg" radius="md"
                    onClick={() => { if (atEnd) restart(); else setPlaying(p => !p); }}
                  >
                    {atEnd
                      ? <IconRefresh size={16} />
                      : playing
                        ? <IconPlayerPause size={16} />
                        : <IconPlayerPlay size={16} />
                    }
                  </ActionIcon>
                </Tooltip>

                <Tooltip label="Step forward  →" withArrow openDelay={400}>
                  <ActionIcon
                    variant="subtle" color="gray" size="sm" radius="md"
                    onClick={() => step(1)}
                    disabled={atEnd}
                  >
                    <IconChevronRight size={14} />
                  </ActionIcon>
                </Tooltip>

                <Tooltip label="Speed  ↑ / ↓" withArrow openDelay={400}>
                  <ActionIcon
                    variant="light" color="gray" size="sm" radius="md"
                    onClick={() => setSpeedIdx(s => (s + 1) % SPEEDS.length)}
                    style={{ fontFamily: "monospace", fontSize: 11, width: 38 }}
                  >
                    {SPEED_LBLS[speedIdx]}
                  </ActionIcon>
                </Tooltip>
              </Group>

              {/* Frame counter */}
              <Text ff="monospace" size="xs" style={{ color: dim, minWidth: 90, textAlign: "right" }}>
                {frameIdx + 1} / {total}
              </Text>
            </Group>
          </Box>
        </>
      )}
    </Box>
  );
}
