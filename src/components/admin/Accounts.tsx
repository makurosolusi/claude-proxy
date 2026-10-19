import { useState, useEffect, useCallback } from "react";
import {
  Stack, Text, Paper, Group, Button, TextInput, Badge,
  ActionIcon, Tooltip, Center, Loader, Code, ThemeIcon,
  Divider, Modal, Textarea, Alert,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconExternalLink, IconCircleCheck, IconKey, IconPlayerStop,
  IconUserCircle, IconPlugConnected, IconAlertTriangle,
  IconAi, IconFileImport, IconPlayerPlay, IconPin, IconPinnedOff,
} from "@tabler/icons-react";
import { ApiKeyProvider } from "./ApiKeyProvider";
import { CustomProvidersSection } from "./CustomProviders";

interface CredentialInfo {
  file: string; email: string; disabled: boolean; active: boolean;
  pinned: boolean; serving: boolean;
}
type ConnectStep = "idle" | "authorizing" | "done";


export function AdminAccounts() {
  const [creds, setCreds]           = useState<CredentialInfo[] | null>(null);
  const [loading, setLoading]       = useState(false);
  const [toggling, setToggling]     = useState<string | null>(null);
  const [activating, setActivating] = useState<string | null>(null);
  const [pinnedEmail, setPinnedEmail] = useState("");
  const [err, setErr]               = useState<string | null>(null);

  const [step, setStep]               = useState<ConnectStep>("idle");
  const [authUrl, setAuthUrl]         = useState("");
  const [callbackUrl, setCallbackUrl] = useState("");
  const [exchanging, setExchanging]   = useState(false);
  const [connectErr, setConnectErr]   = useState<string | null>(null);

  const [importOpen, setImportOpen]       = useState(false);
  const [importContent, setImportContent] = useState("");
  const [importing, setImporting]         = useState(false);
  const [importErr, setImportErr]         = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch("/api/admin/credentials", { credentials: "include" });
      const d = await r.json() as any;
      setCreds(d.credentials ?? []);
      setPinnedEmail(d.pinned_email ?? "");
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setDisabled = async (file: string, disabled: boolean) => {
    setToggling(file);
    try {
      const r = await fetch(`/api/admin/credentials/${disabled ? "remove" : "enable"}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ file }),
      });
      const d = await r.json() as any;
      if (d.ok) load(); else setErr(d.error || "Failed");
    } catch (e: any) { setErr(e.message); }
    finally { setToggling(null); }
  };

  // email "" = auto (first usable account)
  const activate = async (email: string) => {
    setActivating(email || "auto");
    try {
      const r = await fetch("/api/admin/credentials/activate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });
      const d = await r.json() as any;
      if (d.ok) load(); else setErr(d.error || "Failed");
    } catch (e: any) { setErr(e.message); }
    finally { setActivating(null); }
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

  const doImport = async () => {
    setImporting(true); setImportErr(null);
    try {
      const r = await fetch("/admin/auth/import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: importContent.trim() }),
      });
      const d = await r.json() as any;
      if (!d.ok) {
        setImportErr(d.error || "Import failed");
        return;
      }
      notifications.show({ color: "teal", message: `Credential imported: ${d.email}`, autoClose: 2500 });
      setImportOpen(false);
      setImportContent("");
      load();
    } catch (e: any) { setImportErr(e.message); }
    finally { setImporting(false); }
  };

  const activeCount  = creds?.filter(c => c.active).length ?? 0;
  const servingEmail = creds?.find(c => c.serving)?.email ?? "";
  const pinFellBack  = !!pinnedEmail && !!servingEmail && servingEmail !== pinnedEmail;

  return (
    <Stack gap="xl" maw={780} px={{ base: "xs", sm: 0 }}>
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
                  ? `${creds.length} credential${creds.length > 1 ? "s" : ""} · ${activeCount} active · ${pinnedEmail ? `pinned to ${pinnedEmail}` : "auto"}`
                  : "OAuth via claude-*.json credentials"}
              </Text>
            </div>
          </Group>
          {step === "idle" && (
            <Group gap="xs">
              <Button variant="default" leftSection={<IconFileImport size={16} />} onClick={() => setImportOpen(true)} size="sm" radius="md">
                Import JSON
              </Button>
              <Button leftSection={<IconPlugConnected size={16} />} onClick={startConnect} size="sm" radius="md">
                Connect Account
              </Button>
            </Group>
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
                  <Code style={{ wordBreak: "break-all" }}>localhost:54545/callback?code=…</Code> and show an error — that's expected.
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

        {/* Pinned account unavailable — proxy fell back */}
        {!loading && pinFellBack && (
          <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={14} />} p="sm" mt="sm">
            <Text size="xs">
              Pinned account <b>{pinnedEmail}</b> is unavailable — serving <b>{servingEmail}</b> instead.
            </Text>
          </Alert>
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
                    {c.serving && <Badge size="sm" color="green" variant="filled">serving</Badge>}
                    {c.pinned  && <Badge size="sm" color="blue"  variant="light">pinned</Badge>}
                    <Badge size="sm" color={c.active ? "teal" : "gray"} variant="light">
                      {c.active ? "active" : "disabled"}
                    </Badge>
                    {c.active && (
                      <Tooltip label={c.pinned ? "Back to auto" : "Use this account"} withArrow>
                        <ActionIcon
                          size="sm" variant="subtle" color={c.pinned ? "gray" : "blue"}
                          loading={activating === (c.pinned ? "auto" : c.email)}
                          onClick={() => activate(c.pinned ? "" : c.email)}
                        >
                          {c.pinned ? <IconPinnedOff size={14} /> : <IconPin size={14} />}
                        </ActionIcon>
                      </Tooltip>
                    )}
                    <Tooltip label={c.active ? "Disable credential" : "Enable credential"} withArrow>
                      <ActionIcon
                        size="sm" variant="subtle" color={c.active ? "red" : "teal"}
                        loading={toggling === c.file}
                        onClick={() => setDisabled(c.file, c.active)}
                      >
                        {c.active ? <IconPlayerStop size={14} /> : <IconPlayerPlay size={14} />}
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Group>
              </Paper>
            ))}
          </Stack>
        )}
      </Paper>

      {/* ── API Key Providers (built-in) ───────────────────── */}
      <Divider label="Built-in API Key Providers" labelPosition="left" />

      <ApiKeyProvider provider="deepseek" />

      <ApiKeyProvider provider="openrouter" />

      {/* ── Custom Providers ────────────────────────────────── */}
      <Divider label="Custom Providers" labelPosition="left" />

      <CustomProvidersSection />

      {/* Import Credential Modal */}
      <Modal opened={importOpen} onClose={() => { setImportOpen(false); setImportContent(""); setImportErr(null); }}
        title="Import Claude Credential" size="lg">
        <Stack gap="md">
          <Text size="xs" c="dimmed" style={{ lineHeight: 1.55 }}>
            Paste the full content of a <Code>claude-*.json</Code> file (or the credential JSON from Claude Code CLI / another machine).
            The file will be saved to <Code>{"CLIPROXY_AUTH_DIR"}</Code> and immediately used by the proxy.
          </Text>
          <Textarea
            label="JSON content"
            description="Required fields: access_token, refresh_token. Email is auto-resolved if missing."
            placeholder={'{\n  "access_token": "sk-ant-oat01-…",\n  "refresh_token": "sk-ant-ort01-…",\n  "email": "user@example.com"\n}'}
            value={importContent}
            onChange={e => setImportContent(e.currentTarget.value)}
            minRows={8} maxRows={16} autosize
            styles={{ input: { fontFamily: "monospace", fontSize: 12 } }}
          />
          {importErr && (
            <Alert color="red" variant="light" icon={<IconAlertTriangle size={14} />} p="sm">
              <Text size="xs">{importErr}</Text>
            </Alert>
          )}
          <Group justify="flex-end" gap="xs">
            <Button variant="subtle" color="gray" onClick={() => { setImportOpen(false); setImportContent(""); setImportErr(null); }}>
              Cancel
            </Button>
            <Button color="blue" loading={importing}
              disabled={!importContent.trim()}
              onClick={doImport}
              leftSection={<IconFileImport size={14} />}>
              Import
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
