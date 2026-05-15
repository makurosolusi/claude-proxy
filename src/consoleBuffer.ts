// In-memory ring buffer that captures console output so MCP debug tools
// can fetch recent stdout/stderr without SSH. Also tracks uncaught error
// counters separately for runtime health reporting.

export type LogLevel = "info" | "warn" | "error";

export interface LogLine {
  ts:    number;
  level: LogLevel;
  msg:   string;
}

const MAX_LINES = 500;
const MAX_LINE_CHARS = 5000;
const buffer: LogLine[] = [];

let uncaughtCount  = 0;
let unhandledCount = 0;
let lastError: { ts: number; type: string; msg: string } | null = null;

function format(args: unknown[]): string {
  return args.map(a => {
    if (a instanceof Error) return a.stack || a.message;
    if (a === null || a === undefined) return String(a);
    if (typeof a === "object") {
      try { return JSON.stringify(a); } catch { return String(a); }
    }
    return String(a);
  }).join(" ").slice(0, MAX_LINE_CHARS);
}

function push(level: LogLevel, args: unknown[]) {
  buffer.push({ ts: Date.now(), level, msg: format(args) });
  if (buffer.length > MAX_LINES) buffer.shift();
}

// Install once at process start. Wraps console.log/warn/error to ALSO push
// into the buffer; original output to stdout/stderr is preserved.
export function installConsoleInterceptor() {
  const origLog   = console.log.bind(console);
  const origWarn  = console.warn.bind(console);
  const origError = console.error.bind(console);

  console.log = (...args: unknown[]) => { push("info", args);  origLog(...args); };
  console.warn = (...args: unknown[]) => { push("warn", args);  origWarn(...args); };
  console.error = (...args: unknown[]) => { push("error", args); origError(...args); };
}

export function readConsole(opts: { lines?: number; level?: LogLevel; since_ms?: number } = {}): LogLine[] {
  const { lines = 100, level, since_ms } = opts;
  let out: LogLine[] = buffer;
  if (since_ms != null) out = out.filter(l => l.ts >= since_ms);
  if (level) out = out.filter(l => l.level === level);
  return out.slice(-lines);
}

export function recordUncaught(err: unknown) {
  uncaughtCount++;
  const msg = err instanceof Error ? (err.stack || err.message) : String(err);
  lastError = { ts: Date.now(), type: "uncaughtException", msg: msg.slice(0, MAX_LINE_CHARS) };
}

export function recordUnhandled(reason: unknown) {
  unhandledCount++;
  const msg = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
  lastError = { ts: Date.now(), type: "unhandledRejection", msg: msg.slice(0, MAX_LINE_CHARS) };
}

export function getErrorStats() {
  return {
    uncaught_count:  uncaughtCount,
    unhandled_count: unhandledCount,
    last_error:      lastError,
  };
}
