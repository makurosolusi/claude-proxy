import { useState, useEffect } from "react";
import {
  Stack, Text, Paper, Group, Button, Badge, Select, Switch,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertCircle, IconFlask } from "@tabler/icons-react";
import { ProvidersAccordion } from "./ProvidersAccordion";

interface SettingsData {
  deepseek_api_key?:           string;
  openrouter_api_key?:         string;
  provider_override?:          string;
  simulate_anthropic_disabled?: string;
}

interface CustomProviderInfo { id: string; name: string; type: "anthropic" | "openai"; color?: string; api_key_set?: boolean; }

export function AdminProviders() {
  const [override, setOverride]               = useState("");
  const [savedOverride, setSavedOverride]     = useState("");
  const [settingsData, setSettingsData]       = useState<SettingsData>({});
  const [saving, setSaving]                   = useState(false);
  const [customProviders, setCustomProviders] = useState<CustomProviderInfo[]>([]);
  const [loadingInit, setLoadingInit]         = useState(true);
  const [simulateOff, setSimulateOff]         = useState(false);
  const [simSaving, setSimSaving]             = useState(false);

  const deepseekConfigured   = !!settingsData.deepseek_api_key;
  const openrouterConfigured = !!settingsData.openrouter_api_key;
  const overrideDirty        = override !== savedOverride;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/admin/settings").then(r => r.json()).catch(() => ({})),
      fetch("/api/admin/custom-providers").then(r => r.ok ? r.json() : { providers: [] }).catch(() => ({ providers: [] })),
    ]).then(([s, cp]: any[]) => {
      if (cancelled) return;
      const d: SettingsData = s || {};
      const customs: CustomProviderInfo[] = Array.isArray(cp?.providers) ? cp.providers : [];
      setSettingsData(d);
      setCustomProviders(customs);

      // Stale-override cleanup
      const rawOverride = d.provider_override ?? "";
      const isBuiltin   = ["", "anthropic", "deepseek", "openrouter"].includes(rawOverride);
      const customExists = customs.some(c => c.id === rawOverride);
      const resolvedOverride = isBuiltin || customExists ? rawOverride : "";
      if (rawOverride !== resolvedOverride) {
        fetch("/admin/settings/provider-override", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ override: "" }),
        }).catch(() => {});
        notifications.show({
          color: "yellow",
          title: "Routing reset to Auto",
          message: `Provider "${rawOverride}" no longer exists — override cleared.`,
          autoClose: 4000,
        });
      }
      setOverride(resolvedOverride);
      setSavedOverride(resolvedOverride);
      setSimulateOff(d.simulate_anthropic_disabled === "true");
      setLoadingInit(false);
    });
    return () => { cancelled = true; };
  }, []);

  const activeCustom = customProviders.find(c => c.id === override);

  const autoFallbackChain = (() => {
    const chain: string[] = [];
    if (openrouterConfigured) chain.push("OpenRouter");
    if (deepseekConfigured)   chain.push("DeepSeek");
    return chain;
  })();
  const autoModeLabel = autoFallbackChain.length === 0
    ? "Claude Max only — no fallback configured. Configure OpenRouter or DeepSeek in Credentials for auto-fallback."
    : autoFallbackChain.length === 1
      ? `Claude Max → ${autoFallbackChain[0]} when Claude is rate-limited`
      : `Claude Max → ${autoFallbackChain.join(" → ")} when Claude is rate-limited`;

  const modeLabel = override === "deepseek" ? "All requests routed to DeepSeek"
    : override === "openrouter" ? "All requests routed to OpenRouter"
    : override === "anthropic" ? "All requests routed to Claude Max only"
    : activeCustom ? `All requests routed to ${activeCustom.name} (${activeCustom.type === "openai" ? "OpenAI-like, with translation" : "Anthropic-like"})`
    : autoModeLabel;
  const modeColor = override === "deepseek" ? "violet"
    : override === "openrouter" ? "orange"
    : override === "anthropic" ? "blue"
    : activeCustom?.color || "gray";
  const modeBadgeText = override === "" ? "Auto"
    : override === "anthropic" ? "Claude Max"
    : override === "deepseek" ? "DeepSeek"
    : override === "openrouter" ? "OpenRouter"
    : activeCustom?.name || override;

  // Effective active provider for the accordion — based on SAVED override (not pending draft).
  // Otherwise the "Active" badge would jump before user confirms by clicking Save.
  const effectiveActiveProvider = savedOverride === ""
    ? "anthropic"  // Auto mode defaults to Claude
    : savedOverride;

  const toggleSimulate = async (next: boolean) => {
    setSimSaving(true);
    setSimulateOff(next); // optimistic
    try {
      const r = await fetch("/admin/settings/simulate-anthropic-disabled", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ enabled: next ? "true" : "false" }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      notifications.show({
        color: next ? "orange" : "teal",
        title: next ? "Simulation ON" : "Simulation OFF",
        message: next
          ? "Anthropic is now treated as disconnected. Requests will route to fallback. Toggle off to restore."
          : "Anthropic re-enabled (real credential state restored).",
        autoClose: 4000,
      });
    } catch (e: any) {
      setSimulateOff(!next); // revert
      notifications.show({ color: "red", title: "Toggle failed", message: e.message || "Failed", autoClose: 3000 });
    } finally { setSimSaving(false); }
  };

  const save = async () => {
    if (!overrideDirty) return;
    setSaving(true);
    try {
      const r = await fetch("/admin/settings/provider-override", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ override }),
      });
      const text = await r.text();
      const ct   = r.headers.get("content-type") || "";
      let d: any = {};
      if (ct.includes("application/json")) { try { d = JSON.parse(text); } catch {} }
      if (!r.ok || d.ok === false) {
        notifications.show({ color: "red", title: "Save failed", message: d.error || text.slice(0, 120) || `HTTP ${r.status}`, autoClose: 4000 });
        return;
      }
      setSavedOverride(override);
      notifications.show({ color: "teal", message: "Routing mode saved", autoClose: 2000 });
    } catch (e: any) {
      notifications.show({ color: "red", title: "Network error", message: e.message || "Failed", autoClose: 3000 });
    } finally { setSaving(false); }
  };

  return (
    <Stack gap="xl" maw={780} px={{ base: "xs", sm: 0 }}>
      <div>
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }} mb={4}>Providers</Text>
        <Text size="xl" fw={800} ff="monospace">Configuration</Text>
        <Text size="sm" c="dimmed" mt={4}>
          Routing & per-provider settings. API keys are managed in the <b>Credentials</b> tab.
        </Text>
      </div>

      {/* Routing mode — global selector */}
      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" mb="md" wrap="nowrap">
          <Text size="sm" fw={700}>Routing Mode</Text>
          <Badge variant="light" color={modeColor} size="sm">{modeBadgeText}</Badge>
        </Group>
        <Select
          size="sm"
          value={override}
          onChange={v => setOverride(v ?? "")}
          allowDeselect={false}
          comboboxProps={{ withinPortal: true }}
          data={[
            { group: "Mode", items: [
              { value: "",          label: "Auto (smart fallback)" },
              { value: "anthropic", label: "Claude Max only" },
              { value: "openrouter",label: openrouterConfigured ? "OpenRouter only" : "OpenRouter only (not configured)", disabled: !openrouterConfigured },
              { value: "deepseek",  label: deepseekConfigured   ? "DeepSeek only"   : "DeepSeek only (not configured)",   disabled: !deepseekConfigured },
            ]},
            ...(customProviders.length > 0 ? [{
              group: "Custom",
              items: customProviders.map(p => ({
                value:    p.id,
                label:    `${p.name} only (${p.type === "openai" ? "OpenAI-like" : "Anthropic-like"})${p.api_key_set ? "" : " — no key"}`,
                disabled: !p.api_key_set,
              })),
            }] : []),
          ]}
        />
        <Text size="xs" c={modeColor} mt={8} style={{ lineHeight: 1.5 }}>{modeLabel}</Text>
        {(!deepseekConfigured || !openrouterConfigured) && (
          <Text size="xs" c="dimmed" mt={4}>
            <IconAlertCircle size={10} style={{ verticalAlign: -1, marginRight: 4 }} color="var(--mantine-color-yellow-6)" />
            Unconfigured providers are disabled. Set API keys in <b>Credentials</b> to enable.
          </Text>
        )}
        <Group justify="flex-end" mt="md" gap="xs">
          <Button size="xs" variant="subtle" color="gray"
            disabled={!overrideDirty}
            onClick={() => setOverride(savedOverride)}>
            Revert
          </Button>
          <Button size="xs" onClick={save} loading={saving} disabled={!overrideDirty || loadingInit} radius="md">
            Save
          </Button>
        </Group>
      </Paper>

      {/* Simulate Anthropic disabled — dry-run the fallback-only flow */}
      <Paper withBorder p="lg" radius="md" style={simulateOff ? { borderColor: "var(--mantine-color-orange-5)" } : undefined}>
        <Group justify="space-between" wrap="nowrap" mb={6}>
          <Group gap={8}>
            <IconFlask size={16} color="var(--mantine-color-orange-6)" />
            <Text size="sm" fw={700}>Simulate Anthropic disabled</Text>
            {simulateOff && <Badge variant="filled" color="orange" size="xs">ACTIVE</Badge>}
          </Group>
          <Switch
            checked={simulateOff}
            onChange={e => toggleSimulate(e.currentTarget.checked)}
            disabled={simSaving || loadingInit}
            color="orange"
            size="md"
          />
        </Group>
        <Text size="xs" c="dimmed" style={{ lineHeight: 1.5 }}>
          Pretend no Claude credential is connected — without touching credential files. Use this to dry-run the fallback-only mode (verify UI banners, routing chain, mining provider switch). Toggle off to restore real state. Effect is immediate (no restart).
        </Text>
      </Paper>

      {/* Per-provider settings accordion */}
      <Stack gap="xs">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>
          Per-Provider Settings
        </Text>
        <Text size="xs" c="dimmed">
          Pin models, configure provider-specific options. Click a provider to expand.
        </Text>
        <ProvidersAccordion activeProvider={effectiveActiveProvider} globalOverride={savedOverride} />
      </Stack>
    </Stack>
  );
}
