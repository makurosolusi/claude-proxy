import type { TokenEntry } from "../types";

export interface ProxyContext {
  req:           Request;
  url:           URL;
  key:           string;
  token:         TokenEntry;
  bodyJson:      any;
  provider:      string;
  model:         string;
  systemPrompt:  string;
  messages:      any[];
}

export interface PostRequestContext {
  status:        number;
  inputTokens:   number;
  outputTokens:  number;
  durationMs:    number;
  responseText:  string;
  stopReason:    string;
}

export interface PreRequestResult {
  intercept?:    Response;
  modifiedBody?: any;
}

export interface ExtensionHooks {
  preRequest?:   (ctx: ProxyContext) => Promise<PreRequestResult | null>;
  postRequest?:  (ctx: ProxyContext, post: PostRequestContext) => Promise<void>;
}

export interface EnableResult {
  ok:     boolean;
  error?: string;
}

export interface Extension {
  id:          string;
  name:        string;
  version:     string;
  description: string;
  hooks?:      ExtensionHooks;
  onEnable?:   () => Promise<EnableResult>;
  onDisable?:  () => Promise<void>;
  startWorker?: () => Promise<void>;
  stopWorker?:  () => Promise<void>;
  adminTabId?:  string;
}

export interface ExtensionInfo {
  id:          string;
  name:        string;
  version:     string;
  description: string;
  enabled:     boolean;
  config:      Record<string, any>;
  adminTabId?: string;
  installed_at: number;
  updated_at:   number;
}
