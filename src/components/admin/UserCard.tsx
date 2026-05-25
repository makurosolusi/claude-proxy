import { useState, useEffect } from "react";
import {
  Stack, Text, Group, Paper, Table, ThemeIcon, Box, Badge, ActionIcon, Tooltip,
  Button, Progress, Alert, Divider,
} from "@mantine/core";

function fmtMs(ms: number): string {
  if (ms <= 0) return "habis";
  const s   = Math.floor(ms / 1000);
  const m   = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// Isolated counter so we don't rerender the entire UserCard every second.
function GraceCountdown({ until, urgent }: { until: number; urgent: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const remaining = until - now;
  const isUrgent  = urgent || remaining < 5 * 60 * 1000;
  return (
    <Badge size="md" radius="sm" variant="filled" color={isUrgent ? "orange" : "yellow"}
      style={{ fontFamily: "Geist Mono, monospace", fontWeight: 800, fontSize: 12,
        minWidth: 58, textAlign: "center", color: isUrgent ? "#fff7ed" : "#1c1917" }}>
      {fmtMs(remaining)}
    </Badge>
  );
}
import {
  IconRefresh, IconPlayerPause, IconTrash, IconPencil, IconAlertTriangle,
  IconKey, IconPlus, IconCheck, IconBan, IconClock, IconPinnedOff, IconLockOpen, IconHourglass,
} from "@tabler/icons-react";
import { adminPost, fmtRel } from "../../utils";
import { UserAvatar } from "../UserAvatar";
import { modals } from "@mantine/modals";
import { CopyButton } from "./UserModals";
import type { ApiUser, ApiToken } from "./UserModals";

const ACT = 15;
function nf(n: number) { return n.toLocaleString(); }

// Shared metadata for built-in providers + lookup of custom providers passed in.
export interface ProviderInfo { id: string; name: string; color: string; }

const BUILTIN_PROVIDER_MAP: Record<string, ProviderInfo> = {
  inherit:    { id: "inherit",    name: "Auto",       color: "gray"   },
  anthropic:  { id: "anthropic",  name: "Claude",     color: "blue"   },
  deepseek:   { id: "deepseek",   name: "DeepSeek",   color: "violet" },
  openrouter: { id: "openrouter", name: "OpenRouter", color: "orange" },
};

function resolveProvider(id: string, customProviders: ProviderInfo[]): ProviderInfo {
  if (BUILTIN_PROVIDER_MAP[id]) return BUILTIN_PROVIDER_MAP[id];
  const found = customProviders.find(p => p.id === id);
  if (found) return found;
  return { id, name: id, color: "gray" }; // orphaned (e.g., deleted custom provider)
}

// Smart model-name shortening — works for any provider style.
function shortenModel(m: string): string {
  if (!m) return "";
  const stripped = m.includes("/") ? (m.split("/").pop() || m) : m;
  if (stripped.length <= 20) return stripped;
  return stripped.slice(0, 17) + "…";
}

function RoutingBadge({ tk, customProviders }: { tk: ApiToken; customProviders: ProviderInfo[] }) {
  const info  = resolveProvider(tk.provider || "inherit", customProviders);
  const model = tk.pinned_model ? shortenModel(tk.pinned_model) : null;
  const isOrphan = !BUILTIN_PROVIDER_MAP[tk.provider || "inherit"] && !customProviders.find(p => p.id === tk.provider);
  return (
    <Tooltip
      label={isOrphan
        ? `Provider "${tk.provider}" no longer exists — token may fail. Re-assign in Token Details.`
        : `Provider: ${info.name}${model ? ` · Pinned: ${tk.pinned_model}` : " · No pin"}`}
      withArrow>
      <Badge size="xs" variant={isOrphan ? "outline" : "light"} color={isOrphan ? "red" : info.color}>
        {isOrphan && <IconAlertTriangle size={10} style={{ marginRight: 4, verticalAlign: -1 }} />}
        {info.name}{model ? ` · ${model}` : ""}
      </Badge>
    </Tooltip>
  );
}

export function userAggregates(u: ApiUser) {
  const active = u.tokens.filter(t => !t.paused);
  const totalUsed   = u.tokens.reduce((a, t) => a + t.used, 0);
  const todayUsed   = u.tokens.reduce((a, t) => a + t.today, 0);
  const alltime     = u.tokens.reduce((a, t) => a + t.alltime, 0);
  const hasUnlimited = u.tokens.some(t => t.limit === null);
  const totalLimit  = hasUnlimited ? null : u.tokens.reduce((a, t) => a + (t.limit ?? 0), 0);
  const aggPct      = totalLimit && totalLimit > 0 ? Math.round((totalUsed / totalLimit) * 100) : 0;
  const maxPct      = u.tokens.reduce((a, t) => Math.max(a, t.pct), 0);
  const pausedCount = u.tokens.filter(t => t.paused).length;
  const overCount   = u.tokens.filter(t => t.pct > 100).length;
  return { active, totalUsed, todayUsed, alltime, totalLimit, aggPct, maxPct, pausedCount, overCount };
}

export interface UserCardActions {
  rowAction: { key: string; act: string } | null;
  statusBusy: string | null;
  customProviders: ProviderInfo[];  // for routing badge resolution
  onEditUser: (u: ApiUser) => void;
  onDeleteUser: (u: ApiUser) => void;
  onSetStatus: (userId: string, status: "pending" | "approved" | "blocked") => void;
  onEditAllLimits: (u: ApiUser) => void;
  onAddToken: (u: ApiUser) => void;
  onOpenDetail: (token: ApiToken) => void;
  onRowAction: (key: string, act: string, fn: () => Promise<void>, msg: string) => Promise<void>;
  onResetUserPins: (u: ApiUser) => void;
  onBlockContext: (u: ApiUser) => void;
  onUnblockContext: (u: ApiUser) => void;
  onForceGrace: (u: ApiUser) => void;
}

interface TokenRowProps {
  token: ApiToken;
  actions: UserCardActions;
}

function ResetButton({ tk, actions, size }: { tk: ApiToken; actions: UserCardActions; size: "sm" | "xs" }) {
  const iconSize = size === "sm" ? ACT : 11;
  return (
    <Tooltip label="Reset usage" withArrow>
      <ActionIcon variant="subtle" color="gray" size={size}
        loading={actions.rowAction?.key === tk.key && actions.rowAction.act === "reset"}
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          modals.openConfirmModal({
            title: "Reset usage", children: <Text size="sm">Reset usage counter for <b>{tk.key}</b>?</Text>,
            labels: { confirm: "Reset", cancel: "Cancel" }, confirmProps: { color: "gray" },
            onConfirm: () => actions.onRowAction(tk.key, "reset", () => adminPost("/admin/reset", { token: tk.key }), "Usage reset"),
          });
        }}>
        <IconRefresh size={iconSize} />
      </ActionIcon>
    </Tooltip>
  );
}

