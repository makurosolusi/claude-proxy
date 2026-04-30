import { useState } from "react";
import { Stack, Text, Paper, Group, Badge, Button, Loader, ThemeIcon } from "@mantine/core";
import {
  IconCircleCheck, IconCircleX, IconClock, IconWifi, IconKey, IconActivity, IconMessages,
} from "@tabler/icons-react";

interface TestResult { ok: boolean; latency: number; detail: string; error?: string; }
interface TestResponse {
  ok: boolean; mode: string; ts: string;
  results: { credential: TestResult; usage: TestResult; messages: TestResult; };
}

export function AdminTest() {
  const [result,  setResult]  = useState<TestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState<string | null>(null);

  const run = async () => {
    setLoading(true); setErr(null); setResult(null);
    try {
      const r = await fetch("/api/admin/test");
      if (!r.ok) { setErr(`HTTP ${r.status}`); return; }
      setResult(await r.json());
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const steps: { key: keyof TestResponse["results"]; label: string; desc: string; icon: React.ReactNode }[] = [
    { key: "credential", label: "OAuth Credential",  desc: "Read claude-*.json from CLIPROXY_AUTH_DIR",         icon: <IconKey size={18} /> },
    { key: "usage",      label: "Usage Endpoint",     desc: "GET api.anthropic.com/api/oauth/usage",            icon: <IconActivity size={18} /> },
    { key: "messages",   label: "Messages API",       desc: "POST /v1/messages — minimal test request",         icon: <IconMessages size={18} /> },
  ];

  return (
    <Stack gap="xl" maw={680}>
      {/* ── Page Header ───────────────────────────────────── */}
      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" wrap="wrap">
          <div>
            <Text size="sm" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }} mb={4}>Test Connection</Text>
            <Text size="xl" fw={800} ff="monospace">API Diagnostics</Text>
            <Text size="sm" c="dimmed" mt={2}>Verify the full pipeline: credential → usage API → messages API</Text>
          </div>
          <Button
            leftSection={loading ? <Loader size={14} color="white" /> : <IconWifi size={16} />}
            loading={loading}
            onClick={run}
            color="blue"
            size="sm"
            radius="md"
          >
            {loading ? "Running…" : result ? "Run Again" : "Run Test"}
          </Button>
        </Group>
      </Paper>

      {/* ── Idle state ────────────────────────────────────── */}
      {!result && !err && !loading && (
        <Stack gap="sm">
          {steps.map(({ key, label, desc, icon }) => (
            <Paper key={key} withBorder p="md" radius="md" style={{ opacity: 0.45 }}>
              <Group gap="sm" wrap="nowrap">
                <ThemeIcon variant="light" color="gray" size="lg" radius="md">
                  {icon}
                </ThemeIcon>
                <div>
                  <Text size="sm" fw={600}>{label}</Text>
                  <Text size="xs" c="dimmed">{desc}</Text>
                </div>
                <Badge color="gray" variant="light" size="sm" ml="auto">pending</Badge>
              </Group>
            </Paper>
          ))}
        </Stack>
      )}

      {/* ── Overall result banner ─────────────────────────── */}
      {result && (
        <Paper withBorder p="sm" radius="md" style={{
          borderColor: `var(--mantine-color-${result.ok ? "teal" : "red"}-5)`,
        }}>
          <Group gap="sm">
            <ThemeIcon variant="light" color={result.ok ? "teal" : "red"} size="md" radius="md">
              {result.ok ? <IconCircleCheck size={16} /> : <IconCircleX size={16} />}
            </ThemeIcon>
            <Text size="sm" fw={600} c={result.ok ? "teal" : "red"}>
              {result.ok ? "All checks passed" : "One or more checks failed"}
            </Text>
            <Group gap="xs" ml="auto">
              <Badge variant="outline" size="xs" color="gray">mode: {result.mode}</Badge>
              <Text size="xs" c="dimmed" ff="monospace">{new Date(result.ts).toLocaleTimeString()}</Text>
            </Group>
          </Group>
        </Paper>
      )}

      {/* ── Step results ──────────────────────────────────── */}
      {result && (
        <Stack gap="sm">
          {steps.map(({ key, label, desc, icon }) => {
            const r = result.results[key];
            const ok = r.ok;
            return (
              <Paper key={key} withBorder p="md" radius="md" style={{
                borderColor: ok ? undefined : "var(--mantine-color-red-3)",
              }}>
                <Group justify="space-between" wrap="wrap" mb={r.error ? 6 : 0}>
                  <Group gap="sm" wrap="nowrap">
                    <ThemeIcon variant="light" color={ok ? "teal" : "red"} size="lg" radius="md">
                      {ok ? <IconCircleCheck size={18} /> : <IconCircleX size={18} />}
                    </ThemeIcon>
                    <div>
                      <Text size="sm" fw={600}>{label}</Text>
                      <Text size="xs" c="dimmed">{desc}</Text>
                    </div>
                  </Group>
                  <Group gap="sm">
                    {r.latency > 0 && (
                      <Group gap={4}>
                        <IconClock size={12} color="var(--mantine-color-dimmed)" />
                        <Text size="xs" c="dimmed" ff="monospace">{r.latency} ms</Text>
                      </Group>
                    )}
                    <Badge color={ok ? "teal" : "red"} variant="filled" size="sm">
                      {ok ? "OK" : "FAIL"}
                    </Badge>
                  </Group>
                </Group>
                <Text size="xs" ff="monospace" c={ok ? "dimmed" : "red"} mt={4}>
                  {r.error ?? r.detail}
                </Text>
              </Paper>
            );
          })}
        </Stack>
      )}

      {/* ── Error ─────────────────────────────────────────── */}
      {err && (
        <Paper withBorder p="md" radius="md" style={{ borderColor: "var(--mantine-color-red-5)" }}>
          <Group gap="sm">
            <ThemeIcon variant="light" color="red" size="md" radius="md">
              <IconCircleX size={16} />
            </ThemeIcon>
            <Text size="sm" c="red">{err}</Text>
          </Group>
        </Paper>
      )}
    </Stack>
  );
}
