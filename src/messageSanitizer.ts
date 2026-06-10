// Conversation coherence layer for cross-provider/cross-model routing.
//
// WHY: Proxy routes a single conversation to different providers/models per turn,
// but the client (Claude Code) accumulates history assuming a single destination.
// Anthropic-specific state (thinking blocks with signatures, the `thinking` param)
// becomes invalid when the destination doesn't match the original — different
// model, different provider, or model that doesn't support thinking.
//
// Pre-flight `sanitizeRequestBody` strips incompatible state up front; the
// post-error retry path (`stripAllThinking` + `isThinkingIncompatibleError`)
// handles unknown cases self-healingly.

export interface DestinationCapabilities {
  acceptsThinkingBlocks:    boolean;
  acceptsThinkingParam:     boolean;
  rejectsThinkingDisabled?: boolean; // model uses adaptive thinking by default, rejects thinking.type.disabled
}

export interface SanitizationStats {
  thinkingBlocks:       number;
  redactedBlocks:       number;
  thinkingParamDropped: boolean;
}

// Models known to reject thinking. Add new ones as Anthropic ships them;
// the retry safety net catches unknowns automatically.
const NO_THINKING_MODELS = new Set<string>([
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
]);

function modelSupportsThinking(model: string): boolean {
  if (!model) return true; // unknown — let upstream decide, retry will catch
  if (NO_THINKING_MODELS.has(model)) return false;
  if (/haiku/i.test(model)) return false; // entire haiku family historically lacks extended thinking
  return true;
}

// Models that use adaptive thinking by default and reject thinking.type.disabled.
// They DO support thinking.type.enabled; only the explicit "disabled" flag is rejected.
function modelRejectsThinkingDisabled(model: string): boolean {
  if (!model) return false;
  return /fable/i.test(model);
}

export function getCapabilities(
  provider:    string,
  model:       string,
  customType?: "anthropic" | "openai",
): DestinationCapabilities {
  // openai-like custom: translation strips thinking via anthropicContentToText.
  // Treat as cannot-accept upfront — translation handles the actual drop.
  if (customType === "openai") {
    return { acceptsThinkingBlocks: false, acceptsThinkingParam: false };
  }
  // Anthropic + non-thinking model (haiku family): model rejects thinking
  if (provider === "anthropic" && !modelSupportsThinking(model)) {
    return { acceptsThinkingBlocks: false, acceptsThinkingParam: false };
  }
  // Anthropic + adaptive-thinking model (fable family): accepts thinking.type.enabled
  // but rejects thinking.type.disabled — strip that specific value pre-flight
  if (provider === "anthropic" && modelRejectsThinkingDisabled(model)) {
    return { acceptsThinkingBlocks: true, acceptsThinkingParam: true, rejectsThinkingDisabled: true };
  }
  // Default KEEP. Covers:
  //   - Anthropic + thinking-capable: preserve for extended-thinking caching;
  //     stale signature mismatches handled by post-error retry path
  //   - Non-Anthropic anthropic-compat (DS, OR, custom-anthropic): provider may
  //     run its own thinking mode and REQUIRE its blocks back in history
  //     (DeepSeek: "content[].thinking in the thinking mode must be passed back")
  return { acceptsThinkingBlocks: true, acceptsThinkingParam: true };
}

// Mutate body in place. Idempotent — safe to call multiple times.
export function sanitizeRequestBody(
  body: any,
  caps: DestinationCapabilities,
): SanitizationStats {
  const stats: SanitizationStats = {
    thinkingBlocks:       0,
    redactedBlocks:       0,
    thinkingParamDropped: false,
  };
  if (!body) return stats;

  if (!caps.acceptsThinkingParam && body.thinking) {
    delete body.thinking;
    stats.thinkingParamDropped = true;
  }

  // Fable-family: thinking.type.disabled is not supported (adaptive mode is the default).
  // Drop only the disabled flag; preserve thinking.type.enabled if present.
  if (caps.rejectsThinkingDisabled && body.thinking?.type === "disabled") {
    delete body.thinking;
    stats.thinkingParamDropped = true;
  }

  if (!caps.acceptsThinkingBlocks && Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
      msg.content = msg.content.filter((b: any) => {
        if (b?.type === "thinking")          { stats.thinkingBlocks++; return false; }
        if (b?.type === "redacted_thinking") { stats.redactedBlocks++; return false; }
        return true;
      });
    }
  }
  return stats;
}

// Aggressive strip for post-error retry — drops thinking unconditionally.
export function stripAllThinking(body: any): SanitizationStats {
  return sanitizeRequestBody(body, { acceptsThinkingBlocks: false, acceptsThinkingParam: false });
}

// Detect Anthropic 400 errors indicating thinking-state incompatibility.
export function isThinkingIncompatibleError(status: number, body: any): boolean {
  if (status !== 400) return false;
  const msg = String(body?.error?.message || body?.message || "").toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("invalid `signature`") ||
    msg.includes("adaptive thinking") ||
    msg.includes("thinking.type.disabled") ||
    /thinking[^a-z]*(is\s+)?not\s+supported/.test(msg)
  );
}
