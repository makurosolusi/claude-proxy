import { useState, useEffect, useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { Box, Center, Group, Stack, Text, Button, useMantineColorScheme } from "@mantine/core";
import { LoadingScreen } from "./shared";

interface MindNode {
  id: string; name: string; category: number;
  requests?: number; tokens?: number;
  fullDate?: string;
  tools?: number; duration?: number; status?: number;
  stream?: number; ts?: number; model?: string; prompt?: string;
}
interface MindLink {
  source: string; target: string; value: number; tokens: number; type: string;
}
interface MindData {
  nodes: MindNode[];
  links: MindLink[];
  totalRequests: number;
  totalTokens: number;
}

// webkit-dep inspired palette — muted, professional
const CAT_COLORS = ["#5470c6", "#91cc75", "#fac858", "#ee6666"];
const CAT_NAMES  = ["User", "Date", "Hour", "Request"];

export function MindPage() {
  const [data, setData] = useState<MindData | null>(null);
  const [err, setErr] = useState(false);
  const { colorScheme } = useMantineColorScheme();
  const dark = colorScheme === "dark";

  useEffect(() => {
    fetch("/api/mind").then(r => r.json()).then(setData).catch(() => setErr(true));
  }, []);

  const option = useMemo(() => {
    if (!data || !data.nodes.length) return {};

    const userNodes = data.nodes.filter(n => n.category === 0);
    const dateNodes = data.nodes.filter(n => n.category === 1);
    const hourNodes = data.nodes.filter(n => n.category === 2);
    const reqNodes  = data.nodes.filter(n => n.category === 3);

    const maxUser = Math.max(...userNodes.map(n => n.requests ?? 1), 1);
    const maxDate = Math.max(...dateNodes.map(n => n.requests ?? 1), 1);
    const maxHour = Math.max(...hourNodes.map(n => n.requests ?? 1), 1);
    const maxTok  = Math.max(...reqNodes.map(n => n.tokens ?? 1), 1);

    const bgColor = dark ? "#1a1b1e" : "#fafbfc";
    const textColor = dark ? "#909296" : "#555";
    const mutedColor = dark ? "#5c5f66" : "#999";

    // ── Colony layout ─────────────────────────────────────────────────────
    // Every user owns an exclusive angular sector. User, date, and hour nodes
    // are all pre-positioned (fixed) so colonies never drift into each other.
    // Only request leaf nodes are free — they cluster around their fixed hour parent.

    const n = Math.max(userNodes.length, 1);
    const sectorAngle = (2 * Math.PI) / n;          // full sector per user
    const sectorHalf  = sectorAngle * 0.42;          // 84% used, 16% gap between colonies

    // Radii from canvas center
    const rUser = Math.max(700, n * 260);            // user node ring
    const rDate = rUser + 320;                       // date nodes further out
    const rHour = rDate + 240;                       // hour nodes furthest

    // ── User positions ─────────────────────────────────────────────────────
    const userPositions = new Map<string, { x: number; y: number; angle: number }>();
    userNodes.forEach((un, i) => {
      const angle = sectorAngle * i - Math.PI / 2;
      userPositions.set(un.id, {
        x: Math.round(rUser * Math.cos(angle)),
        y: Math.round(rUser * Math.sin(angle)),
        angle,
      });
    });

    // ── Build adjacency maps ───────────────────────────────────────────────
    const userDates = new Map<string, string[]>();
    userNodes.forEach(n => userDates.set(n.id, []));
    data.links.forEach(l => {
      if (l.type === "ud") userDates.get(l.source)?.push(l.target);
    });

    const dateHours = new Map<string, string[]>();
    dateNodes.forEach(n => dateHours.set(n.id, []));
    data.links.forEach(l => {
      if (l.type === "dh") dateHours.get(l.source)?.push(l.target);
    });

    // ── Date positions — fan within user sector ────────────────────────────
    const datePositions = new Map<string, { x: number; y: number }>();
    userNodes.forEach(un => {
      const { angle: uAngle } = userPositions.get(un.id)!;
      const dates = userDates.get(un.id) ?? [];
      dates.forEach((dId, di) => {
        const t = dates.length === 1 ? 0 : (di / (dates.length - 1)) - 0.5;
        const dAngle = uAngle + t * sectorHalf;
        datePositions.set(dId, {
          x: Math.round(rDate * Math.cos(dAngle)),
          y: Math.round(rDate * Math.sin(dAngle)),
        });
      });
    });

    // ── Hour positions — mini-fan around each date, pointing outward ───────
    const hourPositions = new Map<string, { x: number; y: number }>();
    datePositions.forEach((dPos, dId) => {
      const dAngle = Math.atan2(dPos.y, dPos.x);
      const hours   = dateHours.get(dId) ?? [];
      const hHalf   = Math.min(sectorHalf * 0.4, Math.PI / 6);
      hours.forEach((hId, hi) => {
        const t = hours.length === 1 ? 0 : (hi / (hours.length - 1)) - 0.5;
        const hAngle = dAngle + t * 2 * hHalf;
        hourPositions.set(hId, {
          x: Math.round(rHour * Math.cos(hAngle)),
          y: Math.round(rHour * Math.sin(hAngle)),
        });
      });
    });

    return {
      backgroundColor: bgColor,

      tooltip: {
        trigger: "item",
        confine: true,
        padding: [10, 14],
        backgroundColor: dark ? "rgba(26,27,30,0.96)" : "rgba(255,255,255,0.96)",
        borderColor: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
        borderWidth: 1,
        extraCssText: "backdrop-filter:blur(12px);border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,0.2);max-width:300px;word-break:break-word;overflow-wrap:break-word;white-space:normal;line-height:1.7",
        textStyle: { fontFamily: "monospace", fontSize: 11, color: dark ? "#c1c2c5" : "#333" },
        formatter: (p: any) => {
          if (p.dataType === "edge") {
            const d = p.data;
            const tok = d.tokens ? `<br/>tokens: <b>${Number(d.tokens).toLocaleString()}</b>` : "";
            const label: Record<string, string> = { ud: "user → date", dh: "date → hour", hr: "hour → req" };
            return `${label[d.type as string] ?? "→"}<br/>count: <b>${d.value}</b>${tok}`;
          }
          const d = p.data;
          if (d.category === 0) {
            return `<b style="color:${CAT_COLORS[0]}">${d.name}</b> <span style="color:${mutedColor}">user</span>`
              + `<br/>requests: <b>${(d.requests||0).toLocaleString()}</b>`
              + `<br/>tokens: <b>${(d.tokens||0).toLocaleString()}</b>`;
          }
          if (d.category === 1) {
            return `<b style="color:${CAT_COLORS[1]}">${d.fullDate ?? d.name}</b> <span style="color:${mutedColor}">date</span>`
              + `<br/>requests: <b>${(d.requests||0).toLocaleString()}</b>`
              + `<br/>tokens: <b>${(d.tokens||0).toLocaleString()}</b>`;
          }
          if (d.category === 2) {
            return `<b style="color:${CAT_COLORS[2]}">${d.name}</b> <span style="color:${mutedColor}">hour</span>`
              + `<br/>requests: <b>${(d.requests||0).toLocaleString()}</b>`
              + `<br/>tokens: <b>${(d.tokens||0).toLocaleString()}</b>`;
          }
          const t = new Date(d.ts ?? 0);
          const ts = `${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}:${String(t.getSeconds()).padStart(2,"0")}`;
          const prompt = d.prompt ? `<div style="margin-top:4px;color:${mutedColor};font-size:10px">${d.prompt}${d.prompt.length >= 80 ? "…" : ""}</div>` : "";
          return `<b style="color:${CAT_COLORS[3]}">${d.model}</b> <span style="color:${mutedColor}">${ts}</span>`
            + `<br/>tokens: <b>${(d.tokens||0).toLocaleString()}</b>`
            + (d.tools ? `<br/>tools: <b>${d.tools}</b>` : "")
            + (d.duration ? `<br/>duration: <b>${d.duration} ms</b>` : "")
            + prompt;
        },
      },

      legend: [{
        data: CAT_NAMES.map((name, i) => ({ name, icon: "circle" })),
        bottom: 12,
        orient: "horizontal",
        textStyle: { fontSize: 11, fontFamily: "monospace", color: textColor },
        icon: "circle",
        itemWidth: 8,
        itemHeight: 8,
        itemGap: 18,
        selectedMode: true,
      }],

      series: [{
        type: "graph",
        layout: "force",
        animation: true,
        animationDuration: 800,
        animationEasing: "cubicOut",

        // ── Node style ────────────────────────────────────
        symbol: "circle",
        roam: true,
        roamTrigger: "global",
        scaleLimit: { max: 20, min: 0.08 },
        draggable: true,

        label: {
          show: true,
          position: "right",
          distance: 6,
          formatter: (p: any) => {
            const d = p.data;
            if (d.category === 0) return d.name;
            if (d.category === 3) return "";
            return d.name;
          },
          fontSize: 11,
          fontFamily: "monospace",
          color: textColor,
        },

        labelLayout: { hideOverlap: true },

        // ── Edge style ────────────────────────────────────
        edgeSymbol: ["none", "none"],
        lineStyle: {
          color: "source",
          curveness: 0.3,
          opacity: 0.35,
        },

        emphasis: {
          focus: "none",
          lineStyle: { opacity: 0.8, width: 2.5 },
          itemStyle: { shadowBlur: 16, shadowColor: "rgba(0,0,0,0.3)" },
          scale: 1.4,
        },

        // ── Node data ─────────────────────────────────────
        data: data.nodes.map(n => {
          const color = CAT_COLORS[n.category] ?? "#999";
          if (n.category === 0) {
            const ratio = Math.sqrt((n.requests ?? 1) / maxUser);
            const size = 26 + ratio * 42;
            const pos = userPositions.get(n.id) ?? { x: 0, y: 0 };
            return {
              id: n.id, name: n.name, category: 0,
              symbolSize: size,
              value: size,
              x: pos.x, y: pos.y, fixed: true,
              requests: n.requests ?? 0, tokens: n.tokens ?? 0,
              itemStyle: {
                color,
                borderColor: dark ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.8)",
                borderWidth: 2,
                shadowBlur: 4,
                shadowColor: "rgba(0,0,0,0.15)",
              },
              label: { fontSize: 13, fontWeight: "bold", color: dark ? "#c1c2c5" : "#333" },
            };
          }
          if (n.category === 1) {
            const ratio = Math.sqrt((n.requests ?? 1) / maxDate);
            const size = 12 + ratio * 18;
            const pos = datePositions.get(n.id);
            return {
              id: n.id, name: n.name, category: 1,
              symbolSize: size, value: size,
              ...(pos ? { x: pos.x, y: pos.y, fixed: true } : {}),
              requests: n.requests ?? 0, tokens: n.tokens ?? 0,
              fullDate: (n as any).fullDate,
              itemStyle: {
                color,
                borderColor: dark ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.7)",
                borderWidth: 1.5,
              },
              label: { fontSize: 10, color: dark ? "#909296" : "#666" },
            };
          }
          if (n.category === 2) {
            const ratio = Math.sqrt((n.requests ?? 1) / maxHour);
            const size = 8 + ratio * 12;
            const pos = hourPositions.get(n.id);
            return {
              id: n.id, name: n.name, category: 2,
              symbolSize: size, value: size,
              ...(pos ? { x: pos.x, y: pos.y, fixed: true } : {}),
              requests: n.requests ?? 0, tokens: n.tokens ?? 0,
              itemStyle: { color, borderColor: "rgba(255,255,255,0.5)", borderWidth: 1 },
              label: { fontSize: 9, color: mutedColor },
            };
          }
          const tRatio = Math.sqrt((n.tokens ?? 0) / maxTok);
          const size = 4 + tRatio * 8;
          return {
            id: n.id, name: n.name, category: 3,
            symbolSize: size, value: size,
            tokens: n.tokens ?? 0, tools: n.tools ?? 0,
            duration: (n as any).duration ?? 0,
            status: (n as any).status ?? 200,
            stream: (n as any).stream ?? 0,
            ts: (n as any).ts ?? 0,
            model: (n as any).model ?? "",
            prompt: (n as any).prompt ?? "",
            itemStyle: { color, borderWidth: 0 },
            label: { show: false },
          };
        }),

        // ── Edge data ─────────────────────────────────────
        links: data.links.map(l => ({
          source: l.source,
          target: l.target,
          value: l.value,
          tokens: l.tokens,
          type: l.type,
          lineStyle: {
            width: l.type === "ud" ? Math.max(0.8, Math.min(3.5, Math.log2(l.value + 1) * 0.8))
                 : l.type === "dh" ? Math.max(0.5, Math.min(2.5, Math.log2(l.value + 1) * 0.55))
                 : Math.max(0.3, Math.min(1.2, Math.log2(l.value + 1) * 0.3)),
            opacity: l.type === "ud" ? 0.5 : l.type === "dh" ? 0.35 : 0.2,
            curveness: l.type === "ud" ? 0.25 : l.type === "dh" ? 0.15 : 0.05,
          },
        })),

        categories: CAT_NAMES.map((name, i) => ({
          name,
          itemStyle: { color: CAT_COLORS[i] },
        })),

        force: {
          repulsion: [200, 600],
          gravity: 0,
          edgeLength: [30, 100],
          friction: 0.7,
          layoutAnimation: true,
        },
      }],
    };
  }, [data, dark]);

  const isEmpty   = data && data.nodes.length === 0;
  const userCount = data?.nodes.filter(n => n.category === 0).length ?? 0;
  const dateCount = data?.nodes.filter(n => n.category === 1).length ?? 0;
  const hourCount = data?.nodes.filter(n => n.category === 2).length ?? 0;
  const reqCount  = data?.nodes.filter(n => n.category === 3).length ?? 0;

  return (
    <Box style={{
      background: dark ? "#1a1b1e" : "#fafbfc",
      minHeight: "100vh",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* ── Top bar ──────────────────────────────────────── */}
      <Box style={{
        position: "absolute", top: 0, left: 0, right: 0, zIndex: 10,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 20px",
        pointerEvents: "none",
      }}>
        <Button
          component="a" href="/"
          variant="subtle" size="xs"
          style={{
            color: dark ? "#909296" : "#555",
            fontFamily: "monospace",
            pointerEvents: "auto",
          }}>
          ← home
        </Button>

        <Text ff="monospace" fw={700} size="sm"
          style={{ color: dark ? "#909296" : "#555", letterSpacing: ".14em", textTransform: "uppercase" }}>
          Request Mind Map
        </Text>

        <Box style={{ width: 60 }} />
      </Box>

      {/* ── Legend overlay ───────────────────────────────── */}
      {data && !isEmpty && (
        <Box style={{
          position: "absolute", bottom: 52, left: "50%", transform: "translateX(-50%)", zIndex: 10,
          textAlign: "center", pointerEvents: "none",
        }}>
          <Group gap="lg">
            {CAT_NAMES.map((name, i) => (
              <Group key={name} gap={6}>
                <Box w={8} h={8} style={{ borderRadius: "50%", background: CAT_COLORS[i] }} />
                <Text size="xs" ff="monospace" style={{ color: dark ? "#909296" : "#666" }}>{name}</Text>
              </Group>
            ))}
          </Group>
        </Box>
      )}

      {/* ── Stats corner ─────────────────────────────────── */}
      {data && !isEmpty && (
        <Box style={{ position: "absolute", top: 56, right: 20, zIndex: 10, textAlign: "right" }}>
          <Text size="xs" ff="monospace" style={{ color: dark ? "#909296" : "#555" }}>
            {userCount} users · {dateCount} dates · {hourCount} hours · {reqCount} requests
          </Text>
          <Text size="xs" ff="monospace" style={{ color: dark ? "#5c5f66" : "#999" }}>
            {data.totalRequests.toLocaleString()} total · {data.totalTokens.toLocaleString()} tokens
          </Text>
        </Box>
      )}

      {/* ── States ───────────────────────────────────────── */}
      {!data && !err && <LoadingScreen />}

      {err && (
        <Center mih="100vh">
          <Text c="dimmed" ff="monospace">failed to load</Text>
        </Center>
      )}

      {isEmpty && (
        <Center mih="100vh">
          <Stack align="center" gap="xs">
            <Text size="xl" fw={700} style={{ color: dark ? "#909296" : "#555" }}>no data</Text>
            <Text size="sm" style={{ color: dark ? "#5c5f66" : "#999" }} ff="monospace">make some requests first</Text>
          </Stack>
        </Center>
      )}

      {/* ── Chart ────────────────────────────────────────── */}
      {data && !isEmpty && (
        <ReactECharts
          option={option}
          style={{ height: "100vh", width: "100%" }}
          opts={{ renderer: "canvas" }}
          notMerge
        />
      )}
    </Box>
  );
}
