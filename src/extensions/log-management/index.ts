import { registerExtension } from "../registry";
import type { Extension } from "../types";
import { onEnable, onDisable } from "./lifecycle";

const ext: Extension = {
  id:          "log-management",
  name:        "Log Management",
  version:     "0.1.0",
  description: "Persist console output to the database with configurable retention (default 7 days). Adds queryable, searchable app logs surfaced via admin UI and MCP proxy-stg tools. Survives restarts unlike the in-memory ring buffer.",
  onEnable,
  onDisable,
  adminTabId:  "logs",
};

registerExtension(ext);
export default ext;
