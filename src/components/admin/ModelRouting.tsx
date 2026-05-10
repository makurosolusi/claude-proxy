import { useState, useEffect, useCallback } from "react";
import {
  Stack, Paper, Text, Group, Box, Button, Select, NumberInput,
  Badge, ActionIcon,
} from "@mantine/core";
import { IconPlus, IconTrash, IconDeviceFloppy } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";

interface RouteRow {
  model_id:    string;
  threshold:   number;   // 0–1
  action:      "redirect" | "block";
  fallback_to: string | null;
}

const MODEL_OPTIONS = [
  { value: "claude-sonnet-4-6",    label: "Sonnet 4.6" },
  { value: "claude-opus-4-7",      label: "Opus 4.7" },
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
  { value: "*",                    label: "Default (5h global)" },
];

const ACTION_OPTIONS = [
  { value: "redirect", label: "Redirect" },
  { value: "block",    label: "Block" },
];

function emptyRow(): RouteRow {
  return { model_id: "", threshold: 0.9, action: "block", fallback_to: null };
}

const MODEL_LABELS: Record<string, string> = {
  "claude-sonnet-4-6":    "Sonnet 4.6",
  "claude-opus-4-7":      "Opus 4.7",
  "claude-haiku-4-5-20251001": "Haiku 4.5",
  "*":                    "Default (5h global)",
};

function modelLabel(id: string): string {
  return MODEL_LABELS[id] || id;
}

export function AdminModelRouting() {
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/model-routes");
      const data = await r.json() as RouteRow[];
      if (Array.isArray(data)) setRoutes(data.length ? data : []);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch("/api/admin/model-routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(routes.filter(x => x.model_id)),
      });
      const data = await r.json();
      if (!r.ok) {
        notifications.show({ color: "red", title: "Save failed", message: data.error || "Unknown error", autoClose: 4000 });
        return;
      }
      notifications.show({ color: "teal", message: "Routing rules saved", autoClose: 2000 });
    } catch (e: any) {
      notifications.show({ color: "red", title: "Network error", message: e.message, autoClose: 4000 });
    } finally {
      setSaving(false);
    }
  };

  const update = (i: number, patch: Partial<RouteRow>) => {
    setRoutes(prev => prev.map((r, j) => j === i ? { ...r, ...patch } : r));
  };

  const remove = (i: number) => {
    setRoutes(prev => prev.filter((_, j) => j !== i));
  };

  const add = () => {
    setRoutes(prev => [...prev, emptyRow()]);
  };

  const usedModels = new Set(routes.map(r => r.model_id).filter(Boolean));
  const availModels = MODEL_OPTIONS.filter(m => !usedModels.has(m.value));

  return (
    <Stack gap="md">
      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" wrap="wrap">
          <div>
            <Text size="sm" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }} mb={4}>Model Routing</Text>
            <Text size="xl" fw={800} ff="monospace">Request Routing Rules</Text>
            <Text size="sm" c="dimmed" mt={2}>
              Redirect or block requests when upstream model quotas reach threshold.
              Global 5h soft cap check runs first.
            </Text>
          </div>
          <Group gap="xs">
            <Button size="xs" leftSection={<IconPlus size={14} />} variant="light" onClick={add}>
              Add Rule
            </Button>
            <Button size="xs" leftSection={<IconDeviceFloppy size={14} />}
              color="blue" onClick={save} loading={saving}>
              Save
            </Button>
          </Group>
        </Group>
      </Paper>

      {routes.length === 0 ? (
        <Paper withBorder p="xl" radius="md" style={{ textAlign: "center" }}>
          <Text size="sm" c="dimmed" mb="md">No routing rules configured. Requests pass through unchanged.</Text>
          <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={add}>
            Add First Rule
          </Button>
        </Paper>
      ) : (
        <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
          <Box style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <Box style={{ minWidth: 480 }}>
          <Group gap={0} px="md" py={10}
            style={{ borderBottom: "1px solid var(--mantine-color-default-border)",
              background: "var(--mantine-color-dark-6)", fontSize: 11, fontWeight: 600,
              textTransform: "uppercase", letterSpacing: ".06em", color: "var(--mantine-color-dimmed)" }}>
            <Text size="xs" style={{ flex: 3 }}>Model</Text>
            <Text size="xs" style={{ flex: 2 }}>Threshold</Text>
            <Text size="xs" style={{ flex: 2 }}>Action</Text>
            <Text size="xs" style={{ flex: 3 }}>Fallback</Text>
            <Box style={{ width: 36 }} />
          </Group>
          {routes.map((r, i) => (
            <Group key={i} gap={0} px="md" py="sm"
              style={{ borderBottom: i < routes.length - 1 ? "1px solid var(--mantine-color-default-border)" : "none" }}>
              <Box style={{ flex: 3, paddingRight: 8 }}>
                {r.model_id ? (
                  <Group gap={4} wrap="nowrap">
                    <Text size="sm" ff="monospace">{r.model_id}</Text>
                    <Badge size="xs" variant="light" color="gray">{modelLabel(r.model_id)}</Badge>
                  </Group>
                ) : (
                  <Select
                    size="xs"
                    placeholder="Pick model..."
                    data={availModels}
                    value={r.model_id || null}
                    onChange={v => update(i, { model_id: v || "" })}
                    clearable
                  />
                )}
              </Box>
              <Box style={{ flex: 2, paddingRight: 8 }}>
                <NumberInput
                  size="xs"
                  min={1} max={100}
                  suffix="%"
                  value={Math.round(r.threshold * 100)}
                  onChange={v => update(i, { threshold: Math.max(0.01, Math.min(1, (v as number) / 100)) })}
                />
              </Box>
              <Box style={{ flex: 2, paddingRight: 8 }}>
                <Select
                  size="xs"
                  data={ACTION_OPTIONS}
                  value={r.action}
                  onChange={v => update(i, {
                    action: (v as "redirect" | "block") || "block",
                    fallback_to: v === "block" ? null : r.fallback_to,
                  })}
                />
              </Box>
              <Box style={{ flex: 3, paddingRight: 8 }}>
                {r.action === "redirect" ? (
                  <Select
                    size="xs"
                    placeholder="Fallback model..."
                    data={MODEL_OPTIONS.filter(m => m.value !== r.model_id && m.value !== "*")}
                    value={r.fallback_to || ""}
                    onChange={v => update(i, { fallback_to: v || null })}
                    clearable
                  />
                ) : (
                  <Text size="xs" c="dimmed" fs="italic">—</Text>
                )}
              </Box>
              <ActionIcon variant="subtle" color="red" size="sm" onClick={() => remove(i)}>
                <IconTrash size={14} />
              </ActionIcon>
            </Group>
          ))}
          </Box>
          </Box>
        </Paper>
      )}
    </Stack>
  );
}
