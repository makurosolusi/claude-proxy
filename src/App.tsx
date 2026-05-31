import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Routes, Route } from "react-router-dom";
import { StatusCtx, ChatCtx, NotificationsCtx } from "./contexts";
import type { StatusResponse, ChatMsg, AppNotification, NotificationsCtxType } from "./contexts";
import { notifications } from "@mantine/notifications";
import { LoadingScreen, NotFoundPage, RequireAdmin, RequireAuth, WaitingPage, BlockedPage } from "./components/shared";
import { AdminDashboard } from "./components/admin/Dashboard";
import { MindPage } from "./components/MindPage";
import { SessionHistory } from "./components/SessionHistory";
import { NotificationsPage } from "./components/NotificationsPage";
import { ContextPunishmentScreen } from "./components/ContextPunishmentScreen";
import { GraceBanner } from "./components/GraceBanner";
import { UserNotificationModal } from "./components/UserNotificationModal";
import { Dashboard } from "./pages/Dashboard";
import { LoginPage, LoginRedirect } from "./pages/LoginPage";
import { ProfilePage } from "./pages/ProfilePage";

const NOTIF_KEY  = "cp_notifications";
const MAX_NOTIFS = 200;

function loadNotifs(): AppNotification[] {
  try { return JSON.parse(localStorage.getItem(NOTIF_KEY) || "[]"); } catch { return []; }
}
function saveNotifs(items: AppNotification[]) {
  try { localStorage.setItem(NOTIF_KEY, JSON.stringify(items)); } catch {}
}

