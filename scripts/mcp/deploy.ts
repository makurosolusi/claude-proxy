#!/usr/bin/env bun
/**
 * MCP Deploy Server — deploy-stg
 * Pipeline: stg → GHCR (publish.yml) → Portainer (re-pull.yml) → verify
 * Standalone — tidak mengimpor dari src/
 */

import { execSync }                    from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

// ── Konstanta project ────────────────────────────────────────────────────────
const REPO        = process.env.GH_REPO ?? (() => {
  try {
    const url = execSync("git remote get-url origin", { encoding: "utf8" }).trim();
    const m = url.match(/github\.com[/:](.+?\/.+?)(?:\.git)?$/);
    if (m) return m[1];
  } catch {}
  return "bipprojectbali/claude-proxy";
})();
const BRANCH      = "stg";
const STACK_NAME  = process.env.STACK_NAME  ?? "claude-proxy";
const STACK_ENV   = process.env.ENV         ?? "stg";
const STAGING_URL = process.env.BASE_URL    ?? "https://claude-proxy.wibudev.com";
const PKG_PATH    = "package.json";

// ── Utilitas ─────────────────────────────────────────────────────────────────
function run(cmd: string): string {
  return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}
function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }
function log(...a: unknown[]) { process.stderr.write(a.join(" ") + "\n"); }
function send(obj: Record<string, unknown>) { process.stdout.write(JSON.stringify(obj) + "\n"); }

function bumpVersion(v: string, bump: "patch" | "minor" | "major"): string {
  const [maj, min, pat] = v.split(".").map(Number);
  if (bump === "major") return `${(maj ?? 0) + 1}.0.0`;
  if (bump === "minor") return `${maj ?? 0}.${(min ?? 0) + 1}.0`;
  return `${maj ?? 0}.${min ?? 0}.${(pat ?? 0) + 1}`;
}
function readPkg(): Record<string, unknown> & { version: string } {
  return JSON.parse(readFileSync(PKG_PATH, "utf8")) as Record<string, unknown> & { version: string };
}

// ── Credential scanner ────────────────────────────────────────────────────────
const CRED_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "anthropic_key",       re: /sk-ant-[a-zA-Z0-9\-_]{20,}/g },
  { name: "openai_key",          re: /sk-[a-zA-Z0-9]{48}/g },
  { name: "stripe_key",          re: /sk_(live|test)_[a-zA-Z0-9]{24,}/g },
  { name: "github_pat",          re: /ghp_[a-zA-Z0-9]{36,}/g },
  { name: "github_oauth",        re: /gho_[a-zA-Z0-9]{36,}/g },
  { name: "github_fine_grained", re: /github_pat_[a-zA-Z0-9_]{22,}/g },
  { name: "slack_token",         re: /xox[baprs]-[a-zA-Z0-9\-]{20,}/g },
  { name: "google_api_key",      re: /AIza[a-zA-Z0-9\-_]{35}/g },
  { name: "google_oauth_token",  re: /ya29\.[a-zA-Z0-9\-_]{20,}/g },
  { name: "private_key_pem",     re: /-----BEGIN [A-Z ]+ PRIVATE KEY-----/g },
  { name: "bearer_hardcoded",    re: /Bearer\s+[a-zA-Z0-9\-_\.]{20,}/g },
  { name: "db_url_with_creds",   re: /(postgres|mysql|mongodb|redis):\/\/[^:]+:[^@]+@/g },
  { name: "hardcoded_secret",    re: /(password|secret|token)\s*[:=]\s*["'][^"']{8,}["']/gi },
];

const SENSITIVE_FILE_PATTERNS: RegExp[] = [
  /^\.env(\.|$)/i,
  /\.(pem|key|p12|pfx|jks)$/i,
  /credentials?\.(json|ya?ml)$/i,
  /service.?account\.json$/i,
  /^id_rsa(\.pub)?$/,
  /^id_ed25519(\.pub)?$/,
];