function TokenTableRow({ token: tk, actions }: TokenRowProps) {
  return (
    <Table.Tr style={{ cursor: "pointer", opacity: tk.paused ? 0.5 : 1 }}
      onClick={() => actions.onOpenDetail(tk)}>
      <Table.Td>
        <Stack gap={2}>
          {tk.label && (
            <Group gap={4} wrap="nowrap">
              <Text size="sm" fw={600}>{tk.label}</Text>
              <RoutingBadge tk={tk} customProviders={actions.customProviders} />
              {tk.paused && <Badge size="xs" color="gray">paused</Badge>}
            </Group>
          )}
          <Group gap={4} wrap="nowrap">
            <IconKey size={12} color="var(--mantine-color-dimmed)" />
            <Text size="xs" ff="monospace" c="dimmed" style={{ letterSpacing: "0.1em" }}>••••••••••••••••</Text>
            <Box onClick={e => e.stopPropagation()}><CopyButton value={tk.key} /></Box>
            {!tk.label && <RoutingBadge tk={tk} customProviders={actions.customProviders} />}
            {!tk.label && tk.paused && <Badge size="xs" color="gray">paused</Badge>}
          </Group>
          {tk.description && <Text size="xs" c="dimmed" lineClamp={1}>{tk.description}</Text>}
        </Stack>
      </Table.Td>
      <Table.Td style={{ minWidth: 140 }}>
        <Group gap="xs" wrap="nowrap">
          <Progress value={Math.min(tk.pct, 100)} color={tk.pct >= 95 ? "red" : tk.pct >= 75 ? "orange" : "teal"} size="sm" style={{ flex: 1 }} />
          <Text size="xs" c="dimmed" ff="monospace">{tk.pct}%</Text>
        </Group>
        <Text size="xs" c="dimmed" ff="monospace" mt={2}>{nf(tk.used)} / {tk.limit === null ? "∞" : nf(tk.limit)}{tk.today > 0 ? ` · ${nf(tk.today)} today` : ""}</Text>
      </Table.Td>
      <Table.Td style={{ width: 40 }} onClick={e => e.stopPropagation()}>
        <ResetButton tk={tk} actions={actions} size="sm" />
      </Table.Td>
    </Table.Tr>
  );
}

