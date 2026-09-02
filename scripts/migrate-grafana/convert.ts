// Converts one cached grafana.com dashboard (.cache/grafana/{id}.json) to Datadog JSON + report.
//   pnpm migrate:one <id|path> [--model opus|sonnet|haiku] [--refresh] [--print]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { normalizeDashboard } from "./normalize";
import { convertVariables } from "./variables";
import { extractRequests } from "./extract";
import { translateRequests, type ModelKey, type TranslateOptions } from "./llm";
import { assemble } from "./assemble";
import type { ConversionReport, DdDashboard } from "./types";
import type { CatalogItem } from "./fetch";

export type CachedGrafana = { meta: CatalogItem & { categories?: string[] }; json: unknown };

export interface ConvertOptions { model: ModelKey; refresh?: boolean; systemPrompt?: string; log?: (s: string) => void }

export async function convertDashboard(src: CachedGrafana, opts: ConvertOptions): Promise<{ dashboard: DdDashboard; report: ConversionReport }> {
  const norm = normalizeDashboard(src.json);
  const vars = convertVariables(norm.variables);
  const requests = extractRequests(norm, vars);
  const t: TranslateOptions = { model: opts.model, refresh: opts.refresh, systemPrompt: opts.systemPrompt, log: opts.log };
  const { results, stats } = await translateRequests(requests, t);
  const meta = {
    grafanaId: src.meta.id,
    sourceUrl: `https://grafana.com/grafana/dashboards/${src.meta.id}`,
    orgName: src.meta.orgName || src.meta.orgSlug || "unknown",
    model: opts.model,
    llm: { calls: stats.calls, retries: stats.retries, validationFailures: stats.validationFailures, cached: stats.cached },
  };
  return assemble(norm, vars, results, meta);
}

export function loadCached(idOrPath: string): CachedGrafana {
  const path = existsSync(idOrPath) ? idOrPath : `.cache/grafana/${idOrPath}.json`;
  const raw = JSON.parse(readFileSync(path, "utf8")) as CachedGrafana | Record<string, unknown>;
  if ("meta" in raw && "json" in raw) return raw as CachedGrafana;
  // bare Grafana JSON (fixtures): synthesize meta
  const id = Number((raw as { gnetId?: number }).gnetId ?? 0);
  return { meta: { id, slug: String((raw as { uid?: string }).uid ?? id), name: String((raw as { title?: string }).title ?? ""), description: "", downloads: 0, revision: 1, orgSlug: "unknown", orgName: "unknown", datasource: null, collectorType: null, updatedAt: "", createdAt: "" }, json: raw };
}

export function writeOutputs(id: number, out: { dashboard: DdDashboard; report: ConversionReport }) {
  mkdirSync(".cache/datadog", { recursive: true });
  mkdirSync(".cache/reports", { recursive: true });
  writeFileSync(`.cache/datadog/${id}.json`, JSON.stringify(out.dashboard));
  writeFileSync(`.cache/reports/${id}.json`, JSON.stringify(out.report, null, 2));
}

export function summarize(r: ConversionReport): string {
  const c = r.counts;
  return `${r.title} [${r.grafanaId}] score=${r.score} panels=${c.total} native=${c.native} openmetrics=${c.openmetrics} partial=${c.partial} unsupported=${c.unsupported} llm(calls=${r.llm.calls} retries=${r.llm.retries} invalid=${r.llm.validationFailures} cached=${r.llm.cached}) unmapped=${r.unmappedMetrics.length}`;
}

if (process.argv[1]?.endsWith("convert.ts")) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const target = argv.find((a) => !a.startsWith("--") && !["opus", "sonnet", "haiku"].includes(a));
  if (!target) { console.error("usage: convert.ts <id|path> [--model opus|sonnet|haiku] [--refresh] [--print]"); process.exit(2); }
  const model = (flag("model") ?? "sonnet") as ModelKey;
  const src = loadCached(target);
  convertDashboard(src, { model, refresh: argv.includes("--refresh"), log: (s) => process.stderr.write(s + "\n") })
    .then((out) => {
      writeOutputs(src.meta.id, out);
      process.stderr.write(summarize(out.report) + "\n");
      if (argv.includes("--print")) process.stdout.write(JSON.stringify(out.dashboard, null, 2) + "\n");
    })
    .catch((e) => { console.error(e); process.exit(1); });
}
