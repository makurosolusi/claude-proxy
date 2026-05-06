import { useState } from "react";
import {
  Stack, Text, Paper, Group, Badge, Button, Loader, ThemeIcon, SimpleGrid,
} from "@mantine/core";
import {
  IconCircleCheck, IconCircleX, IconClock, IconWifi, IconKey, IconActivity,
  IconMessages, IconRobot, IconAi, IconCloud,
} from "@tabler/icons-react";

interface TestResult { ok: boolean; latency: number; detail: string; error?: string; }
interface ClaudeResults {
  ok: boolean; ts: string;
  results: { credential: TestResult; usage: TestResult; messages: TestResult; };
}
interface DeepSeekResult {
  ok: boolean; latency: number; detail?: string; error?: string;
}

function ResultRow({ label, desc, icon, result }: {
  label: string; desc: string; icon: React.ReactNode; result: TestResult | null;
}) {
  if (!result) return null;
  return (
    <Paper withBorder p="sm" radius="md" style={{
      borderColor: result.ok ? undefined : "var(--mantine-color-red-3)",
    }}>
      <Group justify="space-between" wrap="wrap" mb={result.error ? 4 : 0}>
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon variant="light" color={result.ok ? "teal" : "red"} size="md" radius="md">
            {result.ok ? <IconCircleCheck size={16} /> : <IconCircleX size={16} />}
          </ThemeIcon>
          <div>
            <Text size="sm" fw={600}>{label}</Text>
            <Text size="xs" c="dimmed">{desc}</Text>
          </div>
        </Group>
        <Group gap="sm">
          {result.latency > 0 && (
            <Group gap={4}>
              <IconClock size={12} color="var(--mantine-color-dimmed)" />
              <Text size="xs" c="dimmed" ff="monospace">{result.latency}ms</Text>
            </Group>
          )}
          <Badge color={result.ok ? "teal" : "red"} variant="filled" size="sm">
            {result.ok ? "OK" : "FAIL"}
          </Badge>
        </Group>
      </Group>
      <Text size="xs" ff="monospace" c={result.ok ? "dimmed" : "red"} mt={4}>
        {result.error ?? result.detail}
      </Text>
    </Paper>
  );
}

