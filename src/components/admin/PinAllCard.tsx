import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Stack, Text, Paper, Group, ThemeIcon, Box, Loader, Badge,
  SegmentedControl, TextInput, ScrollArea, ActionIcon, Tooltip, UnstyledButton,
} from "@mantine/core";
import { IconPin, IconCheck, IconRefresh, IconSearch, IconAlertCircle } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { modals } from "@mantine/modals";
import { adminPost } from "../../utils";
import { useStatus } from "../../contexts";
import type { ApiUser } from "./UserModals";

type Provider = "anthropic" | "deepseek" | "openrouter";

interface ModelEntry { id: string; display_name: string; }
interface ModelsResponse {
  provider:    Provider;
  models:      ModelEntry[];
  fetched_at:  number;
  cached:      boolean;
  age_seconds: number;
  stale?:      boolean;
  error?:      string;
}

interface Props {
  onSaved?: () => Promise<void> | void; // optional — for hosts that want to know
}

const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic:  "Claude",
  deepseek:   "DeepSeek",
  openrouter: "OpenRouter",
};

const PROVIDER_COLOR: Record<Provider, string> = {
  anthropic:  "blue",
  deepseek:   "violet",
  openrouter: "orange",
};

function relAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export function PinAllCard({ onSaved }: Props = {}) {
  const status = useStatus();
  const upstreamData = status?.upstream;

  const [apiUsers, setApiUsers]       = useState<ApiUser[] | null>(null);
  const [pinProvider, setPinProvider] = useState<Provider>("anthropic");
  const [modelsMap,   setModelsMap]   = useState<Partial<Record<Provider, ModelsResponse>>>({});
  const [loading,     setLoading]     = useState<Record<Provider, boolean>>({ anthropic: false, deepseek: false, openrouter: false });
  const [filter,      setFilter]      = useState("");
  const [bulkBusy,    setBulkBusy]    = useState(false);

  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/users");
      const d = await r.json();
      setApiUsers(d.users ?? d);
    } catch {}
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Compute counts of tokens per provider category for the chips/badges
  const tokenCounts = useMemo(() => {
    const counts: Record<Provider, number> = { anthropic: 0, deepseek: 0, openrouter: 0 };
    if (!apiUsers) return counts;
    for (const u of apiUsers) for (const t of u.tokens) {
      const p = t.provider || "inherit";
      if (p === "inherit" || p === "anthropic") counts.anthropic++;
      else if (p === "deepseek")                 counts.deepseek++;
      else if (p === "openrouter")               counts.openrouter++;
    }
    return counts;
  }, [apiUsers]);

  // Aggregate pinned_model for tokens matching the selected provider (for active-button highlight)
  const pinnedSummary = useMemo(() => {
    if (!apiUsers) return { active: null as string | null, mixed: false };
    const relevantPins: string[] = [];
    for (const u of apiUsers) for (const t of u.tokens) {
      const p = t.provider || "inherit";
      const matches =
        (pinProvider === "anthropic" && (p === "inherit" || p === "anthropic")) ||
        (pinProvider === "deepseek"   && p === "deepseek") ||
        (pinProvider === "openrouter" && p === "openrouter");
      if (matches) relevantPins.push(t.pinned_model || "");
    }
    if (relevantPins.length === 0) return { active: "", mixed: false };
    const unique = new Set(relevantPins);
    if (unique.size === 1) return { active: relevantPins[0]!, mixed: false };
    return { active: null, mixed: true };
  }, [apiUsers, pinProvider]);

  const loadModels = useCallback(async (p: Provider, force = false) => {
    setLoading(l => ({ ...l, [p]: true }));
    try {
      const r = await fetch(`/api/admin/models/${p}${force ? "?refresh=1" : ""}`, { credentials: "include" });
      const d = await r.json() as ModelsResponse;
      setModelsMap(m => ({ ...m, [p]: d }));
      if (d.error && !d.models?.length) {
        notifications.show({ color: "red", title: `${PROVIDER_LABEL[p]} models`, message: d.error, autoClose: 4000 });
      }
    } catch (e: any) {
      notifications.show({ color: "red", title: `${PROVIDER_LABEL[p]} models`, message: e.message || "Failed to fetch", autoClose: 4000 });
    } finally {
      setLoading(l => ({ ...l, [p]: false }));
    }
  }, []);

  useEffect(() => {
    if (!modelsMap[pinProvider] && !loading[pinProvider]) loadModels(pinProvider);
  }, [pinProvider, modelsMap, loading, loadModels]);

  const bulkPin = async (model: string) => {
    setBulkBusy(true);
    try {
      await adminPost("/admin/token/pin-all", { model, provider_scope: pinProvider });
      await reload();
      if (onSaved) await onSaved();
      notifications.show({
        color: "teal",
        message: model
          ? `${PROVIDER_LABEL[pinProvider]} tokens pinned to ${model}`
          : `Pinned model cleared for ${PROVIDER_LABEL[pinProvider]} tokens`,
        autoClose: 2500,
      });
    } catch (e: any) {
      notifications.show({ color: "red", title: "Error", message: e.message || "Failed bulk pin", autoClose: 4000 });
    } finally {
      setBulkBusy(false);
    }
  };

  const confirmPin = (modelId: string, displayLabel: string) => {
    const scopeCount = tokenCounts[pinProvider];
    if (scopeCount === 0) {
      notifications.show({ color: "yellow", title: "No matching tokens", message: `No tokens currently use ${PROVIDER_LABEL[pinProvider]}.`, autoClose: 3000 });
      return;
    }
    modals.openConfirmModal({
      title: "Pin All Tokens",
      children: <Text size="sm">
        Apply <b>{displayLabel}</b> as pinned model for <b>{scopeCount}</b> {PROVIDER_LABEL[pinProvider]} token{scopeCount !== 1 ? "s" : ""}? This overrides per-token settings.
      </Text>,
      labels: { confirm: modelId ? `Pin to ${displayLabel}` : "Clear pins", cancel: "Cancel" },
      confirmProps: { color: PROVIDER_COLOR[pinProvider] },
      onConfirm: () => bulkPin(modelId),
    });
  };

  const current = modelsMap[pinProvider];
  const models  = current?.models ?? [];
  const filtered = filter
    ? models.filter(m =>
        m.id.toLowerCase().includes(filter.toLowerCase()) ||
        m.display_name.toLowerCase().includes(filter.toLowerCase())
      )
    : models;
  const isLoading = loading[pinProvider];

  const ROW_BG_HOVER     = "var(--mantine-color-default-hover)";
  const ROW_BG_ACTIVE    = `var(--mantine-color-${PROVIDER_COLOR[pinProvider]}-light)`;
  const ROW_BORDER_ACTIVE = `var(--mantine-color-${PROVIDER_COLOR[pinProvider]}-filled)`;

  const renderModelRow = (m: ModelEntry) => {
    const isActive = !pinnedSummary.mixed && pinnedSummary.active === m.id;
    // Claude util data (only for anthropic)
    let util: number | null = null;
    if (pinProvider === "anthropic") {
      if (m.id.includes("haiku"))  util = upstreamData?.sevenDay?.utilization      ?? null;
      if (m.id.includes("sonnet")) util = upstreamData?.sevenDaySonnet?.utilization ?? null;
      if (m.id.includes("opus"))   util = upstreamData?.sevenDayOpus?.utilization   ?? null;
    }
    const utilColor = util === null ? "gray" : util >= 90 ? "red" : util >= 70 ? "orange" : "teal";

    return (
      <UnstyledButton key={m.id} disabled={bulkBusy}
        onClick={() => confirmPin(m.id, m.display_name)}
        style={{
          display: "block", width: "100%",
          padding: "10px 12px",
          borderRadius: 8,
          background: isActive ? ROW_BG_ACTIVE : "transparent",
          border: `1px solid ${isActive ? ROW_BORDER_ACTIVE : "var(--mantine-color-default-border)"}`,
          transition: "background 0.12s",
          cursor: bulkBusy ? "wait" : "pointer",
        }}
        onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = ROW_BG_HOVER; }}
        onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}>
        <Group justify="space-between" gap="sm" wrap="nowrap" align="center">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
            <Box style={{
              width: 18, height: 18,
              borderRadius: 4,
              background: isActive ? ROW_BORDER_ACTIVE : "var(--mantine-color-default-border)",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              {isActive && <IconCheck size={12} color="white" stroke={3} />}
            </Box>
            <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
              <Text size="sm" fw={600} style={{ wordBreak: "break-word" }}>
                {m.display_name}
              </Text>
              <Text size="xs" c="dimmed" ff="monospace" truncate>
                {m.id}
              </Text>
            </Stack>
          </Group>
          {util !== null && (
            <Badge size="sm" variant="light" color={utilColor} style={{ flexShrink: 0 }}>
              {util.toFixed(0)}%
            </Badge>
          )}
        </Group>
      </UnstyledButton>
    );
  };

  const renderAutoRow = () => {
    const isActive = !pinnedSummary.mixed && pinnedSummary.active === "";
    return (
      <UnstyledButton disabled={bulkBusy}
        onClick={() => confirmPin("", "Auto (clear)")}
        style={{
          display: "block", width: "100%",
          padding: "10px 12px",
          borderRadius: 8,
          background: isActive ? ROW_BG_ACTIVE : "transparent",
          border: `1px solid ${isActive ? ROW_BORDER_ACTIVE : "var(--mantine-color-default-border)"}`,
          transition: "background 0.12s",
          cursor: bulkBusy ? "wait" : "pointer",
        }}
        onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = ROW_BG_HOVER; }}
        onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}>
        <Group gap="sm" wrap="nowrap" align="center">
          <Box style={{
            width: 18, height: 18,
            borderRadius: 4,
            background: isActive ? ROW_BORDER_ACTIVE : "var(--mantine-color-default-border)",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            {isActive && <IconCheck size={12} color="white" stroke={3} />}
          </Box>
          <Stack gap={2} style={{ flex: 1 }}>
            <Text size="sm" fw={600}>Auto — no pin</Text>
            <Text size="xs" c="dimmed">
              Tokens use whatever model the client requests
            </Text>
          </Stack>
        </Group>
      </UnstyledButton>
    );
  };

  const scopeCount = tokenCounts[pinProvider];

  return (
    <Paper withBorder p="md" radius="md">
      <Group gap="sm" wrap="nowrap" align="center" mb="sm">
        <ThemeIcon variant="light" color="violet" size="lg" radius="md"><IconPin size={18} /></ThemeIcon>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm" fw={600}>Pin All Tokens</Text>
          <Text size="xs" c="dimmed">
            {pinnedSummary.mixed
              ? <>{PROVIDER_LABEL[pinProvider]} tokens have <b>mixed</b> pin settings — click any below to unify</>
              : pinnedSummary.active === ""
                ? <>All {PROVIDER_LABEL[pinProvider]} tokens currently on <b>Auto</b> (no pin)</>
                : <>All {PROVIDER_LABEL[pinProvider]} tokens currently pinned to <b>{pinnedSummary.active}</b></>
            }
          </Text>
        </div>
        <Tooltip label={current ? `Models fetched ${relAge(current.age_seconds)}${current.stale ? " (stale)" : ""}` : "Refresh model list"} withArrow>
          <ActionIcon variant="subtle" color="gray" size="lg" radius="md"
            loading={isLoading}
            onClick={() => loadModels(pinProvider, true)}>
            <IconRefresh size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>

      {/* Provider scope selector */}
      <SegmentedControl
        fullWidth size="xs"
        value={pinProvider}
        onChange={v => { setPinProvider(v as Provider); setFilter(""); }}
        data={(["anthropic", "deepseek", "openrouter"] as Provider[]).map(p => ({
          value: p,
          label: (
            <Group gap={6} justify="center" wrap="nowrap">
              <Text size="xs" fw={600}>{PROVIDER_LABEL[p]}</Text>
              <Badge size="xs" variant="light" color={tokenCounts[p] > 0 ? PROVIDER_COLOR[p] : "gray"}>
                {tokenCounts[p]}
              </Badge>
            </Group>
          ),
        }))}
        mb="sm"
      />

      {scopeCount === 0 && (
        <Group gap="xs" mb="sm">
          <IconAlertCircle size={14} color="var(--mantine-color-yellow-6)" />
          <Text size="xs" c="dimmed">
            No tokens currently use {PROVIDER_LABEL[pinProvider]}. Pin actions will not apply.
          </Text>
        </Group>
      )}

      {/* Search — always visible if there are models */}
      {models.length > 0 && (
        <TextInput
          placeholder={`Search ${models.length} ${PROVIDER_LABEL[pinProvider]} model${models.length !== 1 ? "s" : ""}…`}
          value={filter}
          onChange={e => setFilter(e.currentTarget.value)}
          leftSection={<IconSearch size={12} />}
          size="xs"
          mb="sm"
        />
      )}

      {/* Loading / error / models list */}
      {isLoading && !current ? (
        <Group justify="center" py="lg"><Loader size="sm" /></Group>
      ) : current?.error && !current.models.length ? (
        <Paper p="sm" radius="sm" bg="var(--mantine-color-red-light)">
          <Text size="xs" c="red">Failed to load models: {current.error}</Text>
        </Paper>
      ) : (
        <Stack gap={6}>
          {/* Auto / clear pin — always first */}
          {renderAutoRow()}

          <ScrollArea.Autosize mah={360} type="auto" offsetScrollbars>
            <Stack gap={4}>
              {filtered.map(renderModelRow)}
              {filter && filtered.length === 0 && (
                <Text size="xs" c="dimmed" ta="center" py="md">
                  No models match "{filter}"
                </Text>
              )}
            </Stack>
          </ScrollArea.Autosize>

          {!filter && models.length > 10 && (
            <Text size="xs" c="dimmed" ta="center" mt={4}>
              Showing all {models.length} models · scroll to see more
            </Text>
          )}
        </Stack>
      )}
    </Paper>
  );
}
