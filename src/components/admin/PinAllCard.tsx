import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Stack, Text, Paper, Group, ThemeIcon, Box, Loader, Badge,
  TextInput, ScrollArea, ActionIcon, Tooltip, UnstyledButton,
} from "@mantine/core";
import { IconPin, IconCheck, IconRefresh, IconSearch, IconAlertCircle } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { modals } from "@mantine/modals";
import { useStatus } from "../../contexts";
import type { ApiUser } from "./UserModals";

type Provider = string; // built-in or custom slug

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

interface CustomProviderInfo { id: string; name: string; type: "anthropic" | "openai"; color?: string; api_key_set?: boolean; }

interface Props {
  onSaved?:       () => Promise<void> | void; // optional — for hosts that want to know
  lockedProvider?: string;                     // if set, hide pills + header (used inside accordion item)
  globalOverride?: string;                     // from parent — overrides internal fetch if provided
}

const BUILT_IN_LABEL: Record<string, string> = {
  anthropic:  "Claude",
  deepseek:   "DeepSeek",
  openrouter: "OpenRouter",
};

const BUILT_IN_COLOR: Record<string, string> = {
  anthropic:  "blue",
  deepseek:   "violet",
  openrouter: "orange",
};

function relAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export function PinAllCard({ onSaved, lockedProvider, globalOverride: globalOverrideProp }: Props = {}) {
  const status = useStatus();
  const upstreamData = status?.upstream;

  const [apiUsers,    setApiUsers]       = useState<ApiUser[] | null>(null);
  const [customProviders, setCustomProviders] = useState<CustomProviderInfo[]>([]);
  const [pinProvider, setPinProvider] = useState<Provider>(lockedProvider || "anthropic");
  const [modelsMap,   setModelsMap]   = useState<Record<string, ModelsResponse>>({});
  const [loading,     setLoading]     = useState<Record<string, boolean>>({});
  const [filter,      setFilter]      = useState("");
  const [bulkBusy,    setBulkBusy]    = useState(false);

  // Sync pinProvider with lockedProvider prop in case it changes
  useEffect(() => { if (lockedProvider) setPinProvider(lockedProvider); }, [lockedProvider]);

  // Helper: get label/color for any provider (built-in or custom)
  const providerLabel = (p: string): string =>
    BUILT_IN_LABEL[p] || customProviders.find(c => c.id === p)?.name || p;
  const providerColor = (p: string): string =>
    BUILT_IN_COLOR[p] || customProviders.find(c => c.id === p)?.color || "gray";

  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/users");
      const d = await r.json();
      setApiUsers(d.users ?? d);
    } catch {}
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Settings for effective routing (global override + which providers are configured).
  // globalOverride: prop takes precedence (so parent can drive reactivity); fallback to internal fetch.
  const [internalOverride,     setInternalOverride]    = useState("");
  const [deepseekConfigured,   setDeepseekConfigured]  = useState(false);
  const [openrouterConfigured, setOpenrouterConfigured] = useState(false);
  const globalOverride = globalOverrideProp !== undefined ? globalOverrideProp : internalOverride;

  useEffect(() => {
    fetch("/api/admin/custom-providers")
      .then(r => r.ok ? r.json() : { providers: [] })
      .then((d: any) => setCustomProviders(Array.isArray(d.providers) ? d.providers : []))
      .catch(() => {});
    fetch("/api/admin/settings")
      .then(r => r.json())
      .then((d: any) => {
        setInternalOverride(d?.provider_override || "");
        setDeepseekConfigured(!!d?.deepseek_api_key);
        setOpenrouterConfigured(!!d?.openrouter_api_key);
      })
      .catch(() => {});
  }, []);

  // Whether a provider's credentials are configured (mirrors backend logic)
  const isConfigured = useCallback((id: string): boolean => {
    if (id === "anthropic" || id === "" || id === "inherit") return true;
    if (id === "deepseek")   return deepseekConfigured;
    if (id === "openrouter") return openrouterConfigured;
    return !!customProviders.find(c => c.id === id)?.api_key_set;
  }, [deepseekConfigured, openrouterConfigured, customProviders]);

  // Resolve effective routing provider — matches proxy.ts logic.
  // Same logic as ProvidersAccordion for consistency.
  const effectiveProviderOf = useCallback((tokenProvider: string): string => {
    if (tokenProvider && tokenProvider !== "inherit") {
      return isConfigured(tokenProvider) ? tokenProvider : "anthropic";
    }
    if (globalOverride) {
      return isConfigured(globalOverride) ? globalOverride : "anthropic";
    }
    return "anthropic";
  }, [globalOverride, isConfigured]);

  // Compute counts of tokens per provider via EFFECTIVE routing
  const tokenCounts = useMemo(() => {
    const counts: Record<string, number> = { anthropic: 0, deepseek: 0, openrouter: 0 };
    for (const cp of customProviders) counts[cp.id] = 0;
    if (!apiUsers) return counts;
    for (const u of apiUsers) for (const t of u.tokens) {
      const key = effectiveProviderOf(t.provider || "inherit");
      if (key in counts) counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [apiUsers, customProviders, effectiveProviderOf]);

  // Match a token against a provider scope via effective routing
  const tokenMatchesScope = useCallback((tokenProvider: string, scope: string) => {
    return effectiveProviderOf(tokenProvider) === scope;
  }, [effectiveProviderOf]);

  // Aggregate pinned_model for tokens matching the selected provider (for active-button highlight)
  const pinnedSummary = useMemo(() => {
    if (!apiUsers) return { active: null as string | null, mixed: false };
    const relevantPins: string[] = [];
    for (const u of apiUsers) for (const t of u.tokens) {
      if (tokenMatchesScope(t.provider || "inherit", pinProvider)) relevantPins.push(t.pinned_model || "");
    }
    if (relevantPins.length === 0) return { active: "", mixed: false };
    const unique = new Set(relevantPins);
    if (unique.size === 1) return { active: relevantPins[0]!, mixed: false };
    return { active: null, mixed: true };
  }, [apiUsers, pinProvider, tokenMatchesScope]);

  const loadModels = useCallback(async (p: Provider, force = false) => {
    setLoading(l => ({ ...l, [p]: true }));
    try {
      const r = await fetch(`/api/admin/models/${p}${force ? "?refresh=1" : ""}`, { credentials: "include" });
      const d = await r.json() as ModelsResponse;
      setModelsMap(m => ({ ...m, [p]: d }));
      if (d.error && !d.models?.length) {
        notifications.show({ color: "red", title: `${providerLabel(p)} models`, message: d.error, autoClose: 4000 });
      }
    } catch (e: any) {
      notifications.show({ color: "red", title: `${providerLabel(p)} models`, message: e.message || "Failed to fetch", autoClose: 4000 });
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
      const r = await fetch("/admin/token/pin-all", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ model, provider_scope: pinProvider }),
      });
      const text = await r.text();
      const ct   = r.headers.get("content-type") || "";
      let d: any = {};
      if (ct.includes("application/json")) { try { d = JSON.parse(text); } catch {} }
      if (!r.ok || d.ok === false) {
        notifications.show({ color: "red", title: "Pin failed", message: d.error || text.slice(0, 200) || `HTTP ${r.status}`, autoClose: 4000 });
        return;
      }
      await reload();
      if (onSaved) await onSaved();

      const count = typeof d.count === "number" ? d.count : -1;
      if (count === 0) {
        notifications.show({
          color: "yellow",
          title: "No tokens affected",
          message: `Scope "${providerLabel(pinProvider)}" matched 0 tokens — no changes saved.`,
          autoClose: 4000,
        });
        return;
      }
      notifications.show({
        color: "teal",
        message: model
          ? `${count > 0 ? count + " " : ""}${providerLabel(pinProvider)} token${count !== 1 ? "s" : ""} pinned to ${model}`
          : `Pin cleared for ${count > 0 ? count + " " : ""}${providerLabel(pinProvider)} tokens`,
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
      notifications.show({ color: "yellow", title: "No matching tokens", message: `No tokens currently use ${providerLabel(pinProvider)}.`, autoClose: 3000 });
      return;
    }
    modals.openConfirmModal({
      title: "Pin All Tokens",
      children: <Text size="sm">
        Apply <b>{displayLabel}</b> as pinned model for <b>{scopeCount}</b> {providerLabel(pinProvider)} token{scopeCount !== 1 ? "s" : ""}? This overrides per-token settings.
      </Text>,
      labels: { confirm: modelId ? `Pin to ${displayLabel}` : "Clear pins", cancel: "Cancel" },
      confirmProps: { color: providerColor(pinProvider) },
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
  const ROW_BG_ACTIVE    = `var(--mantine-color-${providerColor(pinProvider)}-light)`;
  const ROW_BORDER_ACTIVE = `var(--mantine-color-${providerColor(pinProvider)}-filled)`;

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
    <Paper withBorder={!lockedProvider} p={lockedProvider ? 0 : "md"} radius="md" bg={lockedProvider ? "transparent" : undefined}>
      {!lockedProvider && (
        <>
          <Group gap="sm" wrap="nowrap" align="center" mb="sm">
            <ThemeIcon variant="light" color="violet" size="lg" radius="md"><IconPin size={18} /></ThemeIcon>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text size="sm" fw={600}>Pin All Tokens</Text>
              <Text size="xs" c="dimmed">
                {pinnedSummary.mixed
                  ? <>{providerLabel(pinProvider)} tokens have <b>mixed</b> pin settings — click any below to unify</>
                  : pinnedSummary.active === ""
                    ? <>All {providerLabel(pinProvider)} tokens currently on <b>Auto</b> (no pin)</>
                    : <>All {providerLabel(pinProvider)} tokens currently pinned to <b>{pinnedSummary.active}</b></>
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

          {/* Provider scope selector — pills that wrap, scales to many providers */}
          <Group gap={6} wrap="wrap" mb="sm">
            {[
              { id: "anthropic",  name: "Claude",     color: "blue"   },
              { id: "deepseek",   name: "DeepSeek",   color: "violet" },
              { id: "openrouter", name: "OpenRouter", color: "orange" },
              ...customProviders.map(cp => ({ id: cp.id, name: cp.name, color: cp.color || "gray" })),
            ].map(p => {
              const active = pinProvider === p.id;
              const count  = tokenCounts[p.id] || 0;
              return (
                <UnstyledButton
                  key={p.id}
                  onClick={() => { setPinProvider(p.id); setFilter(""); }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "5px 10px 5px 10px",
                    borderRadius: 999,
                    background: active
                      ? `var(--mantine-color-${p.color}-light)`
                      : "transparent",
                    border: `1px solid ${active
                      ? `var(--mantine-color-${p.color}-filled)`
                      : "var(--mantine-color-default-border)"}`,
                    transition: "background 0.12s, border-color 0.12s",
                    cursor: "pointer",
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = "var(--mantine-color-default-hover)"; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
                  {active && <IconCheck size={11} stroke={3} style={{ color: `var(--mantine-color-${p.color}-filled)` }} />}
                  <Text size="xs" fw={600} c={active ? `var(--mantine-color-${p.color}-light-color)` : undefined}>
                    {p.name}
                  </Text>
                  <Badge size="xs" variant={active ? "filled" : "light"}
                    color={count > 0 ? p.color : "gray"}
                    style={{ minWidth: 22, padding: "0 6px" }}>
                    {count}
                  </Badge>
                </UnstyledButton>
              );
            })}
          </Group>
        </>
      )}

      {lockedProvider && (
        <>
          <Group justify="space-between" mb="xs">
            <Text size="xs" c="dimmed">
              {scopeCount === 0
                ? <>No tokens currently route here — pinning has no effect</>
                : pinnedSummary.mixed
                  ? <><b>Mixed</b> — click any below to unify</>
                  : pinnedSummary.active === ""
                    ? <>{scopeCount} token{scopeCount !== 1 ? "s" : ""} — currently no pin</>
                    : <>{scopeCount} token{scopeCount !== 1 ? "s" : ""} pinned to <b>{pinnedSummary.active}</b></>
              }
            </Text>
            <Tooltip label={current ? `Refresh — fetched ${relAge(current.age_seconds)}${current.stale ? " (stale)" : ""}` : "Refresh model list"} withArrow>
              <ActionIcon variant="subtle" color="gray" size="sm"
                loading={isLoading}
                onClick={() => loadModels(pinProvider, true)}>
                <IconRefresh size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>

          {scopeCount === 0 && (
            <Paper p="xs" radius="sm" bg="var(--mantine-color-yellow-light)" mb="xs" withBorder
              style={{ borderColor: "var(--mantine-color-yellow-4)" }}>
              <Group gap={8} wrap="nowrap" align="flex-start">
                <IconAlertCircle size={14} color="var(--mantine-color-yellow-7)" style={{ marginTop: 2, flexShrink: 0 }} />
                <Stack gap={2} style={{ flex: 1 }}>
                  <Text size="xs" fw={600} c="yellow.8">
                    No tokens route to {providerLabel(pinProvider)} right now.
                  </Text>
                  <Text size="xs" c="dimmed" style={{ lineHeight: 1.5 }}>
                    To use this provider:
                    {" "}<b>(1)</b> Set <b>Routing Mode</b> at the top to <code>{providerLabel(pinProvider)}</code>, <b>or</b>
                    {" "}<b>(2)</b> Open a token in <b>Users tab → Token Detail</b> and set its Provider to <code>{providerLabel(pinProvider)}</code>.
                  </Text>
                </Stack>
              </Group>
            </Paper>
          )}
        </>
      )}

      {scopeCount === 0 && !lockedProvider && (
        <Group gap="xs" mb="sm">
          <IconAlertCircle size={14} color="var(--mantine-color-yellow-6)" />
          <Text size="xs" c="dimmed">
            No tokens currently use {providerLabel(pinProvider)}. Pin actions will not apply.
          </Text>
        </Group>
      )}

      {/* Search — always visible if there are models */}
      {models.length > 0 && (
        <TextInput
          placeholder={`Search ${models.length} ${providerLabel(pinProvider)} model${models.length !== 1 ? "s" : ""}…`}
          value={filter}
          onChange={e => setFilter(e.currentTarget.value)}
          leftSection={<IconSearch size={12} />}
          size="xs"
          mb="sm"
          disabled={lockedProvider !== undefined && scopeCount === 0}
        />
      )}

      {/* Loading / error / models list — dimmed + disabled when no tokens route here */}
      <Box style={{
        opacity:       lockedProvider && scopeCount === 0 ? 0.45 : 1,
        pointerEvents: lockedProvider && scopeCount === 0 ? "none" : "auto",
      }}>
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
      </Box>
    </Paper>
  );
}