export function AdminTest() {
  const [claude, setClaude]       = useState<ClaudeResults | null>(null);
  const [deepseek, setDeepseek]   = useState<DeepSeekResult | null>(null);
  const [openrouter, setOpenrouter] = useState<DeepSeekResult | null>(null);
  const [loading, setLoading]     = useState<"claude" | "deepseek" | "openrouter" | "all" | null>(null);
  const [err, setErr]             = useState<string | null>(null);

  const runClaude = async () => {
    setLoading("claude"); setErr(null); setClaude(null);
    try {
      const r = await fetch("/api/admin/test");
      if (!r.ok) { setErr(`Claude test HTTP ${r.status}`); return; }
      setClaude(await r.json());
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(null); }
  };

  const runDeepSeek = async () => {
    setLoading("deepseek"); setErr(null); setDeepseek(null);
    try {
      const r = await fetch("/api/admin/test/deepseek");
      setDeepseek(await r.json());
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(null); }
  };

  const runOpenRouter = async () => {
    setLoading("openrouter"); setErr(null); setOpenrouter(null);
    try {
      const r = await fetch("/api/admin/test/openrouter");
      setOpenrouter(await r.json());
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(null); }
  };

  const runAll = async () => {
    setLoading("all"); setErr(null); setClaude(null); setDeepseek(null); setOpenrouter(null);
    try {
      const [r1, r2, r3] = await Promise.all([
        fetch("/api/admin/test"),
        fetch("/api/admin/test/deepseek"),
        fetch("/api/admin/test/openrouter"),
      ]);
      if (r1.ok) setClaude(await r1.json());
      else setErr("Claude test HTTP " + r1.status);
      try { setDeepseek(await r2.json()); } catch {}
      try { setOpenrouter(await r3.json()); } catch {}
    } catch (e: any) { setErr(e.message); }
    finally { setLoading(null); }
  };

  const claudeAllOk = claude ? Object.values(claude.results).every(r => r.ok) : null;
  const deepseekOk  = deepseek?.ok ?? null;
  const openrouterOk = openrouter?.ok ?? null;
  const loadingAny  = loading !== null;

  return (
    <Stack gap="xl" maw={780}>
      {/* Page Header */}
      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" wrap="wrap">
          <div>
            <Text size="sm" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }} mb={4}>Test Connection</Text>
            <Text size="xl" fw={800} ff="monospace">API Diagnostics</Text>
            <Text size="sm" c="dimmed" mt={2}>Verify connectivity for each upstream provider</Text>
          </div>
          <Group gap="xs">
            <Button
              size="sm" radius="md" variant="light"
              leftSection={loading === "all" ? <Loader size={14} /> : <IconWifi size={16} />}
              loading={loading === "all"}
              onClick={runAll}
            >
              Test All
            </Button>
          </Group>
        </Group>
      </Paper>

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

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        {/* Claude Max */}
        <Paper withBorder p="lg" radius="md">
          <Group gap="sm" mb="lg">
            <ThemeIcon variant="light" color="blue" size="lg" radius="md">
              <IconAi size={18} />
            </ThemeIcon>
            <div style={{ flex: 1 }}>
              <Text size="sm" fw={700}>Claude Max</Text>
              <Text size="xs" c="dimmed">OAuth credential → usage API → messages API</Text>
            </div>
            <Button
              size="xs" variant="light" color="blue" radius="md"
              loading={loading === "claude" || loading === "all"}
              onClick={runClaude}
            >
              {claude ? "Retest" : "Test"}
            </Button>
          </Group>

          {/* Overall */}
          {claudeAllOk !== null && (
            <Paper withBorder p="xs" radius="md" mb="md" style={{
              borderColor: `var(--mantine-color-${claudeAllOk ? "teal" : "red"}-4)`,
              background: `var(--mantine-color-${claudeAllOk ? "teal" : "red"}-light)`,
            }}>
              <Group gap="sm">
                <ThemeIcon variant="light" color={claudeAllOk ? "teal" : "red"} size="sm" radius="sm">
                  {claudeAllOk ? <IconCircleCheck size={14} /> : <IconCircleX size={14} />}
                </ThemeIcon>
                <Text size="xs" fw={600} c={claudeAllOk ? "teal" : "red"}>
                  {claudeAllOk ? "All Claude checks passed" : "One or more checks failed"}
                </Text>
              </Group>
            </Paper>
          )}

          <Stack gap="sm">
            <ResultRow
              label="OAuth Credential"
              desc="Read access token from claude-*.json"
              icon={<IconKey size={16} />}
              result={claude?.results?.credential ?? null}
            />
            <ResultRow
              label="Usage Endpoint"
              desc="GET api.anthropic.com/api/oauth/usage"
              icon={<IconActivity size={16} />}
              result={claude?.results?.usage ?? null}
            />
            <ResultRow
              label="Messages API"
              desc="POST /v1/messages · minimal test prompt"
              icon={<IconMessages size={16} />}
              result={claude?.results?.messages ?? null}
            />
          </Stack>

          {!claude && !loadingAny && (
            <Text size="xs" c="dimmed" ta="center" mt="md">Click Test to verify Claude Max pipeline</Text>
          )}
        </Paper>

        {/* DeepSeek */}
        <Paper withBorder p="lg" radius="md">
          <Group gap="sm" mb="lg">
            <ThemeIcon variant="light" color="violet" size="lg" radius="md">
              <IconRobot size={18} />
            </ThemeIcon>
            <div style={{ flex: 1 }}>
              <Text size="sm" fw={700}>DeepSeek</Text>
              <Text size="xs" c="dimmed">Anthropic-compatible API · direct messages test</Text>
            </div>
            <Button
              size="xs" variant="light" color="violet" radius="md"
              loading={loading === "deepseek" || loading === "all"}
              onClick={runDeepSeek}
            >
              {deepseek ? "Retest" : "Test"}
            </Button>
          </Group>

          {/* Overall */}
          {deepseekOk !== null && (
            <Paper withBorder p="xs" radius="md" mb="md" style={{
              borderColor: `var(--mantine-color-${deepseekOk ? "teal" : "red"}-4)`,
              background: `var(--mantine-color-${deepseekOk ? "teal" : "red"}-light)`,
            }}>
              <Group gap="sm">
                <ThemeIcon variant="light" color={deepseekOk ? "teal" : "red"} size="sm" radius="sm">
                  {deepseekOk ? <IconCircleCheck size={14} /> : <IconCircleX size={14} />}
                </ThemeIcon>
                <Text size="xs" fw={600} c={deepseekOk ? "teal" : "red"}>
                  {deepseekOk ? "DeepSeek connection OK" : (deepseek?.error || "Connection failed")}
                </Text>
              </Group>
              {deepseek && deepseek.latency > 0 && (
                <Group gap={4} mt={4}>
                  <IconClock size={12} color="var(--mantine-color-dimmed)" />
                  <Text size="xs" c="dimmed" ff="monospace">{deepseek.latency}ms · {deepseek.detail || ""}</Text>
                </Group>
              )}
            </Paper>
          )}

          {deepseek && (
            <Stack gap="sm">
              <ResultRow
                label="Messages API"
                desc="POST /v1/messages to DeepSeek endpoint"
                icon={<IconMessages size={16} />}
                result={{
                  ok: deepseek.ok,
                  latency: deepseek.latency,
                  detail: deepseek.detail || deepseek.error || "",
                  error: deepseek.error,
                }}
              />
            </Stack>
          )}

          {!deepseek && !loadingAny && (
            <Text size="xs" c="dimmed" ta="center" mt="md">Click Test to verify DeepSeek connection</Text>
          )}
        </Paper>

        {/* OpenRouter */}
        <Paper withBorder p="lg" radius="md">
          <Group gap="sm" mb="lg">
            <ThemeIcon variant="light" color="orange" size="lg" radius="md">
              <IconCloud size={18} />
            </ThemeIcon>
            <div style={{ flex: 1 }}>
              <Text size="sm" fw={700}>OpenRouter</Text>
              <Text size="xs" c="dimmed">API gateway · Anthropic-compatible endpoint</Text>
            </div>
            <Button
              size="xs" variant="light" color="orange" radius="md"
              loading={loading === "openrouter" || loading === "all"}
              onClick={runOpenRouter}
            >
              {openrouter ? "Retest" : "Test"}
            </Button>
          </Group>

          {openrouterOk !== null && (
            <Paper withBorder p="xs" radius="md" mb="md" style={{
              borderColor: `var(--mantine-color-${openrouterOk ? "teal" : "red"}-4)`,
              background: `var(--mantine-color-${openrouterOk ? "teal" : "red"}-light)`,
            }}>
              <Group gap="sm">
                <ThemeIcon variant="light" color={openrouterOk ? "teal" : "red"} size="sm" radius="sm">
                  {openrouterOk ? <IconCircleCheck size={14} /> : <IconCircleX size={14} />}
                </ThemeIcon>
                <Text size="xs" fw={600} c={openrouterOk ? "teal" : "red"}>
                  {openrouterOk ? "OpenRouter connection OK" : (openrouter?.error || "Connection failed")}
                </Text>
              </Group>
              {openrouter && openrouter.latency > 0 && (
                <Group gap={4} mt={4}>
                  <IconClock size={12} color="var(--mantine-color-dimmed)" />
                  <Text size="xs" c="dimmed" ff="monospace">{openrouter.latency}ms · {openrouter.detail || ""}</Text>
                </Group>
              )}
            </Paper>
          )}

          {openrouter && (
            <Stack gap="sm">
              <ResultRow
                label="Messages API"
                desc="POST /v1/messages to OpenRouter endpoint"
                icon={<IconMessages size={16} />}
                result={{
                  ok: openrouter.ok,
                  latency: openrouter.latency,
                  detail: openrouter.detail || openrouter.error || "",
                  error: openrouter.error,
                }}
              />
            </Stack>
          )}

          {!openrouter && !loadingAny && (
            <Text size="xs" c="dimmed" ta="center" mt="md">Click Test to verify OpenRouter connection</Text>
          )}
        </Paper>
      </SimpleGrid>
    </Stack>
  );
}
