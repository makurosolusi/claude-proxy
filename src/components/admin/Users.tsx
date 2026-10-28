import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Stack, SimpleGrid, Text, Group, Paper, TextInput, ThemeIcon,
  Loader, Select, Switch, SegmentedControl, Button, ActionIcon, Tooltip, Pagination,
} from "@mantine/core";
import {
  IconRefresh, IconPlayerPause, IconPencil, IconAlertTriangle,
  IconSearch, IconArrowsSort, IconLayoutGrid, IconList,
} from "@tabler/icons-react";
import { adminPost } from "../../utils";
import { useStatus } from "../../contexts";
import type { TokenStatus } from "../../contexts";
import { notifications } from "@mantine/notifications";
import { modals } from "@mantine/modals";
import {
  EditUserModal, DeleteUserModal, EditAllLimitsModal,
  AddTokenModal, EditAllLimitsGlobalModal, FilterModal,
} from "./UserModals";
import type { ApiUser, ApiToken } from "./UserModals";
import { UserCard, userAggregates } from "./UserCard";
import type { UserCardActions, ProviderInfo } from "./UserCard";
import { NotificationBroadcast } from "./NotificationBroadcast";

type UserStatus = "pending" | "approved" | "blocked";
type SortKey = "name" | "usage" | "tokens" | "newest";

