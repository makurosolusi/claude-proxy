import { useState, useEffect, useCallback } from "react";
import {
  Stack, Text, Group, Paper, TextInput, Textarea, Box, Badge, Button,
  Modal, Switch, Select, Divider, Loader, Progress,
  ActionIcon, Tooltip, Code,
} from "@mantine/core";
import {
  IconKey, IconRotate, IconTrash, IconPlayerPause, IconPlayerPlay, IconRefresh,
} from "@tabler/icons-react";
import { adminPost } from "../../utils";
import { notifications } from "@mantine/notifications";
import { modals } from "@mantine/modals";
import { CopyButton } from "./UserModals";
import type { ApiToken } from "./UserModals";

function nf(n: number) { return n.toLocaleString(); }

interface ModelEntry { id: string; display_name: string; }
interface CustomProviderInfo { id: string; name: string; type: "anthropic" | "openai"; color?: string; api_key_set?: boolean; }

function shortenModel(m: string): string {
  if (!m) return "";
  const stripped = m.includes("/") ? (m.split("/").pop() || m) : m;
  if (stripped.length <= 24) return stripped;
  return stripped.slice(0, 21) + "…";
}

interface Props {
  token:         ApiToken;
  onClose:       () => void;
  onSaved:       () => Promise<void> | void;
  onRotate:      (token: ApiToken) => void;
}

