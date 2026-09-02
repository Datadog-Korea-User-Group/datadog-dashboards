// PromQL -> Datadog translation through local Claude Code (`claude -p`, subscription auth).
// Global per-expression cache under .cache/llm/expr so identical expressions are translated once across all dashboards.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import type { TranslationRequest, TranslationResult } from "./types";
import { requestKey } from "./extract";
import { validateResult } from "./validate";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMPT_DIR = join(HERE, "prompt");
export const MODEL_IDS = { opus: "claude-opus-5", sonnet: "claude-sonnet-5", haiku: "claude-haiku-4-5-20251001" } as const;
export type ModelKey = keyof typeof MODEL_IDS;

type MappingEntry = { prom: string; match?: Record<string, string>; dd: string; kind: string; scale?: number; tags?: Record<string, string>; note?: string };

export function buildSystemPrompt(): string {
  const tpl = readFileSync(join(PROMPT_DIR, "system.md"), "utf8");
  const tables: string[] = [];
  for (const f of readdirSync(join(PROMPT_DIR, "mappings")).sort()) {
    if (!f.endsWith(".json") || f.startsWith("_")) continue;
    const m = JSON.parse(readFileSync(join(PROMPT_DIR, "mappings", f), "utf8")) as { integration: string; description: string; entries: MappingEntry[] };
    const rows = m.entries.map((e) => {
      const match = e.match ? Object.entries(e.match).map(([k, v]) => `${k}="${v}"`).join(",") : "";
      const tags = e.tags ? Object.entries(e.tags).map(([k, v]) => `${k}->${v}`).join(" ") : "";
      return `| ${e.prom}${match ? `{${match}}` : ""} | ${e.dd} | ${e.kind}${e.scale ? ` x${e.scale}` : ""} | ${tags} | ${e.note ?? ""} |`;
    });
    tables.push(`### ${m.integration}\n${m.description}\n\n| Prometheus | Datadog | kind | tag renames | note |\n|---|---|---|---|---|\n${rows.join("\n")}`);
  }
  const tags = JSON.parse(readFileSync(join(PROMPT_DIR, "mappings", "_tags.json"), "utf8")) as { tags: Record<string, string> };
  const tagLine = `Default label -> tag renames for native metrics: ${Object.entries(tags.tags).map(([k, v]) => `${k}->${v}`).join(", ")}.`;
  const examples = JSON.parse(readFileSync(join(PROMPT_DIR, "examples.json"), "utf8")) as { input: unknown; output: unknown }[];
  const ex = examples.map((e) => `Input: ${JSON.stringify(e.input)}\nOutput: ${JSON.stringify(e.output)}`).join("\n\n");
  return tpl.replace("MAPPINGS_TABLE", `${tagLine}\n\n${tables.join("\n\n")}`).replace("EXAMPLES", ex);
}

export function outputSchema(): string {
  return readFileSync(join(PROMPT_DIR, "schema.json"), "utf8");
}

export class ClaudeError extends Error {
  constructor(message: string, public readonly fatal = false, public readonly rateLimited = false) { super(message); }
}

/** One `claude -p` call. Returns the parsed structured output. */
export async function callClaude(model: string, systemPrompt: string, input: unknown, opts: { timeoutMs?: number } = {}): Promise<{ items: TranslationResult[] }> {
  const args = [
    "-p", "--no-session-persistence", "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--setting-sources", "", "--disable-slash-commands", "--no-chrome", "--max-turns", "1",
    "--model", model, "--output-format", "json", "--json-schema", outputSchema(), "--system-prompt", systemPrompt,
  ];
  const env = { ...process.env };
  delete env.CLAUDECODE; // allow nesting from inside a Claude Code session
  const child = spawn("claude", args, { env, stdio: ["pipe", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? 300_000);
  child.stdin.end(JSON.stringify(input));
  const code: number = await new Promise((res) => child.on("close", (c) => res(c ?? -1)));
  clearTimeout(timer);
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(out) as Record<string, unknown>; } catch {
    throw new ClaudeError(`claude exited ${code}; unparsable output: ${out.slice(0, 300)} ${err.slice(0, 300)}`);
  }
  if (parsed.is_error) {
    const msg = String(parsed.result ?? "");
    const fatal = /not logged in|login/i.test(msg);
    const rl = /rate.?limit|usage limit|overloaded|too many|429|529|capacity/i.test(msg);
    throw new ClaudeError(`claude error: ${msg.slice(0, 300)}`, fatal, rl);
  }
  const so = parsed.structured_output as { items?: TranslationResult[] } | undefined;
  if (so?.items) return { items: so.items };
  const text = String(parsed.result ?? "").replace(/^```(?:json)?\s*|\s*```$/g, "");
  const j = JSON.parse(text) as { items?: TranslationResult[] };
  if (!j.items) throw new ClaudeError("no items in output");
  return { items: j.items };
}

export interface TranslateStats { calls: number; retries: number; validationFailures: number; cached: number; inputTokens: number }

export interface TranslateOptions { model: ModelKey; cacheDir?: string; chunkSize?: number; refresh?: boolean; systemPrompt?: string; log?: (s: string) => void }

async function withBackoff<T>(fn: () => Promise<T>, log: (s: string) => void): Promise<T> {
  const wait = 60_000;
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); } catch (e) {
      const ce = e instanceof ClaudeError ? e : new ClaudeError(String(e));
      if (ce.fatal) throw ce;
      if (attempt >= 8) throw ce;
      const delay = ce.rateLimited ? Math.min(wait * 2 ** (attempt - 1), 3_600_000) : Math.min(5_000 * attempt, 60_000);
      log(`claude call failed (${ce.message.slice(0, 120)}); retry ${attempt} in ${Math.round(delay / 1000)}s`);
      await sleep(delay);
    }
  }
}