type CredIssue = { type: string; sample: string; count: number };

function scanCredentials(diff: string): CredIssue[] {
  return CRED_PATTERNS.flatMap(({ name, re }) => {
    const matches = diff.match(re);
    return matches?.length
      ? [{ type: name, sample: (matches[0]?.slice(0, 20) ?? "") + "***", count: matches.length }]
      : [];
  });
}

function scanSensitiveFiles(): string[] {
  try {
    const files = run(`git diff --name-only origin/${BRANCH}..HEAD`).trim().split("\n").filter(Boolean);
    return files.filter(f => {
      const base = f.split("/").pop() ?? f;
      return SENSITIVE_FILE_PATTERNS.some(re => re.test(base));
    });
  } catch { return []; }
}

function getDiff(): string {
  try {
    return run(
      `git diff origin/${BRANCH}..HEAD -- . ":(exclude)*.lock" ":(exclude)package-lock.json" ` +
      `| grep '^+' | grep -v '^+++'`
    );
  } catch { return ""; }
}

// ── GHA helpers ───────────────────────────────────────────────────────────────
async function getLatestRunId(workflow: string): Promise<number> {
  for (let i = 0; i < 12; i++) {
    await sleep(5_000);
    try {
      const runs = JSON.parse(
        run(`gh run list --repo ${REPO} --workflow=${workflow} --limit=1 --json databaseId,status`)
      ) as { databaseId: number; status: string }[];
      const id = runs[0]?.databaseId;
      if (id) return id;
    } catch { log(`[getRunId] retry ${i + 1}/12 for ${workflow}…`); }
  }
  throw new Error(`Timeout waiting for run ID: ${workflow}`);
}

async function pollRun(runId: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(8_000);
    try {
      const r = JSON.parse(
        run(`gh run view ${runId} --repo ${REPO} --json status,conclusion`)
      ) as { status: string; conclusion: string };
      log(`[poll] run ${runId}: ${r.status}/${r.conclusion}`);
      if (r.status === "completed") return r.conclusion === "success";
    } catch (e: any) { log(`[poll] error: ${e.message}`); }
  }
  return false;
}

async function verifyVersion(expected: string): Promise<boolean> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await sleep(5_000);
    try {
      const res  = await fetch(`${STAGING_URL}/api/version`);
      const data = await res.json() as { version?: string };
      if (data.version === expected) return true;
      log(`[verify] got ${data.version ?? "?"}, want ${expected}`);
    } catch { log("[verify] fetch failed, retrying…"); }
  }
  return false;
}

// ── Tool implementations ──────────────────────────────────────────────────────
type Step = { step: string; status: "ok" | "failed" | "blocked" | "skipped" | "timeout"; detail?: string; issues?: CredIssue[]; sensitive_files?: string[] };

async function toolPreflight() {
  const branch         = run("git branch --show-current").trim();
  const dirty          = run("git status --porcelain").trim() !== "";
  const diff           = getDiff();
  const credIssues     = scanCredentials(diff);
  const sensitiveFiles = scanSensitiveFiles();
  const safe           = credIssues.length === 0 && sensitiveFiles.length === 0 && !dirty;
  return {
    branch,
    working_tree_clean:  !dirty,
    credential_scan:     { ok: credIssues.length === 0,     issues: credIssues },
    sensitive_files:     { ok: sensitiveFiles.length === 0, files: sensitiveFiles },
    deploy_safe: safe,
  };
}

async function toolCheckVersion() {
  const local = readPkg().version;
  let target: string | null = null, targetError: string | null = null;
  try {
    const data = await (await fetch(`${STAGING_URL}/api/version`)).json() as { version?: string };
    target = data.version ?? null;
  } catch (e: any) { targetError = String(e.message); }
  return { local, target, target_url: STAGING_URL, target_error: targetError, in_sync: local === target };
}

