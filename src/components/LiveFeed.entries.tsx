import { useState } from "react";
import { Stack, Text, Box, Group, Badge, ActionIcon, Tooltip } from "@mantine/core";
import {
  IconBolt, IconAlertCircle, IconChevronDown, IconChevronRight,
  IconCornerDownRight, IconBrain,
} from "@tabler/icons-react";
import { UserAvatar } from "./UserAvatar";
import type { LogEntry } from "../contexts";
import {
  kfmt, fmtAge, fmtDuration, modelShort, modelColor,
  ctxSeverity, totalSeverity, maxSev, SEV_COLOR, severityGradient,
  briefExplanation, anomalyScore,
  CacheBar, MetricRow,
} from "./LiveFeed.helpers";

// Owner takes precedence over token label.
// Orphan logs (no owner) fall back to token_label, then legacy name, then last 8 of key.
function deriveDisplay(l: LogEntry): { primary: string; secondary: string } {
  const owner   = l.owner_name || "";
  const tokLbl  = l.token_label || l.name || l.token_key.slice(-8);
  const primary = owner || tokLbl;
  const secondary = owner && tokLbl && tokLbl !== owner ? tokLbl : "";
  return { primary, secondary };
}

export interface LogGroup {
  key: string;
  entries: LogEntry[];
  head: LogEntry;
  totalTokens: number;
  hasNew: boolean;
}