export function TokenDetailModal({ token: tk, onClose, onSaved, onRotate }: Props) {
  const [label, setLabel]         = useState(tk.label || "");
  const [description, setDesc]    = useState(tk.description || "");
  const [unlimited, setUnlimited] = useState(tk.limit === null);
  const [limit, setLimit]         = useState(tk.limit === null ? "40000" : String(tk.limit));
  // Optimistic local state for dropdowns — synced to props after reload
  const [providerValue, setProviderValue]   = useState(tk.provider || "inherit");
  const [pinValue, setPinValue]             = useState(tk.pinned_model || "");
  const [outputTypeValue, setOutputTypeValue] = useState(tk.output_type || "anthropic");
  useEffect(() => { setProviderValue(tk.provider || "inherit"); }, [tk.provider]);
  useEffect(() => { setPinValue(tk.pinned_model || ""); }, [tk.pinned_model]);
  useEffect(() => { setOutputTypeValue(tk.output_type || "anthropic"); }, [tk.output_type]);

  const [savingMeta, setSavingMeta]           = useState(false);
  const [savingLimit, setSavingLimit]         = useState(false);
  const [savingProvider, setSavingProvider]   = useState(false);
  const [savingPinModel, setSavingPinModel]   = useState(false);
  const [savingOutputType, setSavingOutputType] = useState(false);
  const [busyAction, setBusyAction]     = useState<"pause" | "delete" | null>(null);

  // Provider-aware model list
  // effectiveProvider = the provider whose model list to fetch.
  // For "inherit" we default to "anthropic" (Claude is the default fallback).
  const [customProviders, setCustomProviders] = useState<CustomProviderInfo[]>([]);
  const [deepseekConfigured,   setDeepseekConfigured]   = useState(false);
  const [openrouterConfigured, setOpenrouterConfigured] = useState(false);

  useEffect(() => {
    fetch("/api/admin/custom-providers")
      .then(r => r.ok ? r.json() : { providers: [] })
      .then((d: any) => setCustomProviders(Array.isArray(d.providers) ? d.providers : []))
      .catch(() => {});
    fetch("/api/admin/settings")
      .then(r => r.ok ? r.json() : {})
      .then((d: any) => {
        setDeepseekConfigured(!!d?.deepseek_api_key);
        setOpenrouterConfigured(!!d?.openrouter_api_key);
      })
      .catch(() => {});
  }, []);

  // Detect orphan: token references a custom provider that no longer exists
  const isOrphanProvider =
    providerValue !== "inherit" &&
    providerValue !== "anthropic" &&
    providerValue !== "deepseek" &&
    providerValue !== "openrouter" &&
    !customProviders.find(c => c.id === providerValue);

  const effectiveProvider: string =
    providerValue === "inherit" || providerValue === "anthropic" ? "anthropic"
    : providerValue;

  const [modelList, setModelList]     = useState<ModelEntry[]>([]);
  const [loadingModels, setLoading]   = useState(false);
  const [modelFilter, setModelFilter] = useState("");

  const fetchModels = useCallback(async (p: string, force = false) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/models/${p}${force ? "?refresh=1" : ""}`, { credentials: "include" });
      const d = await r.json() as any;
      setModelList(Array.isArray(d?.models) ? d.models : []);
    } catch { setModelList([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    setModelFilter("");
    fetchModels(effectiveProvider);
  }, [effectiveProvider, fetchModels]);

  const metaDirty  = label !== (tk.label || "") || description !== (tk.description || "");
  const limitDirty = unlimited !== (tk.limit === null) ||
                     (!unlimited && limit !== String(tk.limit ?? ""));

  const saveMeta = async () => {
    setSavingMeta(true);
    try {
      await adminPost("/admin/token/meta", { token: tk.key, label: label.trim(), description: description.trim() });
      await onSaved();
      notifications.show({ color: "teal", message: "Info updated", autoClose: 2000 });
    } catch (e: any) {
      notifications.show({ color: "red", message: e.message || "Failed", autoClose: 3000 });
    } finally { setSavingMeta(false); }
  };

  const saveLimit = async () => {
    const value = unlimited ? "unlimited" : limit.trim();
    if (!value || (!unlimited && (!/^\d+$/.test(value) || Number(value) <= 0))) return;
    setSavingLimit(true);
    try {
      await adminPost("/admin/token/edit", { token: tk.key, limit: value });
      await onSaved();
      notifications.show({ color: "teal", message: `Limit set to ${unlimited ? "unlimited" : Number(value).toLocaleString()}`, autoClose: 2000 });
    } catch (e: any) {
      notifications.show({ color: "red", message: e.message || "Failed", autoClose: 3000 });
    } finally { setSavingLimit(false); }
  };

  const changeProvider = async (provider: string) => {
    setProviderValue(provider); // optimistic
    setSavingProvider(true);
    try {
      const r = await fetch("/admin/token/provider", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: tk.key, provider }),
      });
      const text = await r.text();
      const ct   = r.headers.get("content-type") || "";
      let d: any = {};
      if (ct.includes("application/json")) { try { d = JSON.parse(text); } catch {} }
      if (!r.ok || d.ok === false) {
        setProviderValue(tk.provider || "inherit"); // revert
        const msg = d.error || (text && !text.startsWith("<") ? text : `HTTP ${r.status}`);
        notifications.show({ color: "red", title: "Cannot switch provider", message: msg, autoClose: 5000 });
        return;
      }
      await onSaved();
      notifications.show({ color: "teal", message: `Provider: ${provider === "inherit" ? "Auto" : provider}`, autoClose: 2000 });
    } catch (e: any) {
      setProviderValue(tk.provider || "inherit");
      notifications.show({ color: "red", message: e.message || "Failed", autoClose: 3000 });
    } finally { setSavingProvider(false); }
  };

  const changePinModel = async (model: string) => {
    setPinValue(model); // optimistic
    setSavingPinModel(true);
    try {
      await adminPost("/admin/token/pin-model", { token: tk.key, model });
      await onSaved();
      notifications.show({
        color: "teal",
        message: model ? `Pinned to ${shortenModel(model)}` : "Pin cleared",
        autoClose: 2000,
      });
    } catch (e: any) {
      setPinValue(tk.pinned_model || "");
      notifications.show({ color: "red", message: e.message || "Failed", autoClose: 3000 });
    } finally { setSavingPinModel(false); }
  };

  const changeOutputType = async (output_type: string) => {
    setOutputTypeValue(output_type);
    setSavingOutputType(true);
    try {
      await adminPost("/admin/token/output-type", { token: tk.key, output_type });
      await onSaved();
      notifications.show({ color: "teal", message: `Output: ${output_type}`, autoClose: 2000 });
    } catch (e: any) {
      setOutputTypeValue(tk.output_type || "anthropic");
      notifications.show({ color: "red", message: e.message || "Failed", autoClose: 3000 });
    } finally { setSavingOutputType(false); }
  };

  const togglePause = async () => {
    setBusyAction("pause");
    try {
      await adminPost("/admin/token/pause", { token: tk.key });
      await onSaved();
      notifications.show({ color: "teal", message: tk.paused ? "Token resumed" : "Token paused", autoClose: 2000 });
    } catch (e: any) {
      notifications.show({ color: "red", message: e.message || "Failed", autoClose: 3000 });
    } finally { setBusyAction(null); }
  };

  const doDelete = () => {
    modals.openConfirmModal({
      title: "Delete token",
      children: <Text size="sm">Delete <b>{tk.key}</b>? Clients using this token will get 401.</Text>,
      labels: { confirm: "Delete", cancel: "Cancel" },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        setBusyAction("delete");
        try {
          await adminPost("/admin/token/delete", { token: tk.key });
          await onSaved();
          notifications.show({ color: "teal", message: "Token deleted", autoClose: 2000 });
          onClose();
        } catch (e: any) {
          notifications.show({ color: "red", message: e.message || "Failed", autoClose: 3000 });
        } finally { setBusyAction(null); }
      },
    });
  };

  const limitDisplay = tk.limit === null ? "∞" : nf(tk.limit);

  return (
    <Modal opened onClose={onClose} title={tk.label || "Token Details"} size="lg">
      <Stack gap="md">
        {/* ── Info section ─────────────────────────────────────────────────────── */}
        <Paper withBorder p="sm" radius="sm">
          <Stack gap="xs">
            <Group gap="xs" wrap="nowrap">
              <IconKey size={14} color="var(--mantine-color-dimmed)" />
              <Text size="xs" ff="monospace" style={{ flex: 1, wordBreak: "break-all" }}>{tk.key}</Text>
              <CopyButton value={tk.key} />
            </Group>
            <TextInput label="Label" placeholder="Display name for this token" value={label}
              description="Leave empty to use the user's name"
              onChange={e => setLabel(e.currentTarget.value)} />
            <Textarea label="Description" placeholder="Optional notes about this token's purpose" rows={2}
              value={description} onChange={e => setDesc(e.currentTarget.value)} />
            {metaDirty && (
              <Group justify="flex-end">
                <Button size="xs" variant="subtle" onClick={() => { setLabel(tk.label || ""); setDesc(tk.description || ""); }}>Revert</Button>
                <Button size="xs" color="teal" loading={savingMeta} onClick={saveMeta}>Save info</Button>
              </Group>
            )}
          </Stack>
        </Paper>

        {/* ── Usage section ────────────────────────────────────────────────────── */}
        <Paper withBorder p="sm" radius="sm">
          <Stack gap={6}>
            <Group justify="space-between">
              <Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: ".05em" }}>Usage</Text>
              {tk.paused && <Badge size="xs" color="gray">paused</Badge>}
            </Group>
            <Group gap="xs" wrap="nowrap">
              <Progress value={Math.min(tk.pct, 100)} color={tk.pct >= 95 ? "red" : tk.pct >= 75 ? "orange" : "teal"} size="md" style={{ flex: 1 }} />
              <Text size="sm" fw={600} ff="monospace">{tk.pct}%</Text>
            </Group>
            <Group gap="lg" wrap="wrap">
              <Box><Text size="xs" c="dimmed">Used</Text><Text size="sm" ff="monospace">{nf(tk.used)} / {limitDisplay}</Text></Box>
              <Box><Text size="xs" c="dimmed">Today</Text><Text size="sm" ff="monospace">{tk.today ? nf(tk.today) : "—"}</Text></Box>
              <Box><Text size="xs" c="dimmed">All-time</Text><Text size="sm" ff="monospace">{tk.alltime ? nf(tk.alltime) : "—"}</Text></Box>
            </Group>
          </Stack>
        </Paper>

        {/* ── Routing section ──────────────────────────────────────────────────── */}
        <Paper withBorder p="sm" radius="sm">
          <Stack gap="xs">
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: ".05em" }}>Routing</Text>
            <Box>
              <Group gap="xs" mb={4}>
                <Text size="xs" c="dimmed">Provider</Text>
                {savingProvider && <Loader size={10} />}
              </Group>
              <Select size="xs"
                value={providerValue}
                disabled={savingProvider}
                onChange={v => changeProvider(v || "inherit")}
                allowDeselect={false}
                comboboxProps={{ withinPortal: true }}
                data={[
                  { group: "Built-in", items: [
                    { value: "inherit",    label: "Auto (follow global routing)" },
                    { value: "anthropic",  label: "Claude Max" },
                    { value: "deepseek",   label: deepseekConfigured   ? "DeepSeek"   : "DeepSeek (not configured)",   disabled: !deepseekConfigured },
                    { value: "openrouter", label: openrouterConfigured ? "OpenRouter" : "OpenRouter (not configured)", disabled: !openrouterConfigured },
                  ] },
                  ...(customProviders.length > 0 ? [{
                    group: "Custom",
                    items: customProviders.map(p => ({
                      value: p.id,
                      label: `${p.name} (${p.type === "openai" ? "OpenAI-like" : "Anthropic-like"})${p.api_key_set ? "" : " — no key"}`,
                      disabled: !p.api_key_set,
                    })),
                  }] : []),
                  // If current token references an orphan custom provider, show it so the value still renders
                  ...(isOrphanProvider ? [{
                    group: "Orphan",
                    items: [{ value: providerValue, label: `${providerValue} (no longer exists)`, disabled: true }],
                  }] : []),
                ]}
              />
              {isOrphanProvider && (
                <Text size="xs" c="red" mt={4}>
                  Provider <Code>{providerValue}</Code> no longer exists. Pick another provider to fix this token.
                </Text>
              )}
            </Box>
            <Box>
              <Group gap="xs" mb={4} justify="space-between">
                <Group gap="xs">
                  <Text size="xs" c="dimmed">Pinned Model</Text>
                  {savingPinModel && <Loader size={10} />}
                </Group>
                <Tooltip label="Refresh model list from provider" withArrow>
                  <ActionIcon size="xs" variant="subtle" color="gray"
                    loading={loadingModels}
                    onClick={() => fetchModels(effectiveProvider, true)}>
                    <IconRefresh size={11} />
                  </ActionIcon>
                </Tooltip>
              </Group>
              <Group gap={6} wrap="nowrap">
                <Select
                  size="xs"
                  placeholder={loadingModels ? "Loading…" : `Pick a ${effectiveProvider} model`}
                  searchable
                  clearable
                  data={[
                    { value: "", label: "Auto (no pin)" },
                    ...modelList.map(m => ({ value: m.id, label: m.display_name })),
                  ]}
                  value={pinValue}
                  disabled={savingPinModel || loadingModels}
                  onChange={v => changePinModel(v || "")}
                  searchValue={modelFilter}
                  onSearchChange={setModelFilter}
                  nothingFoundMessage={loadingModels ? "Loading…" : "No models match"}
                  comboboxProps={{ withinPortal: true }}
                  style={{ flex: 1 }}
                />
              </Group>
              <Text size="xs" c="dimmed" mt={6}>
                Pin will override whichever model the client requests. {modelList.length} {effectiveProvider} model{modelList.length !== 1 ? "s" : ""} available.
              </Text>
            </Box>
            <Box>
              <Group gap="xs" mb={4}>
                <Text size="xs" c="dimmed">Response Format</Text>
                {savingOutputType && <Loader size={10} />}
              </Group>
              <Select size="xs"
                value={outputTypeValue}
                disabled={savingOutputType}
                allowDeselect={false}
                onChange={v => changeOutputType(v || "anthropic")}
                comboboxProps={{ withinPortal: true }}
                data={[
                  { value: "anthropic", label: "Anthropic (default)" },
                  { value: "openai",    label: "OpenAI compatible — /v1/chat/completions" },
                ]}
              />
              <Text size="xs" c="dimmed" mt={4}>
                OpenAI mode: token accepts <Code>/v1/chat/completions</Code> and returns ChatCompletion format.
              </Text>
            </Box>
          </Stack>
        </Paper>

        {/* ── Limit section ────────────────────────────────────────────────────── */}
        <Paper withBorder p="sm" radius="sm">
          <Stack gap="xs">
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: ".05em" }}>Limit</Text>
            <Switch label="Unlimited" checked={unlimited} onChange={e => setUnlimited(e.currentTarget.checked)} />
            {!unlimited && (
              <TextInput label="Window limit (tokens)"
                description="Max input+output tokens per 5-hour window"
                value={limit}
                onChange={e => setLimit(e.currentTarget.value.replace(/[^\d]/g, ""))} />
            )}
            {limitDirty && (
              <Group justify="flex-end">
                <Button size="xs" variant="subtle" onClick={() => {
                  setUnlimited(tk.limit === null);
                  setLimit(tk.limit === null ? "40000" : String(tk.limit));
                }}>Revert</Button>
                <Button size="xs" color="teal" loading={savingLimit} onClick={saveLimit}>Save limit</Button>
              </Group>
            )}
          </Stack>
        </Paper>

        {/* ── Actions section ──────────────────────────────────────────────────── */}
        <Paper withBorder p="sm" radius="sm">
          <Stack gap="xs">
            <Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: ".05em" }}>Actions</Text>
            <Group gap="xs" wrap="wrap">
              <Button size="xs" variant="light" color={tk.paused ? "teal" : "orange"}
                leftSection={tk.paused ? <IconPlayerPlay size={13} /> : <IconPlayerPause size={13} />}
                loading={busyAction === "pause"}
                onClick={togglePause}>
                {tk.paused ? "Resume" : "Pause"}
              </Button>
              <Button size="xs" variant="light" color="blue"
                leftSection={<IconRotate size={13} />}
                onClick={() => { onClose(); onRotate(tk); }}>
                Rotate key
              </Button>
              <Button size="xs" variant="light" color="red"
                leftSection={<IconTrash size={13} />}
                loading={busyAction === "delete"}
                onClick={doDelete}>
                Delete token
              </Button>
            </Group>
          </Stack>
        </Paper>

        <Divider />
        <Group justify="flex-end">
          <Button variant="subtle" color="gray" onClick={onClose}>Close</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
