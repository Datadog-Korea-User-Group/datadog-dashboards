// Wave orchestrator: for each batch of converted dashboards -> create in Datadog -> feed dummy metrics -> wait -> capture -> stop feed.
//   pnpm migrate:dd [--batch 50] [--feed-minutes 15] [--max-waves N] [--concurrency 3] [--max-series 30000]
import "../env";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import type { CatalogItem } from "./fetch";
import { createOrUpdate, loadState } from "./dd-create";
import { Feeder, enablePercentiles, loadSpecs } from "./dd-feed";
import { captureMany, cleanupShares, SHOT_DIR } from "./dd-capture";

const PIPE_STATE = ".cache/dd-state.json";
type PipeState = { waves: { n: number; ids: number[]; startedAt: string; finishedAt?: string; created: number; captured: number; failed: number }[]; done: Record<string, { capturedAt?: string; error?: string; attempts: number }> };

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const batch = Number(flag("batch") ?? 50);
const feedMinutes = Number(flag("feed-minutes") ?? 18);
const maxWaves = Number(flag("max-waves") ?? Infinity);
const concurrency = Number(flag("concurrency") ?? 3);
const maxSeries = Number(flag("max-series") ?? 30000);
// screenshots captured before this time count as missing (re-create + re-capture after a converter/capture fix)
const staleBefore = flag("stale-before") ? Date.parse(flag("stale-before")!) : 0;
const hasShot = (id: number) => { const f = `${SHOT_DIR}/${id}.webp`; return existsSync(f) && statSync(f).mtimeMs >= staleBefore; };
const log = (s: string) => process.stderr.write(`${new Date().toISOString()} ${s}\n`);

function loadPipe(): PipeState { return existsSync(PIPE_STATE) ? (JSON.parse(readFileSync(PIPE_STATE, "utf8")) as PipeState) : { waves: [], done: {} }; }
function savePipe(s: PipeState) { writeFileSync(PIPE_STATE, JSON.stringify(s, null, 2)); }

async function main() {
  const host = process.env.DOGSTATSD_HOST; const port = Number(process.env.DOGSTATSD_PORT ?? 8125);
  if (!host) throw new Error("DOGSTATSD_HOST not set");
  const catalog = JSON.parse(readFileSync(".cache/grafana/catalog.json", "utf8")) as CatalogItem[];
  const pipe = loadPipe();
  for (let w = 0; w < maxWaves; w++) {
    const ids = catalog
      .map((c) => c.id)
      .filter((id) => existsSync(`.cache/datadog/${id}.json`) && !hasShot(id) && (pipe.done[id]?.attempts ?? 0) < 2)
      .slice(0, batch);
    if (!ids.length) {
      if (!argv.includes("--follow")) { log("nothing left to process"); break; }
      log("nothing converted yet to process; waiting 10 min (--follow)");
      await sleep(10 * 60_000);
      w--;
      continue;
    }
    const wave: PipeState["waves"][number] = { n: pipe.waves.length + 1, ids, startedAt: new Date().toISOString(), created: 0, captured: 0, failed: 0 };
    pipe.waves.push(wave); savePipe(pipe);
    log(`wave ${wave.n}: ${ids.length} dashboards`);

    // 1) create / update in Datadog
    const state = loadState();
    const created: number[] = [];
    for (const id of ids) {
      pipe.done[id] = { ...(pipe.done[id] ?? { attempts: 0 }), attempts: (pipe.done[id]?.attempts ?? 0) + 1 };
      try { await createOrUpdate(id, state); created.push(id); }
      catch (e) { wave.failed++; pipe.done[id].error = String(e).slice(0, 300); log(`[${id}] create failed: ${String(e).slice(0, 160)}`); }
    }
    wave.created = created.length; savePipe(pipe);

    // 2) feed dummy metrics
    const specs = loadSpecs(created, maxSeries);
    log(`feeding ${specs.length} series to ${host}:${port} for ${feedMinutes} min`);
    const feeder = new Feeder(host, port, specs);
    feeder.start(10);
    try {
      await sleep(60_000);
      await enablePercentiles(specs, log);
      await sleep(Math.max(0, feedMinutes - 1) * 60_000);
      // 3) capture a window that lies fully inside the feed period (feed keeps running meanwhile)
      const r = await captureMany(created, { minutes: Math.max(5, feedMinutes - 2), concurrency, log, force: true });
      wave.captured = r.ok.length; wave.failed += r.failed.length;
      for (const id of r.ok) pipe.done[id] = { ...pipe.done[id], capturedAt: new Date().toISOString(), error: undefined };
      for (const f of r.failed) pipe.done[f.id] = { ...pipe.done[f.id], error: f.error };
    } finally {
      feeder.stop();
      await cleanupShares(new Set(created.map((id) => state[id]?.ddId).filter(Boolean)), log).catch((e) => log(`cleanup failed: ${String(e)}`));
    }
    wave.finishedAt = new Date().toISOString(); savePipe(pipe);
    log(`wave ${wave.n} done: created=${wave.created} captured=${wave.captured} failed=${wave.failed}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
