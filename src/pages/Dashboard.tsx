import { useState, useEffect, useMemo, useCallback } from "react";
import { useDisclosure } from "@mantine/hooks";
import { useMantineColorScheme } from "@mantine/core";
import {
  Box, Group, Stack, Text, Paper, ThemeIcon, Badge, Alert, SimpleGrid,
  Loader, Tabs, Modal, Tooltip, SegmentedControl,
} from "@mantine/core";
import {
  IconActivity, IconDatabase, IconUsers, IconClock, IconAlertTriangle,
  IconChartHistogram, IconLayoutDashboard, IconChartLine,
  IconMessages, IconHistory, IconLayoutGrid, IconLayoutList,
} from "@tabler/icons-react";
import type { AnalyticsData, LogEntry, ProfileResponse } from "../contexts";
import { useStatus } from "../contexts";
import type { ProviderInfo } from "../providerDisplay";
import { LoadingScreen, UpstreamSection, TruncText } from "../components/shared";
import { SonnetCriticalAlert } from "../components/SonnetCriticalAlert";
import { BackToTop } from "../components/BackToTop";
import { ContextAlertCard, ContextAlertOverlay } from "../components/ContextAlerts";
import { SessionsTab } from "../components/SessionsTab";
import { TokenDetailModal } from "../components/TokenDetailModal";
import { DashboardHeader } from "../components/dashboard/DashboardHeader";
import { TokenUsagePanel } from "../components/dashboard/TokenUsagePanel";
import { LeaderboardPanel } from "../components/dashboard/LeaderboardPanel";
import { AnalyticsPanel } from "../components/dashboard/AnalyticsPanel";
import { CompetitionPanel } from "../components/CompetitionPanel";
import { AdminUserActivity } from "../components/admin/UserActivity";
import { LiveFeed } from "../components/LiveFeed";
import { DailyHistory } from "../components/tables/DailyHistory";
import { FeedHistory } from "../components/FeedHistory";
import { DetailContent } from "../components/tables/RequestLog";
import { FloatingChat } from "../components/FloatingChat";

const nf = new Intl.NumberFormat();

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const s   = Math.floor(ms / 1000);
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

interface HourlyEntry { h: number; tokens: number; requests: number; }

interface DashboardProps {
  isAdmin: boolean;
  profile?: ProfileResponse;
  wsSignal?: number;
}

