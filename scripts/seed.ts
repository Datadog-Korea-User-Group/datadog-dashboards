// Seeds converted grafana.com dashboards from .cache into the database (idempotent by source_id).
//   pnpm seed [--top N] [--ids 1860,9614] [--only-created]   (--only-created: only dashboards accepted by the Datadog API)
import "./env";
import { statSync, existsSync, readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "../src/db";
import { dashboardRevisions, dashboards, type ConversionSummary } from "../src/db/schema";
import type { CatalogItem } from "./migrate-grafana/fetch";
import type { ConversionReport, DdDashboard } from "./migrate-grafana/types";

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const top = Number(flag("top") ?? Infinity);
const onlyIds = flag("ids")?.split(",").map(Number);
const onlyCreated = argv.includes("--only-created");

type Cached = { meta: CatalogItem & { categories?: string[] }; json: Record<string, unknown> };
type Created = Record<string, { ddId: string; error?: string }>;

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "dashboard";

function integrationsOf(report: ConversionReport, dash: DdDashboard): string[] {
  const set = new Set<string>();
  const widgets = dash.widgets.flatMap((w) => [w, ...(((w.definition.widgets as DdDashboard["widgets"] | undefined) ?? []))]);
  for (const w of widgets) {
    for (const r of (w.definition.requests as { queries?: { query: string }[] }[] | undefined) ?? []) {
      for (const q of r.queries ?? []) {
        const m = /^[a-z0-9]+:([a-zA-Z][a-zA-Z0-9_]*)\./.exec(q.query);
        if (m) set.add(m[1]);
      }
    }
  }
  // Only keep prefixes that look like Datadog integrations (dotted names), not OpenMetrics fallbacks
  return [...set].filter((s) => !report.unmappedMetrics.some((u) => u.metric.startsWith(s))).slice(0, 8);
}

async function main() {
  const catalog = JSON.parse(readFileSync(".cache/grafana/catalog.json", "utf8")) as CatalogItem[];
  const created: Created = existsSync(".cache/dd-created.json") ? JSON.parse(readFileSync(".cache/dd-created.json", "utf8")) : {};
  let items = catalog.slice(0, Number.isFinite(top) ? top : catalog.length);
  if (onlyIds) items = catalog.filter((c) => onlyIds.includes(c.id));
  let inserted = 0, updated = 0, skipped = 0;
  for (const c of items) {
    const ddFile = `.cache/datadog/${c.id}.json`, repFile = `.cache/reports/${c.id}.json`, srcFile = `.cache/grafana/${c.id}.json`;
    if (!existsSync(ddFile) || !existsSync(repFile) || !existsSync(srcFile)) { skipped++; continue; }
    const apiState = created[c.id];
    if (onlyCreated && !apiState?.ddId) { skipped++; continue; }
    const dash = JSON.parse(readFileSync(ddFile, "utf8")) as DdDashboard;
    const report = JSON.parse(readFileSync(repFile, "utf8")) as ConversionReport & { apiError?: string | null };
    const src = JSON.parse(readFileSync(srcFile, "utf8")) as Cached;
    const apiError = report.apiError ?? apiState?.error ?? null;
    const summary: ConversionSummary = {
      counts: report.counts,
      unmappedMetrics: report.unmappedMetrics.slice(0, 50).map((u) => ({ metric: u.metric, count: u.count })),
      unsupportedPanels: report.panels.filter((p) => p.status === "unsupported").map((p) => ({ title: p.title, grafanaType: p.grafanaType })).slice(0, 50),
      model: report.model,
      apiError,
    };
    const tags = Array.from(new Set([...(Array.isArray(src.json.tags) ? (src.json.tags as string[]) : []), ...(src.meta.categories ?? [])].map((t) => String(t).toLowerCase().trim()).filter(Boolean))).slice(0, 20);
    // ?v=<mtime> busts next/image and browser caches when a screenshot is re-captured
    const shotFile = `public/screenshots/${c.id}.webp`;
    const screenshot = existsSync(shotFile) ? `/screenshots/${c.id}.webp?v=${Math.floor(statSync(shotFile).mtimeMs / 1000)}` : null;
    const values = {
      title: c.name,
      description: (c.description || "").trim().slice(0, 500),
      readme: "", // grafana.com READMEs are not mirrored; the detail page links to the original instead
      tags,
      integrations: integrationsOf(report, dash),
      source: "grafana",
      sourceId: c.id,
      sourceUrl: `https://grafana.com/grafana/dashboards/${c.id}`,
      sourceOrgName: c.orgName || c.orgSlug,
      sourceOrgSlug: c.orgSlug,
      sourceRevision: c.revision,
      sourceDownloads: c.downloads,
      qualityScore: report.score,
      conversionSummary: summary,
      screenshotUrl: screenshot,
      isPublished: !apiError,
      updatedAt: new Date(),
    };
    const existing = await db.query.dashboards.findFirst({ where: eq(dashboards.sourceId, c.id), columns: { id: true } });
    let dashboardId: number;
    if (existing) {
      await db.update(dashboards).set(values).where(eq(dashboards.id, existing.id));
      dashboardId = existing.id; updated++;
    } else {
      const slug = `${slugify(c.slug || c.name)}-${c.id}`;
      const [row] = await db.insert(dashboards).values({ ...values, slug, createdAt: new Date(c.createdAt || Date.now()) }).returning({ id: dashboards.id });
      dashboardId = row.id; inserted++;
    }
    await db
      .insert(dashboardRevisions)
      .values({ dashboardId, revision: 1, dashboardJson: dash as unknown as Record<string, unknown>, sourceJson: src.json, conversionReport: report as unknown as Record<string, unknown>, changelog: `Converted from grafana.com revision ${c.revision}` })
      .onConflictDoUpdate({ target: [dashboardRevisions.dashboardId, dashboardRevisions.revision], set: { dashboardJson: dash as unknown as Record<string, unknown>, conversionReport: report as unknown as Record<string, unknown> } });
    if ((inserted + updated) % 100 === 0) process.stderr.write(`seeded ${inserted + updated}\n`);
  }
  await db.execute(sql`analyze dashboards`);
  process.stderr.write(`done inserted=${inserted} updated=${updated} skipped=${skipped}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => pool.end());
