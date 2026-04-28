// Shared broadcast trigger — avoids circular imports between index.tsx and handlers
export const _broadcast: { fn: (() => void) | null } = { fn: null };

export function triggerBroadcast(): void {
  _broadcast.fn?.();
}
