import { useState, useEffect } from "react";
import {
  Stack, Text, Paper, Group, Button, Badge,
  ThemeIcon, SegmentedControl, Slider, NumberInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconRefresh, IconAlertCircle,
} from "@tabler/icons-react";
import { PinAllCard } from "./PinAllCard";

interface SettingsData {
  deepseek_api_key?:    string;
  deepseek_base_url?:   string;
  deepseek_model?:      string;
  openrouter_api_key?:  string;
  openrouter_base_url?: string;
  openrouter_model?:    string;
  provider_override?:   string;
  poll_interval_ms?:    string;
}

export function AdminProviders() {
  const [override, setOverride] = useState("");
  const [settingsData, setSettingsData] = useState<SettingsData>({});
  const [saving, setSaving] = useState(false);
  const [pollSeconds, setPollSeconds]       = useState<number>(60);
  const [pollSavedSeconds, setPollSavedSec] = useState<number>(60);
  const [savingPoll, setSavingPoll]         = useState(false);

  const deepseekConfigured   = !!settingsData.deepseek_api_key;
  const openrouterConfigured = !!settingsData.openrouter_api_key;

  useEffect(() => {
    fetch("/api/admin/settings")
      .then(r => r.json())
      .then((d: SettingsData) => {
        setSettingsData(d);
        setOverride(d.provider_override ?? "");
        const ms = parseInt(d.poll_interval_ms || "60000");
        const sec = Number.isFinite(ms) ? Math.round(ms / 1000) : 60;
        setPollSeconds(sec);
        setPollSavedSec(sec);
      })
      .catch(() => {});
  }, []);

  const savePoll = async () => {
    setSavingPoll(true);
    try {
      const r = await fetch("/admin/settings/poll-interval", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ seconds: String(pollSeconds) }),
      });
      const text = await r.text();
      const ct   = r.headers.get("content-type") || "";
      let d: any = {};
      if (ct.includes("application/json")) { try { d = JSON.parse(text); } catch {} }
      if (!r.ok || d.ok === false) {
        notifications.show({ color: "red", title: "Save failed", message: d.error || text.slice(0, 120) || `HTTP ${r.status}`, autoClose: 4000 });
        return;
      }
      setPollSavedSec(pollSeconds);
      notifications.show({ color: "teal", message: `Poll interval set to ${pollSeconds}s — applies on next tick`, autoClose: 2500 });
    } catch (e: any) {
      notifications.show({ color: "red", message: e.message || "Failed", autoClose: 3000 });
    } finally { setSavingPoll(false); }
  };

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

  const modeLabel = override === "deepseek" ? "All requests routed to DeepSeek"
    : override === "openrouter" ? "All requests routed to OpenRouter"
    : override === "anthropic" ? "All requests routed to Claude Max only"
    : "Auto-switch to OpenRouter first, then DeepSeek when Claude Max is rate-limited";
  const modeColor = override === "deepseek" ? "violet"
    : override === "openrouter" ? "orange"
    : override === "anthropic" ? "blue"
    : "gray";

  const segmentLabel = (label: string, configured: boolean | null) => (
    <Group gap={6} justify="center" wrap="nowrap">
      <Text size="xs" fw={600}>{label}</Text>
      {configured === false && <IconAlertCircle size={11} color="var(--mantine-color-yellow-6)" />}
    </Group>
  );

  return (
    <Stack gap="xl" maw={780} px={{ base: "xs", sm: 0 }}>
      {/* Slim header */}
      <div>
        <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }} mb={4}>Providers</Text>
        <Text size="xl" fw={800} ff="monospace">Configuration</Text>
        <Text size="sm" c="dimmed" mt={4}>
          Routing, model pinning, and upstream polling settings. Configure API keys in the <b>Credentials</b> tab.
        </Text>
      </div>

      {/* Routing mode — disabled segments for unconfigured providers */}
      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" mb="md" wrap="nowrap">
          <Text size="sm" fw={700}>Routing Mode</Text>
          <Badge variant="light" color={modeColor} size="sm">
            {override === "" ? "Auto" : override === "anthropic" ? "Claude Max" : override === "deepseek" ? "DeepSeek" : "OpenRouter"}
          </Badge>
        </Group>
        <SegmentedControl
          fullWidth
          size="sm"
          value={override}
          onChange={setOverride}
          data={[
            { label: segmentLabel("Auto",       null),                 value: "" },
            { label: segmentLabel("Claude Max", true),                 value: "anthropic" },
            { label: segmentLabel("OpenRouter", openrouterConfigured), value: "openrouter", disabled: !openrouterConfigured },
            { label: segmentLabel("DeepSeek",   deepseekConfigured),   value: "deepseek",   disabled: !deepseekConfigured },
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
          <Button size="xs" onClick={save} loading={saving} radius="md">Save</Button>
        </Group>
      </Paper>

      {/* Pin All Tokens — provider-aware model selection */}
      <PinAllCard />

      {/* Polling Interval */}
      <Paper withBorder p="lg" radius="md">
        <Group gap="sm" mb="md" align="center">
          <ThemeIcon variant="light" color="teal" size="md" radius="md">
            <IconRefresh size={16} />
          </ThemeIcon>
          <div style={{ flex: 1 }}>
            <Text size="sm" fw={700}>Upstream Poll Interval</Text>
            <Text size="xs" c="dimmed">How often the proxy fetches Claude quota status. Dashboard refreshes every poll.</Text>
          </div>
          <Badge variant="light" color="teal" size="sm" ff="monospace">
            current: {pollSavedSeconds}s
          </Badge>
        </Group>

        <Slider
          value={pollSeconds}
          onChange={setPollSeconds}
          min={10}
          max={300}
          step={5}
          marks={[
            { value: 10,  label: "10s" },
            { value: 30,  label: "30s" },
            { value: 60,  label: "1m" },
            { value: 120, label: "2m" },
            { value: 300, label: "5m" },
          ]}
          color="teal"
          mb="xl"
        />

        <Group gap="xs" mt="xl" align="end" justify="space-between" wrap="wrap">
          <NumberInput
            label="Custom (seconds)"
            description="Range: 10 – 1800 (30 min)"
            value={pollSeconds}
            onChange={(v) => setPollSeconds(typeof v === "number" ? v : 60)}
            min={10}
            max={1800}
            step={5}
            size="xs"
            style={{ width: 220 }}
          />
          <Group gap="xs">
            <Button size="xs" variant="subtle" color="gray"
              disabled={pollSeconds === pollSavedSeconds}
              onClick={() => setPollSeconds(pollSavedSeconds)}>
              Revert
            </Button>
            <Button size="xs"
              disabled={pollSeconds === pollSavedSeconds}
              loading={savingPoll}
              onClick={savePoll}>
              Save
            </Button>
          </Group>
        </Group>

        <Text size="xs" c="dimmed" mt="md" style={{ lineHeight: 1.5 }}>
          <b>Trade-off:</b> Lower interval → fresher data, higher chance of hitting Anthropic 429 (5-min backoff).
          Higher interval → less load, more stale data. Default <b>60s</b> is balanced.
        </Text>
      </Paper>

    </Stack>
  );
}
