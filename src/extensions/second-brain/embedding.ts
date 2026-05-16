import { FlagEmbedding, EmbeddingModel } from "fastembed";
import fs from "node:fs";
import path from "node:path";

let modelInstance: FlagEmbedding | null = null;
let initPromise: Promise<FlagEmbedding> | null = null;

const CACHE_DIR = process.env.SB_EMBED_CACHE_DIR || path.resolve(process.cwd(), "local_cache/fastembed");

export async function initEmbedding(): Promise<FlagEmbedding> {
  if (modelInstance) return modelInstance;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch {}
    const t0 = Date.now();
    console.log(`[second-brain] loading embedding model bge-small-en-v1.5 (cacheDir=${CACHE_DIR})...`);
    const m = await FlagEmbedding.init({
      model:    EmbeddingModel.BGESmallENV15,
      cacheDir: CACHE_DIR,
    });
    console.log(`[second-brain] embedding model ready in ${Date.now() - t0}ms`);
    modelInstance = m;
    initPromise = null;
    return m;
  })();
  return initPromise;
}

export async function embedText(text: string): Promise<number[]> {
  const m = await initEmbedding();
  const it = m.embed([text], 1);
  for await (const batch of it) {
    for (const emb of batch) return Array.from(emb);
  }
  throw new Error("no embedding produced");
}

export async function embedBatch(texts: string[], batchSize = 16): Promise<number[][]> {
  if (!texts.length) return [];
  const m = await initEmbedding();
  const out: number[][] = [];
  for await (const batch of m.embed(texts, batchSize)) {
    for (const emb of batch) out.push(Array.from(emb));
  }
  return out;
}

export function vectorLiteral(vec: number[]): string {
  return "[" + vec.join(",") + "]";
}

export function disposeEmbedding(): void {
  modelInstance = null;
  initPromise = null;
}
