import { Stack, Text, Group, Box, Badge, UnstyledButton } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import type { UpstreamData } from "../../contexts";

const ROW_BG_HOVER = "var(--mantine-color-default-hover)";
const rowBgActive     = (color: string) => `var(--mantine-color-${color}-light)`;
const rowBorderActive = (color: string) => `var(--mantine-color-${color}-filled)`;

interface RowShellProps {
  isActive:    boolean;
  disabled:    boolean;
  accentColor: string;
  onClick:     () => void;
  children:    React.ReactNode;
}

function RowShell({ isActive, disabled, accentColor, onClick, children }: RowShellProps) {
  return (
    <UnstyledButton disabled={disabled}
      onClick={onClick}
      style={{
        display: "block", width: "100%",
        padding: "10px 12px",
        borderRadius: 8,
        background: isActive ? rowBgActive(accentColor) : "transparent",
        border: `1px solid ${isActive ? rowBorderActive(accentColor) : "var(--mantine-color-default-border)"}`,
        transition: "background 0.12s",
        cursor: disabled ? "wait" : "pointer",
      }}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = ROW_BG_HOVER; }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent"; }}>
      {children}
    </UnstyledButton>
  );
}

function CheckBox({ isActive, accentColor }: { isActive: boolean; accentColor: string }) {
  return (
    <Box style={{
      width: 18, height: 18,
      borderRadius: 4,
      background: isActive ? rowBorderActive(accentColor) : "var(--mantine-color-default-border)",
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
    }}>
      {isActive && <IconCheck size={12} color="white" stroke={3} />}
    </Box>
  );
}

interface PinAllModelRowProps {
  modelId:     string;
  displayName: string;
  isActive:    boolean;
  disabled:    boolean;
  accentColor: string;
  provider:    string;
  upstream:    UpstreamData | null | undefined;
  onClick:     () => void;
}

export function PinAllModelRow({
  modelId, displayName, isActive, disabled, accentColor, provider, upstream, onClick,
}: PinAllModelRowProps) {
  let util: number | null = null;
  if (provider === "anthropic") {
    if (modelId.includes("haiku"))  util = upstream?.sevenDay?.utilization       ?? null;
    if (modelId.includes("sonnet")) util = upstream?.sevenDaySonnet?.utilization ?? null;
    if (modelId.includes("opus"))   util = upstream?.sevenDayOpus?.utilization   ?? null;
  }
  const utilColor = util === null ? "gray" : util >= 90 ? "red" : util >= 70 ? "orange" : "teal";

  return (
    <RowShell isActive={isActive} disabled={disabled} accentColor={accentColor} onClick={onClick}>
      <Group justify="space-between" gap="sm" wrap="nowrap" align="center">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
          <CheckBox isActive={isActive} accentColor={accentColor} />
          <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
            <Text size="sm" fw={600} style={{ wordBreak: "break-word" }}>
              {displayName}
            </Text>
            <Text size="xs" c="dimmed" ff="monospace" truncate>
              {modelId}
            </Text>
          </Stack>
        </Group>
        {util !== null && (
          <Badge size="sm" variant="light" color={utilColor} style={{ flexShrink: 0 }}>
            {util.toFixed(0)}%
          </Badge>
        )}
      </Group>
    </RowShell>
  );
}

interface PinAllAutoRowProps {
  isActive:    boolean;
  disabled:    boolean;
  accentColor: string;
  onClick:     () => void;
}

export function PinAllAutoRow({ isActive, disabled, accentColor, onClick }: PinAllAutoRowProps) {
  return (
    <RowShell isActive={isActive} disabled={disabled} accentColor={accentColor} onClick={onClick}>
      <Group gap="sm" wrap="nowrap" align="center">
        <CheckBox isActive={isActive} accentColor={accentColor} />
        <Stack gap={2} style={{ flex: 1 }}>
          <Text size="sm" fw={600}>Auto — no pin</Text>
          <Text size="xs" c="dimmed">
            Tokens use whatever model the client requests
          </Text>
        </Stack>
      </Group>
    </RowShell>
  );
}
