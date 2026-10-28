import { useState, useEffect, useCallback } from "react";
import { Box, Group, Text, Loader, TagsInput, Button, ActionIcon, Tooltip } from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import { shortenModel } from "../../providerDisplay";

interface ModelEntry { id: string; display_name: string; }

interface Props {
  tokenKey:      string;
  provider:      string;   // effective provider — decides which model list is offered
  allowedModels: string[];
  onSaved:       () => Promise<void> | void;
}

export function TokenAllowedModels({ tokenKey, provider, allowedModels, onSaved }: Props) {
  const saved = allowedModels.join(",");
  const [value, setValue]   = useState<string[]>(allowedModels);
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setValue(saved ? saved.split(",") : []); }, [saved]);

  const fetchModels = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/models/${provider}${force ? "?refresh=1" : ""}`, { credentials: "include" });
      const d = await r.json() as any;
      setModels(Array.isArray(d?.models) ? d.models : []);
    } catch { setModels([]); }
    finally { setLoading(false); }
  }, [provider]);

  useEffect(() => { fetchModels(); }, [fetchModels]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch("/admin/token/allowed-models", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: tokenKey, models: value.join(",") }),
      });
      const text = await r.text();
      let d: any = {};
      if ((r.headers.get("content-type") || "").includes("application/json")) { try { d = JSON.parse(text); } catch {} }
      if (!r.ok || d.ok === false) {
        notifications.show({ color: "red", title: "Gagal menyimpan model", message: d.error || text.slice(0, 200) || `HTTP ${r.status}`, autoClose: 5000 });
        return;
      }
      await onSaved();
      notifications.show({
        color: "teal",
        message: value.length === 0
          ? "Batasan model dihapus"
          : `${value.length} model diizinkan · default ${shortenModel(value[0]!, 24)}`,
        autoClose: 2500,
      });
    } catch (e: any) {
      notifications.show({ color: "red", message: e.message || "Gagal", autoClose: 3000 });
    } finally { setSaving(false); }
  };

  const dirty = value.join(",") !== saved;

  return (
    <Box>
      <Group gap="xs" mb={4} justify="space-between">
        <Group gap="xs"><Text size="xs" c="dimmed">Model yang Diizinkan</Text>{saving && <Loader size={10} />}</Group>
        <Tooltip label="Refresh daftar model" withArrow>
          <ActionIcon size="xs" variant="subtle" color="gray" loading={loading} onClick={() => fetchModels(true)}>
            <IconRefresh size={11} />
          </ActionIcon>
        </Tooltip>
      </Group>
      <TagsInput size="xs" clearable disabled={saving}
        placeholder={loading ? "Memuat…" : value.length ? "Pilih atau tulis model, Enter untuk tambah" : "Kosong = semua model diizinkan"}
        data={models.map(m => m.id)} value={value} onChange={setValue}
        comboboxProps={{ withinPortal: true }} />
      <Text size="xs" c="dimmed" mt={6}>
        {value.length === 0
          ? `Kosong = tanpa batasan, model apa pun dari klien diteruskan. ${models.length} model ${provider} tersedia.`
          : value.length === 1
            ? `Semua request dipaksa ke ${shortenModel(value[0]!, 28)}.`
            : `Urutan = prioritas. Model di luar daftar dialihkan ke yang pertama: ${shortenModel(value[0]!, 28)}.`}
      </Text>
      {dirty && (
        <Group justify="flex-end" mt={6}>
          <Button size="xs" variant="subtle" onClick={() => setValue(saved ? saved.split(",") : [])}>Revert</Button>
          <Button size="xs" color="teal" loading={saving} onClick={save}>Simpan model</Button>
        </Group>
      )}
    </Box>
  );
}