export function AdminUsers({ tokens: tokenStatuses }: { tokens: Record<string, TokenStatus> }) {
  const status = useStatus();
  const navigate = useNavigate();
  const userImages = status?.userImages ?? {};
  const [apiUsers, setApiUsers]       = useState<ApiUser[] | null>(null);
  const [editUser, setEditUser]           = useState<ApiUser | null>(null);
  const [deleteUser, setDeleteUser]       = useState<ApiUser | null>(null);
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
  const [bulkAction, setBulkAction]         = useState<string | null>(null);
  const [statusBusy, setStatusBusy]         = useState<string | null>(null);
  const [demoMode, setDemoMode]                       = useState(false);
  const [demoSaving, setDemoSaving]                   = useState(false);
  const [contextBlockEnabled, setContextBlockEnabled] = useState(true);
  const [contextBlockSaving, setContextBlockSaving]   = useState(false);
  const [customProviders, setCustomProviders] = useState<ProviderInfo[]>([]);
  const [reloading, setReloading]             = useState(false);
  const [userPage, setUserPage]               = useState(1);

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
    setReloading(true);
    try { const d = await (await fetch("/api/admin/users")).json(); setApiUsers(d.users ?? d); }
    finally { setReloading(false); }
  }, []);

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

  const runBulkAction = async (act: string, fn: () => Promise<void>, msg: string) => {
    setBulkAction(act);
    try {
      await fn(); await reload();
      notifications.show({ color: "teal", message: msg, autoClose: 2000 });
    } catch (e: any) {
      notifications.show({ color: "red", title: "Error", message: e.message || "Action failed", autoClose: 4000 });
    } finally { setBulkAction(null); }
  };

  const openFilter = (type: "reset" | "edit", by: "provider" | "model") => modals.open({
    title: `${type === "reset" ? "Reset" : "Edit Limit"} by ${by === "provider" ? "Provider" : "Model"}`,
    children: <FilterModal options={by === "provider" ? uniqueProviders : uniqueModels} action={type}
      onConfirm={async (val, lim) => { modals.closeAll();
        const keys = entries.filter(([,t]) => by === "provider" ? t.activeProvider === val : t.allowed_models.includes(val)).map(([k]) => k);
        if (type === "reset") await runBulkAction(`reset-${by}`, async () => { await Promise.all(keys.map(k => adminPost("/admin/reset", { token: k }))); }, `${keys.length} token(s) reset`);
        else await runBulkAction(`edit-${by}`, async () => { await Promise.all(keys.map(k => adminPost("/admin/token/edit", { token: k, limit: lim }))); }, `${keys.length} token(s) updated`);
      }} />,
  });

  const forceGrace = async (u: ApiUser) => {
    try {
      await adminPost("/admin/user/context-grace", { user_id: u.id, minutes: "30" });
      await reload();
      notifications.show({ color: "yellow", message: `Grace 30 menit aktif untuk ${u.name} — bisa /compact sekarang`, autoClose: 4000 });
    } catch (e: any) {
      notifications.show({ color: "red", title: "Error", message: e.message || "Failed", autoClose: 4000 });
    }
  };

  const blockContext = async (u: ApiUser) => {
    try {
      await adminPost("/admin/user/block-context", { user_id: u.id, reason: "Diblokir manual oleh admin." });
      await reload();
      notifications.show({ color: "orange", message: `Context block aktif untuk ${u.name}`, autoClose: 3000 });
    } catch (e: any) {
      notifications.show({ color: "red", title: "Error", message: e.message || "Failed", autoClose: 4000 });
    }
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
      .then((d: any) => {
        setDemoMode(d.demo_mode === "true");
        setContextBlockEnabled(d.context_block_enabled !== "false");
      })
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

  const toggleContextBlock = async (val: boolean) => {
    setContextBlockSaving(true);
    try {
      const form = new URLSearchParams();
      form.set("enabled", val ? "true" : "false");
      await fetch("/admin/settings/context-block-enabled", { method: "POST", body: form });
      setContextBlockEnabled(val);
      notifications.show({
        color: val ? "orange" : "teal",
        message: val ? "Context block enforcement aktif" : "Context block enforcement dinonaktifkan",
        autoClose: 2000,
      });
    } finally { setContextBlockSaving(false); }
  };

  const USERS_PER_PAGE = 10;

  const filteredUsers = useMemo(() => {
    setUserPage(1);
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

  const userTotalPages = filteredUsers ? Math.ceil(filteredUsers.length / USERS_PER_PAGE) : 0;
  const pagedUsers     = filteredUsers ? filteredUsers.slice((userPage - 1) * USERS_PER_PAGE, userPage * USERS_PER_PAGE) : null;

  const entries    = Object.entries(tokenStatuses);
  const total      = entries.length;
  const paused     = entries.filter(([, t]) => t.paused).length;
  const overLimit  = entries.filter(([, t]) => t.pct > 100).length;
  const uniqueProviders = useMemo(() => [...new Set(Object.values(tokenStatuses).map(t => t.activeProvider).filter(Boolean))].sort(), [tokenStatuses]);
  const uniqueModels    = useMemo(() => [...new Set(Object.values(tokenStatuses).flatMap(t => t.allowed_models).filter(Boolean))].sort(), [tokenStatuses]);

  const cardActions: UserCardActions = {
    rowAction, statusBusy, customProviders,
    onEditUser: setEditUser,
    onDeleteUser: setDeleteUser,
    onSetStatus: setUserStatus,
    onEditAllLimits: setEditAllLimits,
    onAddToken: setAddTokenTo,
    onOpenDetail: (tk: ApiToken) => navigate("/admin/token/" + encodeURIComponent(tk.key)),
    onOpenUser: (u: ApiUser) => navigate("/admin/user/" + encodeURIComponent(u.id)),
    onRowAction: runRowAction,
    onResetUserPins: resetUserPins,
    onBlockContext: blockContext,
    onUnblockContext: unblockContext,
    onForceGrace: forceGrace,
  };

  return (
    <Stack gap="xl">
      {editUser          && <EditUserModal       user={editUser}       onClose={() => setEditUser(null)}             onSaved={reload} />}
      {deleteUser        && <DeleteUserModal     user={deleteUser}     onClose={() => setDeleteUser(null)}           onDone={reload} />}
      {editAllLimits     && <EditAllLimitsModal  user={editAllLimits}  onClose={() => setEditAllLimits(null)}        onSaved={reload} />}
      {showEditAllGlobal && <EditAllLimitsGlobalModal onClose={() => setShowEditAllGlobal(false)} onSaved={reload} />}
      {addTokenTo        && <AddTokenModal       user={addTokenTo}     onClose={() => setAddTokenTo(null)}           onDone={reload} />}

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

      {/* Global Settings */}
      <Stack gap="xs">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Global Settings</Text>
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
        <Paper withBorder p="md" radius="md" style={{ borderColor: !contextBlockEnabled ? "var(--mantine-color-teal-5)" : undefined }}>
          <Group justify="space-between" wrap="nowrap">
            <div>
              <Text size="sm" fw={700}>Context Block Enforcement</Text>
              <Text size="xs" c="dimmed" mt={2}>
                Jika aktif, user dengan input ≥ 100k tokens akan otomatis diblokir sampai menjalankan <code>/compact</code>.
                Nonaktifkan sementara jika ada kebutuhan khusus yang membutuhkan context besar.
              </Text>
            </div>
            <Switch
              checked={contextBlockEnabled}
              disabled={contextBlockSaving}
              onChange={e => toggleContextBlock(e.currentTarget.checked)}
              color="orange"
              size="md"
            />
          </Group>
        </Paper>
      </Stack>

      {/* Broadcast & Notifications */}
      <Stack gap="xs">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Broadcast & Notifications</Text>
        <NotificationBroadcast apiUsers={apiUsers} />
      </Stack>

      {/* Bulk Actions */}
      <Stack gap="xs">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Bulk Actions</Text>
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
          { key: "edit-provider", label: "Edit by Provider", desc: "Set limit for a specific provider's tokens", by: "provider" as const },
          { key: "edit-model",    label: "Edit by Model",    desc: "Set limit for tokens with a pinned model",  by: "model" as const },
        ]).map(({ key, label, desc, by }) => (
          <Paper key={key} withBorder p="sm" radius="md" style={{ cursor: bulkAction === key ? "default" : "pointer", opacity: bulkAction === key ? 0.7 : 1 }}
            onClick={bulkAction === key ? undefined : () => openFilter("edit", by)}>
            <Group gap="sm" wrap="nowrap">
              <ThemeIcon variant="light" color="blue" size="lg" radius="md">
                {bulkAction === key ? <Loader size={16} color="var(--mantine-color-dimmed)" /> : <IconPencil size={18} />}
              </ThemeIcon>
              <div><Text size="sm" fw={600}>{label}</Text><Text size="xs" c="dimmed">{desc}</Text></div>
            </Group>
          </Paper>
        ))}
        {([
          { key: "reset-provider", label: "Reset by Provider", desc: "Zero out counters for a provider's tokens", by: "provider" as const },
          { key: "reset-model",    label: "Reset by Model",    desc: "Zero out counters for a pinned model's tokens", by: "model" as const },
        ]).map(({ key, label, desc, by }) => (
          <Paper key={key} withBorder p="sm" radius="md" style={{ cursor: bulkAction === key ? "default" : "pointer", opacity: bulkAction === key ? 0.7 : 1 }}
            onClick={bulkAction === key ? undefined : () => openFilter("reset", by)}>
            <Group gap="sm" wrap="nowrap">
              <ThemeIcon variant="light" color="gray" size="lg" radius="md">
                {bulkAction === key ? <Loader size={16} color="var(--mantine-color-dimmed)" /> : <IconRefresh size={18} />}
              </ThemeIcon>
              <div><Text size="sm" fw={600}>{label}</Text><Text size="xs" c="dimmed">{desc}</Text></div>
            </Group>
          </Paper>
        ))}
        </SimpleGrid>
      </Stack>

      {/* Users list */}
      <Stack gap="sm">
        <Group justify="space-between" align="center">
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Users</Text>
          <Tooltip label="Reload user data" withArrow openDelay={400}>
            <ActionIcon size="sm" variant="subtle" color="dimmed" loading={reloading} onClick={reload}>
              <IconRefresh size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
        {reloading && <Loader size="xs" type="bars" style={{ alignSelf: "center" }} />}

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

        {pagedUsers === null ? (
          <Group justify="center" py="xl"><Loader size="sm" /></Group>
        ) : filteredUsers!.length === 0 ? (
          <Paper withBorder p="lg" radius="md" ta="center">
            <Text c="dimmed" size="sm">
              {search ? `No users match "${search}".` : "No users yet."}
            </Text>
          </Paper>
        ) : viewMode === "grid" ? (
          <Stack gap="md">
            <SimpleGrid cols={{ base: 1, sm: 2, xl: 3 }} spacing="md">
              {pagedUsers.map(u => (
                <UserCard key={u.id} user={u} userImage={userImages[u.name]} viewMode="grid" actions={cardActions} />
              ))}
            </SimpleGrid>
            {userTotalPages > 1 && (
              <Group justify="center" pt={4}>
                <Pagination size="sm" value={userPage} onChange={setUserPage} total={userTotalPages} siblings={1} />
              </Group>
            )}
          </Stack>
        ) : (
          <Stack gap="sm">
            {pagedUsers.map(u => (
              <UserCard key={u.id} user={u} userImage={userImages[u.name]} viewMode="list" actions={cardActions} />
            ))}
            {userTotalPages > 1 && (
              <Group justify="center" pt={4}>
                <Pagination size="sm" value={userPage} onChange={setUserPage} total={userTotalPages} siblings={1} />
              </Group>
            )}
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}
