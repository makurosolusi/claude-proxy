import { useState, useEffect } from "react";
import {
  Stack, Text, Paper, Group, Button, TextInput, Badge,
  ThemeIcon, PasswordInput, Modal, Textarea, Alert, Code,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconWifi, IconCircleCheck, IconAlertTriangle, IconFileImport,
  IconRobot, IconCloud,
} from "@tabler/icons-react";

type ProviderId = "deepseek" | "openrouter";

interface ProviderConfig {
  id:                   ProviderId;
  name:                 string;
  description:          string;
  color:                string;
  icon:                 React.ReactNode;
  apiKeyPlaceholder:    string;
  apiKeyDescription:    string;
  baseUrlPlaceholder:   string;
  saveEndpoint:         string;
  testEndpoint:         string;
  settingsApiKeyField:  string;
  settingsBaseUrlField: string;
}

const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  deepseek: {
    id:                   "deepseek",
    name:                 "DeepSeek",
    description:          "Anthropic-compatible API — fallback provider",
    color:                "violet",
    icon:                 <IconRobot size={18} />,
    apiKeyPlaceholder:    "sk-...",
    apiKeyDescription:    "DeepSeek API token — stored encrypted in local database",
    baseUrlPlaceholder:   "https://api.deepseek.com/anthropic",
    saveEndpoint:         "/admin/settings/deepseek",
    testEndpoint:         "/api/admin/test/deepseek",
    settingsApiKeyField:  "deepseek_api_key",
    settingsBaseUrlField: "deepseek_base_url",
  },
  openrouter: {
    id:                   "openrouter",
    name:                 "OpenRouter",
    description:          "Gateway — 200+ models via Anthropic-compatible API",
    color:                "orange",
    icon:                 <IconCloud size={18} />,
    apiKeyPlaceholder:    "sk-or-v1-...",
    apiKeyDescription:    "OpenRouter API token",
    baseUrlPlaceholder:   "https://openrouter.ai/api",
    saveEndpoint:         "/admin/settings/openrouter",
    testEndpoint:         "/api/admin/test/openrouter",
    settingsApiKeyField:  "openrouter_api_key",
    settingsBaseUrlField: "openrouter_base_url",
  },
};

interface SettingsData { [key: string]: string | undefined; }
type TestResult = { ok: boolean; latency: number; detail?: string; error?: string };

