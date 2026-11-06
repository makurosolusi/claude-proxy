import { settings, dbSaveSetting } from "./state";

export const LAST_USED_SETTING_KEY         = "credential_last_used";
export const LAST_USED_PERSIST_INTERVAL_MS = 60_000;

// Last-used lives in `settings`, never in the credential JSON: writing those files from
// the request path would race doRefresh() and could clobber a rotated refresh token.
export function createCredentialUsageTracker(opts: {
  seed: () => string | undefined;
  save: (json: string) => Promise<unknown> | unknown;
}) {
  let lastUsed: Map<string, number> | null = null;
  let lastPersistAt = -Infinity;

  // Lazy: settings are loaded from the DB at boot, after this module is imported.
  function load(): Map<string, number> {
    if (lastUsed) return lastUsed;
    lastUsed = new Map();
    const raw = opts.seed();
    if (!raw) return lastUsed;
    try {
      const obj = JSON.parse(raw);
      for (const [file, iso] of Object.entries(obj ?? {})) {
        const ms = Date.parse(String(iso));
        if (!Number.isNaN(ms)) lastUsed.set(file, ms);
      }
    } catch (e: any) {
      console.warn(`[credentialUsage] Ignoring malformed ${LAST_USED_SETTING_KEY}: ${e.message}`);
    }
    return lastUsed;
  }

  function snapshot(): Record<string, string> {
    return Object.fromEntries([...load()].map(([f, ms]) => [f, new Date(ms).toISOString()]));
  }

  function markCredentialUsed(file: string, now = Date.now()) {
    load().set(file, now);
    if (now - lastPersistAt < LAST_USED_PERSIST_INTERVAL_MS) return;
    lastPersistAt = now;
    Promise.resolve()
      .then(() => opts.save(JSON.stringify(snapshot())))
      .catch((e: any) => console.warn(`[credentialUsage] Persist ${LAST_USED_SETTING_KEY} failed: ${e?.message ?? e}`));
  }

  return { markCredentialUsed, getCredentialLastUsed: snapshot };
}

const tracker = createCredentialUsageTracker({
  seed: () => settings[LAST_USED_SETTING_KEY],
  save: json => dbSaveSetting(LAST_USED_SETTING_KEY, json),
});

export const markCredentialUsed    = tracker.markCredentialUsed;
export const getCredentialLastUsed = tracker.getCredentialLastUsed;
