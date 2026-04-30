import { useState, useEffect, useCallback } from "react";
import {
  Stack, Text, Paper, Group, Button, TextInput, Badge,
  ActionIcon, Tooltip, Center, Loader, Code, ThemeIcon,
} from "@mantine/core";
import {
  IconExternalLink, IconCircleCheck, IconKey, IconPlayerStop,
  IconUserCircle, IconPlugConnected, IconAlertTriangle,
} from "@tabler/icons-react";

interface CredentialInfo { file: string; email: string; disabled: boolean; active: boolean; }
type ConnectStep = "idle" | "authorizing" | "done";

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
    <Stack gap="xl" maw={680}>
      {/* ── Page Header ───────────────────────────────────── */}
      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" wrap="wrap">
          <div>
            <Text size="sm" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }} mb={4}>Accounts</Text>
            <Text size="xl" fw={800} ff="monospace">OAuth Credentials</Text>
            <Text size="sm" c="dimmed" mt={2}>
              {creds && creds.length > 0
                ? `${creds.length} credential${creds.length > 1 ? "s" : ""} · ${activeCount} active`
                : "Claude Max accounts used to forward API requests"}
            </Text>
          </div>
          {step === "idle" && (
            <Button leftSection={<IconPlugConnected size={16} />} onClick={startConnect} size="sm" radius="md">
              Connect Account
            </Button>
          )}
        </Group>
      </Paper>

      {/* ── Authorizing flow ───────────────────────────────── */}
      {step === "authorizing" && (
        <Paper withBorder p="lg" radius="md">
          <Stack gap="lg">
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
                  mt="sm"
                  size="xs"
                  variant="light"
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
                    size="sm"
                    loading={exchanging}
                    disabled={!callbackUrl.trim()}
                    onClick={completeExchange}
                    radius="md"
                  >
                    Complete
                  </Button>
                  <Button size="sm" variant="subtle" color="gray" onClick={resetConnect}>Cancel</Button>
                </Group>
              </div>
            </Group>
          </Stack>
        </Paper>
      )}

      {/* ── Success ────────────────────────────────────────── */}
      {step === "done" && (
        <Paper withBorder p="md" radius="md" style={{ borderColor: "var(--mantine-color-teal-5)" }}>
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

      {/* ── Error ──────────────────────────────────────────── */}
      {err && (
        <Paper withBorder p="md" radius="md" style={{ borderColor: "var(--mantine-color-red-5)" }}>
          <Group gap="sm">
            <ThemeIcon variant="light" color="red" size="md" radius="md">
              <IconAlertTriangle size={16} />
            </ThemeIcon>
            <Text size="sm" c="red">{err}</Text>
          </Group>
        </Paper>
      )}

      {/* ── Loading ────────────────────────────────────────── */}
      {loading && <Center py="xl"><Loader size="sm" /></Center>}

      {/* ── Empty state ────────────────────────────────────── */}
      {!loading && creds !== null && creds.length === 0 && step === "idle" && (
        <Paper withBorder p="xl" radius="md">
          <Center>
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
        </Paper>
      )}

      {/* ── Credential list ────────────────────────────────── */}
      {!loading && creds && creds.length > 0 && (
        <Stack gap="xs">
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
    </Stack>
  );
}
