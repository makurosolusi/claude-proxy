import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Stack, SimpleGrid, Text, Group, Paper, TextInput, ThemeIcon,
  Loader, Select, Switch, SegmentedControl,
} from "@mantine/core";
import {
  IconRefresh, IconPlayerPause, IconTrash, IconPencil, IconAlertTriangle,
  IconSearch, IconArrowsSort, IconLayoutGrid, IconList,
} from "@tabler/icons-react";
import { adminPost } from "../../utils";
import { useStatus } from "../../contexts";
import type { TokenStatus } from "../../contexts";
import { notifications } from "@mantine/notifications";
import { modals } from "@mantine/modals";
import {
  EditUserModal, DeleteUserModal, EditAllLimitsModal,
  RotateModal, AddTokenModal, EditAllLimitsGlobalModal,
} from "./UserModals";
import type { ApiUser, ApiToken } from "./UserModals";
import { UserCard, userAggregates } from "./UserCard";
import type { UserCardActions, ProviderInfo } from "./UserCard";
import { TokenDetailModal } from "./TokenDetailModal";

type UserStatus = "pending" | "approved" | "blocked";
type SortKey = "name" | "usage" | "tokens" | "newest";

export function AdminUsers({ tokens: tokenStatuses }: { tokens: Record<string, TokenStatus> }) {
  const status = useStatus();
  const userImages = status?.userImages ?? {};
  const [apiUsers, setApiUsers]       = useState<ApiUser[] | null>(null);
  const [editUser, setEditUser]           = useState<ApiUser | null>(null);
  const [deleteUser, setDeleteUser]       = useState<ApiUser | null>(null);
  const [rotateToken, setRotateToken]     = useState<ApiToken | null>(null);
  const [detailToken, setDetailToken]     = useState<ApiToken | null>(null);
  const [editAllLimits, setEditAllLimits]         = useState<ApiUser | null>(null);
  const [showEditAllGlobal, setShowEditAllGlobal] = useState(false);
  const [addTokenTo, setAddTokenTo]               = useState<ApiUser | null>(null);
  const [search, setSearch]           = useState("");
  const [sort, setSort]               = useState<SortKey>(() => {
    try {
      const saved = localStorage.getItem("admin-users-sort");
      if (saved === "name" || saved === "usage" || saved === "tokens" || saved === "newest") return saved;
    } catch {}
    return "usage";
  });
  const [viewMode, setViewMode]         = useState<"grid" | "list">(() => {
    try { return (localStorage.getItem("admin-users-view") as "grid" | "list") || "grid"; }
    catch { return "grid"; }
  });
  const [rowAction, setRowAction]           = useState<{ key: string; act: string } | null>(null);
  const [bulkAction, setBulkAction]         = useState<"reset" | "pause" | "purge" | null>(null);
  const [statusBusy, setStatusBusy]         = useState<string | null>(null);
  const [demoMode, setDemoMode]             = useState(false);
  const [demoSaving, setDemoSaving]         = useState(false);
  const [customProviders, setCustomProviders] = useState<ProviderInfo[]>([]);

  useEffect(() => {
    fetch("/api/admin/custom-providers")
      .then(r => r.ok ? r.json() : { providers: [] })
      .then((d: any) => {
        const list: ProviderInfo[] = (Array.isArray(d?.providers) ? d.providers : [])
          .map((p: any) => ({ id: p.id, name: p.name, color: p.color || "gray" }));
        setCustomProviders(list);
      })
      .catch(() => {});
  }, []);

  const reload = useCallback(async () => {
    const res = await fetch("/api/admin/users");
    const data = await res.json();
    setApiUsers(data.users ?? data);
  }, []);

  // Auto-refresh detailToken when apiUsers reloads — keeps modal in sync
  useEffect(() => {
    if (!detailToken || !apiUsers) return;
    const key = detailToken.key;
    for (const u of apiUsers) {
      const fresh: ApiToken | undefined = u.tokens.find(t => t.key === key);
      if (fresh && fresh !== detailToken) {
        setDetailToken(fresh);
        return;
      }
      if (fresh) return;
    }
    // Token no longer exists (deleted) — close modal
    setDetailToken(null);
  }, [apiUsers]);

  const setUserStatus = async (userId: string, status: UserStatus) => {
    setStatusBusy(userId + status);
    try {
      await adminPost("/admin/user/set-status", { user_id: userId, status });
      await reload();
      const label = status === "approved" ? "Approved" : status === "blocked" ? "Blocked" : "Set to pending";
      notifications.show({ color: status === "blocked" ? "red" : "teal", message: label, autoClose: 2000 });
    } catch {
      notifications.show({ color: "red", message: "Failed to update status", autoClose: 3000 });
    } finally {
      setStatusBusy(null);
    }
  };

  const runRowAction = async (key: string, act: string, fn: () => Promise<void>, msg: string) => {
    setRowAction({ key, act });
    try {
      await fn(); await reload();
      notifications.show({ color: "teal", message: msg, autoClose: 2000 });
    } catch (e: any) {
      notifications.show({ color: "red", title: "Error", message: e.message || "Action failed", autoClose: 4000 });
    } finally { setRowAction(null); }
  };

  const runBulkAction = async (act: "reset" | "pause" | "purge", fn: () => Promise<void>, msg: string) => {
    setBulkAction(act);
    try {
      await fn(); await reload();
      notifications.show({ color: "teal", message: msg, autoClose: 2000 });
    } catch (e: any) {
      notifications.show({ color: "red", title: "Error", message: e.message || "Action failed", autoClose: 4000 });
    } finally { setBulkAction(null); }
  };

  const unblockContext = async (u: ApiUser) => {
    try {
      await adminPost("/admin/user/unblock-context", { user_id: u.id });
      await reload();
      notifications.show({ color: "teal", message: `Context block cleared for ${u.name}`, autoClose: 3000 });
    } catch (e: any) {
      notifications.show({ color: "red", title: "Error", message: e.message || "Failed", autoClose: 4000 });
    }
  };

  const resetUserPins = (u: ApiUser) => {
    modals.openConfirmModal({
      title: "Reset Pinned Models",
      children: <Text size="sm">Clear pinned model on all <b>{u.tokens.length}</b> token(s) for <b>{u.name}</b>? Each token will go back to Auto.</Text>,
      labels: { confirm: "Reset", cancel: "Cancel" },
      confirmProps: { color: "gray" },
      onConfirm: async () => {
        try {
          await adminPost("/admin/token/pin-all", { model: "", user_id: u.id });
          await reload();
          notifications.show({ color: "teal", message: `Pinned models cleared for ${u.name}`, autoClose: 2000 });
        } catch (e: any) {
          notifications.show({ color: "red", title: "Error", message: e.message || "Failed", autoClose: 4000 });
        }
      },
    });
  };

  const statusTs = status?.ts;
  useEffect(() => { reload(); }, [reload, statusTs]);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then(r => r.json())
      .then((d: any) => setDemoMode(d.demo_mode === "true"))
      .catch(() => {});
  }, []);

  const toggleDemo = async (val: boolean) => {
    setDemoSaving(true);
    try {
      const form = new URLSearchParams();
      form.set("demo", val ? "true" : "false");
      await fetch("/admin/settings/demo", { method: "POST", body: form });
      setDemoMode(val);
      notifications.show({ color: val ? "blue" : "gray", message: val ? "Demo mode enabled" : "Demo mode disabled", autoClose: 2000 });
    } finally { setDemoSaving(false); }
  };

  const filteredUsers = useMemo(() => {
    if (!apiUsers) return null;
    const q = search.trim().toLowerCase();
    let list = apiUsers;
    if (q) {
      list = list.filter(u =>
        u.name.toLowerCase().includes(q) ||
        u.description.toLowerCase().includes(q) ||
        u.tokens.some(t => t.key.toLowerCase().includes(q) || (t.label || "").toLowerCase().includes(q))
      );
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sort) {
        case "name":   return a.name.localeCompare(b.name);
        case "tokens": return b.tokens.length - a.tokens.length;
        case "newest": return b.created_at - a.created_at;
        case "usage":
        default: {
          const ua = userAggregates(a).totalUsed;
          const ub = userAggregates(b).totalUsed;
          return ub - ua;
        }
      }
    });
    return sorted;
  }, [apiUsers, search, sort]);

  const entries    = Object.entries(tokenStatuses);
  const total      = entries.length;
  const paused     = entries.filter(([, t]) => t.paused).length;
  const overLimit  = entries.filter(([, t]) => t.pct > 100).length;

  const cardActions: UserCardActions = {
    rowAction, statusBusy, customProviders,
    onEditUser: setEditUser,
    onDeleteUser: setDeleteUser,
    onSetStatus: setUserStatus,
    onEditAllLimits: setEditAllLimits,
    onAddToken: setAddTokenTo,
    onOpenDetail: setDetailToken,
    onRowAction: runRowAction,
    onResetUserPins: resetUserPins,
    onUnblockContext: unblockContext,
  };

  return (
    <Stack gap="xl">
      {editUser          && <EditUserModal       user={editUser}       onClose={() => setEditUser(null)}             onSaved={reload} />}
      {deleteUser        && <DeleteUserModal     user={deleteUser}     onClose={() => setDeleteUser(null)}           onDone={reload} />}
      {rotateToken       && <RotateModal         token={rotateToken}   onClose={() => setRotateToken(null)}          onDone={reload} />}
      {editAllLimits     && <EditAllLimitsModal  user={editAllLimits}  onClose={() => setEditAllLimits(null)}        onSaved={reload} />}
      {showEditAllGlobal && <EditAllLimitsGlobalModal onClose={() => setShowEditAllGlobal(false)} onSaved={reload} />}
      {addTokenTo        && <AddTokenModal       user={addTokenTo}     onClose={() => setAddTokenTo(null)}           onDone={reload} />}
      {detailToken       && <TokenDetailModal    token={detailToken}   onClose={() => setDetailToken(null)}          onSaved={reload}
                                                  onRotate={setRotateToken} />}

      {/* Header */}
      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" wrap="wrap">
          <div>
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }} mb={4}>User Management</Text>
            <Text size="xl" fw={800} ff="monospace">Users & Tokens</Text>
            <Text size="sm" c="dimmed" mt={2}>{total} token(s) · {apiUsers?.length ?? "…"} user(s)</Text>
          </div>
          <Group gap="xs">
            {paused > 0 && (
              <Paper withBorder p="xs" radius="md">
                <Group gap="xs">
                  <IconPlayerPause size={14} color="var(--mantine-color-orange-5)" />
                  <Text size="xs" fw={600} c="orange">{paused}</Text>
                  <Text size="xs" c="dimmed">paused</Text>
                </Group>
              </Paper>
            )}
            {overLimit > 0 && (
              <Paper withBorder p="xs" radius="md">
                <Group gap="xs">
                  <IconAlertTriangle size={14} color="var(--mantine-color-red-5)" />
                  <Text size="xs" fw={600} c="red">{overLimit}</Text>
                  <Text size="xs" c="dimmed">over</Text>
                </Group>
              </Paper>
            )}
          </Group>
        </Group>
      </Paper>

      {/* Demo Mode */}
      <Paper withBorder p="md" radius="md" style={{ borderColor: demoMode ? "var(--mantine-color-blue-5)" : undefined }}>
        <Group justify="space-between" wrap="nowrap">
          <div>
            <Text size="sm" fw={700}>Demo Mode</Text>
            <Text size="xs" c="dimmed" mt={2}>
              Jika aktif, semua user dengan status <b>pending</b> bisa langsung login ke <code>/</code> tanpa perlu persetujuan.
            </Text>
          </div>
          <Switch
            checked={demoMode}
            disabled={demoSaving}
            onChange={e => toggleDemo(e.currentTarget.checked)}
            color="blue"
            size="md"
          />
        </Group>
      </Paper>


      {/* Token lifecycle actions — 2x2 grid */}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        <Paper withBorder p="sm" radius="md" style={{ cursor: "pointer" }}
          onClick={() => setShowEditAllGlobal(true)}>
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon variant="light" color="blue" size="lg" radius="md"><IconPencil size={18} /></ThemeIcon>
            <div>
              <Text size="sm" fw={600}>Edit All Limits</Text>
              <Text size="xs" c="dimmed">Set a uniform quota for every token</Text>
            </div>
          </Group>
        </Paper>
        {([
          { act: "reset" as const, color: "gray",   icon: <IconRefresh size={18} />,     label: "Reset All Usage",    desc: "Zero out window counters for all tokens" },
          { act: "pause" as const, color: "orange", icon: <IconPlayerPause size={18} />, label: "Pause All Tokens",   desc: "Suspend all tokens temporarily" },
          { act: "purge" as const,        color: "red",    icon: <IconTrash size={18} />,       label: "Purge Orphan Users",  desc: "Delete users with no tokens" },
        ]).map(({ act, color, icon, label, desc }) => {
          const busy = bulkAction === act;
          const doAction = () => runBulkAction(act, async () => {
            if (act === "reset") await adminPost("/admin/reset", { all: "true" });
            else if (act === "pause") await adminPost("/admin/token/pause", { all: "true" });
            else { const r = await fetch("/admin/users/purge-orphans", { method: "POST" }); await r.json(); }
          }, act === "reset" ? "All usage reset" : act === "pause" ? "All tokens paused/resumed" : "Orphan users removed");
          return (
            <Paper key={act} withBorder p="sm" radius="md"
              style={{ cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}
              onClick={busy ? undefined : () => {
                if (act === "reset") modals.openConfirmModal({
                  title: "Reset All Usage",
                  children: <Text size="sm">Zero out all token counters? This cannot be undone.</Text>,
                  labels: { confirm: "Reset", cancel: "Cancel" },
                  confirmProps: { color: "red" },
                  onConfirm: doAction,
                });
                else if (act === "purge") modals.openConfirmModal({
                  title: "Purge Orphan Users",
                  children: <Text size="sm">Delete all users with no tokens? This cannot be undone.</Text>,
                  labels: { confirm: "Purge", cancel: "Cancel" },
                  confirmProps: { color: "red" },
                  onConfirm: doAction,
                });
                else doAction();
              }}>
              <Group gap="sm" wrap="nowrap">
                <ThemeIcon variant="light" color={color} size="lg" radius="md">
                  {busy ? <Loader size={16} color="var(--mantine-color-dimmed)" /> : icon}
                </ThemeIcon>
                <div>
                  <Text size="sm" fw={600}>{label}</Text>
                  <Text size="xs" c="dimmed">{desc}</Text>
                </div>
              </Group>
            </Paper>
          );
        })}
      </SimpleGrid>

      {/* Users list */}
      <Stack gap="sm">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Users</Text>

        <Group gap="sm" wrap="wrap">
          <TextInput
            placeholder="Search by name, label, description, or token key…"
            value={search}
            onChange={e => setSearch(e.currentTarget.value)}
            leftSection={<IconSearch size={14} />}
            size="sm"
            style={{ flex: 1, minWidth: "clamp(140px, 40vw, 220px)" }}
          />
          <Select
            value={sort}
            onChange={v => {
              if (!v) return;
              setSort(v as SortKey);
              try { localStorage.setItem("admin-users-sort", v); } catch {}
            }}
            data={[
              { value: "usage",  label: "Most usage" },
              { value: "name",   label: "Name (A→Z)" },
              { value: "tokens", label: "Token count" },
              { value: "newest", label: "Newest" },
            ]}
            leftSection={<IconArrowsSort size={14} />}
            size="sm"
            allowDeselect={false}
            w={{ base: 140, sm: 170 }}
          />
          <SegmentedControl
            size="sm"
            value={viewMode}
            onChange={v => {
              setViewMode(v as "grid" | "list");
              try { localStorage.setItem("admin-users-view", v); } catch {}
            }}
            data={[
              { label: <Group gap={4} wrap="nowrap"><IconLayoutGrid size={14} /><Text span size="xs">Grid</Text></Group>, value: "grid" },
              { label: <Group gap={4} wrap="nowrap"><IconList size={14} /><Text span size="xs">List</Text></Group>, value: "list" },
            ]}
          />
        </Group>

        {filteredUsers === null ? (
          <Group justify="center" py="xl"><Loader size="sm" /></Group>
        ) : filteredUsers.length === 0 ? (
          <Paper withBorder p="lg" radius="md" ta="center">
            <Text c="dimmed" size="sm">
              {search ? `No users match "${search}".` : "No users yet."}
            </Text>
          </Paper>
        ) : viewMode === "grid" ? (
          <SimpleGrid cols={{ base: 1, sm: 2, xl: 3 }} spacing="md">
            {filteredUsers.map(u => (
              <UserCard key={u.id} user={u} userImage={userImages[u.name]} viewMode="grid" actions={cardActions} />
            ))}
          </SimpleGrid>
        ) : (
          <Stack gap="sm">
            {filteredUsers.map(u => (
              <UserCard key={u.id} user={u} userImage={userImages[u.name]} viewMode="list" actions={cardActions} />
            ))}
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}
