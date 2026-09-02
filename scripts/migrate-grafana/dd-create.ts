// Creates (or updates) converted dashboards in the Datadog org and groups them in a dashboard list.
//   pnpm tsx scripts/migrate-grafana/dd-create.ts [--ids 9614,1860] [--top N] [--skip N]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dd, DdApiError, DD_APP } from "./dd-api";
import type { CatalogItem } from "./fetch";
import type { ConversionReport, DdDashboard } from "./types";

export const STATE_FILE = ".cache/dd-created.json";
export type CreatedState = Record<string, { ddId: string; url: string; title: string; updatedAt: string; error?: string }>;
export const LIST_NAME = "Community imports (grafana.com)";

export function loadState(): CreatedState { return existsSync(STATE_FILE) ? (JSON.parse(readFileSync(STATE_FILE, "utf8")) as CreatedState) : {}; }
export function saveState(s: CreatedState) { writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

const listIds = new Map<string, number>();
export async function ensureList(name: string = LIST_NAME): Promise<number> {
  const cached = listIds.get(name);
  if (cached) return cached;
  const lists = await dd<{ dashboard_lists: { id: number; name: string }[] }>("GET", "/v1/dashboard/lists/manual");
  const found = lists.dashboard_lists.find((l) => l.name === name);
  const id = found ? found.id : (await dd<{ id: number }>("POST", "/v1/dashboard/lists/manual", { name })).id;
  listIds.set(name, id);
  return id;
}

export async function createOrUpdate(sourceId: number, state: CreatedState): Promise<{ ddId: string; url: string; created: boolean }> {
  const dash = JSON.parse(readFileSync(`.cache/datadog/${sourceId}.json`, "utf8")) as DdDashboard;
  const payload = { ...dash, tags: [], title: `[Community] ${dash.title}`.slice(0, 250) };
  const prev = state[sourceId];
  const reportFile = `.cache/reports/${sourceId}.json`;
  const setApiError = (err: string | null) => {
    if (!existsSync(reportFile)) return;
    const r = JSON.parse(readFileSync(reportFile, "utf8")) as ConversionReport & { apiError?: string | null };
    r.apiError = err;
    writeFileSync(reportFile, JSON.stringify(r, null, 2));
  };
  try {
    let res: { id: string; url: string };
    let created = false;
    if (prev?.ddId) {
      try {
        res = await dd<{ id: string; url: string }>("PUT", `/v1/dashboard/${prev.ddId}`, payload);
      } catch (e) {
        if (e instanceof DdApiError && e.status === 404) { res = await dd<{ id: string; url: string }>("POST", "/v1/dashboard", payload); created = true; }
        else throw e;
      }
    } else {
      res = await dd<{ id: string; url: string }>("POST", "/v1/dashboard", payload);
      created = true;
    }
    state[sourceId] = { ddId: res.id, url: `${DD_APP}${res.url}`, title: payload.title, updatedAt: new Date().toISOString() };
    setApiError(null);
    if (created) {
      try {
        const id = await ensureList();
        await dd("POST", `/v2/dashboard/lists/manual/${id}/dashboards`, { dashboards: [{ type: "custom_timeboard", id: res.id }] });
      } catch (e) { process.stderr.write(`[${sourceId}] list add failed: ${String(e).slice(0, 120)}\n`); }
    }
    return { ddId: res.id, url: state[sourceId].url, created };
  } catch (e) {
    const msg = e instanceof DdApiError ? `${e.status} ${e.body.slice(0, 500)}` : String(e);
    state[sourceId] = { ...(prev ?? { ddId: "", url: "", title: payload.title }), updatedAt: new Date().toISOString(), error: msg };
    setApiError(msg);
    throw e;
  } finally {
    saveState(state);
  }
}

if (process.argv[1]?.endsWith("dd-create.ts")) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const catalog = JSON.parse(readFileSync(".cache/grafana/catalog.json", "utf8")) as CatalogItem[];
  const ids = flag("ids") ? flag("ids")!.split(",").map(Number) : catalog.slice(Number(flag("skip") ?? 0), Number(flag("skip") ?? 0) + Number(flag("top") ?? catalog.length)).map((c) => c.id);
  (async () => {
    const state = loadState();
    let ok = 0, failed = 0;
    for (const id of ids) {
      if (!existsSync(`.cache/datadog/${id}.json`)) continue;
      try {
        const r = await createOrUpdate(id, state);
        ok++;
        process.stderr.write(`[${id}] ${r.created ? "created" : "updated"} ${r.url}\n`);
      } catch (e) {
        failed++;
        process.stderr.write(`[${id}] FAILED ${String(e).slice(0, 300)}\n`);
      }
    }
    process.stderr.write(`done ok=${ok} failed=${failed}\n`);
  })();
}
