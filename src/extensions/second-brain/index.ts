import { registerExtension } from "../registry";
import type { Extension } from "../types";
import { onEnable, onDisable } from "./lifecycle";
import { preRequest, postRequest } from "./hooks";

const ext: Extension = {
  id:          "second-brain",
  name:        "Second Brain",
  version:     "0.1.0",
  description: "Semantic prompt cache + strategy memory mined from successful sessions. Helps cheaper models like DeepSeek behave more like Claude by injecting learned patterns, while reducing token cost via cache hits on repeated prompts.",
  hooks:       { preRequest, postRequest },
  onEnable,
  onDisable,
  adminTabId:  "brain",
};

registerExtension(ext);
export default ext;