export function FeedEntry({
  log: l, isNew, onClick, compact = false, imageUrl,
}: {
  log: LogEntry; isNew: boolean; onClick: () => void; compact?: boolean; imageUrl?: string;
}) {
  const isErr   = l.status >= 400;
  const total   = l.input_tokens + l.output_tokens + l.cache_read + l.cache_creation;
  const model   = modelShort(l.model);
  const mColor  = modelColor(l.model);
  const { primary, secondary } = deriveDisplay(l);
  const ctxSev  = ctxSeverity(l.input_tokens);
  const totSev  = totalSeverity(total);
  const sev     = maxSev(ctxSev, totSev);
  const cachePct = (l.input_tokens + l.cache_read) > 0
    ? Math.round((l.cache_read / (l.input_tokens + l.cache_read)) * 100) : 0;
  const anom    = anomalyScore(l.input_tokens, l.output_tokens, l.tool_use_count, l.duration_ms);
  const slow    = l.duration_ms > 30_000;
  const explain = briefExplanation(ctxSev, totSev, isErr, l.status, l.duration_ms);

  return (
    <Box
      className={`feed-entry${isNew ? " feed-entry-new" : ""}`}
      onClick={onClick}
      style={{
        padding: compact ? "6px 14px 6px 48px" : "10px 14px",
        borderBottom: "1px solid var(--cp-border)",
        cursor: "pointer",
        background: compact ? "var(--cp-surface-2)" : severityGradient(sev, isErr),
        opacity: compact ? 0.88 : 1,
        position: "relative",
        transition: "background 0.3s ease",
      }}
    >
      <Group gap={10} wrap="nowrap" align="flex-start">
        {!compact && <UserAvatar name={primary} imageUrl={imageUrl} isErr={isErr} />}

        <Box style={{ flex: 1, minWidth: 0 }}>
          {/* Row 1: token name + age (+ duration if slow) */}
          {!compact && (
            <Group justify="space-between" wrap="nowrap" mb={2}>
              <Text fz={13} fw={700} truncate style={{ letterSpacing: "-0.01em", maxWidth: "70%" }}>
                {primary}
              </Text>
              <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
                {slow && (
                  <Tooltip label={`Duration: ${fmtDuration(l.duration_ms)}`} withArrow>
                    <Text fz={10} c={l.duration_ms > 120_000 ? "orange" : "yellow"}
                      fw={600} ff="Geist Mono, monospace">
                      {fmtDuration(l.duration_ms)}
                    </Text>
                  </Tooltip>
                )}
                <Text fz={10} c="dimmed" ff="Geist Mono, monospace">{fmtAge(l.ts)}</Text>
              </Group>
            </Group>
          )}

          {/* Row 2: token sub-label */}
          {!compact && secondary && (
            <Group gap={4} wrap="nowrap" mb={4} style={{ minWidth: 0 }}>
              <IconCornerDownRight size={11} style={{ color: "var(--cp-text-3)", flexShrink: 0 }} />
              <Text fz={11} ff="Geist Mono, monospace" truncate style={{ color: "var(--cp-text-2)" }}>
                {secondary}
              </Text>
            </Group>
          )}

          {/* Row 3: model badge + side meta */}
          <Group gap={6} wrap="nowrap" mb={compact ? 0 : 5}>
            {isErr ? (
              <Badge size="xs" variant="light" color="red" leftSection={<IconAlertCircle size={8} />}
                style={{ fontSize: 10, fontFamily: "Geist Mono, monospace" }}>
                {l.status}
              </Badge>
            ) : (
              <Box style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                background: mColor + "20", borderRadius: 6, padding: "2px 8px",
              }}>
                <Box w={5} h={5} style={{ borderRadius: "50%", background: mColor, flexShrink: 0 }} />
                <Text fz={11} fw={700} style={{ color: mColor, fontFamily: "Geist Mono, monospace" }}>
                  {model}
                </Text>
              </Box>
            )}
            {!compact && !isErr && l.stop_reason && l.stop_reason !== "end_turn" && (
              <Tooltip label={`Stop reason: ${l.stop_reason}`} withArrow>
                <Badge size="xs" variant="outline" color={l.stop_reason === "max_tokens" ? "orange" : "gray"}
                  style={{ fontSize: 9, fontFamily: "Geist Mono, monospace", textTransform: "none" }}>
                  {l.stop_reason}
                </Badge>
              </Tooltip>
            )}
            {!compact && !isErr && anom >= 40 && (
              <Tooltip label={`Anomaly score: ${anom}/100 (high input, low output, heavy tools, or slow duration)`} withArrow>
                <Badge size="xs" variant="light"
                  color={anom >= 70 ? "red" : anom >= 50 ? "orange" : "yellow"}
                  style={{ fontSize: 9, fontFamily: "Geist Mono, monospace" }}>
                  anom·{anom}
                </Badge>
              </Tooltip>
            )}
            {!compact && !isErr && l.turns > 0 && (
              <Tooltip label={`${l.turns} turn${l.turns > 1 ? "s" : ""} · ${l.tool_use_count} tool use`} withArrow>
                <Text fz={10} c="dimmed" ff="Geist Mono, monospace">
                  {l.turns}t{l.tool_use_count > 0 ? `·${l.tool_use_count}🔧` : ""}
                </Text>
              </Tooltip>
            )}
            {compact && (
              <Text fz={10} c="dimmed" ff="Geist Mono, monospace" style={{ marginLeft: "auto" }}>
                {fmtAge(l.ts)}
              </Text>
            )}
          </Group>

          {/* Context + Total metric rows */}
          {!compact && !isErr && (
            <Stack gap={3} mb={5}>
              <MetricRow
                icon={<IconBrain size={12} />}
                label="Context"
                value={kfmt(l.input_tokens)}
                sev={ctxSev}
                hint={`Input: ${l.input_tokens.toLocaleString()} tokens${cachePct > 0 ? ` · ${cachePct}% cache hit` : ""}`}
              />
              <MetricRow
                icon={<IconBolt size={12} />}
                label="Request"
                value={kfmt(total)}
                sev={totSev}
                hint={`Total: ${total.toLocaleString()} (input+output+cache_read+cache_creation)`}
              />
            </Stack>
          )}

          {compact && !isErr && (
            <Group gap={6} wrap="nowrap" mt={2}>
              <IconBrain size={9} color={SEV_COLOR[ctxSev]} />
              <Text fz={10} ff="Geist Mono, monospace" style={{ color: SEV_COLOR[ctxSev] }}>
                {kfmt(l.input_tokens)}
              </Text>
              <IconBolt size={9} color={SEV_COLOR[totSev]} />
              <Text fz={10} ff="Geist Mono, monospace" style={{ color: SEV_COLOR[totSev] }}>
                {kfmt(total)}
              </Text>
              <CacheBar cacheRead={l.cache_read} inputTokens={l.input_tokens} />
            </Group>
          )}

          {l.prompt && !isErr && !compact && (
            <Text fz={12} c="dimmed" mt={4} lineClamp={3} style={{ lineHeight: 1.5, opacity: 0.85 }}>
              {l.prompt}
            </Text>
          )}

          {!compact && (
            <Text fz={10} fw={500} mt={5}
              style={{
                color: isErr ? "#ef4444" : SEV_COLOR[sev],
                opacity: sev === "normal" && !isErr ? 0.55 : 0.9,
                letterSpacing: ".01em",
              }}>
              ─ {explain}
            </Text>
          )}
        </Box>
      </Group>
    </Box>
  );
}

