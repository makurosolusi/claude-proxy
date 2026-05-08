import { useState, useEffect, useRef } from "react";
import {
  Stack, Text, Paper, Group, Button, Progress, Modal, Loader, ThemeIcon,
} from "@mantine/core";
import {
  IconDatabase, IconDownload, IconUpload, IconAlertTriangle, IconCircleCheck, IconCircleX, IconTrash,
} from "@tabler/icons-react";
import { modals } from "@mantine/modals";

type DbPhase = "idle" | "selected" | "uploading" | "restarting" | "error";

export function AdminDb() {
  const [info, setInfo]         = useState<{ path: string; size: number; modified: string } | null>(null);
  const [phase, setPhase]       = useState<DbPhase>("idle");
  const [file, setFile]         = useState<File | null>(null);
  const [errMsg, setErrMsg]     = useState("");
  const [countdown, setCountdown] = useState(5);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [downloaded, setDownloaded]   = useState(false);
  const [clearing, setClearing]             = useState(false);
  const [cleared, setCleared]               = useState(false);
  const [clearingUsage, setClearingUsage]   = useState(false);
  const [clearedUsage, setClearedUsage]     = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/admin/db/info")
      .then(r => r.json()).then(d => setInfo(d as any)).catch(() => {});
  }, []);

  useEffect(() => {
    if (phase !== "restarting") return;
    if (countdown <= 0) { window.location.reload(); return; }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, countdown]);

  const fmt = (bytes: number) => {
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1024 / 1024).toFixed(2) + " MB";
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setPhase(f ? "selected" : "idle");
    setErrMsg("");
  };

  const doUpload = async () => {
    if (!file) return;
    setConfirmOpen(false);
    setPhase("uploading");
    setErrMsg("");
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch("/api/admin/db/upload", { method: "POST", body: form });
      const d = await r.json() as any;
      if (d.ok) {
        setPhase("restarting");
        setCountdown(5);
      } else {
        setErrMsg(d.error || "Upload failed");
        setPhase("error");
      }
    } catch (e: any) {
      setErrMsg(e.message);
      setPhase("error");
    }
  };

  const reset = () => {
    setPhase("idle"); setFile(null); setErrMsg("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const onDownload = () => {
    setDownloaded(true);
    setTimeout(() => setDownloaded(false), 3000);
  };

  const clearLogs = async () => {
    setClearing(true);
    await fetch("/admin/logs/clear", { method: "POST" });
    setClearing(false);
    setCleared(true);
    setTimeout(() => setCleared(false), 3000);
  };

  const clearUsage = async () => {
    setClearingUsage(true);
    await fetch("/admin/usage/clear", { method: "POST" });
    setClearingUsage(false);
    setClearedUsage(true);
    setTimeout(() => setClearedUsage(false), 3000);
  };

  return (
    <Stack gap="xl" maw={600}>
      {/* ── Page Header ───────────────────────────────────── */}
      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" wrap="wrap">
          <div>
            <Text size="sm" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: ".08em" }} mb={4}>Database</Text>
            <Text size="xl" fw={800} ff="monospace">Backup & Restore</Text>
            <Text size="sm" c="dimmed" mt={2}>
              {info ? `${info.path} · ${fmt(info.size)}` : "SQLite database management"}
            </Text>
          </div>
        </Group>
      </Paper>

      {/* ── Current DB Info ────────────────────────────────── */}
      <Paper withBorder p="md" radius="md">
        <Group gap="sm" mb="md">
          <ThemeIcon variant="light" color="gray" size="md" radius="md">
            <IconDatabase size={16} />
          </ThemeIcon>
          <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: ".07em" }}>Current Database</Text>
        </Group>
        {info ? (
          <Group gap="xl" pl={40}>
            <div>
              <Text size="xs" c="dimmed">Path</Text>
              <Text size="sm" ff="monospace">{info.path}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">Size</Text>
              <Text size="sm" fw={600}>{fmt(info.size)}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed">Last modified</Text>
              <Text size="sm" fw={600}>{new Date(info.modified).toLocaleString()}</Text>
            </div>
          </Group>
        ) : (
          <Group gap="xs" pl={40}><Loader size="xs" /><Text size="sm" c="dimmed">Loading...</Text></Group>
        )}
      </Paper>

      {/* ── Backup ─────────────────────────────────────────── */}
      <Paper withBorder p="md" radius="md">
        <Group gap="sm" mb="sm">
          <ThemeIcon variant="light" color="blue" size="md" radius="md">
            <IconDownload size={16} />
          </ThemeIcon>
          <div>
            <Text size="sm" fw={600}>Backup — Download</Text>
            <Text size="xs" c="dimmed">Download a copy of the database before making changes.</Text>
          </div>
        </Group>
        <Group gap="xs" pl={40}>
          <Button
            component="a"
            href="/api/admin/db/download"
            download
            onClick={onDownload}
            leftSection={<IconDownload size={15} />}
            size="sm"
            variant="light"
            radius="md"
          >
            Download Database
          </Button>
          {downloaded && (
            <Group gap={4}>
              <IconCircleCheck size={15} color="var(--mantine-color-teal-5)" />
              <Text size="xs" c="teal">Download started</Text>
            </Group>
          )}
        </Group>
      </Paper>

      {/* ── Data Management ────────────────────────────────── */}
      <Paper withBorder p="md" radius="md">
        <Group gap="sm" mb="md">
          <ThemeIcon variant="light" color="red" size="md" radius="md">
            <IconTrash size={16} />
          </ThemeIcon>
          <div>
            <Text size="sm" fw={600}>Data Management</Text>
            <Text size="xs" c="dimmed">Hapus data historis. Quota counter tidak terpengaruh.</Text>
          </div>
        </Group>
        <Stack gap="sm" pl={40}>
          <Group gap="xs">
            <Button
              size="sm" color="red" variant="light" radius="md"
              loading={clearing} leftSection={<IconTrash size={15} />}
              onClick={() => modals.openConfirmModal({
                title: "Clear Request Logs",
                children: <Text size="sm">Hapus semua request logs? Quota counter tidak ikut terhapus. Tindakan ini tidak bisa dibatalkan.</Text>,
                labels: { confirm: "Clear Logs", cancel: "Cancel" },
                confirmProps: { color: "red" },
                onConfirm: clearLogs,
              })}
            >
              Clear Request Logs
            </Button>
            {cleared && <Group gap={4}><IconCircleCheck size={15} color="var(--mantine-color-teal-5)" /><Text size="xs" c="teal">Cleared</Text></Group>}
          </Group>
          <Group gap="xs">
            <Button
              size="sm" color="orange" variant="light" radius="md"
              loading={clearingUsage} leftSection={<IconTrash size={15} />}
              onClick={() => modals.openConfirmModal({
                title: "Clear Daily Usage History",
                children: <Text size="sm">Hapus semua data daily usage (grafik per-user)? Quota counter window saat ini tidak terpengaruh. Tindakan ini tidak bisa dibatalkan.</Text>,
                labels: { confirm: "Clear Usage History", cancel: "Cancel" },
                confirmProps: { color: "orange" },
                onConfirm: clearUsage,
              })}
            >
              Clear Usage History
            </Button>
            {clearedUsage && <Group gap={4}><IconCircleCheck size={15} color="var(--mantine-color-teal-5)" /><Text size="xs" c="teal">Cleared</Text></Group>}
          </Group>
        </Stack>
      </Paper>

      {/* ── Restore / Upload ───────────────────────────────── */}
      <Paper withBorder p="md" radius="md" style={{
        borderColor: phase === "restarting" ? "var(--mantine-color-teal-5)"
          : phase === "error" ? "var(--mantine-color-red-5)"
          : phase === "uploading" ? "var(--mantine-color-blue-5)"
          : phase === "selected" ? "var(--mantine-color-orange-5)" : undefined,
      }}>
        <Group gap="sm" mb="md">
          <ThemeIcon variant="light" color="orange" size="md" radius="md">
            <IconUpload size={16} />
          </ThemeIcon>
          <div>
            <Text size="sm" fw={600}>Restore — Upload</Text>
            <Text size="xs" c="dimmed">Replace database from a backup file.</Text>
          </div>
        </Group>

        <div style={{ paddingLeft: 40 }}>
          {(phase === "idle" || phase === "selected") && (
            <Stack gap="sm">
              <Paper p="xs" radius="sm" style={{ background: "var(--mantine-color-orange-light)" }}>
                <Group gap="xs" align="flex-start" wrap="nowrap">
                  <IconAlertTriangle size={14} color="var(--mantine-color-orange-6)" style={{ marginTop: 2, flexShrink: 0 }} />
                  <Text size="xs" c="orange">
                    Replaces the active database and restarts the server. All in-flight requests will be dropped.
                    Download a backup first.
                  </Text>
                </Group>
              </Paper>

              <input ref={fileRef} type="file" accept=".db" style={{ display: "none" }} onChange={onFileChange} />

              {phase === "idle" && (
                <div>
                  <Button size="sm" variant="default" leftSection={<IconUpload size={15} />} radius="md"
                    onClick={() => fileRef.current?.click()}>
                    Choose .db file
                  </Button>
                </div>
              )}

              {phase === "selected" && file && (
                <Paper p="sm" withBorder style={{ borderStyle: "dashed" }} radius="md">
                  <Group justify="space-between" wrap="nowrap">
                    <Group gap="sm" wrap="nowrap">
                      <ThemeIcon variant="light" color="orange" size="md" radius="md">
                        <IconDatabase size={18} />
                      </ThemeIcon>
                      <div>
                        <Text size="sm" fw={500}>{file.name}</Text>
                        <Text size="xs" c="dimmed">{fmt(file.size)}</Text>
                      </div>
                    </Group>
                    <Button size="xs" variant="subtle" color="gray" onClick={reset}>Change</Button>
                  </Group>
                </Paper>
              )}

              {phase === "selected" && (
                <Group gap="xs">
                  <Button size="sm" color="orange" leftSection={<IconUpload size={15} />} radius="md"
                    onClick={() => setConfirmOpen(true)}>
                    Upload & Restore
                  </Button>
                  <Button size="sm" variant="subtle" color="gray" onClick={reset}>Cancel</Button>
                </Group>
              )}
            </Stack>
          )}

          {phase === "uploading" && (
            <Stack gap="sm" align="center" py="md">
              <Loader size="md" />
              <Text size="sm" fw={500}>Uploading database...</Text>
              <Text size="xs" c="dimmed">Please wait, do not close this page.</Text>
            </Stack>
          )}

          {phase === "restarting" && (
            <Stack gap="sm">
              <Group gap="sm">
                <IconCircleCheck size={22} color="var(--mantine-color-teal-5)" />
                <Text size="sm" fw={600} c="teal">Database replaced successfully!</Text>
              </Group>
              <Text size="xs" c="dimmed">Server is restarting. Page will reload in <Text span fw={700}>{countdown}s</Text>.</Text>
              <Progress value={(5 - countdown) / 5 * 100} color="teal" size="sm" animated />
            </Stack>
          )}

          {phase === "error" && (
            <Stack gap="sm">
              <Group gap="sm">
                <IconCircleX size={20} color="var(--mantine-color-red-5)" />
                <Text size="sm" fw={500} c="red">Upload failed</Text>
              </Group>
              <Paper p="xs" withBorder radius="sm" style={{ borderColor: "var(--mantine-color-red-4)" }}>
                <Text size="xs" ff="monospace" c="red">{errMsg}</Text>
              </Paper>
              <div>
                <Button size="sm" variant="light" onClick={reset} radius="md">Try again</Button>
              </div>
            </Stack>
          )}
        </div>
      </Paper>

      <Modal
        opened={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={<Group gap="xs"><IconAlertTriangle size={18} color="var(--mantine-color-orange-5)" /><Text fw={600}>Confirm Database Replace</Text></Group>}
        centered
        size="sm"
        radius="md"
      >
        <Stack gap="md">
          <Text size="sm">You are about to replace the current database with:</Text>
          <Paper p="xs" withBorder radius="sm">
            <Text size="sm" ff="monospace" fw={500}>{file?.name}</Text>
            <Text size="xs" c="dimmed">{file ? fmt(file.size) : ""}</Text>
          </Paper>
          <Text size="sm" c="orange">
            The server will restart (~2–5s downtime). All current sessions and in-flight requests will be dropped.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" size="sm" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button color="orange" size="sm" leftSection={<IconUpload size={15} />} onClick={doUpload} radius="md">
              Yes, Replace & Restart
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