export function App() {
  const [status, setStatus]     = useState<StatusResponse | null>(null);
  const [profile, setProfile]   = useState<import("./contexts").ProfileResponse | null | "loading">("loading");
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [wsSignal, setWsSignal] = useState(0);
  const [notifBroadcastSignal, setNotifBroadcastSignal] = useState(0);
  const [notifItems, setNotifItems] = useState<AppNotification[]>(loadNotifs);
  const wsRef      = useRef<WebSocket | null>(null);
  const seenThresh = useRef<Set<string>>(new Set());

  const notifCtx = useMemo<NotificationsCtxType>(() => ({
    items: notifItems,
    unread: notifItems.filter(n => !n.read).length,
    push(n) {
      setNotifItems(prev => {
        const next: AppNotification[] = [
          { ...n, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, ts: Date.now(), read: false },
          ...prev,
        ].slice(0, MAX_NOTIFS);
        saveNotifs(next);
        return next;
      });
    },
    markAllRead() {
      setNotifItems(prev => {
        const next = prev.map(n => ({ ...n, read: true }));
        saveNotifs(next);
        return next;
      });
    },
    clearAll() {
      setNotifItems([]);
      saveNotifs([]);
    },
  }), [notifItems]);

  useEffect(() => {
    const alerts = status?.thresholdAlerts ?? [];
    const TITLE: Record<string, string> = {
      quota_80:     "Quota 80%",
      quota_95:     "Quota 95%",
      high_context: "High Context",
      upstream_85:  "Upstream 85%",
      error_storm:  "Error Storm",
    };
    const COLOR: Record<string, AppNotification["color"]> = {
      quota_95:     "red",
      error_storm:  "red",
      quota_80:     "orange",
      upstream_85:  "orange",
      high_context: "blue",
    };
    for (const a of alerts) {
      const key = `${a.label}:${a.type}:${a.ts}`;
      if (seenThresh.current.has(key)) continue;
      seenThresh.current.add(key);
      const color = COLOR[a.type] ?? "orange";
      setNotifItems(prev => {
        const next: AppNotification[] = [
          { id: `th-${key}`, title: `${TITLE[a.type] ?? a.type} — ${a.label}`, message: a.msg, color, ts: a.ts, read: false },
          ...prev,
        ].slice(0, MAX_NOTIFS);
        saveNotifs(next);
        return next;
      });
    }
  }, [status?.thresholdAlerts]);

  const sendChat = useCallback((nick: string, text: string) => {
    wsRef.current?.send(JSON.stringify({ type: "chat", nick, text }));
  }, []);

  useEffect(() => {
    let ws: WebSocket, dead = false;
    function connect() {
      if (dead) return;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${location.host}/ws`);
      wsRef.current = ws;
      ws.onmessage = e => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === "force_reload")  { window.location.reload(); return; }
          if (data.type === "notif_changed") { setNotifBroadcastSignal(n => n + 1); return; }
          if (data.type === "chat_history")  { setChatMsgs(data.messages); return; }
          if (data.type === "chat_message")  {
            const msg: ChatMsg = data.message;
            setChatMsgs(prev => [...prev.slice(-99), msg]);
            if (msg.type === "system") {
              const text   = msg.text;
              const isErr  = text.includes("🚨") || text.includes("quota") || text.includes("besar") || text.includes("blocked");
              const isWarn = text.includes("⚠️") || text.includes("nearing") || text.includes("80%");
              const isGood = text.includes("🔄") || text.includes("reset") || text.includes("✅");
              const color  = (isErr ? "red" : isWarn ? "orange" : isGood ? "teal" : "blue") as AppNotification["color"];
              const title  = isErr ? "Peringatan sistem" : isGood ? "Info sistem" : "Sistem";
              const body   = text.replace(/^[⚡🚨⚠️🔄✅🗑️🚫]\s?/, "");
              notifications.show({ id: msg.id, title, message: body, color, autoClose: isErr ? 10000 : 6000, withBorder: true });
              setNotifItems(prev => {
                const next: AppNotification[] = [
                  { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, title, message: body, color, ts: Date.now(), read: false },
                  ...prev,
                ].slice(0, MAX_NOTIFS);
                saveNotifs(next);
                return next;
              });
            }
            return;
          }
          if (data.type === "chat_clear") { setChatMsgs([]); return; }
          setStatus(data);
          setWsSignal(n => n + 1);
        } catch {}
      };
      ws.onclose = () => { if (!dead) setTimeout(connect, 3000); };
    }
    connect();
    return () => {
      dead = true;
      if (!ws) return;
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      } else if (ws.readyState === WebSocket.CONNECTING) {
        ws.onopen  = () => ws.close();
        ws.onclose = () => {};
      }
    };
  }, []);

  const statusTs = status?.ts;
  useEffect(() => {
    fetch("/api/profile", { credentials: "include" })
      .then(r => r.json())
      .then(d => setProfile(d))
      .catch(() => setProfile({ authenticated: false }));
  }, [statusTs]);

  const authenticated = profile && profile !== "loading" && profile.authenticated === true;

  return (
    <NotificationsCtx.Provider value={notifCtx}>
      <ChatCtx.Provider value={{ messages: chatMsgs, send: sendChat }}>
        <StatusCtx.Provider value={status}>
          {authenticated && <UserNotificationModal refreshSignal={notifBroadcastSignal} />}
          <Routes>
            <Route path="/" element={
              <RequireAuth profile={profile}>
                {(() => {
                  if (profile === "loading" || !status) return <LoadingScreen />;
                  const isAdmin        = profile?.role === "SUPER_ADMIN" || profile?.role === "ADMIN";
                  const enforcementOn  = profile?.context_block_enforcement_on !== false;
                  const graceActive    = profile?.context_block_grace_until && profile.context_block_grace_until > Date.now();
                  if (profile?.context_blocked && !graceActive && enforcementOn)
                    return <ContextPunishmentScreen reason={profile.context_block_reason} blockedAt={profile.context_blocked_at} />;
                  return (
                    <>
                      {profile?.context_blocked && graceActive && enforcementOn && (
                        <GraceBanner graceUntil={profile.context_block_grace_until!} />
                      )}
                      <Dashboard isAdmin={isAdmin} profile={profile as import("./contexts").ProfileResponse} wsSignal={wsSignal} />
                    </>
                  );
                })()}
              </RequireAuth>
            } />
            <Route path="/admin/*" element={<RequireAdmin><AdminDashboard /></RequireAdmin>} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/login/redirect" element={<LoginRedirect />} />
            <Route path="/menunggu" element={<WaitingPage />} />
            <Route path="/diblokir" element={<BlockedPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/mind" element={<MindPage />} />
            <Route path="/sessions/:user" element={<SessionHistory />} />
            <Route path="/notifications" element={
              <RequireAuth profile={profile}>
                <NotificationsPage isSuperAdmin={profile !== "loading" && profile?.role === "SUPER_ADMIN"} />
              </RequireAuth>
            } />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </StatusCtx.Provider>
      </ChatCtx.Provider>
    </NotificationsCtx.Provider>
  );
}
