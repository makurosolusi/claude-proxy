import { useState, useEffect, useCallback, useRef } from "react";
import {
  Paper, Group, Text, ActionIcon, Tooltip, Stack, ScrollArea,
  Badge, TextInput, Button,
} from "@mantine/core";
import {
  IconMessageCircle, IconTrash, IconBan, IconBolt, IconUserOff,
  IconPencil, IconMinus, IconSend,
} from "@tabler/icons-react";
import { useStatus, useChat } from "../contexts";

function nickColor(nick: string): string {
  const palette = ["blue","teal","grape","violet","cyan","green","orange","pink"];
  let h = 0;
  for (let i = 0; i < nick.length; i++) h = nick.charCodeAt(i) + ((h << 5) - h);
  return palette[Math.abs(h) % palette.length];
}

export function FloatingChat() {
  const { messages, send } = useChat();
  const isAdmin = useStatus()?.isAdmin ?? false;
  const [open, setOpen]         = useState(false);
  const [unread, setUnread]     = useState(0);
  const [nick, setNick]         = useState(() => {
    try { return localStorage.getItem("chat-nick") || ""; } catch { return ""; }
  });
  const [editingNick, setEditingNick] = useState(false);
  const [nickDraft, setNickDraft]     = useState("");
  const [text, setText]               = useState("");
  const [hoveredId, setHoveredId]     = useState<string | null>(null);
  const [blocked, setBlocked]         = useState<string[]>([]);
  const [showBlocked, setShowBlocked] = useState(false);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLInputElement>(null);
  const prevLen    = useRef(0);

  const loadBlocked = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const r = await fetch("/admin/chat/blocked");
      const d = await r.json() as any;
      setBlocked(d.blocked ?? []);
    } catch {}
  }, [isAdmin]);

  useEffect(() => { if (open && isAdmin) loadBlocked(); }, [open, isAdmin, loadBlocked]);

  const adminClear = async () => {
    await fetch("/admin/chat/clear", { method: "POST" });
  };

  const adminBlock = async (blockNick: string) => {
    await fetch("/admin/chat/block", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nick: blockNick }),
    });
    setBlocked(prev => [...prev, blockNick.toLowerCase()]);
  };

  const adminUnblock = async (blockNick: string) => {
    await fetch("/admin/chat/unblock", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nick: blockNick }),
    });
    setBlocked(prev => prev.filter(b => b !== blockNick.toLowerCase()));
  };

  useEffect(() => {
    if (messages.length <= prevLen.current) { prevLen.current = messages.length; return; }
    const newMsgs = messages.slice(prevLen.current);
    prevLen.current = messages.length;
    const chatMsgs = newMsgs.filter(m => m.type === "chat");
    if (chatMsgs.length === 0) return;
    if (!open) {
      setUnread(u => u + chatMsgs.length);
      if (Notification.permission === "granted" && document.hidden) {
        const last = chatMsgs[chatMsgs.length - 1];
        new Notification(last.nick, { body: last.text.slice(0, 120) });
      }
    }
  }, [messages, open]);

  useEffect(() => {
    if (open) setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, [messages, open]);

  useEffect(() => {
    if (open && Notification.permission === "default") Notification.requestPermission();
  }, [open]);

  const toggle = () => setOpen(o => { if (!o) setUnread(0); return !o; });

  const saveNick = (draft: string) => {
    const n = draft.trim().slice(0, 20);
    if (!n) return;
    setNick(n);
    setEditingNick(false);
    try { localStorage.setItem("chat-nick", n); } catch {}
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const onSend = () => {
    const t = text.trim();
    if (!t || !nick) return;
    send(nick, t);
    setText("");
    inputRef.current?.focus();
  };

  const fmtTs = (ts: number) => {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  };

  const showNickSetup = !nick || editingNick;

  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 1000, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>

      {open && (
        <Paper withBorder shadow="xl" mb={10}
          style={{ width: 320, height: 420, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          <Group justify="space-between" px="sm" py={8}
            style={{ borderBottom: "1px solid var(--mantine-color-default-border)", flexShrink: 0 }}>
            <Group gap={6}>
              <IconMessageCircle size={15} />
              <Text size="sm" fw={600}>Team Chat</Text>
              {messages.length > 0 && (
                <Text size="xs" c="dimmed">· {messages.filter(m => m.type === "chat").length}</Text>
              )}
            </Group>
            <Group gap={4}>
              {isAdmin && (
                <>
                  <Tooltip label="Clear chat" withArrow position="left">
                    <ActionIcon size="sm" variant="subtle" color="red" onClick={adminClear}>
                      <IconTrash size={13} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={showBlocked ? "Hide blocked" : `Blocked users${blocked.length > 0 ? ` (${blocked.length})` : ""}`} withArrow position="left">
                    <ActionIcon
                      size="sm" variant={showBlocked ? "filled" : "subtle"} color="orange"
                      onClick={() => { setShowBlocked(v => !v); loadBlocked(); }}
                    >
                      <IconBan size={13} />
                    </ActionIcon>
                  </Tooltip>
                </>
              )}
              <ActionIcon size="sm" variant="subtle" color="gray" onClick={toggle}>
                <IconMinus size={13} />
              </ActionIcon>
            </Group>
          </Group>

          <ScrollArea style={{ flex: 1 }} px="xs" py={6}>
            {messages.length === 0 && (
              <Text size="xs" c="dimmed" ta="center" mt="xl">No messages yet. Say hi! 👋</Text>
            )}
            {messages.map(msg => {
              const isMine = msg.type === "chat" && msg.nick === nick;

              if (msg.type === "system") return (
                <div key={msg.id} style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4,
                    background: "var(--mantine-color-dark-6)", borderRadius: 20, padding: "3px 10px" }}>
                    <IconBolt size={10} color="var(--mantine-color-yellow-4)" />
                    <Text size="xs" c="dimmed" fs="italic">{msg.text}</Text>
                    <Text size="xs" c="dimmed" style={{ opacity: 0.6 }}>{fmtTs(msg.ts)}</Text>
                  </div>
                </div>
              );

              const isBlocked = blocked.includes(msg.nick.toLowerCase());
              return (
                <div key={msg.id}
                  style={{ display: "flex", flexDirection: "column",
                    alignItems: isMine ? "flex-end" : "flex-start", marginBottom: 10 }}
                  onMouseEnter={() => setHoveredId(msg.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  {!isMine && (
                    <Group gap={4} mb={2} align="center" style={{ paddingLeft: 4 }}>
                      <Text size="xs" fw={700} c={isBlocked ? "dimmed" : nickColor(msg.nick)}>
                        {msg.nick}{isBlocked && " 🚫"}
                      </Text>
                      {isAdmin && hoveredId === msg.id && (
                        <Tooltip label={isBlocked ? "Unblock" : "Block user"} withArrow position="top">
                          <ActionIcon
                            size="xs" variant="subtle" color={isBlocked ? "teal" : "red"}
                            onClick={() => isBlocked ? adminUnblock(msg.nick) : adminBlock(msg.nick)}
                          >
                            <IconUserOff size={11} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </Group>
                  )}

                  <div style={{
                    maxWidth: "78%", padding: "7px 11px",
                    borderRadius: isMine ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                    background: isMine ? "var(--mantine-color-blue-6)" : "var(--mantine-color-dark-5)",
                    opacity: isBlocked ? 0.5 : 1,
                  }}>
                    <Text size="xs" style={{ wordBreak: "break-word", lineHeight: 1.55,
                      color: isMine ? "#fff" : "var(--mantine-color-text)" }}>
                      {msg.text}
                    </Text>
                  </div>

                  <Text size="xs" c="dimmed" mt={2} style={{ paddingInline: 4, opacity: 0.7 }}>
                    {fmtTs(msg.ts)}
                  </Text>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </ScrollArea>

          {isAdmin && showBlocked && (
            <div style={{ borderTop: "1px solid var(--mantine-color-default-border)",
              padding: "8px", flexShrink: 0, maxHeight: 120, overflowY: "auto" }}>
              <Text size="xs" fw={600} c="dimmed" mb={4}>Blocked users</Text>
              {blocked.length === 0 ? (
                <Text size="xs" c="dimmed">No blocked users</Text>
              ) : (
                <Stack gap={4}>
                  {blocked.map(b => (
                    <Group key={b} justify="space-between">
                      <Group gap={4}>
                        <IconBan size={11} color="var(--mantine-color-red-5)" />
                        <Text size="xs" ff="monospace">{b}</Text>
                      </Group>
                      <Button size="xs" variant="subtle" color="teal"
                        onClick={() => adminUnblock(b)}>
                        Unblock
                      </Button>
                    </Group>
                  ))}
                </Stack>
              )}
            </div>
          )}

          {showNickSetup && (
            <div style={{ borderTop: "1px solid var(--mantine-color-default-border)", padding: "8px 8px", flexShrink: 0 }}>
              <Text size="xs" c="dimmed" mb={4}>
                {editingNick ? "Change your nickname:" : "Set your nickname to start chatting:"}
              </Text>
              <Group gap="xs">
                <TextInput
                  placeholder="Your name…"
                  value={nickDraft}
                  onChange={e => setNickDraft(e.currentTarget.value)}
                  onKeyDown={e => { if (e.key === "Enter") saveNick(nickDraft); if (e.key === "Escape") { setEditingNick(false); setNickDraft(""); } }}
                  size="xs"
                  style={{ flex: 1 }}
                  maxLength={20}
                  autoFocus
                />
                <Button size="xs" disabled={!nickDraft.trim()} onClick={() => saveNick(nickDraft)}>
                  {editingNick ? "Save" : "Set"}
                </Button>
                {editingNick && (
                  <Button size="xs" variant="subtle" color="gray" onClick={() => { setEditingNick(false); setNickDraft(""); }}>
                    Cancel
                  </Button>
                )}
              </Group>
            </div>
          )}

          {!showNickSetup && (
            <div style={{ borderTop: "1px solid var(--mantine-color-default-border)", padding: "6px 8px", flexShrink: 0 }}>
              <Group gap={4} mb={4} align="center">
                <Text size="xs" c="dimmed">as <Text span fw={600} c={nickColor(nick)}>{nick}</Text></Text>
                <Tooltip label="Change nickname" withArrow position="top">
                  <ActionIcon size="xs" variant="subtle" color="gray"
                    onClick={() => { setNickDraft(nick); setEditingNick(true); }}>
                    <IconPencil size={10} />
                  </ActionIcon>
                </Tooltip>
              </Group>
              <Group gap="xs">
                <TextInput
                  ref={inputRef}
                  placeholder="Message…"
                  value={text}
                  onChange={e => setText(e.currentTarget.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }}
                  size="xs"
                  style={{ flex: 1 }}
                  maxLength={500}
                />
                <ActionIcon size="md" variant="filled" disabled={!text.trim()} onClick={onSend}>
                  <IconSend size={14} />
                </ActionIcon>
              </Group>
            </div>
          )}
        </Paper>
      )}

      <div style={{ position: "relative" }}>
        <ActionIcon size={48} radius="xl" variant="filled" color="blue" onClick={toggle}>
          <IconMessageCircle size={22} />
        </ActionIcon>
        {unread > 0 && (
          <Badge size="xs" color="red" circle
            style={{ position: "absolute", top: -2, right: -2, minWidth: 18, height: 18, padding: 0, fontSize: 10 }}>
            {unread > 9 ? "9+" : unread}
          </Badge>
        )}
      </div>
    </div>
  );
}
