// Preview worker: for each queued preview job, create the uploaded dashboard in the community Datadog org,
// feed dummy metrics derived from its queries for a few minutes, capture a public share with Playwright,
// and store the screenshot next to the migrated ones. Runs as its own container (see Dockerfile `worker` stage).
//   Env: DATABASE_URL, DD_API_KEY + DD_APP_KEY (or DD_PAT), DD_SITE, DOGSTATSD_HOST, DOGSTATSD_PORT,
//        SCREENSHOT_DIR (default public/screenshots), PREVIEW_FEED_MINUTES (10), PREVIEW_MAX_SERIES (3000)
import "./env";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { chromium, type Browser } from "playwright";
import { dd, DdApiError } from "./migrate-grafana/dd-api";
import { ensureList } from "./migrate-grafana/dd-create";
import { Feeder, enablePercentiles, seriesForDashboard } from "./migrate-grafana/dd-feed";
import { captureToFile } from "./migrate-grafana/dd-capture";
import type { DdDashboard } from "./migrate-grafana/types";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const SHOT_DIR = process.env.SCREENSHOT_DIR ?? "public/screenshots/uploads";
const FEED_MINUTES = Number(process.env.PREVIEW_FEED_MINUTES ?? 10);
const MAX_SERIES = Number(process.env.PREVIEW_MAX_SERIES ?? 3000);
const POLL_MS = 15_000;
const LIST_NAME = "Community uploads";
const log = (s: string) => process.stdout.write(`${new Date().toISOString()} ${s}\n`);
let stopping = false;

type Job = { id: number; dashboard_id: number; revision: number; attempts: number };
type Dash = { id: number; slug: string; title: string; dd_dashboard_id: string | null; screenshot_source: string | null };

async function claimJob(): Promise<Job | null> {
  const r = await pool.query<Job>(`
    UPDATE preview_jobs SET status = 'running', started_at = now(), attempts = attempts + 1
    WHERE id = (SELECT id FROM preview_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id, dashboard_id, revision, attempts`);
  return r.rows[0] ?? null;
}

async function finish(job: Job, ok: boolean, error?: string) {
  const status = ok ? "done" : job.attempts >= 2 ? "failed" : "queued";
  await pool.query(`UPDATE preview_jobs SET status = $2, error = $3, finished_at = CASE WHEN $2 = 'queued' THEN NULL ELSE now() END WHERE id = $1`, [job.id, status, error ?? null]);
}

async function createOrUpdateDashboard(dash: Dash, json: DdDashboard): Promise<string> {
  const payload = { ...json, tags: [], title: `[Community] ${dash.title}`.slice(0, 250) };
  const post = async () => {
    const res = await dd<{ id: string }>("POST", "/v1/dashboard", payload);
    try { await dd("POST", `/v2/dashboard/lists/manual/${await ensureList(LIST_NAME)}/dashboards`, { dashboards: [{ type: "custom_timeboard", id: res.id }] }); }
    catch (e) { log(`list add failed: ${String(e).slice(0, 120)}`); }
    return res.id;
  };
  if (!dash.dd_dashboard_id) return post();
  try {
    await dd("PUT", `/v1/dashboard/${dash.dd_dashboard_id}`, payload);
    return dash.dd_dashboard_id;
  } catch (e) {
    if (e instanceof DdApiError && e.status === 404) return post();
    throw e;
  }
}

async function runJob(browser: Browser, job: Job) {
  const d = await pool.query<Dash>(`SELECT id, slug, title, dd_dashboard_id, screenshot_source FROM dashboards WHERE id = $1`, [job.dashboard_id]);
  const dash = d.rows[0];
  if (!dash) return finish(job, true, "dashboard gone");
  if (dash.screenshot_source === "manual") return finish(job, true, "manual screenshot present");
  const rev = await pool.query<{ dashboard_json: DdDashboard }>(`SELECT dashboard_json FROM dashboard_revisions WHERE dashboard_id = $1 AND revision = $2`, [job.dashboard_id, job.revision]);
  const json = rev.rows[0]?.dashboard_json;
  if (!json?.widgets) return finish(job, false, "revision has no widgets");

  log(`[job ${job.id}] ${dash.slug} rev ${job.revision}: creating in Datadog`);
  const ddId = await createOrUpdateDashboard(dash, json);
  await pool.query(`UPDATE dashboards SET dd_dashboard_id = $2 WHERE id = $1`, [dash.id, ddId]);

  const specs = seriesForDashboard(json).slice(0, MAX_SERIES);
  const host = process.env.DOGSTATSD_HOST; const port = Number(process.env.DOGSTATSD_PORT ?? 8125);
  if (!host) throw new Error("DOGSTATSD_HOST not set");
  log(`[job ${job.id}] feeding ${specs.length} series for ${FEED_MINUTES} min`);
  const feeder = new Feeder(host, port, specs);
  feeder.start(10);
  try {
    await sleep(60_000);
    await enablePercentiles(specs, log).catch(() => undefined);
    await sleep(Math.max(0, FEED_MINUTES - 1) * 60_000);
    mkdirSync(SHOT_DIR, { recursive: true });
    const file = `u-${dash.id}-${job.revision}.webp`;
    await captureToFile(browser, ddId, Math.max(5, FEED_MINUTES - 1), path.join(SHOT_DIR, file));
    // Do not overwrite a manual screenshot uploaded while we were working.
    await pool.query(
      `UPDATE dashboards SET screenshot_url = $2, screenshot_source = 'auto', updated_at = now() WHERE id = $1 AND screenshot_source IS DISTINCT FROM 'manual'`,
      [dash.id, `/screenshots/uploads/${file}?v=${Date.now()}`],
    );
    log(`[job ${job.id}] captured ${file}`);
  } finally {
    feeder.stop();
  }
  await finish(job, true);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await chromium.launch();
  process.on("SIGTERM", () => { stopping = true; });
  process.on("SIGINT", () => { stopping = true; });
  log(`preview worker started (feed ${FEED_MINUTES} min, screenshots -> ${SHOT_DIR})`);
  while (!stopping) {
    let job: Job | null = null;
    try {
      job = await claimJob();
      if (!job) { await sleep(POLL_MS); continue; }
      await runJob(browser, job);
    } catch (e) {
      const msg = String(e).slice(0, 500);
      log(`[job ${job?.id ?? "?"}] FAILED ${msg}`);
      if (job) await finish(job, false, msg).catch(() => undefined);
      await sleep(5_000);
    }
  }
  await browser.close();
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
