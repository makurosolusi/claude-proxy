import { useState, useEffect, useCallback } from "react";
import {
  Stack, Text, Paper, Group, Button, TextInput, Badge,
  ActionIcon, Tooltip, Center, Loader, Code, ThemeIcon,
  PasswordInput, SimpleGrid, Divider,
} from "@mantine/core";
import {
  IconExternalLink, IconCircleCheck, IconKey, IconPlayerStop,
  IconUserCircle, IconPlugConnected, IconAlertTriangle,
  IconRobot, IconCloud, IconWifi, IconAi,
} from "@tabler/icons-react";

interface CredentialInfo { file: string; email: string; disabled: boolean; active: boolean; }
type ConnectStep = "idle" | "authorizing" | "done";

interface SettingsData {
  deepseek_api_key?: string;
  deepseek_base_url?: string;
  deepseek_model?: string;
  openrouter_api_key?: string;
  openrouter_base_url?: string;
  openrouter_model?: string;
}

function DeepSeekCredentials() {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
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
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    const form = new URLSearchParams();
    if (apiKey) form.set("api_key", apiKey);
    if (baseUrl) form.set("base_url", baseUrl);
    if (model) form.set("model", model);
    try {
      const r = await fetch("/admin/settings/deepseek", { method: "POST", body: form });
      const d = await r.json() as any;
      if (d.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
    } finally { setSaving(false); }
  };

  const test = async () => {
    setTesting(true); setTestResult(null);
    try {
      const r = await fetch("/api/admin/test/deepseek");
      setTestResult(await r.json());
    } catch (e: any) {
      setTestResult({ ok: false, latency: 0, error: e.message });
    } finally { setTesting(false); }
  };

  const configured = !!apiKey;

  return (
    <Paper withBorder p="lg" radius="md">
      <Group gap="sm" mb="lg">
        <ThemeIcon variant="light" color="violet" size="lg" radius="md">
          <IconRobot size={18} />
        </ThemeIcon>
        <div style={{ flex: 1 }}>
          <Text size="sm" fw={700}>DeepSeek</Text>
          <Text size="xs" c="dimmed">Anthropic-compatible API — fallback provider</Text>
        </div>
        {configured && <Badge color="violet" variant="light" size="sm">configured</Badge>}
      </Group>
      <Stack gap="sm">
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
            description="DeepSeek model name"
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
            <Button size="xs" onClick={save} loading={saving} radius="md">Save</Button>
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

function OpenRouterCredentials() {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; latency: number; detail?: string; error?: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then(r => r.json())
      .then((d: SettingsData) => {
        if (d.openrouter_api_key) setApiKey(d.openrouter_api_key);
        if (d.openrouter_base_url) setBaseUrl(d.openrouter_base_url);
        if (d.openrouter_model) setModel(d.openrouter_model);
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    const form = new URLSearchParams();
    if (apiKey) form.set("api_key", apiKey);
    if (baseUrl) form.set("base_url", baseUrl);
    if (model) form.set("model", model);
    try {
      const r = await fetch("/admin/settings/openrouter", { method: "POST", body: form });
      const d = await r.json() as any;
      if (d.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
    } finally { setSaving(false); }
  };

  const test = async () => {
    setTesting(true); setTestResult(null);
    try {
      const r = await fetch("/api/admin/test/openrouter");
      setTestResult(await r.json());
    } catch (e: any) {
      setTestResult({ ok: false, latency: 0, error: e.message });
    } finally { setTesting(false); }
  };

  const configured = !!apiKey;

  return (
    <Paper withBorder p="lg" radius="md">
      <Group gap="sm" mb="lg">
        <ThemeIcon variant="light" color="orange" size="lg" radius="md">
          <IconCloud size={18} />
        </ThemeIcon>
        <div style={{ flex: 1 }}>
          <Text size="sm" fw={700}>OpenRouter</Text>
          <Text size="xs" c="dimmed">Gateway — 200+ models via Anthropic-compatible API</Text>
        </div>
        {configured && <Badge color="orange" variant="light" size="sm">configured</Badge>}
      </Group>
      <Stack gap="sm">
        <PasswordInput
          label="API Key"
          description="OpenRouter API token"
          placeholder="sk-or-v1-..."
          value={apiKey}
          onChange={e => setApiKey(e.currentTarget.value)}
          size="sm"
        />
        <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="sm">
          <TextInput
            label="Base URL"
            description="OpenRouter endpoint"
            placeholder="https://openrouter.ai/api"
            value={baseUrl}
            onChange={e => setBaseUrl(e.currentTarget.value)}
            size="sm"
          />
          <TextInput
            label="Model ID"
            description="Default model for requests"
            placeholder="anthropic/claude-sonnet-4"
            value={model}
            onChange={e => setModel(e.currentTarget.value)}
            size="sm"
          />
        </SimpleGrid>
        <Group justify="space-between" align="center" mt={4}>
          <Text size="xs" c={configured ? "teal" : "red"}>
            {configured ? `Key: ...${apiKey.slice(-8)}` : "API key required to enable OpenRouter"}
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
            <Button size="xs" onClick={save} loading={saving} radius="md">Save</Button>
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

export function AdminAccounts() {
  const [creds, setCreds]       = useState<CredentialInfo[] | null>(null);
  const [loading, setLoading]   = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [err, setErr]           = useState<string | null>(null);

  const [step, setStep]               = useState<ConnectStep>("idle");
  const [authUrl, setAuthUrl]         = useState("");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [exchanging, setExchanging]   = useState(false);
  const [connectErr, setConnectErr]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch("/api/admin/credentials");
      const d = await r.json() as any;
      setCreds(d.credentials ?? []);
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const remove = async (file: string) => {
    setRemoving(file);
    try {
      const r = await fetch("/api/admin/credentials/remove", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file }),
      });
      const d = await r.json() as any;
      if (d.ok) load(); else setErr(d.error || "Failed");
    } catch (e: any) { setErr(e.message); }
    finally { setRemoving(null); }
  };

  const startConnect = async () => {
    setConnectErr(null); setCallbackUrl("");
    try {
      const r = await fetch("/admin/auth/start");
      const d = await r.json() as any;
      if (!d.authUrl) throw new Error("No authUrl returned");
      setAuthUrl(d.authUrl);
      setStep("authorizing");
    } catch (e: any) { setConnectErr(e.message); }
  };

  const completeExchange = async () => {
    if (!callbackUrl.trim()) return;
    setExchanging(true); setConnectErr(null);
    try {
      const r = await fetch("/admin/auth/exchange", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callbackUrl: callbackUrl.trim() }),
      });
      const d = await r.json() as any;
      if (d.ok) {
        setStep("done");
        load();
      } else {
        setConnectErr(d.error || "Exchange failed");
      }
    } catch (e: any) { setConnectErr(e.message); }
    finally { setExchanging(false); }
  };

  const resetConnect = () => {
    setStep("idle"); setAuthUrl(""); setCallbackUrl(""); setConnectErr(null);
  };

  const activeCount = creds?.filter(c => c.active).length ?? 0;

  return (
    <Stack gap="xl" maw={780}>
      {/* ── Page Header ───────────────────────────────────── */}
      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" wrap="wrap">
          <div>
            <Text size="sm" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }} mb={4}>Credentials</Text>
            <Text size="xl" fw={800} ff="monospace">API Keys & Accounts</Text>
            <Text size="sm" c="dimmed" mt={2}>
              Manage OAuth credentials and API keys for all upstream providers
            </Text>
          </div>
        </Group>
      </Paper>

      {/* ── Claude Max OAuth ──────────────────────────────── */}
      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" wrap="wrap" mb="md">
          <Group gap="sm">
            <ThemeIcon variant="light" color="blue" size="lg" radius="md">
              <IconAi size={18} />
            </ThemeIcon>
            <div>
              <Text size="sm" fw={700}>Claude Max</Text>
              <Text size="xs" c="dimmed">
                {creds && creds.length > 0
                  ? `${creds.length} credential${creds.length > 1 ? "s" : ""} · ${activeCount} active`
                  : "OAuth via claude-*.json credentials"}
              </Text>
            </div>
          </Group>
          {step === "idle" && (
            <Button leftSection={<IconPlugConnected size={16} />} onClick={startConnect} size="sm" radius="md">
              Connect Account
            </Button>
          )}
        </Group>

        {/* Authorizing flow */}
        {step === "authorizing" && (
          <Stack gap="lg" mt="sm">
            <Group gap="md" wrap="nowrap">
              <ThemeIcon variant="light" color="blue" size="xl" radius="md" style={{ flexShrink: 0 }}>
                <Text fw={700}>1</Text>
              </ThemeIcon>
              <div style={{ flex: 1 }}>
                <Text size="sm" fw={600}>Authorize on Claude.ai</Text>
                <Text size="xs" c="dimmed" mt={2}>
                  Click below to open the authorization page. Grant access to your Claude Max account.
                </Text>
                <Button
                  mt="sm" size="xs" variant="light"
                  leftSection={<IconExternalLink size={14} />}
                  onClick={() => window.open(authUrl, "_blank", "noopener")}
                >
                  Open Claude.ai
                </Button>
              </div>
            </Group>

            <Group gap="md" wrap="nowrap">
              <ThemeIcon variant="light" color="blue" size="xl" radius="md" style={{ flexShrink: 0 }}>
                <Text fw={700}>2</Text>
              </ThemeIcon>
              <div style={{ flex: 1 }}>
                <Text size="sm" fw={600}>Paste the callback URL</Text>
                <Text size="xs" c="dimmed" mt={2}>
                  After authorizing, your browser will try to load{" "}
                  <Code>localhost:54545/callback?code=…</Code> and show an error — that's expected.
                  Copy that URL from the address bar and paste it below.
                </Text>
                <TextInput
                  mt="sm"
                  placeholder="http://localhost:54545/callback?code=...&state=..."
                  value={callbackUrl}
                  onChange={e => setCallbackUrl(e.currentTarget.value)}
                  ff="monospace"
                  size="sm"
                />
                {connectErr && <Text size="xs" c="red" mt="xs">{connectErr}</Text>}
                <Group gap="xs" mt="sm">
                  <Button
                    size="sm" loading={exchanging}
                    disabled={!callbackUrl.trim()}
                    onClick={completeExchange} radius="md"
                  >
                    Complete
                  </Button>
                  <Button size="sm" variant="subtle" color="gray" onClick={resetConnect}>Cancel</Button>
                </Group>
              </div>
            </Group>
          </Stack>
        )}

        {/* Success */}
        {step === "done" && (
          <Paper withBorder p="md" radius="md" mt="sm" style={{ borderColor: "var(--mantine-color-teal-5)" }}>
            <Group justify="space-between">
              <Group gap="sm">
                <ThemeIcon variant="light" color="teal" size="md" radius="md">
                  <IconCircleCheck size={16} />
                </ThemeIcon>
                <Text size="sm" fw={500} c="teal">Account connected successfully.</Text>
              </Group>
              <Button size="xs" variant="subtle" onClick={resetConnect}>Connect another</Button>
            </Group>
          </Paper>
        )}

        {/* Error */}
        {err && (
          <Paper withBorder p="md" radius="md" mt="sm" style={{ borderColor: "var(--mantine-color-red-5)" }}>
            <Group gap="sm">
              <ThemeIcon variant="light" color="red" size="md" radius="md">
                <IconAlertTriangle size={16} />
              </ThemeIcon>
              <Text size="sm" c="red">{err}</Text>
            </Group>
          </Paper>
        )}

        {/* Loading */}
        {loading && <Center py="xl"><Loader size="sm" /></Center>}

        {/* Empty state */}
        {!loading && creds !== null && creds.length === 0 && step === "idle" && (
          <Center py="xl">
            <Stack align="center" gap="md">
              <ThemeIcon variant="light" color="gray" size="xl" radius="xl">
                <IconUserCircle size={28} />
              </ThemeIcon>
              <div style={{ textAlign: "center" }}>
                <Text c="dimmed" size="sm" fw={500}>No credentials found</Text>
                <Text c="dimmed" size="xs" mt={4}>
                  Click "Connect Account" to authenticate a Claude Max account via OAuth.
                </Text>
              </div>
            </Stack>
          </Center>
        )}

        {/* Credential list */}
        {!loading && creds && creds.length > 0 && (
          <Stack gap="xs" mt="sm">
            {creds.map(c => (
              <Paper key={c.file} withBorder p="sm" radius="md" style={{ opacity: c.active ? 1 : 0.5 }}>
                <Group justify="space-between" wrap="nowrap">
                  <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                    <ThemeIcon variant="light" color={c.active ? "teal" : "gray"} size="md" radius="md">
                      <IconKey size={16} />
                    </ThemeIcon>
                    <div style={{ minWidth: 0 }}>
                      <Text fw={500} size="sm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.email}
                      </Text>
                      <Text size="xs" c="dimmed" ff="monospace">{c.file}</Text>
                    </div>
                  </Group>
                  <Group gap="xs" wrap="nowrap">
                    <Badge size="sm" color={c.active ? "teal" : "gray"} variant="light">
                      {c.active ? "active" : "disabled"}
                    </Badge>
                    {c.active && (
                      <Tooltip label="Disable credential" withArrow>
                        <ActionIcon
                          size="sm" variant="subtle" color="red"
                          loading={removing === c.file}
                          onClick={() => remove(c.file)}
                        >
                          <IconPlayerStop size={14} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </Group>
                </Group>
              </Paper>
            ))}
          </Stack>
        )}
      </Paper>

      {/* ── API Key Providers ─────────────────────────────── */}
      <Divider label="API Key Providers" labelPosition="left" />

      <DeepSeekCredentials />

      <OpenRouterCredentials />
    </Stack>
  );
}
