import { useState, useEffect } from "react";
import {
  Stack, Text, Paper, Group, Button, TextInput, Badge,
  ThemeIcon, Divider, PasswordInput, SegmentedControl, Box, SimpleGrid,
} from "@mantine/core";
import {
  IconRobot, IconCircleCheck, IconAlertTriangle, IconWifi,
  IconKey, IconCloud, IconAi,
} from "@tabler/icons-react";
import { UpstreamSection } from "../shared";
import { useStatus } from "../../contexts";

interface SettingsData {
  deepseek_api_key?: string;
  deepseek_base_url?: string;
  deepseek_model?: string;
  provider_override?: string;
}

function DeepSeekConfig() {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [override, setOverride] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; latency: number; detail?: string; error?: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then(r => r.json())
      .then((d: SettingsData) => {
        if (d.deepseek_api_key) setApiKey(d.deepseek_api_key);
        if (d.deepseek_base_url) setBaseUrl(d.deepseek_base_url);
        if (d.deepseek_model) setModel(d.deepseek_model);
        if (d.provider_override) setOverride(d.provider_override);
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    const form = new URLSearchParams();
    if (apiKey) form.set("api_key", apiKey);
    if (baseUrl) form.set("base_url", baseUrl);
    if (model) form.set("model", model);
    form.set("provider_override", override);
    try {
      const r = await fetch("/admin/settings/deepseek", { method: "POST", body: form });
      const d = await r.json() as any;
      if (d.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true); setTestResult(null);
    try {
      const r = await fetch("/api/admin/test/deepseek");
      setTestResult(await r.json());
    } catch (e: any) {
      setTestResult({ ok: false, latency: 0, error: e.message });
    } finally {
      setTesting(false);
    }
  };

  const configured = !!apiKey;
  const modeLabel = override === "deepseek" ? "All requests routed to DeepSeek"
    : override === "anthropic" ? "All requests routed to Claude Max only"
    : "Auto-switch to DeepSeek when Claude Max is rate-limited";
  const modeColor = override === "deepseek" ? "violet" : override === "anthropic" ? "blue" : "gray";

  return (
    <Paper withBorder p="lg" radius="md">
      <Group gap="sm" mb="lg">
        <ThemeIcon variant="light" color="violet" size="lg" radius="md">
          <IconRobot size={18} />
        </ThemeIcon>
        <div style={{ flex: 1 }}>
          <Text size="sm" fw={700}>DeepSeek</Text>
          <Text size="xs" c="dimmed">Fallback provider via Anthropic-compatible API</Text>
        </div>
        {configured && (
          <Badge color="violet" variant="light" size="sm">configured</Badge>
        )}
      </Group>

      <Stack gap="sm">
        <Box>
          <Text size="xs" fw={600} mb={6}>Routing Mode</Text>
          <SegmentedControl
            fullWidth
            size="xs"
            value={override}
            onChange={(v) => { setOverride(v); }}
            data={[
              { label: "Auto", value: "" },
              { label: "DeepSeek", value: "deepseek" },
              { label: "Claude Max", value: "anthropic" },
            ]}
          />
          <Text size="xs" c={modeColor} mt={6} style={{ lineHeight: 1.4 }}>
            {modeLabel}
          </Text>
        </Box>

        <Divider />

        <PasswordInput
          label="API Key"
          description="DeepSeek API token — stored encrypted in local database"
          placeholder="sk-..."
          value={apiKey}
          onChange={e => setApiKey(e.currentTarget.value)}
          size="sm"
        />
        <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm">
          <TextInput
            label="Base URL"
            description="Anthropic-compatible endpoint"
            placeholder="https://api.deepseek.com/anthropic"
            value={baseUrl}
            onChange={e => setBaseUrl(e.currentTarget.value)}
            size="sm"
          />
          <TextInput
            label="Model ID"
            description="DeepSeek model name for requests"
            placeholder="deepseek-v4-pro[1m]"
            value={model}
            onChange={e => setModel(e.currentTarget.value)}
            size="sm"
          />
        </SimpleGrid>

        <Group justify="space-between" align="center" mt={4}>
          <Text size="xs" c={configured ? "teal" : "red"}>
            {configured ? `Key: ...${apiKey.slice(-8)}` : "API key required to enable fallback"}
          </Text>
          <Group gap="xs">
            {saved && <Text size="xs" c="teal">Saved</Text>}
            <Button
              size="xs" variant="light" color="gray" radius="md"
              onClick={test} loading={testing} disabled={!configured}
              leftSection={testing ? undefined : <IconWifi size={13} />}
            >
              Test
            </Button>
            <Button size="xs" onClick={save} loading={saving} radius="md" disabled={!configured}>
              Save
            </Button>
          </Group>
        </Group>

        {testResult && (
          <Paper withBorder p="sm" radius="md" style={{
            borderColor: `var(--mantine-color-${testResult.ok ? "teal" : "red"}-4)`,
            background: `var(--mantine-color-${testResult.ok ? "teal" : "red"}-light)`,
          }}>
            <Group gap="sm" wrap="nowrap">
              <ThemeIcon variant="light" color={testResult.ok ? "teal" : "red"} size="sm" radius="sm">
                {testResult.ok ? <IconCircleCheck size={14} /> : <IconAlertTriangle size={14} />}
              </ThemeIcon>
              <Text size="xs" ff="monospace" c={testResult.ok ? "teal" : "red"} style={{ flex: 1 }}>
                {testResult.ok ? testResult.detail : (testResult.error || "Connection failed")}
              </Text>
              {testResult.latency > 0 && (
                <Badge size="xs" variant="outline" color="gray">{testResult.latency}ms</Badge>
              )}
            </Group>
          </Paper>
        )}
      </Stack>
    </Paper>
  );
}

export function AdminProviders() {
  const status = useStatus()!;
  const { upstream } = status;
  const isFallback = upstream.fallbackProvider === "deepseek";
  const providerDot = isFallback ? "violet" : upstream.ok ? "teal" : "red";
  const providerName = isFallback ? "DeepSeek" : "Claude Max";
  const providerDesc = isFallback
    ? "DeepSeek is currently serving all requests"
    : upstream.ok
    ? "Claude Max is healthy and serving requests"
    : "Claude Max may be unreachable";

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
              <Text size="xl" fw={800} ff="monospace">API Providers</Text>
              <Text size="sm" c="dimmed" mt={2}>Configure upstream providers and fallback behavior</Text>
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

      {/* Claude Max status (read-only) */}
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

      {/* DeepSeek config */}
      <DeepSeekConfig />

      {/* Quick reference */}
      <Paper withBorder p="md" radius="md" style={{ opacity: 0.7 }}>
        <Text size="xs" fw={600} mb={8} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>How It Works</Text>
        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            <b>Auto</b> — Proxy uses Claude Max normally. When rate-limited (5h utilization &ge; 95% or HTTP 429),
            requests automatically route to DeepSeek until Claude recovers.
          </Text>
          <Text size="xs" c="dimmed">
            <b>DeepSeek</b> — All requests go through DeepSeek regardless of Claude status. Use when Claude Max quota is exhausted.
          </Text>
          <Text size="xs" c="dimmed">
            <b>Claude Max</b> — Never fallback. Requests return rate-limit errors when Claude is at capacity.
          </Text>
        </Stack>
      </Paper>
    </Stack>
  );
}
