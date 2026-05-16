import { useEffect, useState } from "react";
import {
  Stack, Group, Text, Title, Paper, Badge, Switch, Loader, Center,
  ThemeIcon, Alert, Box, Button,
} from "@mantine/core";
import {
  IconPuzzle, IconRefresh, IconAlertCircle, IconCheck,
} from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";

interface ExtensionInfo {
  id:           string;
  name:         string;
  version:      string;
  description:  string;
  enabled:      boolean;
  config:       Record<string, any>;
  adminTabId?:  string;
  installed_at: number;
  updated_at:   number;
}

export function AdminExtensions() {
  const [items, setItems]       = useState<ExtensionInfo[] | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [busy, setBusy]         = useState<Set<string>>(new Set());

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/extensions", { credentials: "include" });
      const d = await r.json() as any;
      if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
      setItems(d.extensions || []);
    } catch (e: any) {
      setError(e.message || "Failed to load");
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggle = async (ext: ExtensionInfo, next: boolean) => {
    const action = next ? "enable" : "disable";
    setBusy(s => new Set(s).add(ext.id));
    try {
      const r = await fetch(`/api/admin/extensions/${ext.id}/${action}`, {
        method:      "POST",
        credentials: "include",
      });
      const d = await r.json() as any;
      if (!r.ok || d.ok === false) {
        notifications.show({ color: "red", title: `Failed to ${action}`, message: d?.error || `HTTP ${r.status}`, autoClose: 5000 });
        return;
      }
      notifications.show({ color: "teal", message: `${ext.name} ${next ? "enabled" : "disabled"}`, autoClose: 2500, icon: <IconCheck size={16} /> });
      await load();
    } catch (e: any) {
      notifications.show({ color: "red", message: e.message || "Failed", autoClose: 4000 });
    } finally {
      setBusy(s => { const n = new Set(s); n.delete(ext.id); return n; });
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <Box>
          <Group gap="xs" align="center">
            <ThemeIcon variant="light" radius="md" size="lg" color="grape">
              <IconPuzzle size={20} />
            </ThemeIcon>
            <Title order={3}>Extensions</Title>
          </Group>
          <Text size="sm" c="dimmed" mt={4}>
            Optional add-ons. Toggle on/off without affecting core proxy behavior.
            When disabled, the extension's code path is fully inert.
          </Text>
        </Box>
        <Button
          variant="default"
          size="xs"
          leftSection={<IconRefresh size={14} />}
          onClick={load}
          loading={loading}
        >Refresh</Button>
      </Group>

      {error && (
        <Alert color="red" icon={<IconAlertCircle size={16} />} variant="light">
          {error}
        </Alert>
      )}

      {loading && !items && (
        <Center py="xl"><Loader size="sm" /></Center>
      )}

      {items && items.length === 0 && !loading && (
        <Paper withBorder p="xl" radius="md">
          <Center>
            <Stack align="center" gap="xs">
              <ThemeIcon variant="light" size={48} radius="xl" color="gray">
                <IconPuzzle size={28} />
              </ThemeIcon>
              <Text fw={500}>No extensions installed</Text>
              <Text size="xs" c="dimmed" ta="center" maw={400}>
                Extensions register themselves at boot. None are loaded yet.
              </Text>
            </Stack>
          </Center>
        </Paper>
      )}

      {items && items.length > 0 && (
        <Stack gap="md">
          {items.map(ext => (
            <Paper key={ext.id} withBorder p="md" radius="md">
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <Group gap="xs" align="center" mb={4}>
                    <Text fw={600} size="md">{ext.name}</Text>
                    <Badge size="xs" variant="light" color="gray">v{ext.version}</Badge>
                    <Badge size="xs" variant="light" color={ext.enabled ? "teal" : "gray"}>
                      {ext.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </Group>
                  <Text size="sm" c="dimmed">{ext.description}</Text>
                  <Text size="xs" c="dimmed" mt={6} ff="monospace">
                    id: {ext.id}
                  </Text>
                </Box>
                <Switch
                  checked={ext.enabled}
                  onChange={e => toggle(ext, e.currentTarget.checked)}
                  disabled={busy.has(ext.id)}
                  size="md"
                  color="teal"
                  onLabel="ON"
                  offLabel="OFF"
                />
              </Group>
            </Paper>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