export function ApiKeyProvider({ provider }: { provider: ProviderId }) {
  const cfg = PROVIDERS[provider];

  const [apiKey, setApiKey]   = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [saving, setSaving]   = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const [importOpen, setImportOpen]       = useState(false);
  const [importContent, setImportContent] = useState("");
  const [importing, setImporting]         = useState(false);
  const [importErr, setImportErr]         = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then(r => r.json())
      .then((d: SettingsData) => {
        if (d[cfg.settingsApiKeyField])  setApiKey(d[cfg.settingsApiKeyField] || "");
        if (d[cfg.settingsBaseUrlField]) setBaseUrl(d[cfg.settingsBaseUrlField] || "");
      })
      .catch(() => {});
  }, [cfg]);

  const save = async (overrideKey?: string, overrideUrl?: string) => {
    setSaving(true);
    const form = new URLSearchParams();
    const finalKey = overrideKey ?? apiKey;
    const finalUrl = overrideUrl ?? baseUrl;
    if (finalKey) form.set("api_key", finalKey);
    if (finalUrl) form.set("base_url", finalUrl);
    try {
      const r = await fetch(cfg.saveEndpoint, { method: "POST", body: form });
      const d = await r.json() as any;
      if (d.ok) notifications.show({ color: "teal", message: `${cfg.name} credentials saved`, autoClose: 2000 });
    } finally { setSaving(false); }
  };

  const test = async () => {
    setTesting(true); setTestResult(null);
    try {
      const r = await fetch(cfg.testEndpoint);
      setTestResult(await r.json());
    } catch (e: any) {
      setTestResult({ ok: false, latency: 0, error: e.message });
    } finally { setTesting(false); }
  };

  const doImport = async () => {
    setImporting(true); setImportErr(null);
    try {
      const parsed = JSON.parse(importContent.trim());
      const newKey = String(parsed.api_key  || parsed.apiKey  || "").trim();
      const newUrl = String(parsed.base_url || parsed.baseUrl || "").trim();
      if (!newKey) {
        setImportErr("api_key is required in the JSON");
        return;
      }
      setApiKey(newKey);
      if (newUrl) setBaseUrl(newUrl);
      await save(newKey, newUrl);
      notifications.show({ color: "teal", message: `${cfg.name} credential imported`, autoClose: 2500 });
      setImportOpen(false);
      setImportContent("");
    } catch (e: any) {
      setImportErr(e instanceof SyntaxError ? "Not valid JSON" : (e.message || "Import failed"));
    } finally { setImporting(false); }
  };

  const configured = !!apiKey;

  return (
    <Paper withBorder p="lg" radius="md">
      <Group gap="sm" mb="lg" wrap="wrap">
        <ThemeIcon variant="light" color={cfg.color} size="lg" radius="md">
          {cfg.icon}
        </ThemeIcon>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm" fw={700}>{cfg.name}</Text>
          <Text size="xs" c="dimmed">{cfg.description}</Text>
        </div>
        <Group gap="xs">
          {configured && <Badge color={cfg.color} variant="light" size="sm">configured</Badge>}
          <Button size="xs" variant="default" leftSection={<IconFileImport size={13} />}
            onClick={() => setImportOpen(true)} radius="md">
            Import JSON
          </Button>
        </Group>
      </Group>

      <Stack gap="sm">
        <PasswordInput
          label="API Key"
          description={cfg.apiKeyDescription}
          placeholder={cfg.apiKeyPlaceholder}
          value={apiKey}
          onChange={e => setApiKey(e.currentTarget.value)}
          size="sm"
        />
        <TextInput
          label="Base URL"
          description={`${cfg.name} endpoint`}
          placeholder={cfg.baseUrlPlaceholder}
          value={baseUrl}
          onChange={e => setBaseUrl(e.currentTarget.value)}
          size="sm"
        />
        <Text size="xs" c="dimmed">
          Default model & per-token pinning are configured in the <b>Providers</b> tab.
        </Text>
        <Group justify="space-between" align="center" mt={4}>
          <Text size="xs" c={configured ? "teal" : "red"}>
            {configured ? `Key: ...${apiKey.slice(-8)}` : `API key required to enable ${cfg.name}`}
          </Text>
          <Group gap="xs">
            <Button
              size="xs" variant="light" color="gray" radius="md"
              onClick={test} loading={testing} disabled={!configured}
              leftSection={testing ? undefined : <IconWifi size={13} />}
            >
              Test
            </Button>
            <Button size="xs" onClick={() => save()} loading={saving} radius="md">Save</Button>
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

      {/* Import Modal */}
      <Modal opened={importOpen} onClose={() => { setImportOpen(false); setImportContent(""); setImportErr(null); }}
        title={`Import ${cfg.name} Credential`} size="lg">
        <Stack gap="md">
          <Text size="xs" c="dimmed" style={{ lineHeight: 1.55 }}>
            Paste a JSON object with at minimum an <Code>api_key</Code> field. Optional fields:
            <Code>base_url</Code>. Values will overwrite the current form and save immediately.
          </Text>
          <Textarea
            label="JSON content"
            description="Required: api_key. Optional: base_url"
            placeholder={`{\n  "api_key": "${cfg.apiKeyPlaceholder}",\n  "base_url": "${cfg.baseUrlPlaceholder}"\n}`}
            value={importContent}
            onChange={e => setImportContent(e.currentTarget.value)}
            minRows={6} maxRows={12} autosize
            styles={{ input: { fontFamily: "monospace", fontSize: 12 } }}
          />
          {importErr && (
            <Alert color="red" variant="light" icon={<IconAlertTriangle size={14} />} p="sm">
              <Text size="xs">{importErr}</Text>
            </Alert>
          )}
          <Group justify="flex-end" gap="xs">
            <Button variant="subtle" color="gray"
              onClick={() => { setImportOpen(false); setImportContent(""); setImportErr(null); }}>
              Cancel
            </Button>
            <Button color={cfg.color} loading={importing}
              disabled={!importContent.trim()}
              onClick={doImport}
              leftSection={<IconFileImport size={14} />}>
              Import & Save
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Paper>
  );
}
