import { useState, useEffect, useMemo } from "react";
import {
  Accordion, Group, Text, Badge, ThemeIcon, Stack, Box, Divider, Alert, Anchor,
} from "@mantine/core";
import {
  IconAi, IconRobot, IconCloud, IconBolt, IconAlertCircle, IconCircleDashedCheck,
} from "@tabler/icons-react";
import { PinAllCard } from "./PinAllCard";
import { PollIntervalCard } from "./PollIntervalCard";
import { useStatus } from "../../contexts";

interface CustomProviderInfo { id: string; name: string; type: "anthropic" | "openai"; color?: string; api_key_set?: boolean; }
interface ApiToken { provider?: string; pinned_model?: string; }
interface ApiUser { tokens: ApiToken[]; }

interface ProviderDef {
  id:          string;
  name:        string;
  color:       string;
  icon:        React.ReactNode;
  description: string;
  builtin:     boolean;
  configured:  boolean;        // for built-in: api_key configured. For Claude: always true. For custom: api_key_set.
  type?:       "anthropic" | "openai";
}

interface Props {
  activeProvider: string;
  globalOverride: string;     // from parent — keeps in sync with saved settings
}

export function ProvidersAccordion({ activeProvider, globalOverride }: Props) {
  const status = useStatus();
  const upstream = status?.upstream;

  const [customProviders, setCustomProviders] = useState<CustomProviderInfo[]>([]);
  const [apiUsers, setApiUsers]               = useState<ApiUser[] | null>(null);
  const [settings, setSettings]               = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/admin/custom-providers")
      .then(r => r.ok ? r.json() : { providers: [] })
      .then((d: any) => setCustomProviders(Array.isArray(d.providers) ? d.providers : []))
      .catch(() => {});
    fetch("/api/admin/users")
      .then(r => r.json())
      .then((d: any) => setApiUsers(d.users ?? d))
      .catch(() => {});
    fetch("/api/admin/settings")
      .then(r => r.json())
      .then((d: any) => setSettings(d || {}))
      .catch(() => {});
  }, []);

  const deepseekConfigured   = !!settings.deepseek_api_key;
  const openrouterConfigured = !!settings.openrouter_api_key;

  // Check if a provider id has its credentials configured
  const isConfigured = (id: string): boolean => {
    if (id === "anthropic" || id === "" || id === "inherit") return true;
    if (id === "deepseek")   return deepseekConfigured;
    if (id === "openrouter") return openrouterConfigured;
    return !!customProviders.find(c => c.id === id)?.api_key_set;
  };

  // Resolve effective routing provider for a token — matches proxy.ts logic.
  // Falls back to anthropic if requested provider is not configured.
  const effectiveProviderOf = (tokenProvider: string): string => {
    // Per-token override
    if (tokenProvider && tokenProvider !== "inherit") {
      return isConfigured(tokenProvider) ? tokenProvider : "anthropic";
    }
    // Global override
    if (globalOverride) {
      return isConfigured(globalOverride) ? globalOverride : "anthropic";
    }
    return "anthropic";
  };

  // Compute per-provider stats using EFFECTIVE routing (not literal token.provider field)
  const stats = useMemo(() => {
    const out: Record<string, { count: number; pin: string | null; mixed: boolean }> = {};
    const allIds = ["anthropic", "deepseek", "openrouter", ...customProviders.map(c => c.id)];
    for (const id of allIds) out[id] = { count: 0, pin: "", mixed: false };

    if (!apiUsers) return out;

    const pinsByProvider: Record<string, string[]> = {};
    for (const u of apiUsers) for (const t of u.tokens) {
      const key = effectiveProviderOf(t.provider || "inherit");
      if (!(key in out)) continue; // unknown provider, skip
      out[key].count++;
      pinsByProvider[key] = pinsByProvider[key] || [];
      pinsByProvider[key].push(t.pinned_model || "");
    }

    for (const id of allIds) {
      const pins = pinsByProvider[id] || [];
      if (pins.length === 0) { out[id].pin = ""; continue; }
      const unique = new Set(pins);
      if (unique.size === 1) out[id].pin = pins[0] ?? "";
      else                   { out[id].pin = null; out[id].mixed = true; }
    }
    return out;
  }, [apiUsers, customProviders, globalOverride]);

  const providers: ProviderDef[] = [
    {
      id: "anthropic", name: "Claude Max", color: "blue",
      icon: <IconAi size={18} />,
      description: "Anthropic OAuth — primary provider",
      builtin: true, configured: true,
    },
    {
      id: "deepseek", name: "DeepSeek", color: "violet",
      icon: <IconRobot size={18} />,
      description: "Anthropic-compatible API",
      builtin: true, configured: deepseekConfigured,
    },
    {
      id: "openrouter", name: "OpenRouter", color: "orange",
      icon: <IconCloud size={18} />,
      description: "Gateway — 200+ models",
      builtin: true, configured: openrouterConfigured,
    },
    ...customProviders.map(cp => ({
      id:          cp.id,
      name:        cp.name,
      color:       cp.color || "gray",
      icon:        <IconBolt size={18} />,
      description: cp.type === "openai" ? "Custom — OpenAI-compatible (translated)" : "Custom — Anthropic-compatible",
      builtin:     false,
      configured:  !!cp.api_key_set,
      type:        cp.type,
    })),
  ];

  const renderControl = (p: ProviderDef) => {
    const st     = stats[p.id] || { count: 0, pin: "", mixed: false };
    const isActive = activeProvider === p.id || (activeProvider === "anthropic" && p.id === "anthropic");

    let pinText: string;
    if (st.count === 0)        pinText = "no tokens routed here";
    else if (st.mixed)         pinText = "mixed pins";
    else if (st.pin === "")    pinText = "no model pinned";
    else                       pinText = String(st.pin);
    // Trim long model names for collapsed view
    if (pinText.length > 28) pinText = pinText.slice(0, 25) + "…";

    return (
      <Group gap="sm" wrap="nowrap" align="center" style={{ flex: 1, minWidth: 0 }}>
        <ThemeIcon variant="light" color={p.color} size="lg" radius="md">{p.icon}</ThemeIcon>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Group gap={6} wrap="wrap" align="center">
            <Text size="sm" fw={700}>{p.name}</Text>
            {isActive && (
              <Badge size="xs" variant="filled" color="teal" leftSection={<IconCircleDashedCheck size={10} />}>
                Active
              </Badge>
            )}
            {!p.builtin && p.type && (
              <Badge size="xs" variant="light" color={p.type === "openai" ? "yellow" : "blue"}>
                {p.type === "openai" ? "OpenAI-like" : "Anthropic-like"}
              </Badge>
            )}
            {!p.configured && (
              <Badge size="xs" variant="outline" color="gray">not configured</Badge>
            )}
          </Group>
          <Group gap="xs" mt={2}>
            <Text size="xs" c="dimmed">{st.count} token{st.count !== 1 ? "s" : ""}</Text>
            <Text size="xs" c="dimmed">·</Text>
            <Text size="xs" c={st.mixed ? "orange" : "dimmed"}>{pinText}</Text>
          </Group>
        </div>
      </Group>
    );
  };

  // Default open: the active provider
  const defaultOpen = providers.find(p => p.id === activeProvider || (activeProvider === "" && p.id === "anthropic"))?.id || "anthropic";

  return (
    <Accordion variant="separated" radius="md" defaultValue={defaultOpen} multiple={false}>
      {providers.map(p => (
        <Accordion.Item key={p.id} value={p.id}>
          <Accordion.Control>{renderControl(p)}</Accordion.Control>
          <Accordion.Panel>
            {!p.configured ? (
              <Alert color="yellow" variant="light" icon={<IconAlertCircle size={14} />}>
                <Text size="xs">
                  This provider has no API key configured. Set it in the{" "}
                  <Anchor href="#" onClick={e => { e.preventDefault(); document.location.hash = "credentials"; }}>
                    Credentials
                  </Anchor>{" "}
                  tab to enable.
                </Text>
              </Alert>
            ) : (
              <Stack gap="md">
                {/* Pin Model picker scoped to this provider */}
                <PinAllCard lockedProvider={p.id} globalOverride={globalOverride} />

                {/* Claude Max only — Poll Interval */}
                {p.id === "anthropic" && (
                  <>
                    <Divider />
                    <PollIntervalCard />
                    {/* Optional: quota summary */}
                    {upstream && upstream.fiveHour && (
                      <Box>
                        <Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: ".05em" }} mb={4}>
                          Current Quota
                        </Text>
                        <Group gap="lg" wrap="wrap">
                          <Box>
                            <Text size="xs" c="dimmed">5-hour</Text>
                            <Text size="sm" ff="monospace">{upstream.fiveHour.utilization.toFixed(0)}%</Text>
                          </Box>
                          {upstream.sevenDay && (
                            <Box>
                              <Text size="xs" c="dimmed">7-day total</Text>
                              <Text size="sm" ff="monospace">{upstream.sevenDay.utilization.toFixed(0)}%</Text>
                            </Box>
                          )}
                          {upstream.sevenDaySonnet && (
                            <Box>
                              <Text size="xs" c="dimmed">Sonnet 7d</Text>
                              <Text size="sm" ff="monospace">{upstream.sevenDaySonnet.utilization.toFixed(0)}%</Text>
                            </Box>
                          )}
                          {upstream.sevenDayOpus && (
                            <Box>
                              <Text size="xs" c="dimmed">Opus 7d</Text>
                              <Text size="sm" ff="monospace">{upstream.sevenDayOpus.utilization.toFixed(0)}%</Text>
                            </Box>
                          )}
                        </Group>
                      </Box>
                    )}
                  </>
                )}
              </Stack>
            )}
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  );
}
