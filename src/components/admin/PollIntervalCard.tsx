import { useState, useEffect } from "react";
import { Stack, Text, Group, Button, Badge, Slider, NumberInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";

export function PollIntervalCard() {
  const [pollSeconds, setPollSeconds]       = useState<number>(60);
  const [pollSavedSeconds, setPollSavedSec] = useState<number>(60);
  const [savingPoll, setSavingPoll]         = useState(false);
  const [loaded, setLoaded]                 = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then(r => r.json())
      .then((d: any) => {
        const ms = parseInt(d.poll_interval_ms || "60000");
        const sec = Number.isFinite(ms) ? Math.round(ms / 1000) : 60;
        setPollSeconds(sec);
        setPollSavedSec(sec);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const dirty = pollSeconds !== pollSavedSeconds;

  const savePoll = async () => {
    if (!dirty) return;
    setSavingPoll(true);
    try {
      const r = await fetch("/admin/settings/poll-interval", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ seconds: String(pollSeconds) }),
      });
      const text = await r.text();
      const ct   = r.headers.get("content-type") || "";
      let d: any = {};
      if (ct.includes("application/json")) { try { d = JSON.parse(text); } catch {} }
      if (!r.ok || d.ok === false) {
        notifications.show({ color: "red", title: "Save failed", message: d.error || text.slice(0, 120) || `HTTP ${r.status}`, autoClose: 4000 });
        return;
      }
      setPollSavedSec(pollSeconds);
      notifications.show({ color: "teal", message: `Poll interval set to ${pollSeconds}s — applies on next tick`, autoClose: 2500 });
    } catch (e: any) {
      notifications.show({ color: "red", message: e.message || "Failed", autoClose: 3000 });
    } finally { setSavingPoll(false); }
  };

  return (
    <Stack gap="xs">
      <Group justify="space-between" align="center">
        <div>
          <Text size="sm" fw={700}>Quota Poll Interval</Text>
          <Text size="xs" c="dimmed">
            How often the proxy fetches Claude's <code>/api/oauth/usage</code> endpoint. Dashboard refreshes every poll.
          </Text>
        </div>
        <Badge variant="light" color="teal" size="sm" ff="monospace">
          current: {pollSavedSeconds}s
        </Badge>
      </Group>

      <Slider
        value={pollSeconds}
        onChange={setPollSeconds}
        min={10}
        max={300}
        step={5}
        marks={[
          { value: 10,  label: "10s" },
          { value: 30,  label: "30s" },
          { value: 60,  label: "1m" },
          { value: 120, label: "2m" },
          { value: 300, label: "5m" },
        ]}
        color="teal"
        mb="xl"
      />

      <Group gap="xs" mt="xl" align="end" justify="space-between" wrap="wrap">
        <NumberInput
          label="Custom (seconds)"
          description="Range: 10 – 300 (5 min)"
          value={pollSeconds}
          onChange={(v) => setPollSeconds(typeof v === "number" ? v : 60)}
          min={10}
          max={300}
          step={5}
          size="xs"
          style={{ width: 220 }}
        />
        <Group gap="xs">
          <Button size="xs" variant="subtle" color="gray"
            disabled={!dirty}
            onClick={() => setPollSeconds(pollSavedSeconds)}>
            Revert
          </Button>
          <Button size="xs"
            disabled={!dirty || !loaded}
            loading={savingPoll}
            onClick={savePoll}>
            Save
          </Button>
        </Group>
      </Group>

      <Text size="xs" c="dimmed" mt="xs" style={{ lineHeight: 1.5 }}>
        <b>Trade-off:</b> Lower → fresher data + higher risk of Anthropic 429 (5-min backoff).
        Higher → less load, stale dashboard. Default <b>60s</b> is balanced.
      </Text>
    </Stack>
  );
}
