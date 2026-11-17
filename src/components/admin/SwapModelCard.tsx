import { useEffect, useMemo, useState } from "react";
import {
  Paper, Group, ThemeIcon, Text, Modal, Stack, Select, Autocomplete,
  Checkbox, Button, Alert,
} from "@mantine/core";
import { IconArrowsExchange } from "@tabler/icons-react";
import { notifications } from "@mantine/notifications";
import type { TokenStatus } from "../../contexts";
import type { ApiUser } from "./UserModals";
import { swapModel } from "../../modelAllowlist";

const UNRESTRICTED = "__unrestricted__";

interface Props {
  tokens:   Record<string, TokenStatus>;
  apiUsers: ApiUser[] | null;
  reload:   () => Promise<void> | void;
}

export function SwapModelCard({ tokens, apiUsers, reload }: Props) {
  const [open, setOpen]   = useState(false);
  const [from, setFrom]   = useState<string | null>(null);
  const [to, setTo]       = useState("");
  const [userId, setUser] = useState<string | null>(null);
  const [sweep, setSweep] = useState(false);
  const [busy, setBusy]   = useState(false);
  const [catalog, setCatalog] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/admin/models/anthropic", { credentials: "include" })
      .then(r => r.json())
      .then(d => setCatalog(Array.isArray(d?.models) ? d.models.map((m: { id: string }) => m.id) : []))
      .catch((e: any) => console.warn("[swap-model] catalog fetch failed:", e?.message));
  }, [open]);

  const entries = useMemo(() => Object.entries(tokens), [tokens]);

  const fromOptions = useMemo(
    () => [...new Set(entries.flatMap(([, t]) => t.allowed_models).filter(Boolean))].sort(),
    [entries],
  );

  const fromData = useMemo(
    () => [{ value: UNRESTRICTED, label: "(Unrestricted tokens — empty allowlist)" }, ...fromOptions],
    [fromOptions],
  );

  const toOptions = useMemo(
    () => [...new Set([...catalog, ...fromOptions, ...entries.map(([, t]) => t.activeModel || "")])]
      .filter(m => m && m !== from).sort(),
    [catalog, fromOptions, entries, from],
  );

  const userOptions = useMemo(
    () => (apiUsers ?? []).map(u => ({ value: u.id, label: u.name || u.email || u.id })),
    [apiUsers],
  );

  const target = to.trim();
  const unrestricted = from === UNRESTRICTED;
  const sweepable = (unrestricted || sweep) && !!target;

  // Mirrors the backend loop in adminTokenModels.ts so the preview cannot drift.
  const affected = useMemo(() => {
    if (!from) return 0;
    let n = 0;
    for (const [, t] of entries) {
      if (userId && t.user_id !== userId) continue;
      const current = t.allowed_models || [];
      if (current.length === 0) { if (sweepable) n++; continue; }
      if (unrestricted) continue;
      const next = swapModel(current, from, target);
      if (next.length !== current.length || next.some((m, i) => m !== current[i])) n++;
    }
    return n;
  }, [entries, from, target, userId, sweepable, unrestricted]);

  const submit = async () => {
    if (!from) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("from", unrestricted ? "" : from);
      form.set("to", target);
      if (userId) form.set("user_id", userId);
      if (sweepable) form.set("include_unrestricted", "1");
      const r = await fetch("/admin/token/swap-model", { method: "POST", body: form, credentials: "include" });
      const text = await r.text();
      const d: any = r.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : {};
      if (!r.ok || d.ok === false) {
        notifications.show({ color: "red", title: "Switch failed", message: d.error || text.slice(0, 200) || `HTTP ${r.status}`, autoClose: 4000 });
        return;
      }
      const count = typeof d.count === "number" ? d.count : 0;
      setOpen(false);
      await reload();
      if (count === 0) {
        notifications.show({ color: "yellow", title: "No tokens changed", message: unrestricted ? "No unrestricted token in this scope." : `No token matched ${from} in this scope.`, autoClose: 4000 });
        return;
      }
      notifications.show({
        color: "teal",
        message: unrestricted
          ? `${count} unrestricted token(s) set to ${target}`
          : target
          ? `${count} token(s) switched from ${from} to ${target}`
          : `${from} removed from ${count} token(s)`,
        autoClose: 3000,
      });
    } catch (e: any) {
      notifications.show({ color: "red", title: "Error", message: e.message || "Failed to switch model", autoClose: 4000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Paper withBorder p="sm" radius="md" style={{ cursor: "pointer" }} onClick={() => setOpen(true)}>
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon variant="light" color="orange" size="lg" radius="md"><IconArrowsExchange size={18} /></ThemeIcon>
          <div>
            <Text size="sm" fw={600}>Bulk Switch Model</Text>
            <Text size="xs" c="dimmed">Replace one allowed model with another across tokens</Text>
          </div>
        </Group>
      </Paper>

      <Modal opened={open} onClose={() => setOpen(false)} title="Bulk Switch Model" centered>
        <Stack gap="sm">
          <Select
            label="From" placeholder="Model to replace" searchable
            data={fromData} value={from} onChange={setFrom}
          />
          <Autocomplete
            label="To"
            description={unrestricted ? "Model to pin on every unrestricted token" : "Leave empty to remove the model without a replacement"}
            placeholder={unrestricted ? "Model (required)" : "Replacement model (optional)"}
            data={toOptions} value={to} onChange={setTo}
          />
          <Select
            label="Limit to user" placeholder="All users" searchable clearable
            data={userOptions} value={userId} onChange={setUser}
          />
          {!unrestricted && <Checkbox
            checked={sweep} disabled={!target}
            onChange={e => setSweep(e.currentTarget.checked)}
            label="Also pin unrestricted tokens"
            description="Tokens with an empty allowlist may call any model today — checking this sets them to the To model instead."
          />}
          <Alert color={affected > 0 ? "orange" : "gray"} variant="light" p="xs">
            <Text size="sm">{affected} token(s) will change</Text>
          </Alert>
          <Group justify="flex-end" gap="xs">
            <Button variant="subtle" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" color="orange" loading={busy} disabled={!from || affected === 0 || target === from || (unrestricted && !target)} onClick={submit}>
              {unrestricted ? "Set" : target ? "Switch" : "Remove"}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