function TokenGridCard({ token: tk, actions }: TokenRowProps) {
  return (
    <Paper withBorder p="xs" radius="sm" style={{ cursor: "pointer", opacity: tk.paused ? 0.55 : 1 }}
      onClick={() => actions.onOpenDetail(tk)}>
      <Stack gap={5}>
        {tk.label && (
          <Group gap={4} wrap="nowrap">
            <Text size="xs" fw={600} truncate style={{ flex: 1 }}>{tk.label}</Text>
            <RoutingBadge tk={tk} customProviders={actions.customProviders} />
          </Group>
        )}
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Group gap={4} wrap="nowrap" style={{ minWidth: 0 }}>
            <IconKey size={10} color="var(--mantine-color-dimmed)" style={{ flexShrink: 0 }} />
            <Text size="xs" ff="monospace" c="dimmed" style={{ letterSpacing: "0.06em", flexShrink: 0 }}>••••••••••••</Text>
            <Box onClick={e => e.stopPropagation()}><CopyButton value={tk.key} /></Box>
            {!tk.label && <RoutingBadge tk={tk} customProviders={actions.customProviders} />}
            {tk.paused && <Badge size="xs" color="gray">paused</Badge>}
          </Group>
          <Box onClick={e => e.stopPropagation()}>
            <ResetButton tk={tk} actions={actions} size="xs" />
          </Box>
        </Group>
        <Group gap={6} wrap="nowrap">
          <Progress value={Math.min(tk.pct, 100)} color={tk.pct >= 95 ? "red" : tk.pct >= 75 ? "orange" : "teal"} size="xs" style={{ flex: 1 }} />
          <Text size="xs" c="dimmed" ff="monospace" style={{ minWidth: 32, textAlign: "right" }}>{tk.pct}%</Text>
        </Group>
        <Text size="xs" ff="monospace" c="dimmed">{nf(tk.used)} / {tk.limit === null ? "∞" : nf(tk.limit)}{tk.today > 0 ? ` · ${nf(tk.today)} today` : ""}</Text>
        {tk.description && <Text size="xs" c="dimmed" lineClamp={2}>{tk.description}</Text>}
      </Stack>
    </Paper>
  );
}

interface UserCardProps {
  user: ApiUser;
  userImage?: string;
  viewMode: "grid" | "list";
  actions: UserCardActions;
}

