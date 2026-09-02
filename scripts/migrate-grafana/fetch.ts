// Downloads every grafana.com community dashboard with a Prometheus datasource into .cache/grafana/{id}.json
// (metadata + dashboard JSON from GET /api/dashboards/{id}). Resumable: existing files are skipped.
//   pnpm migrate:fetch [--concurrency 4] [--delay 200] [--max N]
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const API = "https://grafana.com/api";
const OUT = ".cache/grafana";
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1] ?? "true");
const concurrency = Number(args.get("concurrency") ?? 4);
const delayMs = Number(args.get("delay") ?? 200);
const max = Number(args.get("max") ?? Infinity);

export type CatalogItem = {
  id: number; slug: string; name: string; description: string; downloads: number; revision: number;
  orgSlug: string; orgName: string; datasource: string | null; collectorType: string | null; updatedAt: string; createdAt: string;
};

async function getJson<T>(url: string, attempt = 1): Promise<T> {
  const res = await fetch(url, { headers: { "user-agent": "datadog-dashboards-migration/1.0 (+https://github.com/Datadog-Korea-User-Group/datadog-dashboards)" } });
  if (res.status === 429 || res.status >= 500) {
    if (attempt > 5) throw new Error(`${url} -> ${res.status} after ${attempt} attempts`);
    await sleep(1000 * 2 ** attempt);
    return getJson<T>(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchCatalog(): Promise<CatalogItem[]> {
  const file = `${OUT}/catalog.json`;
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as CatalogItem[];
  const items: CatalogItem[] = [];
  for (let page = 1; ; page++) {
    const d = await getJson<{ items: CatalogItem[]; pages: number }>(`${API}/dashboards?dataSourceSlugIn=prometheus&orderBy=downloads&direction=desc&page=${page}&pageSize=100`);
    items.push(...d.items.map((i) => ({
      id: i.id, slug: i.slug, name: i.name, description: i.description ?? "", downloads: i.downloads, revision: i.revision,
      orgSlug: i.orgSlug, orgName: i.orgName, datasource: i.datasource, collectorType: i.collectorType, updatedAt: i.updatedAt, createdAt: i.createdAt,
    })));
    process.stderr.write(`catalog page ${page}/${d.pages} (${items.length})\n`);
    if (page >= d.pages) break;
    await sleep(delayMs);
  }
  writeFileSync(file, JSON.stringify(items));
  return items;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const catalog = await fetchCatalog();
  const todo = catalog.filter((c) => !existsSync(`${OUT}/${c.id}.json`)).slice(0, max);
  process.stderr.write(`catalog=${catalog.length} todo=${todo.length}\n`);
  let done = 0, failed = 0;
  const failures: { id: number; error: string }[] = [];
  const worker = async () => {
    for (;;) {
      const item = todo.shift();
      if (!item) return;
      try {
        const detail = await getJson<Record<string, unknown>>(`${API}/dashboards/${item.id}`);
        // Detail carries the dashboard body under `json` (string or object); normalize to an object.
        let json = detail.json;
        if (typeof json === "string") json = JSON.parse(json);
        const cats = ((detail.categories as { items?: { categoryName?: string }[] } | undefined)?.items ?? []).map((c) => c.categoryName).filter(Boolean);
        writeFileSync(`${OUT}/${item.id}.json`, JSON.stringify({ meta: { ...item, categories: cats }, json }));
        done++;
      } catch (e) {
        failed++;
        failures.push({ id: item.id, error: String(e) });
      }
      if ((done + failed) % 50 === 0) process.stderr.write(`progress done=${done} failed=${failed} remaining=${todo.length}\n`);
      await sleep(delayMs);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  writeFileSync(`${OUT}/_failures.json`, JSON.stringify(failures, null, 2));
  process.stderr.write(`finished done=${done} failed=${failed}\n`);
}

if (process.argv[1]?.endsWith("fetch.ts")) main().catch((e) => { console.error(e); process.exit(1); });
