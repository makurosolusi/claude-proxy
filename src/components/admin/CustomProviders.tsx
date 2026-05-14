import { useState, useEffect, useCallback } from "react";
import {
  Stack, Text, Paper, Group, Button, TextInput, Badge, ThemeIcon, Box,
  PasswordInput, Modal, Select, Alert, ActionIcon, Tooltip, Center, Loader,
  Divider,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { modals } from "@mantine/modals";
import {
  IconPlus, IconWifi, IconCircleCheck, IconAlertTriangle, IconTrash, IconPencil,
  IconBolt,
} from "@tabler/icons-react";

interface CustomProvider {
  id:             string;
  name:           string;
  type:           "anthropic" | "openai";
  base_url:       string;
  api_key:        string;     // masked when from list endpoint
  color?:         string;
  api_key_set?:   boolean;    // present in list response
}

type TestResult = { ok: boolean; latency: number; detail?: string; error?: string };

const COLOR_OPTIONS = [
  { value: "gray",   label: "Gray" },
  { value: "blue",   label: "Blue" },
  { value: "violet", label: "Violet" },
  { value: "orange", label: "Orange" },
  { value: "teal",   label: "Teal" },
  { value: "pink",   label: "Pink" },
  { value: "cyan",   label: "Cyan" },
  { value: "yellow", label: "Yellow" },
  { value: "lime",   label: "Lime" },
  { value: "indigo", label: "Indigo" },
];

function emptyForm(): Partial<CustomProvider> {
  return { id: "", name: "", type: "anthropic", base_url: "", api_key: "", color: "gray" };
}

export function CustomProvidersSection() {
  const [providers, setProviders] = useState<CustomProvider[] | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form,      setForm]      = useState<Partial<CustomProvider>>(emptyForm());
  const [saving,    setSaving]    = useState(false);
  const [formErr,   setFormErr]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/custom-providers");
      const d = await r.json() as any;
      setProviders(d.providers || []);
    } catch (e: any) {
      notifications.show({ color: "red", message: e.message || "Failed to load", autoClose: 3000 });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setFormErr(null);
    setModalOpen(true);
  };

  const openEdit = (p: CustomProvider) => {
    setEditingId(p.id);
    setForm({ ...p, api_key: "" }); // api_key always blank in edit form — leave empty to keep existing
    setFormErr(null);
    setModalOpen(true);
  };

  const save = async () => {
    setSaving(true); setFormErr(null);
    try {
      const isUpdate = !!editingId;
      const payload: any = { ...form, _update: isUpdate };
      // When editing and api_key is blank, send masked sentinel so server keeps original
      if (isUpdate && !payload.api_key) payload.api_key = "…keep";
      const r = await fetch("/api/admin/custom-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json() as any;
      if (!r.ok || d.ok === false) {
        setFormErr(d.error || `HTTP ${r.status}`);
        return;
      }
      notifications.show({ color: "teal", message: isUpdate ? `Provider ${form.name} updated` : `Provider ${form.name} created`, autoClose: 2000 });
      setModalOpen(false);
      load();
    } catch (e: any) {
      setFormErr(e.message || "Save failed");
    } finally { setSaving(false); }
  };

  const remove = (p: CustomProvider) => {
    modals.openConfirmModal({
      title: "Delete provider",
      children: <Text size="sm">Delete <b>{p.name}</b> (<code>{p.id}</code>)? Tokens using this provider will fail until reassigned.</Text>,
      labels: { confirm: "Delete", cancel: "Cancel" },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        try {
          const r = await fetch(`/api/admin/custom-providers/${encodeURIComponent(p.id)}`, { method: "DELETE" });
          const d = await r.json() as any;
          if (d.ok) {
            notifications.show({ color: "teal", message: `Provider ${p.name} deleted`, autoClose: 2000 });
            load();
          } else {
            notifications.show({ color: "red", message: d.error || "Delete failed", autoClose: 3000 });
          }
        } catch (e: any) {
          notifications.show({ color: "red", message: e.message || "Delete failed", autoClose: 3000 });
        }
      },
    });
  };

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <div>
          <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }}>Custom Providers</Text>
          <Text size="xs" c="dimmed" mt={2}>
            Add any Anthropic-compatible or OpenAI-compatible provider. The proxy translates if needed.
          </Text>
        </div>
        <Button size="sm" leftSection={<IconPlus size={14} />} onClick={openCreate} radius="md">
          Add Provider
        </Button>
      </Group>

      {loading && !providers ? (
        <Center py="lg"><Loader size="sm" /></Center>
      ) : !providers || providers.length === 0 ? (
        <Paper withBorder p="md" radius="md" ta="center">
          <Text size="sm" c="dimmed">No custom providers yet. Click <b>Add Provider</b> to register one.</Text>
        </Paper>
      ) : (
        <Stack gap="sm">
          {providers.map(p => (
            <CustomProviderCard key={p.id} provider={p} onEdit={() => openEdit(p)} onDelete={() => remove(p)} onChanged={load} />
          ))}
        </Stack>
      )}

      {/* Add / Edit Modal */}
      <Modal opened={modalOpen} onClose={() => setModalOpen(false)}
        title={editingId ? `Edit Provider: ${form.name}` : "Add Custom Provider"} size="lg">
        <Stack gap="sm">
          <Group gap="sm" grow>
            <TextInput
              label="ID (slug)"
              description="kebab-case, used internally as token provider value"
              placeholder="groq"
              value={form.id || ""}
              onChange={e => setForm({ ...form, id: e.currentTarget.value })}
              disabled={!!editingId}
              required
            />
            <TextInput
              label="Display Name"
              placeholder="Groq"
              value={form.name || ""}
              onChange={e => setForm({ ...form, name: e.currentTarget.value })}
              required
            />
          </Group>
          <Group gap="sm" grow>
            <Select
              label="Provider Type"
              description="Anthropic-compatible: forward as-is. OpenAI-compatible: proxy translates."
              data={[
                { value: "anthropic", label: "Anthropic-compatible (/v1/messages)" },
                { value: "openai",    label: "OpenAI-compatible (/v1/chat/completions)" },
              ]}
              value={form.type || "anthropic"}
              onChange={v => setForm({ ...form, type: (v as any) || "anthropic" })}
              allowDeselect={false}
            />
            <Select
              label="Badge color"
              data={COLOR_OPTIONS}
              value={form.color || "gray"}
              onChange={v => setForm({ ...form, color: v || "gray" })}
              allowDeselect={false}
            />
          </Group>
          <TextInput
            label="Base URL"
            description={form.type === "openai"
              ? "Base URL — endpoint will be {base_url}/v1/chat/completions"
              : "Base URL — endpoint will be {base_url}/v1/messages"}
            placeholder={form.type === "openai" ? "https://api.groq.com/openai" : "https://api.example.com"}
            value={form.base_url || ""}
            onChange={e => setForm({ ...form, base_url: e.currentTarget.value })}
            required
          />
          <PasswordInput
            label="API Key"
            description={editingId ? "Leave empty to keep current key" : "Bearer token sent to the provider"}
            placeholder={editingId ? "(unchanged)" : "sk-..."}
            value={form.api_key || ""}
            onChange={e => setForm({ ...form, api_key: e.currentTarget.value })}
          />
          <Alert color="blue" variant="light" p="xs">
            <Text size="xs" style={{ lineHeight: 1.5 }}>
              <b>Model selection</b> is handled separately in the <b>Pin All Tokens</b> card above. After creating this provider, pin tokens to a specific model from this provider's <code>/v1/models</code> list.
            </Text>
          </Alert>
          {formErr && (
            <Alert color="red" variant="light" icon={<IconAlertTriangle size={14} />} p="sm">
              <Text size="xs">{formErr}</Text>
            </Alert>
          )}
          <Group justify="flex-end" gap="xs" mt="md">
            <Button variant="subtle" color="gray" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button color={form.color || "blue"} loading={saving} onClick={save}>
              {editingId ? "Save Changes" : "Create Provider"}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Divider my="xs" />
    </Stack>
  );
}

