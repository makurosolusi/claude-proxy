import type { ProxyContext, PostRequestContext, PreRequestResult } from "../types";

export async function preRequest(_ctx: ProxyContext): Promise<PreRequestResult | null> {
  // Implemented in Fase B2 (semantic cache) and B4 (strategy injection).
  return null;
}

export async function postRequest(_ctx: ProxyContext, _post: PostRequestContext): Promise<void> {
  // Implemented in Fase B2 (cache write) and B3 (mining trigger).
}