async function toolDeployStatus() {
  const list = (wf: string) => {
    try {
      return JSON.parse(
        run(`gh run list --repo ${REPO} --workflow=${wf} --limit=3 --json databaseId,status,conclusion,createdAt,displayTitle`)
      );
    } catch { return []; }
  };
  return { publish: list("publish.yml"), re_pull: list("re-pull.yml") };
}

async function toolDeploy(args: { bump?: "patch" | "minor" | "major"; skip_commit?: boolean }) {
  const bump       = args.bump       ?? "patch";
  const skipCommit = args.skip_commit ?? false;
  const steps: Step[] = [];

  // 1 — branch check
  const branch = run("git branch --show-current").trim();
  if (branch !== BRANCH) {
    return { success: false, blocked_by: "wrong_branch", steps,
      hint: `Harus berada di branch '${BRANCH}', saat ini di '${branch}'` };
  }

  // 2 — preflight
  const pre = await toolPreflight();
  const preDetail = [
    !pre.working_tree_clean              && "Working tree kotor — commit atau stash dulu",
    pre.credential_scan.issues.length   && `Credential leak: ${pre.credential_scan.issues.map(i => i.type).join(", ")}`,
    pre.sensitive_files.files.length    && `File sensitif terdeteksi: ${pre.sensitive_files.files.join(", ")}`,
  ].filter(Boolean).join(" · ") || undefined;

  steps.push({
    step: "preflight", status: pre.deploy_safe ? "ok" : "blocked",
    issues: pre.credential_scan.issues,
    detail: preDetail,
  });
  if (!pre.deploy_safe) {
    const blockedBy = !pre.working_tree_clean ? "dirty_tree"
      : pre.sensitive_files.files.length      ? "sensitive_file"
      : "credential_leak";
    const hint = blockedBy === "dirty_tree"
      ? "Jalankan git commit/stash, lalu deploy ulang"
      : blockedBy === "sensitive_file"
      ? `Hapus file sensitif dari commit: ${pre.sensitive_files.files.join(", ")}`
      : `Perbaiki credential leak sebelum deploy: ${pre.credential_scan.issues.map(i => i.type).join(", ")}`;
    return { success: false, blocked_by: blockedBy, steps, hint };
  }

  let version = readPkg().version;

  if (!skipCommit) {
    // 3 — version bump
    const oldVer = version;
    version = bumpVersion(oldVer, bump);
    const pkg = readPkg();
    pkg.version = version;
    writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n");
    steps.push({ step: "bump_version", status: "ok", detail: `${oldVer} → ${version}` });

    // 4 — commit & push
    run("git add package.json");
    run(`git commit -m "chore: bump ${version}"`);
    steps.push({ step: "commit", status: "ok" });
    run(`git push origin ${BRANCH}`);
    steps.push({ step: "push", status: "ok" });
  } else {
    steps.push({ step: "bump_version", status: "skipped", detail: `skip_commit=true, deploy versi ${version}` });
  }

  // 5 — trigger publish (build Docker image → GHCR)
  run(`gh workflow run publish.yml --repo ${REPO} --ref ${BRANCH} -f stack_env=${STACK_ENV} -f tag=${version}`);
  steps.push({ step: "publish_triggered", status: "ok", detail: `tag=${version} env=${STACK_ENV}` });
  log(`[deploy] publish triggered for ${version}`);

  const publishId = await getLatestRunId("publish.yml");
  log(`[deploy] publish run ID: ${publishId}`);

  // 6 — tunggu publish selesai (Docker build ~3-7 menit, timeout 10 menit)
  const publishOk = await pollRun(publishId, 600_000);
  steps.push({ step: "publish_done", status: publishOk ? "ok" : "failed",
    detail: `gh run view ${publishId} --repo ${REPO}` });
  if (!publishOk) {
    return { success: false, blocked_by: "publish_failed", steps,
      hint: `Cek log: gh run view ${publishId} --repo ${REPO}` };
  }

  // 7 — trigger re-pull (Portainer pull image baru)
  run(`gh workflow run re-pull.yml --repo ${REPO} --ref ${BRANCH} -f stack_name=${STACK_NAME} -f stack_env=${STACK_ENV}`);
  steps.push({ step: "repull_triggered", status: "ok", detail: `${STACK_NAME}-${STACK_ENV}` });
  log(`[deploy] re-pull triggered for ${STACK_NAME}-${STACK_ENV}`);

  const repullId = await getLatestRunId("re-pull.yml");
  log(`[deploy] re-pull run ID: ${repullId}`);

  // 8 — tunggu re-pull selesai (timeout 5 menit)
  const repullOk = await pollRun(repullId, 300_000);
  steps.push({ step: "repull_done", status: repullOk ? "ok" : "failed",
    detail: `gh run view ${repullId} --repo ${REPO}` });
  if (!repullOk) {
    return { success: false, blocked_by: "repull_failed", steps,
      hint: `Cek log: gh run view ${repullId} --repo ${REPO}` };
  }

  // 9 — verifikasi versi live
  const verified = await verifyVersion(version);
  steps.push({ step: "verify", status: verified ? "ok" : "timeout",
    detail: `${STAGING_URL}/api/version` });

  return { success: verified, version, target_url: STAGING_URL, steps };
}