interface CardProps {
  provider:  CustomProvider;
  onEdit:    () => void;
  onDelete:  () => void;
  onChanged: () => void;
}

function CustomProviderCard({ provider: p, onEdit, onDelete }: CardProps) {
  const [testing, setTesting]   = useState(false);
  const [result,  setResult]    = useState<TestResult | null>(null);

  const test = async () => {
    setTesting(true); setResult(null);
    try {
      const r = await fetch(`/api/admin/test/${encodeURIComponent(p.id)}`);
      setResult(await r.json());
    } catch (e: any) {
      setResult({ ok: false, latency: 0, error: e.message });
    } finally { setTesting(false); }
  };

  const color = p.color || "gray";
  const configured = !!p.api_key_set;

  return (
    <Paper withBorder p="lg" radius="md" style={{ opacity: configured ? 1 : 0.75 }}>
      <Group gap="sm" mb="sm" wrap="wrap">
        <ThemeIcon variant="light" color={color} size="lg" radius="md">
          <IconBolt size={18} />
        </ThemeIcon>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs" align="center">
            <Text size="sm" fw={700}>{p.name}</Text>
            <Badge size="xs" variant="outline" color="gray" ff="monospace">{p.id}</Badge>
            <Badge size="xs" variant="light" color={p.type === "openai" ? "yellow" : "blue"}>
              {p.type === "openai" ? "OpenAI-like" : "Anthropic-like"}
            </Badge>
            {configured && <Badge size="xs" variant="light" color={color}>configured</Badge>}
          </Group>
          <Text size="xs" c="dimmed" mt={2}>{p.base_url}</Text>
        </div>
        <Group gap="xs">
          <Tooltip label="Test connection" withArrow>
            <ActionIcon variant="light" color="gray" size="lg" radius="md"
              loading={testing} disabled={!configured}
              onClick={test}>
              <IconWifi size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Edit" withArrow>
            <ActionIcon variant="light" color="blue" size="lg" radius="md" onClick={onEdit}>
              <IconPencil size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Delete" withArrow>
            <ActionIcon variant="light" color="red" size="lg" radius="md" onClick={onDelete}>
              <IconTrash size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <Group gap="xl" pl={56} wrap="wrap">
        <Box>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".05em" }}>API Key</Text>
          <Text size="xs" ff="monospace" c={configured ? undefined : "red"}>
            {p.api_key || "(not set)"}
          </Text>
        </Box>
        <Box>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: ".05em" }}>Endpoint</Text>
          <Text size="xs" ff="monospace">
            {p.type === "openai" ? "/v1/chat/completions" : "/v1/messages"}
          </Text>
        </Box>
      </Group>

      {result && (
        <Paper withBorder p="sm" radius="md" mt="md" style={{
          borderColor: `var(--mantine-color-${result.ok ? "teal" : "red"}-4)`,
          background: `var(--mantine-color-${result.ok ? "teal" : "red"}-light)`,
        }}>
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon variant="light" color={result.ok ? "teal" : "red"} size="sm" radius="sm">
              {result.ok ? <IconCircleCheck size={14} /> : <IconAlertTriangle size={14} />}
            </ThemeIcon>
            <Text size="xs" ff="monospace" c={result.ok ? "teal" : "red"} style={{ flex: 1 }}>
              {result.ok ? result.detail : (result.error || "Connection failed")}
            </Text>
            {result.latency > 0 && (
              <Badge size="xs" variant="outline" color="gray">{result.latency}ms</Badge>
            )}
          </Group>
        </Paper>
      )}
    </Paper>
  );
}