export function UserCard({ user: u, userImage, viewMode, actions }: UserCardProps) {
  const agg = userAggregates(u);
  const limitLabel = agg.totalLimit === null ? "∞" : nf(agg.totalLimit);

  const statusColor = u.status === "approved" ? "teal" : u.status === "blocked" ? "red" : "yellow";
  const statusLabel = u.status === "approved" ? "Approved" : u.status === "blocked" ? "Blocked" : "Pending";
  const StatusIcon  = u.status === "approved" ? IconCheck : u.status === "blocked" ? IconBan : IconClock;

  const { statusBusy, onEditUser, onDeleteUser, onSetStatus, onEditAllLimits, onAddToken, onResetUserPins, onBlockContext, onUnblockContext, onForceGrace } = actions;
  const hasPinnedTokens = u.tokens.some(t => t.pinned_model);

  const tokensList = u.tokens.length === 0 ? (
    <Paper withBorder p="md" radius="sm" ta="center">
      <Stack gap="xs" align="center">
        <ThemeIcon variant="light" color="gray" size="lg" radius="xl"><IconKey size={16} /></ThemeIcon>
        <Text size="sm" c="dimmed">This user has no tokens yet.</Text>
        <Button size="xs" variant="light" color="teal" leftSection={<IconPlus size={12} />} onClick={() => onAddToken(u)}>Create first token</Button>
      </Stack>
    </Paper>
  ) : viewMode === "list" ? (
    <Box style={{ overflowX: "auto" }}>
      <Table withRowBorders highlightOnHover verticalSpacing="xs">
        <Table.Thead>
          <Table.Tr>
            {["Token","Usage",""].map((h, i) => (
              <Table.Th key={i} style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", whiteSpace: "nowrap" }}>{h}</Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {u.tokens.map(tk => <TokenTableRow key={tk.key} token={tk} actions={actions} />)}
        </Table.Tbody>
      </Table>
    </Box>
  ) : (
    <Stack gap={6}>
      {u.tokens.map(tk => <TokenGridCard key={tk.key} token={tk} actions={actions} />)}
    </Stack>
  );

  if (viewMode === "list") {
    const header = (
      <Group gap="md" wrap="nowrap" align="center">
        <UserAvatar name={u.name} imageUrl={userImage} size={38} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs" wrap="nowrap">
            <Text size="sm" fw={700} truncate>{u.name}</Text>
            {!u.email && <Badge size="xs" variant="light" color="yellow" leftSection={<IconAlertTriangle size={10} />}>Legacy</Badge>}
            <Badge size="xs" variant="light" color={statusColor} leftSection={<StatusIcon size={10} />}>{statusLabel}</Badge>
            <Badge size="xs" variant="light" color="gray">{u.tokens.length} token{u.tokens.length !== 1 ? "s" : ""}</Badge>
            {agg.pausedCount > 0 && <Badge size="xs" variant="light" color="orange" leftSection={<IconPlayerPause size={10} />}>{agg.pausedCount} paused</Badge>}
            {agg.overCount > 0 && <Badge size="xs" variant="light" color="red" leftSection={<IconAlertTriangle size={10} />}>{agg.overCount} over</Badge>}
          </Group>
          <Group gap="md" wrap="nowrap" mt={4}>
            <Text size="xs" c="dimmed" ff="monospace" style={{ whiteSpace: "nowrap" }}>{nf(agg.totalUsed)} / {limitLabel}</Text>
            {agg.todayUsed > 0 && <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>today <Text span ff="monospace" c="bright">{nf(agg.todayUsed)}</Text></Text>}
          </Group>
        </div>
        <Group gap={2} wrap="nowrap" onClick={e => e.stopPropagation()}>
          {u.status !== "approved" && (
            <Tooltip label="Approve user" withArrow>
              <ActionIcon variant="subtle" color="teal" size="sm" radius="sm"
                loading={statusBusy === u.id + "approved"}
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); onSetStatus(u.id, "approved"); }}>
                <IconCheck size={ACT} />
              </ActionIcon>
            </Tooltip>
          )}
          {u.status !== "blocked" && (
            <Tooltip label="Block user" withArrow>
              <ActionIcon variant="subtle" color="red" size="sm" radius="sm"
                loading={statusBusy === u.id + "blocked"}
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); onSetStatus(u.id, "blocked"); }}>
                <IconBan size={ACT} />
              </ActionIcon>
            </Tooltip>
          )}
          <Tooltip label="Edit user" withArrow>
            <ActionIcon variant="subtle" color="gray" size="sm"
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); onEditUser(u); }}>
              <IconPencil size={ACT} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Delete user" withArrow>
            <ActionIcon variant="subtle" color="red" size="sm"
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); onDeleteUser(u); }}>
              <IconTrash size={ACT} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
    );

    const body = (
      <Stack gap="sm">
        {u.context_blocked_at && (() => {
          const graceActive = !!(u.context_block_grace_until && u.context_block_grace_until > Date.now());
          return (
            <Alert color={graceActive ? "yellow" : "red"}
              variant="light" icon={<IconAlertTriangle size={14} />} p="xs" radius="sm">
              <Group justify="space-between" wrap="nowrap" gap="xs">
                <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                  <Group gap={6} wrap="nowrap" align="center">
                    <Text size="xs" fw={700}>
                      {graceActive ? "⏳ Grace aktif" : "⛔ Context Block aktif"}
                    </Text>
                    {graceActive && <GraceCountdown until={u.context_block_grace_until!} urgent={false} />}
                  </Group>
                  <Text size="xs" c="dimmed" lineClamp={2}>{u.context_block_reason}</Text>
                </Stack>
                <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                  <Tooltip label="Beri 30 menit grace — user bisa /compact tanpa re-block" withArrow>
                    <Button size="xs" color="yellow" variant="light" leftSection={<IconHourglass size={12} />}
                      onClick={() => onForceGrace(u)}>
                      Force 30m
                    </Button>
                  </Tooltip>
                  <Button size="xs" color="red" variant="filled" leftSection={<IconLockOpen size={12} />}
                    onClick={() => onUnblockContext(u)}>
                    Unblock
                  </Button>
                </Group>
              </Group>
            </Alert>
          );
        })()}
        {!u.email && (
          <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={14} />} p="xs" radius="sm">
            <Text size="xs"><b>Legacy user</b> — no Google account linked. Set an email via Edit to allow migration, or purge once all users have migrated.</Text>
          </Alert>
        )}
        <Group justify="space-between">
          <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: ".05em" }}>Tokens</Text>
          <Group gap="xs">
            {!u.context_blocked_at && (
              <Tooltip label="Paksa layar merah context-block pada user ini" withArrow>
                <Button size="xs" variant="subtle" color="red" leftSection={<IconAlertTriangle size={12} />}
                  onClick={() => onBlockContext(u)}>
                  Block Context
                </Button>
              </Tooltip>
            )}
            {hasPinnedTokens && <Button size="xs" variant="subtle" color="gray" leftSection={<IconPinnedOff size={12} />} onClick={() => onResetUserPins(u)}>Reset Pinned</Button>}
            {u.tokens.length > 0 && <Button size="xs" variant="subtle" color="gray" leftSection={<IconPencil size={12} />} onClick={() => onEditAllLimits(u)}>Edit All Limits</Button>}
            <Button size="xs" variant="light" color="blue" leftSection={<IconPlus size={12} />} onClick={() => onAddToken(u)}>Add Token</Button>
          </Group>
        </Group>
        {tokensList}
      </Stack>
    );

    return (
      <Paper withBorder radius="md">
        <Box px="md" pt="md" pb="xs">{header}</Box>
        <Divider />
        <Box px="md" pb="md" pt="xs">{body}</Box>
      </Paper>
    );
  }

  const gridHeader = (
    <Group gap="sm" wrap="nowrap" align="flex-start">
      <UserAvatar name={u.name} imageUrl={userImage} size={38} />
      <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Text size="sm" fw={700} truncate>{u.name}</Text>
          <Group gap={2} wrap="nowrap" style={{ flexShrink: 0 }}>
            <Tooltip label="Edit user" withArrow>
              <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => onEditUser(u)}>
                <IconPencil size={ACT} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Delete user" withArrow>
              <ActionIcon variant="subtle" color="red" size="sm" onClick={() => onDeleteUser(u)}>
                <IconTrash size={ACT} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
        <Group gap={4} wrap="wrap">
          {!u.email && <Badge size="xs" variant="light" color="yellow" leftSection={<IconAlertTriangle size={10} />}>Legacy</Badge>}
          <Badge size="xs" variant="light" color="gray">{u.tokens.length} token{u.tokens.length !== 1 ? "s" : ""}</Badge>
          {agg.pausedCount > 0 && <Badge size="xs" variant="light" color="orange" leftSection={<IconPlayerPause size={10} />}>{agg.pausedCount} paused</Badge>}
          {agg.overCount > 0 && <Badge size="xs" variant="light" color="red" leftSection={<IconAlertTriangle size={10} />}>{agg.overCount} over</Badge>}
        </Group>
      </Stack>
    </Group>
  );

  const gridBody = (
    <Stack gap="sm">
      {u.context_blocked_at && (() => {
        const graceActive = !!(u.context_block_grace_until && u.context_block_grace_until > Date.now());
        return (
          <Alert color={graceActive ? "yellow" : "red"}
            variant="light" icon={<IconAlertTriangle size={14} />} p="xs" radius="sm">
            <Group justify="space-between" wrap="nowrap" gap="xs">
              <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                <Group gap={6} wrap="nowrap" align="center">
                  <Text size="xs" fw={700}>
                    {graceActive ? "⏳ Grace aktif" : "⛔ Context Block aktif"}
                  </Text>
                  {graceActive && <GraceCountdown until={u.context_block_grace_until!} urgent={false} />}
                </Group>
                <Text size="xs" c="dimmed" lineClamp={2}>{u.context_block_reason}</Text>
              </Stack>
              <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                <Tooltip label="Beri 30 menit grace" withArrow>
                  <Button size="xs" color="yellow" variant="light" leftSection={<IconHourglass size={12} />}
                    onClick={() => onForceGrace(u)}>
                    30m
                  </Button>
                </Tooltip>
                <Button size="xs" color="red" variant="filled" leftSection={<IconLockOpen size={12} />}
                  onClick={() => onUnblockContext(u)}>
                  Unblock
                </Button>
              </Group>
            </Group>
          </Alert>
        );
      })()}
      {!u.email && (
        <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={14} />} p="xs" radius="sm">
          <Text size="xs"><b>Legacy user</b> — no Google account linked. Set an email via Edit to allow migration.</Text>
        </Alert>
      )}
      <Paper withBorder={false} bg="var(--mantine-color-default-hover)" p="xs" radius="sm">
        <Group gap="xs" wrap="wrap">
          <Box><Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".05em" }}>Created</Text><Text size="xs">{fmtRel(u.created_at)}</Text></Box>
          <Box><Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".05em" }}>All-time</Text><Text size="xs" ff="monospace">{nf(agg.alltime)}</Text></Box>
          {u.email && <Box style={{ flex: 1, minWidth: 0 }}><Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".05em" }}>Google</Text><Text size="xs" c="blue" truncate>{u.email}</Text></Box>}
        </Group>
        {u.description && <Text size="xs" c="dimmed" mt={4} lineClamp={2}>{u.description}</Text>}
      </Paper>
      <Group justify="space-between" align="center">
        <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: ".05em" }}>Tokens</Text>
        <Group gap={4}>
          {!u.context_blocked_at && (
            <Tooltip label="Paksa layar merah context-block" withArrow>
              <Button size="xs" variant="subtle" color="red" leftSection={<IconAlertTriangle size={11} />}
                onClick={() => onBlockContext(u)}>
                Block
              </Button>
            </Tooltip>
          )}
          {hasPinnedTokens && <Button size="xs" variant="subtle" color="gray" leftSection={<IconPinnedOff size={11} />} onClick={() => onResetUserPins(u)}>Reset</Button>}
          {u.tokens.length > 0 && <Button size="xs" variant="subtle" color="gray" leftSection={<IconPencil size={11} />} onClick={() => onEditAllLimits(u)}>Edit All</Button>}
          <Button size="xs" variant="light" color="blue" leftSection={<IconPlus size={11} />} onClick={() => onAddToken(u)}>Add</Button>
        </Group>
      </Group>
      {tokensList}
    </Stack>
  );

  return (
    <Paper withBorder radius="md" style={{ display: "flex", flexDirection: "column" }}>
      <Box px="md" pt="md" pb="sm">{gridHeader}</Box>
      <Divider />
      <Box px="md" pb="md" pt="sm" style={{ flex: 1 }}>{gridBody}</Box>
    </Paper>
  );
}