export function GroupedEntry({
  group, newIds, onEntryClick, imageUrl,
}: {
  group: LogGroup;
  newIds: Set<number>;
  onEntryClick: (log: LogEntry) => void;
  imageUrl?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const l = group.head;
  const isErr  = l.status >= 400;
  const model  = modelShort(l.model);
  const mColor = modelColor(l.model);
  const { primary, secondary } = deriveDisplay(l);
  const count  = group.entries.length;
  const isNew  = group.hasNew;

  const maxCtx   = group.entries.reduce((m, e) => Math.max(m, e.input_tokens), 0);
  const avgCtx   = Math.round(group.entries.reduce((s, e) => s + e.input_tokens, 0) / count);
  const ctxSev   = ctxSeverity(maxCtx);
  const totSev   = totalSeverity(group.totalTokens);
  const sev      = maxSev(ctxSev, totSev);
  const totalDur = group.entries.reduce((s, e) => s + e.duration_ms, 0);
  const maxAnom  = group.entries.reduce((m, e) =>
    Math.max(m, anomalyScore(e.input_tokens, e.output_tokens, e.tool_use_count, e.duration_ms)), 0);
  const explain  = briefExplanation(ctxSev, totSev, isErr, l.status, totalDur / count);

  return (
    <Box>
      <Box
        className={`feed-entry${isNew ? " feed-entry-new" : ""}`}
        onClick={() => setExpanded(v => !v)}
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--cp-border)",
          cursor: "pointer",
          background: severityGradient(sev, isErr),
          transition: "background 0.3s ease",
        }}
      >
        <Group gap={10} wrap="nowrap" align="flex-start">
          <UserAvatar name={primary} imageUrl={imageUrl} isErr={isErr} />

          <Box style={{ flex: 1, minWidth: 0 }}>
            <Group justify="space-between" wrap="nowrap" mb={2}>
              <Group gap={6} wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                <Text fz={13} fw={700} truncate style={{ letterSpacing: "-0.01em" }}>
                  {primary}
                </Text>
                <Badge size="xs" variant="filled"
                  color={sev === "normal" ? "gray" : undefined}
                  style={{
                    fontSize: 10, fontFamily: "Geist Mono, monospace", cursor: "default", flexShrink: 0,
                    background: sev === "normal" ? undefined : SEV_COLOR[sev],
                  }}>
                  ×{count}
                </Badge>
              </Group>
              <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
                {totalDur > 60_000 && (
                  <Tooltip label={`Total duration across ${count} requests: ${fmtDuration(totalDur)}`} withArrow>
                    <Text fz={10} c={totalDur > 300_000 ? "orange" : "yellow"} fw={600} ff="Geist Mono, monospace">
                      Σ{fmtDuration(totalDur)}
                    </Text>
                  </Tooltip>
                )}
                <Text fz={10} c="dimmed" ff="Geist Mono, monospace">{fmtAge(l.ts)}</Text>
              </Group>
            </Group>

            {secondary && (
              <Group gap={4} wrap="nowrap" mb={4} style={{ minWidth: 0 }}>
                <IconCornerDownRight size={11} style={{ color: "var(--cp-text-3)", flexShrink: 0 }} />
                <Text fz={11} ff="Geist Mono, monospace" truncate style={{ color: "var(--cp-text-2)" }}>
                  {secondary}
                </Text>
              </Group>
            )}

            <Group gap={6} wrap="nowrap" mb={5}>
              {isErr ? (
                <Badge size="xs" variant="light" color="red" leftSection={<IconAlertCircle size={8} />}
                  style={{ fontSize: 10, fontFamily: "Geist Mono, monospace" }}>
                  {l.status}
                </Badge>
              ) : (
                <Box style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  background: mColor + "20", borderRadius: 6, padding: "2px 8px",
                }}>
                  <Box w={5} h={5} style={{ borderRadius: "50%", background: mColor, flexShrink: 0 }} />
                  <Text fz={11} fw={700} style={{ color: mColor, fontFamily: "Geist Mono, monospace" }}>
                    {model}
                  </Text>
                </Box>
              )}
              {maxAnom >= 40 && !isErr && (
                <Tooltip label={`Peak anomaly across ${count} requests: ${maxAnom}/100`} withArrow>
                  <Badge size="xs" variant="light"
                    color={maxAnom >= 70 ? "red" : maxAnom >= 50 ? "orange" : "yellow"}
                    style={{ fontSize: 9, fontFamily: "Geist Mono, monospace" }}>
                    anom·{maxAnom}
                  </Badge>
                </Tooltip>
              )}
              <ActionIcon size={16} variant="subtle" color="gray"
                style={{ marginLeft: "auto" }}
                onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
                aria-label={expanded ? "Collapse" : "Expand"}>
                {expanded ? <IconChevronDown size={11} /> : <IconChevronRight size={11} />}
              </ActionIcon>
            </Group>

            {!isErr && (
              <Stack gap={3} mb={5}>
                <MetricRow
                  icon={<IconBrain size={12} />}
                  label="Context"
                  value={`${kfmt(maxCtx)}↑`}
                  sev={ctxSev}
                  hint={`Max context: ${maxCtx.toLocaleString()} · Avg: ${avgCtx.toLocaleString()} across ${count} requests`}
                />
                <MetricRow
                  icon={<IconBolt size={12} />}
                  label="Total"
                  value={kfmt(group.totalTokens)}
                  sev={totSev}
                  hint={`Combined ${count} requests: ${group.totalTokens.toLocaleString()} tokens`}
                />
              </Stack>
            )}

            {l.prompt && !isErr && (
              <Text fz={12} c="dimmed" mt={4} lineClamp={3} style={{ lineHeight: 1.5, opacity: 0.85 }}>
                {l.prompt}
              </Text>
            )}

            <Text fz={10} fw={500} mt={5}
              style={{
                color: isErr ? "#ef4444" : SEV_COLOR[sev],
                opacity: sev === "normal" && !isErr ? 0.55 : 0.9,
                letterSpacing: ".01em",
              }}>
              ─ {explain} · {count} requests
            </Text>
          </Box>
        </Group>
      </Box>

      {expanded && group.entries.map(entry => (
        <FeedEntry
          key={entry.id}
          log={entry}
          isNew={newIds.has(entry.id)}
          onClick={() => onEntryClick(entry)}
          compact
        />
      ))}
    </Box>
  );
}

export function groupLogs(logs: LogEntry[], newIds: Set<number>): LogGroup[] {
  const map = new Map<string, LogGroup>();
  const order: string[] = [];

  for (const l of logs) {
    const gk = `${l.token_key}::${l.model}::${l.prompt ?? ""}`;
    if (!map.has(gk)) {
      order.push(gk);
      map.set(gk, { key: `g-${l.id}`, entries: [], head: l, totalTokens: 0, hasNew: false });
    }
    const g = map.get(gk)!;
    g.entries.push(l);
    g.totalTokens += l.input_tokens + l.output_tokens + l.cache_read + l.cache_creation;
    if (newIds.has(l.id)) g.hasNew = true;
  }

  return order.map(gk => map.get(gk)!);
}
