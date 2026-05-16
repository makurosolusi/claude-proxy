import { embedText, initEmbedding } from "../src/extensions/second-brain/embedding";
import { hashPrompt, lookupCacheExact, lookupCacheSimilar, writeCache } from "../src/extensions/second-brain/cache";
import { prisma } from "../src/prisma";

console.log("init embedding...");
await initEmbedding();

const prompt1 = "lanjutkan codingan untuk socket io agar bisa real time di project bun";
const prompt2 = "lanjutkan codingan untuk websocket real time di project bun";
const prompt3 = "buat database schema untuk user authentication";

const vec1 = await embedText(prompt1);
console.log("vec1 dim:", vec1.length);

await writeCache({
  prompt: prompt1, promptVec: vec1,
  responseText: "Test: implement WS at /ws endpoint with Bun native.",
  inputTokens: 100, outputTokens: 50, model: "claude-sonnet-4-6", provider: "anthropic",
  userId: "test-user", scope: "user", ttlMs: 3600_000,
});
console.log("✓ wrote cache");

const exact = await lookupCacheExact(hashPrompt(prompt1), "test-user", "user");
console.log("exact:", exact ? `HIT ${exact.response_text.slice(0, 50)}` : "MISS");

const vec2 = await embedText(prompt2);
const sim = await lookupCacheSimilar(vec2, "test-user", "user", 0.7);
console.log("semantic similar:", sim ? `HIT sim=${sim.similarity.toFixed(3)}` : "MISS");

const vec3 = await embedText(prompt3);
const diff = await lookupCacheSimilar(vec3, "test-user", "user", 0.7);
console.log("semantic different (threshold 0.7):", diff ? `WRONG HIT sim=${diff.similarity.toFixed(3)}` : "MISS (correct)");

const diff2 = await lookupCacheSimilar(vec3, "test-user", "user", 0.5);
console.log("semantic different (threshold 0.5):", diff2 ? `HIT sim=${diff2.similarity.toFixed(3)}` : "MISS");

await prisma.$executeRawUnsafe(`DELETE FROM sb_prompt_cache WHERE user_id = 'test-user'`);
console.log("✓ cleanup");
process.exit(0);
