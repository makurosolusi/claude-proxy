import { useState, useEffect } from "react";
import { useMantineColorScheme } from "@mantine/core";
import { Box, Group, Stack, Text, Alert, Button, Divider, Anchor, Code } from "@mantine/core";
import { Transition } from "@mantine/core";
import { IconCheck, IconAlertTriangle, IconBrandGoogle, IconShieldCheck } from "@tabler/icons-react";
import { LoadingScreen } from "../components/shared";
import { resolveLoginRedirect, signInWithGoogle } from "../utils";

export function LoginRedirect() {
  useEffect(() => {
    resolveLoginRedirect().then(url => { window.location.replace(url); });
  }, []);
  return <LoadingScreen />;
}

export function LoginPage() {
  const isDark = useMantineColorScheme().colorScheme === "dark";
  const [signing, setSigning]       = useState(false);
  const [errorParam, setErrorParam] = useState<string | null>(null);
  const [version, setVersion]       = useState<string>("");
  const [upstreamOk, setUpstreamOk] = useState<boolean>(true);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    fetch("/api/profile", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then((d: any) => {
        if (d?.authenticated) {
          resolveLoginRedirect().then(url => window.location.replace(url));
          return;
        }
        setAuthChecked(true);
      })
      .catch(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const e = p.get("error");
    if (e) setErrorParam(e);
    fetch("/api/status", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then((d: any) => {
        if (d?.version) setVersion(d.version);
        if (d?.upstream) setUpstreamOk(!!d.upstream.ok);
      })
      .catch(() => {});
  }, []);

  if (!authChecked) return <LoadingScreen />;

  const handleSignIn = async () => {
    setSigning(true);
    try { await signInWithGoogle(); }
    finally { setTimeout(() => setSigning(false), 5000); }
  };

  const features = [
    { label: "Share Claude Max across your team via OAuth" },
    { label: "Per-user quota, rate limits, and audit logs" },
    { label: "Automatic fallback to DeepSeek or OpenRouter" },
    { label: "Real-time monitoring with quota alerts" },
  ];

  const rightBg   = isDark ? "#0e1014" : "#ffffff";
  const leftBg    = isDark ? "#0a0b10" : "#fafbfc";
  const borderCol = isDark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.08)";
  const accent    = "#3b82f6";

  return (
    <Box style={{
      minHeight: "100vh",
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr)",
      background: rightBg,
    }} className="cp-login-grid">
      <style>{`
        @media (min-width: 992px) {
          .cp-login-grid { grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr) !important; }
          .cp-login-left { display: flex !important; }
        }
        .cp-login-left { display: none; }
      `}</style>

      {/* ── LEFT: welcome + brand + features ── */}
      <Box className="cp-login-left" style={{
        flexDirection: "column", padding: "48px 56px",
        background: leftBg, borderRight: `1px solid ${borderCol}`,
        position: "relative", overflow: "hidden",
      }}>
        <Box style={{
          position: "absolute", inset: 0,
          background: isDark
            ? "radial-gradient(ellipse 80% 60% at 0% 100%, rgba(59,130,246,0.10) 0%, transparent 60%)"
            : "radial-gradient(ellipse 80% 60% at 0% 100%, rgba(59,130,246,0.08) 0%, transparent 60%)",
          pointerEvents: "none",
        }} />

        <Group gap={10} align="center" style={{ position: "relative", zIndex: 1 }}>
          <Box style={{ width: 32, height: 32, background: accent, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Text span fz={12} fw={700} c="white" ff="monospace" style={{ letterSpacing: "-0.02em" }}>CP</Text>
          </Box>
          <Text fw={600} size="md" ff="monospace">claude-proxy</Text>
        </Group>

        <Box style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", marginTop: 32, marginBottom: 32, position: "relative", zIndex: 1 }}>
          <Stack gap="md" maw={460}>
            <Stack gap={8}>
              <Text fz={11} fw={600} tt="uppercase" c={accent} style={{ letterSpacing: "0.12em" }}>Welcome back</Text>
              <Text fw={700} style={{ fontSize: 36, lineHeight: 1.1, letterSpacing: "-0.03em" }}>
                The smart gateway for sharing Claude with your team.
              </Text>
              <Text size="md" c="dimmed" style={{ lineHeight: 1.55 }} mt={8}>
                One Claude Max account, many users. Manage quotas, monitor usage in real-time, and never lose service to rate limits.
              </Text>
            </Stack>
            <Divider my="md" opacity={0.5} />
            <Stack gap={12}>
              {features.map(({ label }) => (
                <Group key={label} gap={12} wrap="nowrap" align="flex-start">
                  <Box style={{
                    marginTop: 4, width: 18, height: 18, borderRadius: 5,
                    background: isDark ? "rgba(59,130,246,0.15)" : "rgba(59,130,246,0.1)",
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  }}>
                    <IconCheck size={11} color={accent} stroke={3} />
                  </Box>
                  <Text size="sm" c={isDark ? "gray.3" : "dark.6"} style={{ lineHeight: 1.55 }}>{label}</Text>
                </Group>
              ))}
            </Stack>
          </Stack>
        </Box>

        <Group justify="space-between" align="center" wrap="wrap" gap="xs" style={{ position: "relative", zIndex: 1 }}>
          <Group gap={6}>
            <Box w={6} h={6} style={{
              borderRadius: "50%",
              background: upstreamOk ? "var(--mantine-color-teal-5)" : "var(--mantine-color-yellow-5)",
              boxShadow: upstreamOk ? "0 0 8px var(--mantine-color-teal-5)" : "0 0 8px var(--mantine-color-yellow-5)",
            }} />
            <Text size="xs" c="dimmed">{upstreamOk ? "All systems operational" : "Limited service"}</Text>
          </Group>
          {version && <Text size="xs" c="dimmed" ff="monospace">v{version}</Text>}
        </Group>
      </Box>

      {/* ── RIGHT: login form ── */}
      <Box style={{ display: "flex", flexDirection: "column", background: rightBg, minHeight: "100vh" }}>
        <Box className="cp-login-mobile-brand" style={{ padding: "20px 24px" }}>
          <style>{`@media (min-width: 992px) { .cp-login-mobile-brand { display: none !important; } }`}</style>
          <Group gap={10} align="center">
            <Box style={{ width: 28, height: 28, background: accent, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Text span fz={11} fw={700} c="white" ff="monospace" style={{ letterSpacing: "-0.02em" }}>CP</Text>
            </Box>
            <Text fw={600} size="sm" ff="monospace">claude-proxy</Text>
          </Group>
        </Box>

        <Box style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 24px" }}>
          <Transition mounted transition="fade" duration={300}>
            {(styles) => (
              <Stack gap={28} style={{ ...styles, width: "100%", maxWidth: 380 }}>
                <Stack gap={6}>
                  <Text fw={700} fz={26} style={{ letterSpacing: "-0.025em", lineHeight: 1.2 }}>Sign in</Text>
                  <Text size="sm" c="dimmed" style={{ lineHeight: 1.55 }}>
                    Continue with your Google account to access the dashboard.
                  </Text>
                </Stack>
                {errorParam && (
                  <Alert color="red" variant="light" icon={<IconAlertTriangle size={14} />} radius="sm" p="sm">
                    <Text size="xs">Sign-in failed: <Code>{errorParam}</Code></Text>
                  </Alert>
                )}
                <Button fullWidth size="md" radius="sm" loading={signing} onClick={handleSignIn}
                  leftSection={<IconBrandGoogle size={17} stroke={2} />}
                  color={accent} style={{ fontWeight: 500, fontSize: 14 }}>
                  Continue with Google
                </Button>
                <Group gap={6} justify="center" wrap="nowrap" mt={-12}>
                  <IconShieldCheck size={11} color="var(--mantine-color-dimmed)" />
                  <Text size="xs" c="dimmed" ta="center">New accounts require admin approval before first use</Text>
                </Group>
                <Divider opacity={0.5} />
                <Group justify="space-between" gap="xs" wrap="wrap">
                  <Anchor href="/" size="xs" c="dimmed" style={{ fontWeight: 500 }}>Public stats →</Anchor>
                  <Text size="xs" c="dimmed">Need help? Contact admin</Text>
                </Group>
              </Stack>
            )}
          </Transition>
        </Box>

        <Box style={{ padding: "20px 24px" }}>
          <Text size="xs" c="dimmed" ta="center">
            © {new Date().getFullYear()} claude-proxy · By signing in you agree to admin usage policies
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
