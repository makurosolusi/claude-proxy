import { registerExtension, loadEnabledFromDb } from "./registry";

export * from "./types";
export {
  registerExtension, getExtension, isEnabled, getConfig,
  listExtensions, enableExtension, disableExtension, updateExtensionConfig,
  runPreRequest, runPostRequest,
} from "./registry";

export async function bootstrapExtensions(): Promise<void> {
  // Built-in extensions self-register here. Each extension is isolated under
  // src/extensions/<id>/index.ts and calls registerExtension() at import time.
  // Add new extension imports below. Keep order alphabetical for stability.

  await import("./second-brain");

  await loadEnabledFromDb();
}