export function Dashboard({ isAdmin, profile, wsSignal }: DashboardProps) {
  const status = useStatus()!;
  const { colorScheme } = useMantineColorScheme();
  const { tokens, upstream, contextAlerts = [], thresholdAlerts = [], insights = {} } = status;

  const [activeTab, setActiveTab] = useState<string>(() => {
    try { return localStorage.getItem("dashboard-tab") || "dashboard"; } catch { return "dashboard"; }
  });
  const [tokenView, setTokenView] = useState<"grid" | "list">(() => {
    try { return localStorage.getItem("token-view") === "list" ? "list" : "grid"; } catch { return "grid"; }
  });
  const [dismissedAlerts,  setDismissedAlerts]  = useState<string[]>([]);
  const [dismissedThresh,  setDismissedThresh]  = useState<string[]>([]);
  const [dismissedOverlay, setDismissedOverlay] = useState<string[]>([]);

  const visibleAlerts = contextAlerts.filter(a => !dismissedAlerts.includes(a.label + a.ts));
  const visibleThresh = thresholdAlerts.filter(a => !dismissedThresh.includes(a.label + a.type));

  const myTokenNames = Object.values(profile?.tokens ?? {}).map(t => t.name).filter(Boolean);
  const myAlerts     = contextAlerts.filter(a =>
    myTokenNames.includes(a.label) && !dismissedOverlay.includes(a.label + a.ts)
  );

  const utilPct = upstream?.fiveHour?.utilization ?? 0;
  const t       = Math.max(0, Math.min(1, utilPct / 90));
  const isDark  = colorScheme === "dark" ||
    (colorScheme === "auto" && typeof window !== "undefined" &&
     window.matchMedia("(prefers-color-scheme: dark)").matches);

  const pageBg = useMemo(() => {
    if (t <= 0) return "transparent";
    const skyA = isDark ? (0.10 + t * 0.12) : (0.10 + t * 0.10);
    const skyR = Math.round(20  + t * 20);
    const skyG = Math.round(60  - t * 55);
    const skyB = Math.round(150 - t * 130);
    const sky  = `radial-gradient(ellipse 220% 55% at 50% 0%, rgba(${skyR},${skyG},${skyB},${skyA.toFixed(3)}) 0%, transparent 65%)`;
    const fr = Math.round(t < 0.35 ? 30  + t * 560 : t < 0.65 ? 226 - (t-0.35)*100 : 196);
    const fg = Math.round(t < 0.35 ? 90  - t * 257 : t < 0.65 ? Math.max(0, 0 - (t-0.35)*0) : 0);
    const fb = Math.round(t < 0.35 ? 50  - t * 143 : 0);
    const fireA  = isDark ? (t * 0.55) : (t * 0.35);
    const fireA2 = isDark ? (t * 0.25) : (t * 0.15);
    const fire = `radial-gradient(ellipse 180% 75% at 50% 100%, rgba(${fr},${fg},${fb},${fireA.toFixed(3)}) 0%, rgba(${Math.round(fr*0.6)},${Math.round(fg*0.3)},0,${fireA2.toFixed(3)}) 40%, transparent 75%)`;
    return `${sky}, ${fire}`;
  }, [t, isDark]);

  const todayTotal   = Object.values(tokens).reduce((sum, tk: any) => sum + (tk.today || 0), 0);
  const activeTokens = Object.values(tokens).filter(tk => tk.used > 0).length;
  const totalTokens  = Object.keys(tokens).length;

  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const resetsAtMs  = upstream?.fiveHour?.resets_at ? new Date(upstream.fiveHour.resets_at).getTime() : null;
  const countdownMs = resetsAtMs ? Math.max(0, resetsAtMs - Date.now()) : null;

  const [hourly, setHourly] = useState<HourlyEntry[]>([]);
  useEffect(() => {
    fetch("/api/usage/hourly").then(r => r.json()).then(d => setHourly(d.hours || [])).catch(() => {});
  }, []);

  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  useEffect(() => {
    fetch("/api/analytics").then(r => r.json()).then(setAnalytics).catch(() => {});
  }, []);

  const [customProviders, setCustomProviders] = useState<ProviderInfo[]>([]);
  useEffect(() => {
    fetch("/api/admin/custom-providers", { credentials: "include" })
      .then(r => r.ok ? r.json() : { providers: [] })
      .then((d: any) => {
        const list: ProviderInfo[] = (Array.isArray(d?.providers) ? d.providers : [])
          .map((p: any) => ({ id: p.id, name: p.name, color: p.color || "gray" }));
        setCustomProviders(list);
      })
      .catch(() => {});
  }, []);

  const [anomalyPage, setAnomalyPage] = useState(1);
  const [selectedToken, setSelectedToken] = useState<{ key: string; tk: import("../contexts").TokenStatus } | null>(null);
  const [anomalyDetail, setAnomalyDetail] = useState<LogEntry | null>(null);
  const [anomalyDetailLoading, setAnomalyDetailLoading] = useState(false);
  const [anomalyModalOpen, { open: openAnomalyModal, close: closeAnomalyModal }] = useDisclosure(false);

  const openAnomalyDetail = useCallback(async (id: number) => {
    setAnomalyDetailLoading(true);
    openAnomalyModal();
    try {
      const res = await fetch(`/api/logs/${id}`);
      if (res.ok) setAnomalyDetail(await res.json());
    } finally { setAnomalyDetailLoading(false); }
  }, [openAnomalyModal]);

  useEffect(() => {
    const KEY   = "scroll:dashboard";
    const saved = parseInt(sessionStorage.getItem(KEY) || "", 10);
    let raf = 0;
    if (Number.isFinite(saved) && saved > 0) {
      const start = performance.now();
      const restore = () => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo(0, Math.min(max, saved));
        if (max < saved && performance.now() - start < 2000) raf = requestAnimationFrame(restore);
      };
      raf = requestAnimationFrame(restore);
    }
    let timer = 0 as unknown as ReturnType<typeof setTimeout>;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => sessionStorage.setItem(KEY, String(window.scrollY)), 150);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); window.removeEventListener("scroll", onScroll); };
  }, []);

  const quotaPct = (() => {
    const myTokens  = Object.values(profile?.tokens ?? {});
    const totalUsed = myTokens.reduce((s, t) => s + t.used, 0);
    const totalLim  = myTokens.reduce((s, t) => s + (t.limit ?? 0), 0);
    return totalLim > 0 ? Math.min(100, Math.round((totalUsed / totalLim) * 100)) : 0;
  })();

  return (
    <Box className="cp-page-bg" style={{ minHeight: "100vh", backgroundImage: pageBg !== "transparent" ? pageBg : undefined, backgroundAttachment: "fixed" }}>

      <DashboardHeader
        isAdmin={isAdmin}
        isAdminStatus={status.isAdmin}
        profile={profile}
        upstream={upstream}
        customProviders={customProviders}
      />

      <Box px={{ base: 12, sm: 24 }} pt="xl" pb="xl" style={{ maxWidth: 1800, margin: "0 auto" }}>
        <Box className="dashboard-grid cp-stagger">

          {/* ── Left: Tabs ── */}
          <Box >
            <Tabs value={activeTab} onChange={v => { if (!v) return; setActiveTab(v); try { localStorage.setItem("dashboard-tab", v); } catch {} }} variant="outline" >
              <Tabs.List mb="lg" style={{ flexWrap: "nowrap", overflowX: "auto", scrollbarWidth: "none" }}>
                <Tabs.Tab value="dashboard" leftSection={<IconLayoutDashboard size={13} />} >Dashboard</Tabs.Tab>
                <Tabs.Tab value="activity"  leftSection={<IconChartLine size={13} />}       >Activity</Tabs.Tab>
                <Tabs.Tab value="sessions"  leftSection={<IconMessages size={13} />}        >Sessions</Tabs.Tab>
                <Tabs.Tab value="history"   leftSection={<IconHistory size={13} />}         >History</Tabs.Tab>
                <Tabs.Tab value="feed" leftSection={<IconActivity size={13} />} hiddenFrom="md" >Feed</Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="dashboard">
                <Stack gap="lg">

                  {upstream?.sevenDaySonnet && (
                    <SonnetCriticalAlert pct={Math.round(upstream.sevenDaySonnet.utilization)} />
                  )}

                  <SimpleGrid cols={{ base: 2, sm: 4 }} mb="lg" id="stats" style={{ scrollMarginTop: 16 }} className="cp-stagger">
                    <Box className="cp-stat-card cp-fade-in">
                      <Group gap={8} mb={8}>
                        <Box style={{ width: 28, height: 28, borderRadius: 8, background: "var(--cp-accent-dim)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <IconActivity size={14} color="var(--cp-accent)" />
                        </Box>
                        <Text fz={10} fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Today</Text>
                      </Group>
                      <TruncText fz={{ base: 16, sm: 24 }} fw={800} ff="Geist Mono, monospace" c={todayTotal === 0 ? "dimmed" : "var(--cp-text)"} style={{ letterSpacing: "-0.03em", lineHeight: 1 }}>
                        {nf.format(todayTotal)}
                      </TruncText>
                      <Text fz={11} c="dimmed" mt={4}>{todayTotal === 0 ? "Quiet — no requests yet" : "tokens used today"}</Text>
                    </Box>

                    <Box className="cp-stat-card cp-fade-in">
                      <Group gap={8} mb={8}>
                        <Box style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(124,58,237,0.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <IconDatabase size={14} color="#7c3aed" />
                        </Box>
                        <Text fz={10} fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>All-Time</Text>
                      </Group>
                      <TruncText fz={{ base: 16, sm: 24 }} fw={800} ff="Geist Mono, monospace" style={{ letterSpacing: "-0.03em", lineHeight: 1 }}>
                        {nf.format(status.totalAllTime ?? 0)}
                      </TruncText>
                      <Text fz={11} c="dimmed" mt={4}>total tokens processed</Text>
                    </Box>

                    <Box className="cp-stat-card cp-fade-in">
                      <Group gap={8} mb={8}>
                        <Box style={{ width: 28, height: 28, borderRadius: 8, background: "var(--cp-teal-dim)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <IconUsers size={14} color="var(--cp-teal)" />
                        </Box>
                        <Text fz={10} fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Active</Text>
                      </Group>
                      <Text fz={{ base: 16, sm: 24 }} fw={800} ff="Geist Mono, monospace" style={{ letterSpacing: "-0.03em", lineHeight: 1 }}>
                        {activeTokens}<Text span fz={14} fw={500} c="dimmed"> /{totalTokens}</Text>
                      </Text>
                      <Text fz={11} c="dimmed" mt={4}>
                        {totalTokens === 0 ? "no tokens configured" : activeTokens === 0 ? "none active this window" : "tokens active this window"}
                      </Text>
                    </Box>

                    <Box className="cp-stat-card cp-fade-in">
                      <Group gap={8} mb={8}>
                        <Box style={{ width: 28, height: 28, borderRadius: 8, background: "var(--cp-amber-dim)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <IconClock size={14} color="var(--cp-amber)" />
                        </Box>
                        <Text fz={10} fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Resets In</Text>
                      </Group>
                      {countdownMs !== null ? (
                        <>
                          <Text fz={{ base: 16, sm: 24 }} fw={800} ff="Geist Mono, monospace" style={{ letterSpacing: "-0.03em", lineHeight: 1 }}>{fmtCountdown(countdownMs)}</Text>
                          <Text fz={11} c="dimmed" mt={4}>at {new Date(resetsAtMs!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
                        </>
                      ) : (
                        <>
                          <Group gap={6} align="center" mih={28}><Loader size={10} color="orange" /><Text fz={13} fw={500} c="dimmed">polling…</Text></Group>
                          <Text fz={11} c="dimmed" mt={4}>waiting for upstream</Text>
                        </>
                      )}
                    </Box>
                  </SimpleGrid>

                  {visibleAlerts.length > 0 && (
                    <Stack gap="sm" mb="lg">
                      {visibleAlerts.map(a => (
                        <ContextAlertCard key={a.label + a.ts} alert={a} onDismiss={() => setDismissedAlerts(d => [...d, a.label + a.ts])} />
                      ))}
                    </Stack>
                  )}

                  {visibleThresh.length > 0 && (
                    <Stack gap="xs" mb="lg">
                      {visibleThresh.map(a => (
                        <Alert key={a.label + a.type}
                          color={a.type === "quota_95" || a.type === "error_storm" ? "red" : a.type === "upstream_85" ? "orange" : "yellow"}
                          icon={<IconAlertTriangle size={14} />}
                          withCloseButton
                          onClose={() => setDismissedThresh(d => [...d, a.label + a.type])}
                          py={6} px="md">
                          <Text size="sm">{a.msg}</Text>
                        </Alert>
                      ))}
                    </Stack>
                  )}

                  <Stack gap="xs" mb="lg" id="health" style={{ scrollMarginTop: 16 }}>
                    <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Upstream Health</Text>
                    <Paper withBorder p="md" radius="md" style={{ overflow: "hidden" }}>
                      <UpstreamSection upstream={upstream} isAdmin={isAdmin} />
                    </Paper>
                  </Stack>

                  <Stack gap="xs" mb="lg" id="tokens" style={{ scrollMarginTop: 16 }}>
                    <Group justify="space-between">
                      <Group gap="xs">
                        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Token Usage</Text>
                        {totalTokens > 0 && activeTokens === 0 && (
                          <Badge size="xs" variant="light" color="teal">all quotas fresh</Badge>
                        )}
                      </Group>
                      <SegmentedControl
                        size="xs"
                        value={tokenView}
                        onChange={v => { setTokenView(v as "grid" | "list"); try { localStorage.setItem("token-view", v); } catch {} }}
                        data={[
                          { value: "grid", label: <Tooltip label="Grid view" withArrow><IconLayoutGrid size={14} /></Tooltip> },
                          { value: "list", label: <Tooltip label="List view" withArrow><IconLayoutList size={14} /></Tooltip> },
                        ]}
                      />
                    </Group>
                    <TokenUsagePanel
                      tokens={tokens}
                      profile={profile}
                      insights={insights}
                      userImages={status.userImages}
                      isAdmin={isAdmin}
                      view={tokenView}
                      setSelectedToken={setSelectedToken}
                    />
                  </Stack>

                  {hourly.length === 24 && (() => {
                    const maxTok   = Math.max(...hourly.map(h => h.tokens), 1);
                    const curH     = new Date().getHours();
                    const dayTotal = hourly.reduce((s, h) => s + h.tokens, 0);
                    return (
                      <Stack gap="xs" mb="lg" id="activity" style={{ scrollMarginTop: 16 }}>
                        <Group justify="space-between">
                          <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Today's Activity</Text>
                          <Text size="xs" c="dimmed" ff="monospace">{nf.format(dayTotal)} tokens</Text>
                        </Group>
                        <Paper withBorder p="md" radius="md" style={{ overflow: "hidden" }}>
                          {dayTotal === 0 ? (
                            <Stack gap={4} align="center" py="md">
                              <ThemeIcon variant="light" color="gray" size="lg" radius="xl"><IconChartHistogram size={18} /></ThemeIcon>
                              <Text size="sm" c="dimmed">No activity yet today</Text>
                              <Text size="xs" c="dimmed">Hourly bars will appear as requests arrive</Text>
                            </Stack>
                          ) : (
                            <>
                              <Box style={{ display: "flex", alignItems: "flex-end", height: "clamp(56px, 13vw, 80px)", gap: 2 }}>
                                {hourly.map(({ h, tokens: tok, requests: req }) => {
                                  const barH = Math.round((tok / maxTok) * 56);
                                  const bg   = h === curH ? (isDark ? "#228be6" : "#1c7ed6") : h > curH ? (isDark ? "#2c2e33" : "#e9ecef") : (isDark ? "#0ca678" : "#12b886");
                                  return (
                                    <Tooltip key={h} label={`${String(h).padStart(2, "0")}:00 · ${nf.format(tok)} tok · ${req} req`} withArrow position="top" openDelay={80}>
                                      <Box style={{ flex: 1, height: Math.max(barH, tok > 0 ? 2 : 0), borderRadius: "2px 2px 0 0", background: bg, cursor: "default", opacity: h > curH ? 0.35 : 1, transition: "height 0.3s ease" }} />
                                    </Tooltip>
                                  );
                                })}
                              </Box>
                              <Box style={{ display: "flex", gap: 2, marginTop: 4 }}>
                                {hourly.map(({ h }) => (
                                  <Text key={h} size="10px" ff="monospace" c="dimmed" style={{ flex: 1, textAlign: "center" }}>
                                    {h % 6 === 0 ? String(h).padStart(2, "0") : ""}
                                  </Text>
                                ))}
                              </Box>
                            </>
                          )}
                        </Paper>
                      </Stack>
                    );
                  })()}

                  {analytics && (
                    <LeaderboardPanel analytics={analytics} userImages={status.userImages} />
                  )}

                  {analytics && (
                    <AnalyticsPanel
                      analytics={analytics}
                      userImages={status.userImages}
                      anomalyPage={anomalyPage}
                      setAnomalyPage={setAnomalyPage}
                      onOpenAnomalyDetail={openAnomalyDetail}
                    />
                  )}

                  {selectedToken && (
                    <TokenDetailModal
                      tokenKey={selectedToken.key}
                      tk={selectedToken.tk}
                      ins={insights[selectedToken.key]}
                      opened={!!selectedToken}
                      onClose={() => setSelectedToken(null)}
                      customProviders={customProviders}
                    />
                  )}

                  <Modal opened={anomalyModalOpen} onClose={() => { closeAnomalyModal(); setAnomalyDetail(null); }}
                    title="Request Detail" size="lg" centered>
                    {anomalyDetailLoading
                      ? <Group justify="center" py="xl"><Loader size="sm" /></Group>
                      : anomalyDetail
                      ? <DetailContent log={anomalyDetail} />
                      : <Text size="sm" c="dimmed">Failed to load detail.</Text>
                    }
                  </Modal>

                  {isAdmin && (
                    <Stack gap="xs">
                      <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Daily History</Text>
                      <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
                        <DailyHistory isAdmin={isAdmin} userImages={status.userImages} />
                      </Paper>
                    </Stack>
                  )}

                </Stack>
              </Tabs.Panel>

              <Tabs.Panel value="activity">
                <Stack gap="xl">
                  <CompetitionPanel quotaPct={quotaPct} />
                  <AdminUserActivity />
                </Stack>
              </Tabs.Panel>

              <Tabs.Panel value="sessions">
                <SessionsTab tokens={tokens} />
              </Tabs.Panel>

              <Tabs.Panel value="history">
                <FeedHistory />
              </Tabs.Panel>

              <Tabs.Panel value="feed">
                <Box className="feed-tab-panel">
                  <LiveFeed wsSignal={wsSignal} />
                </Box>
              </Tabs.Panel>

            </Tabs>
          </Box>

          {/* ── Right: LiveFeed ── */}
          <Box className="live-feed-col">
            <LiveFeed wsSignal={wsSignal} />
          </Box>

        </Box>
      </Box>

      <BackToTop />
      <FloatingChat userName={profile?.name || profile?.email} />

      {myAlerts.length > 0 && (
        <ContextAlertOverlay alerts={myAlerts} onDismiss={key => setDismissedOverlay(d => [...d, key])} />
      )}
    </Box>
  );
}
