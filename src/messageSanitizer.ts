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
  acceptsThinkingBlocks: boolean;
  acceptsThinkingParam:  boolean;
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

export function getCapabilities(
  provider:    string,
  model:       string,
  customType?: "anthropic" | "openai",
): DestinationCapabilities {
  // openai-like translation already drops thinking blocks via anthropicContentToText
  if (customType === "openai") {
    return { acceptsThinkingBlocks: false, acceptsThinkingParam: false };
  }
  // Non-Anthropic native: signature bound to Anthropic account/model is meaningless here
  if (provider !== "anthropic") {
    return { acceptsThinkingBlocks: false, acceptsThinkingParam: false };
  }
  // Anthropic + model that rejects thinking
  if (!modelSupportsThinking(model)) {
    return { acceptsThinkingBlocks: false, acceptsThinkingParam: false };
  }
  // Anthropic + thinking-capable: preserve for extended-thinking caching
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
    /thinking[^a-z]*(is\s+)?not\s+supported/.test(msg)
  );
}
