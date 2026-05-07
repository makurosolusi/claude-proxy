import { useState, useEffect } from "react";
import {
  Stack, Text, Paper, Group, Button, Badge,
  ThemeIcon, Box, SegmentedControl,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconRobot, IconCloud, IconAi,
} from "@tabler/icons-react";
import { UpstreamSection } from "../shared";
import { useStatus } from "../../contexts";

interface SettingsData {
  deepseek_api_key?: string;
  openrouter_api_key?: string;
  provider_override?: string;
}

export function AdminProviders() {
  const status = useStatus()!;
  const { upstream } = status;

  const [override, setOverride] = useState("");
  const [deepseekConfigured, setDeepseekConfigured] = useState(false);
  const [openrouterConfigured, setOpenrouterConfigured] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then(r => r.json())
      .then((d: SettingsData) => {
        setOverride(d.provider_override ?? "");
        setDeepseekConfigured(!!d.deepseek_api_key);
        setOpenrouterConfigured(!!d.openrouter_api_key);
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    const form = new URLSearchParams();
    form.set("provider_override", override);
    try {
      const r = await fetch("/admin/settings/deepseek", { method: "POST", body: form });
      const d = await r.json() as any;
      if (d.ok) { notifications.show({ color: "teal", message: "Routing mode saved", autoClose: 2000 }); }
    } finally { setSaving(false); }
  };

  const fb = upstream.fallbackProvider;
  const isDS = fb === "deepseek";
  const isOR = fb === "openrouter";
  const providerDot = isDS ? "violet" : isOR ? "orange" : upstream.ok ? "teal" : "red";
  const providerName = isDS ? "DeepSeek" : isOR ? "OpenRouter" : "Claude Max";
  const providerDesc = isDS || isOR
    ? `${providerName} is currently serving all requests`
    : upstream.ok
    ? "Claude Max is healthy and serving requests"
    : "Claude Max may be unreachable";

  const modeLabel = override === "deepseek" ? "All requests routed to DeepSeek"
    : override === "openrouter" ? "All requests routed to OpenRouter"
    : override === "anthropic" ? "All requests routed to Claude Max only"
    : "Auto-switch to OpenRouter first, then DeepSeek when Claude Max is rate-limited";
  const modeColor = override === "deepseek" ? "violet"
    : override === "openrouter" ? "orange"
    : override === "anthropic" ? "blue"
    : "gray";

  return (
    <Stack gap="xl" maw={780}>
      {/* Header — active provider indicator */}
      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" wrap="wrap">
          <Group gap="md">
            <ThemeIcon variant="light" color="blue" size="xl" radius="md">
              <IconCloud size={22} />
            </ThemeIcon>
            <div>
              <Text size="sm" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }} mb={4}>Providers</Text>
              <Text size="xl" fw={800} ff="monospace">Routing</Text>
              <Text size="sm" c="dimmed" mt={2}>Select which upstream provider handles requests</Text>
            </div>
          </Group>
          <Paper withBorder p="sm" radius="md" style={{ background: `var(--mantine-color-${providerDot}-light)` }}>
            <Group gap="sm">
              <Box w={10} h={10} style={{ borderRadius: "50%", background: `var(--mantine-color-${providerDot}-5)`, flexShrink: 0 }} />
              <div>
                <Text size="sm" fw={600}>{providerName}</Text>
                <Text size="xs" c="dimmed">{providerDesc}</Text>
              </div>
            </Group>
          </Paper>
        </Group>
      </Paper>

      {/* Routing mode — single control */}
      <Paper withBorder p="lg" radius="md">
        <Text size="sm" fw={700} mb="md">Routing Mode</Text>
        <SegmentedControl
          fullWidth
          size="sm"
          value={override}
          onChange={setOverride}
          data={[
            { label: "Auto", value: "" },
            { label: "Claude Max", value: "anthropic" },
            { label: "OpenRouter", value: "openrouter" },
            { label: "DeepSeek", value: "deepseek" },
          ]}
        />
        <Text size="xs" c={modeColor} mt={8} style={{ lineHeight: 1.5 }}>{modeLabel}</Text>
        <Group justify="flex-end" mt="md" gap="xs">
          <Button size="xs" onClick={save} loading={saving} radius="md">Save</Button>
        </Group>
      </Paper>

      {/* Provider status — read-only overview */}
      <Stack gap="sm">
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Provider Status</Text>

        {/* Claude Max */}
        <Paper withBorder p="lg" radius="md">
          <Group gap="sm" mb="lg">
            <ThemeIcon variant="light" color="blue" size="lg" radius="md">
              <IconAi size={18} />
            </ThemeIcon>
            <div style={{ flex: 1 }}>
              <Text size="sm" fw={700}>Claude Max</Text>
              <Text size="xs" c="dimmed">Primary provider — OAuth via claude-*.json credentials</Text>
            </div>
            {upstream.email && (
              <Badge variant="light" color="blue" size="sm" ff="monospace">{upstream.email}</Badge>
            )}
          </Group>
          <UpstreamSection upstream={upstream} isAdmin={true} />
        </Paper>

        {/* DeepSeek */}
        <Paper withBorder p="md" radius="md" style={{ opacity: deepseekConfigured ? 1 : 0.6 }}>
          <Group justify="space-between">
            <Group gap="sm">
              <ThemeIcon variant="light" color="violet" size="md" radius="md">
                <IconRobot size={16} />
              </ThemeIcon>
              <div>
                <Text size="sm" fw={600}>DeepSeek</Text>
                <Text size="xs" c="dimmed">Anthropic-compatible API</Text>
              </div>
            </Group>
            <Badge
              color={deepseekConfigured ? "violet" : "gray"}
              variant={deepseekConfigured ? "light" : "outline"}
              size="sm"
            >
              {deepseekConfigured ? "configured" : "not configured"}
            </Badge>
          </Group>
        </Paper>

        {/* OpenRouter */}
        <Paper withBorder p="md" radius="md" style={{ opacity: openrouterConfigured ? 1 : 0.6 }}>
          <Group justify="space-between">
            <Group gap="sm">
              <ThemeIcon variant="light" color="orange" size="md" radius="md">
                <IconCloud size={16} />
              </ThemeIcon>
              <div>
                <Text size="sm" fw={600}>OpenRouter</Text>
                <Text size="xs" c="dimmed">Gateway — 200+ models</Text>
              </div>
            </Group>
            <Badge
              color={openrouterConfigured ? "orange" : "gray"}
              variant={openrouterConfigured ? "light" : "outline"}
              size="sm"
            >
              {openrouterConfigured ? "configured" : "not configured"}
            </Badge>
          </Group>
        </Paper>
      </Stack>

      {/* How It Works */}
      <Paper withBorder p="md" radius="md" style={{ opacity: 0.7 }}>
        <Text size="xs" fw={600} mb={8} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>How It Works</Text>
        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            <b>Auto</b> — Proxy uses Claude Max normally. When rate-limited (5h utilization &ge; 95% or HTTP 429),
            requests automatically route to OpenRouter first (if configured), then DeepSeek, until Claude recovers.
          </Text>
          <Text size="xs" c="dimmed">
            <b>OpenRouter</b> — All requests go through OpenRouter regardless of Claude status.
          </Text>
          <Text size="xs" c="dimmed">
            <b>DeepSeek</b> — All requests go through DeepSeek regardless of Claude status.
          </Text>
          <Text size="xs" c="dimmed">
            <b>Claude Max</b> — Never fallback. Requests return rate-limit errors when Claude is at capacity.
          </Text>
          <Text size="xs" c="dimmed" mt={4}>
            Configure API keys for DeepSeek and OpenRouter in the <b>Credentials</b> section.
          </Text>
        </Stack>
      </Paper>
    </Stack>
  );
}
