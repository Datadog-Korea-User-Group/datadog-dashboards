// Converts every cached grafana.com dashboard in download order, resumable.
//   pnpm migrate:convert [--model opus|sonnet|haiku] [--top N] [--skip N] [--concurrency 2] [--force] [--ids 1860,14584]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildSystemPrompt, type ModelKey } from "./llm";
import { convertDashboard, loadCached, summarize, writeOutputs } from "./convert";
import type { CatalogItem } from "./fetch";
import type { ConversionReport } from "./types";

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const model = (flag("model") ?? "sonnet") as ModelKey;
const top = Number(flag("top") ?? Infinity);
const skip = Number(flag("skip") ?? 0);
const concurrency = Number(flag("concurrency") ?? 2);
const force = argv.includes("--force");
const onlyIds = flag("ids")?.split(",").map(Number);

async function main() {
  const catalog = JSON.parse(readFileSync(".cache/grafana/catalog.json", "utf8")) as CatalogItem[];
  let todo = catalog.slice(skip, skip + (Number.isFinite(top) ? top : catalog.length));
  if (onlyIds) todo = catalog.filter((c) => onlyIds.includes(c.id));
  todo = todo.filter((c) => existsSync(`.cache/grafana/${c.id}.json`) && (force || !existsSync(`.cache/datadog/${c.id}.json`)));
  process.stderr.write(`model=${model} todo=${todo.length} concurrency=${concurrency}\n`);
  mkdirSync(".cache/reports", { recursive: true });
  const systemPrompt = buildSystemPrompt();
  const failures: { id: number; error: string }[] = [];
  let done = 0;
  const started = Date.now();
  const worker = async () => {
    for (;;) {
      const item = todo.shift();
      if (!item) return;
      try {
        const src = loadCached(String(item.id));
        const out = await convertDashboard(src, { model, refresh: false, systemPrompt, log: (s) => process.stderr.write(`[${item.id}] ${s}\n`) });
        writeOutputs(item.id, out);
        done++;
        const rate = done / ((Date.now() - started) / 60000);
        process.stderr.write(`(${done}, ${rate.toFixed(1)}/min, left=${todo.length}) ${summarize(out.report)}\n`);
      } catch (e) {
        const msg = String(e);
        failures.push({ id: item.id, error: msg });
        process.stderr.write(`[${item.id}] FAILED ${msg.slice(0, 200)}\n`);
        if (/not logged in/i.test(msg)) { process.stderr.write("fatal: claude not logged in\n"); process.exit(3); }
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  writeFileSync(".cache/reports/_failures.json", JSON.stringify(failures, null, 2));
  writeSummary();
}

export function writeSummary() {
  const catalog = JSON.parse(readFileSync(".cache/grafana/catalog.json", "utf8")) as CatalogItem[];
  const dist = { native: 0, openmetrics: 0, partial: 0, unsupported: 0, panels: 0, dashboards: 0 };
  const scores: number[] = [];
  const unmapped = new Map<string, number>();
  const byModel: Record<string, number> = {};
  for (const c of catalog) {
    const f = `.cache/reports/${c.id}.json`;
    if (!existsSync(f)) continue;
    const r = JSON.parse(readFileSync(f, "utf8")) as ConversionReport;
    dist.dashboards++; dist.panels += r.counts.total;
    dist.native += r.counts.native; dist.openmetrics += r.counts.openmetrics; dist.partial += r.counts.partial; dist.unsupported += r.counts.unsupported;
    scores.push(r.score);
    byModel[r.model] = (byModel[r.model] ?? 0) + 1;
    for (const u of r.unmappedMetrics) unmapped.set(u.metric, (unmapped.get(u.metric) ?? 0) + u.count);
  }
  const summary = {
    ...dist, byModel,
    avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
    scoreBands: { good: scores.filter((s) => s >= 80).length, fair: scores.filter((s) => s >= 50 && s < 80).length, poor: scores.filter((s) => s < 50).length },
    topUnmapped: [...unmapped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100).map(([metric, count]) => ({ metric, count })),
  };
  writeFileSync(".cache/reports/_summary.json", JSON.stringify(summary, null, 2));
  process.stderr.write(`summary: dashboards=${summary.dashboards} panels=${summary.panels} avgScore=${summary.avgScore} bands=${JSON.stringify(summary.scoreBands)} native=${dist.native} openmetrics=${dist.openmetrics} partial=${dist.partial} unsupported=${dist.unsupported}\n`);
}

if (process.argv[1]?.endsWith("convert-all.ts")) main().catch((e) => { console.error(e); process.exit(1); });
