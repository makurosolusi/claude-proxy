import { prisma } from "../prisma";
import type {
  Extension, ExtensionInfo, ProxyContext, PostRequestContext, PreRequestResult,
} from "./types";

const registered = new Map<string, Extension>();
const enabledIds = new Set<string>();
const configs    = new Map<string, Record<string, any>>();
const installedAt = new Map<string, number>();
const updatedAt   = new Map<string, number>();

export function registerExtension(ext: Extension): void {
  if (registered.has(ext.id)) {
    console.warn(`[ext] duplicate register: ${ext.id} — ignored`);
    return;
  }
  registered.set(ext.id, ext);
  console.log(`[ext] registered ${ext.id} v${ext.version}`);
}

export function getExtension(id: string): Extension | undefined {
  return registered.get(id);
}

export function isEnabled(id: string): boolean {
  return enabledIds.has(id);
}

export function getConfig(id: string): Record<string, any> {
  return configs.get(id) || {};
}

export async function loadEnabledFromDb(): Promise<void> {
  const rows = await prisma.extensions.findMany();
  const now = Date.now();
  for (const r of rows) {
    let cfg: Record<string, any> = {};
    try { cfg = JSON.parse(r.config || "{}"); } catch {}
    configs.set(r.id, cfg);
    installedAt.set(r.id, Number(r.installed_at));
    updatedAt.set(r.id, Number(r.updated_at));
    if (!r.enabled) continue;
    const ext = registered.get(r.id);
    if (!ext) {
      console.warn(`[ext] db says ${r.id} enabled but extension not registered`);
      continue;
    }
    try {
      if (ext.onEnable) {
        const res = await ext.onEnable();
        if (!res.ok) {
          console.warn(`[ext] ${r.id} onEnable refused: ${res.error}`);
          await prisma.extensions.update({ where: { id: r.id }, data: { enabled: false, updated_at: BigInt(now) } });
          continue;
        }
      }
      enabledIds.add(r.id);
      if (ext.startWorker) await ext.startWorker().catch(e => console.warn(`[ext] ${r.id} startWorker failed:`, e?.message ?? e));
      console.log(`[ext] enabled ${r.id}`);
    } catch (e: any) {
      console.error(`[ext] ${r.id} enable failed:`, e?.message ?? e);
    }
  }
}

export function listExtensions(): ExtensionInfo[] {
  return [...registered.values()].map(ext => ({
    id:           ext.id,
    name:         ext.name,
    version:      ext.version,
    description:  ext.description,
    enabled:      enabledIds.has(ext.id),
    config:       configs.get(ext.id) || {},
    adminTabId:   ext.adminTabId,
    installed_at: installedAt.get(ext.id) || 0,
    updated_at:   updatedAt.get(ext.id) || 0,
  }));
}

export async function enableExtension(id: string): Promise<{ ok: boolean; error?: string }> {
  const ext = registered.get(id);
  if (!ext) return { ok: false, error: "Extension not registered" };
  if (enabledIds.has(id)) return { ok: true };
  if (ext.onEnable) {
    const res = await ext.onEnable();
    if (!res.ok) return { ok: false, error: res.error || "onEnable failed" };
  }
  const now = Date.now();
  const inst = installedAt.get(id) || now;
  installedAt.set(id, inst);
  updatedAt.set(id, now);
  await prisma.extensions.upsert({
    where:  { id },
    create: { id, name: ext.name, version: ext.version, enabled: true, config: JSON.stringify(configs.get(id) || {}), installed_at: BigInt(inst), updated_at: BigInt(now) },
    update: { name: ext.name, version: ext.version, enabled: true, updated_at: BigInt(now) },
  });
  enabledIds.add(id);
  if (ext.startWorker) ext.startWorker().catch(e => console.warn(`[ext] ${id} startWorker failed:`, e?.message ?? e));
  return { ok: true };
}

export async function disableExtension(id: string): Promise<{ ok: boolean; error?: string }> {
  const ext = registered.get(id);
  if (!ext) return { ok: false, error: "Extension not registered" };
  if (!enabledIds.has(id)) return { ok: true };
  enabledIds.delete(id);
  if (ext.stopWorker) await ext.stopWorker().catch(e => console.warn(`[ext] ${id} stopWorker failed:`, e?.message ?? e));
  if (ext.onDisable)  await ext.onDisable().catch(e => console.warn(`[ext] ${id} onDisable failed:`, e?.message ?? e));
  const now = Date.now();
  updatedAt.set(id, now);
  await prisma.extensions.update({
    where: { id },
    data:  { enabled: false, updated_at: BigInt(now) },
  });
  return { ok: true };
}

export async function updateExtensionConfig(id: string, patch: Record<string, any>): Promise<{ ok: boolean; error?: string; config?: Record<string, any> }> {
  const ext = registered.get(id);
  if (!ext) return { ok: false, error: "Extension not registered" };
  const cur = configs.get(id) || {};
  const next = { ...cur, ...patch };
  configs.set(id, next);
  const now = Date.now();
  updatedAt.set(id, now);
  await prisma.extensions.upsert({
    where:  { id },
    create: { id, name: ext.name, version: ext.version, enabled: false, config: JSON.stringify(next), installed_at: BigInt(now), updated_at: BigInt(now) },
    update: { config: JSON.stringify(next), updated_at: BigInt(now) },
  });
  return { ok: true, config: next };
}

export async function runPreRequest(ctx: ProxyContext): Promise<PreRequestResult | null> {
  if (!enabledIds.size) return null;
  for (const id of enabledIds) {
    const ext = registered.get(id);
    if (!ext?.hooks?.preRequest) continue;
    try {
      const res = await ext.hooks.preRequest(ctx);
      if (res?.intercept) return res;
      if (res?.modifiedBody) {
        ctx.bodyJson = res.modifiedBody;
        ctx.messages = res.modifiedBody?.messages || ctx.messages;
      }
    } catch (e: any) {
      console.warn(`[ext] ${id} preRequest error:`, e?.message ?? e);
    }
  }
  return ctx.bodyJson ? { modifiedBody: ctx.bodyJson } : null;
}

export async function runPostRequest(ctx: ProxyContext, post: PostRequestContext): Promise<void> {
  if (!enabledIds.size) return;
  for (const id of enabledIds) {
    const ext = registered.get(id);
    if (!ext?.hooks?.postRequest) continue;
    try {
      await ext.hooks.postRequest(ctx, post);
    } catch (e: any) {
      console.warn(`[ext] ${id} postRequest error:`, e?.message ?? e);
    }
  }
}
