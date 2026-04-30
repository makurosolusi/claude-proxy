import { useState, useEffect, useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { Box, Center, Stack, Text, Button } from "@mantine/core";
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

export function MindPage() {
  const [data, setData] = useState<MindData | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetch("/api/mind").then(r => r.json()).then(setData).catch(() => setErr(true));
  }, []);

  const option = useMemo(() => {
    if (!data || !data.nodes.length) return {};

    const userNodes = data.nodes.filter(n => n.category === 0);
    const dateNodes = data.nodes.filter(n => n.category === 1);
    const hourNodes = data.nodes.filter(n => n.category === 2);
    const reqNodes  = data.nodes.filter(n => n.category === 3);
    const maxUser   = Math.max(...userNodes.map(n => n.requests ?? 1), 1);
    const maxDate   = Math.max(...dateNodes.map(n => n.requests ?? 1), 1);
    const maxHour   = Math.max(...hourNodes.map(n => n.requests ?? 1), 1);
    const maxTok    = Math.max(...reqNodes.map(n => n.tokens ?? 1), 1);

    return {
      tooltip: {
        trigger: "item",
        confine: true,
        padding: [8, 12],
        textStyle: { fontFamily: "monospace", fontSize: 11 },
        extraCssText: "max-width:280px;word-break:break-word;overflow-wrap:break-word;white-space:normal;line-height:1.7",
        formatter: (p: any) => {
          if (p.dataType !== "node") {
            const tok = p.data.tokens ? `<br/>tokens: <b>${Number(p.data.tokens).toLocaleString()}</b>` : "";
            const label = { ud: "user → date", dh: "date → hour", hr: "hour → req" }[p.data.type as string] ?? "→";
            return `${label}<br/>count: <b>${p.data.value}</b>${tok}`;
          }
          const d = p.data;
          if (d.category === 0) {
            return `<b>${d.name}</b> <span style="color:#888">user</span>`
              + `<br/>requests: <b>${(d.requests||0).toLocaleString()}</b>`
              + `<br/>tokens: <b>${(d.tokens||0).toLocaleString()}</b>`;
          }
          if (d.category === 1) {
            return `<b>${d.fullDate ?? d.name}</b> <span style="color:#888">date</span>`
              + `<br/>requests: <b>${(d.requests||0).toLocaleString()}</b>`
              + `<br/>tokens: <b>${(d.tokens||0).toLocaleString()}</b>`;
          }
          if (d.category === 2) {
            return `<b>${d.name}</b> <span style="color:#888">hour</span>`
              + `<br/>requests: <b>${(d.requests||0).toLocaleString()}</b>`
              + `<br/>tokens: <b>${(d.tokens||0).toLocaleString()}</b>`;
          }
          const t = new Date(d.ts ?? 0);
          const ts = `${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}:${String(t.getSeconds()).padStart(2,"0")}`;
          const prompt = d.prompt ? `<div style="margin-top:5px;color:#666;font-size:10px;overflow-wrap:break-word;word-break:break-word;white-space:normal">${d.prompt}${d.prompt.length >= 80 ? "…" : ""}</div>` : "";
          return `<b>${d.model}</b> <span style="color:#888">${ts}</span>`
            + `<br/>tokens: <b>${(d.tokens||0).toLocaleString()}</b>`
            + (d.tools ? `<br/>tools: <b>${d.tools}</b>` : "")
            + (d.duration ? `<br/>duration: <b>${d.duration} ms</b>` : "")
            + prompt;
        },
      },

      legend: [{
        data: ["User", "Date", "Hour", "Request"],
        bottom: 16,
        orient: "horizontal",
        textStyle: { fontSize: 11, fontFamily: "monospace" },
        icon: "circle",
        itemWidth: 10, itemHeight: 10,
      }],

      series: [{
        type: "graph",
        layout: "force",
        animation: false,

        label: {
          show: true,
          position: "right",
          formatter: "{b}",
          fontSize: 11,
          fontFamily: "monospace",
        },

        labelLayout: { hideOverlap: true },

        data: data.nodes.map(n => {
          if (n.category === 0) {
            const ratio = Math.sqrt((n.requests ?? 1) / maxUser);
            return {
              id: n.id, name: n.name, category: 0,
              requests: n.requests ?? 0, tokens: n.tokens ?? 0,
              value: 200 + ratio * 800,
              symbolSize: Math.round(20 + ratio * 46),
              label: { fontSize: 13, fontWeight: "bold" },
            };
          }
          if (n.category === 1) {
            const ratio = Math.sqrt((n.requests ?? 1) / maxDate);
            return {
              id: n.id, name: n.name, category: 1,
              requests: n.requests ?? 0, tokens: n.tokens ?? 0,
              fullDate: (n as any).fullDate,
              value: 60 + ratio * 80,
              symbolSize: Math.round(10 + ratio * 14),
              label: { fontSize: 10 },
            };
          }
          if (n.category === 2) {
            const ratio = Math.sqrt((n.requests ?? 1) / maxHour);
            return {
              id: n.id, name: n.name, category: 2,
              requests: n.requests ?? 0, tokens: n.tokens ?? 0,
              value: 20 + ratio * 30,
              symbolSize: Math.round(7 + ratio * 9),
              label: { fontSize: 9 },
            };
          }
          const tRatio = Math.sqrt((n.tokens ?? 0) / maxTok);
          return {
            id: n.id, name: n.name, category: 3,
            tokens: n.tokens ?? 0, tools: n.tools ?? 0,
            duration: (n as any).duration ?? 0,
            status: (n as any).status ?? 200,
            stream: (n as any).stream ?? 0,
            ts: (n as any).ts ?? 0,
            model: (n as any).model ?? "",
            prompt: (n as any).prompt ?? "",
            value: 5,
            symbolSize: Math.round(3 + tRatio * 9),
            label: { fontSize: 9 },
          };
        }),

        links: data.links.map(l => ({
          source: l.source, target: l.target, value: l.value, tokens: l.tokens, type: l.type,
          lineStyle: {
            width: l.type === "ud" ? Math.max(0.8, Math.min(3, Math.log2(l.value + 1) * 0.7))
                 : l.type === "dh" ? Math.max(0.5, Math.min(2, Math.log2(l.value + 1) * 0.5))
                 : 0.4,
            opacity: l.type === "ud" ? 0.55 : l.type === "dh" ? 0.4 : 0.25,
            curveness: l.type === "ud" ? 0.2 : l.type === "dh" ? 0.1 : 0,
          },
        })),

        categories: [
          { name: "User" },
          { name: "Date" },
          { name: "Hour" },
          { name: "Request" },
        ],

        roam: true,
        roamTrigger: "global",
        scaleLimit: { max: 10, min: 0.3 },
        draggable: true,
        lineStyle: { color: "source", curveness: 0.3, opacity: 0.5 },
        // no focus to avoid white-flash dimming of non-adjacent nodes
        emphasis: {
          lineStyle: { opacity: 0.9, width: 2 },
        },
        // keep blurred nodes visible, not washed out
        blur: {
          itemStyle: { opacity: 0.4 },
          label: { opacity: 0.4 },
          lineStyle: { opacity: 0.15 },
        },
        force: {
          repulsion: [30, 700],
          gravity: 0.1,
          edgeLength: [35, 140],
          friction: 0.6,
          layoutAnimation: false,
        },
      }],
    };
  }, [data]);

  const isEmpty = data && data.nodes.length === 0;
  const userCount = data?.nodes.filter(n => n.category === 0).length ?? 0;
  const dateCount = data?.nodes.filter(n => n.category === 1).length ?? 0;
  const hourCount = data?.nodes.filter(n => n.category === 2).length ?? 0;
  const reqCount  = data?.nodes.filter(n => n.category === 3).length ?? 0;

  return (
    <Box style={{ background: "#fff", minHeight: "100vh", position: "relative", overflow: "hidden" }}>
      <Box style={{ position: "absolute", top: 16, left: 16, zIndex: 10 }}>
        <Button component="a" href="/" variant="subtle" size="xs"
          style={{ color: "#555", fontFamily: "monospace", letterSpacing: ".04em" }}>
          ← home
        </Button>
      </Box>

      <Box style={{ position: "absolute", top: 18, left: "50%", transform: "translateX(-50%)", zIndex: 10, textAlign: "center", pointerEvents: "none" }}>
        <Text ff="monospace" fw={700} size="sm" style={{ color: "#333", letterSpacing: ".18em", textTransform: "uppercase" }}>
          Request Mind Map
        </Text>
      </Box>

      {data && !isEmpty && (
        <Box style={{ position: "absolute", top: 12, right: 16, zIndex: 10, textAlign: "right" }}>
          <Text size="xs" ff="monospace" style={{ color: "#555" }}>
            {userCount} users · {dateCount} dates · {hourCount} hours · {reqCount} requests
          </Text>
          <Text size="xs" ff="monospace" style={{ color: "#888" }}>
            {data.totalRequests.toLocaleString()} total · {data.totalTokens.toLocaleString()} tokens
          </Text>
        </Box>
      )}

      {!data && !err && <LoadingScreen />}
      {err && (
        <Center mih="100vh">
          <Text c="dimmed" ff="monospace">failed to load</Text>
        </Center>
      )}
      {isEmpty && (
        <Center mih="100vh">
          <Stack align="center" gap="xs">
            <Text size="xl" fw={700} style={{ color: "#1e3a5f" }}>no data</Text>
            <Text size="sm" style={{ color: "#4a5568" }} ff="monospace">make some requests first</Text>
          </Stack>
        </Center>
      )}

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