// ── Tool registry ─────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "deploy",
    description:
      `Pipeline penuh: preflight → bump version → commit → push → ` +
      `build Docker (GHCR, publish.yml) → deploy Portainer (${STACK_NAME}-${STACK_ENV}, re-pull.yml) → verify`,
    inputSchema: {
      type: "object",
      properties: {
        bump: {
          type: "string",
          enum: ["patch", "minor", "major"],
          description: "Tipe semver bump (default: patch)",
        },
        skip_commit: {
          type: "boolean",
          description: "Skip bump + commit — deploy ulang versi yang sama",
        },
      },
    },
  },
  {
    name: "check_version",
    description: `Bandingkan versi lokal (package.json) vs live di ${STAGING_URL}`,
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "deploy_status",
    description: "Cek status run GitHub Actions terbaru untuk publish.yml dan re-pull.yml",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "preflight",
    description: "Scan credential leak di git diff tanpa melakukan deploy",
    inputSchema: { type: "object", properties: {} },
  },
];

async function callTool(name: string, args: Record<string, unknown>) {
  if (name === "deploy")        return toolDeploy(args as Parameters<typeof toolDeploy>[0]);
  if (name === "check_version") return toolCheckVersion();
  if (name === "deploy_status") return toolDeployStatus();
  if (name === "preflight")     return toolPreflight();
  throw new Error(`Unknown tool: ${name}`);
}

// ── JSON-RPC 2.0 stdio transport ──────────────────────────────────────────────
let buf = "";
process.stdin.setEncoding("utf8");

process.stdin.on("data", (chunk: string) => {
  buf += chunk;
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";
  for (const line of lines) {
    const t = line.trim();
    if (t) void handleMessage(t);
  }
});
process.stdin.on("end", () => process.exit(0));

async function handleMessage(raw: string) {
  let req: { jsonrpc: string; id: unknown; method: string; params?: Record<string, unknown> };
  try { req = JSON.parse(raw); }
  catch { return; }

  const { id, method, params } = req;
  try {
    let result: unknown;
    switch (method) {
      case "initialize":
        result = {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "deploy-stg", version: "1.0.0" },
        };
        break;
      case "notifications/initialized":
        return;
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = { tools: TOOLS };
        break;
      case "tools/call": {
        const name = String(params?.name ?? "");
        const args = (params?.arguments ?? {}) as Record<string, unknown>;
        const output = await callTool(name, args);
        result = { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] };
        break;
      }
      default:
        send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
        return;
    }
    send({ jsonrpc: "2.0", id, result });
  } catch (e: any) {
    log(`[error] method=${method}: ${e.message}`);
    send({ jsonrpc: "2.0", id, error: { code: -32603, message: String(e?.message ?? e) } });
  }
}