/** Translates all requests, using and filling the expression cache. Never throws for a single bad item: it becomes `unsupported`. */
export async function translateRequests(requests: TranslationRequest[], opts: TranslateOptions): Promise<{ results: Map<string, TranslationResult>; stats: TranslateStats }> {
  const cacheDir = opts.cacheDir ?? ".cache/llm/expr";
  mkdirSync(cacheDir, { recursive: true });
  const log = opts.log ?? (() => {});
  const systemPrompt = opts.systemPrompt ?? buildSystemPrompt();
  const stats: TranslateStats = { calls: 0, retries: 0, validationFailures: 0, cached: 0, inputTokens: 0 };
  const results = new Map<string, TranslationResult>();
  const keyOf = new Map<string, string>();
  const pending: TranslationRequest[] = [];
  const seenKeys = new Map<string, TranslationRequest[]>(); // dedupe identical expressions within this batch

  for (const r of requests) {
    const key = requestKey(r);
    keyOf.set(r.id, key);
    const file = join(cacheDir, `${key}.json`);
    if (!opts.refresh && existsSync(file)) {
      try {
        const cached = JSON.parse(readFileSync(file, "utf8")) as TranslationResult;
        results.set(r.id, { ...cached, id: r.id });
        stats.cached++;
        continue;
      } catch { /* fall through */ }
    }
    const group = seenKeys.get(key);
    if (group) { group.push(r); continue; }
    seenKeys.set(key, [r]);
    pending.push(r);
  }

  const chunkSize = opts.chunkSize ?? 40;
  const finalize = (req: TranslationRequest, res: TranslationResult) => {
    const key = keyOf.get(req.id)!;
    writeFileSync(join(cacheDir, `${key}.json`), JSON.stringify({ ...res, id: "" }));
    for (const r of seenKeys.get(key) ?? [req]) results.set(r.id, { ...res, id: r.id });
  };

  for (let i = 0; i < pending.length; i += chunkSize) {
    const chunk = pending.slice(i, i + chunkSize);
    let toSend = chunk.map((r) => ({ ...r }));
    let errors = new Map<string, string>();
    for (let round = 0; round < 2 && toSend.length; round++) {
      const input = { items: toSend.map((r) => (errors.has(r.id) ? { ...r, previousAttemptError: errors.get(r.id) } : r)) };
      stats.calls++; if (round > 0) stats.retries++;
      const out = await withBackoff(() => callClaude(MODEL_IDS[opts.model], systemPrompt, input), log);
      const byId = new Map(out.items.map((it) => [it.id, it]));
      const next: TranslationRequest[] = [];
      const nextErrors = new Map<string, string>();
      for (const req of toSend) {
        const res = byId.get(req.id);
        const err = res ? validateResult(res) : "missing from model output";
        if (!err && res) { finalize(req, normalizeResult(res)); continue; }
        stats.validationFailures++;
        if (round === 0) { next.push(req); nextErrors.set(req.id, err ?? "invalid"); }
        else finalize(req, { id: req.id, status: "unsupported", queries: [], formula: "", unmappedMetrics: [], notes: [`translation failed validation: ${err}`] });
      }
      toSend = next; errors = nextErrors;
    }
    log(`translated chunk ${Math.min(i + chunkSize, pending.length)}/${pending.length} (calls=${stats.calls} retries=${stats.retries} invalid=${stats.validationFailures})`);
  }
  return { results, stats };
}

function normalizeResult(r: TranslationResult): TranslationResult {
  return {
    id: r.id,
    status: r.status,
    queries: (r.queries ?? []).map((q) => ({ name: q.name, query: q.query.trim(), ...(q.aggregator ? { aggregator: q.aggregator } : {}) })),
    formula: (r.formula ?? "").trim(),
    ...(r.tagRenames && Object.keys(r.tagRenames).length ? { tagRenames: r.tagRenames } : {}),
    unmappedMetrics: Array.from(new Set(r.unmappedMetrics ?? [])),
    notes: (r.notes ?? []).filter(Boolean),
  };
}
