// Local preview runner (run by an admin from their own machine, e.g. through the `/preview` Claude Code skill):
// pulls queued preview jobs from the site's admin API, creates each dashboard in the community Datadog org,
// feeds dummy metrics through a Datadog Agent's DogStatsD, captures a public share with Playwright, and uploads
// the screenshot back. Datadog credentials never leave this machine.
//   pnpm preview:run [--limit 5] [--minutes 10] [--dry]
//   Env (.env.local): SITE_URL, ADMIN_API_TOKEN, DD_API_KEY + DD_APP_KEY (or DD_PAT), DD_SITE, DOGSTATSD_HOST, DOGSTATSD_PORT
import "./env";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { dd, DdApiError } from "./migrate-grafana/dd-api";
import { ensureList } from "./migrate-grafana/dd-create";
import { Feeder, enablePercentiles, seriesForDashboard } from "./migrate-grafana/dd-feed";
import { captureToFile } from "./migrate-grafana/dd-capture";
import type { DdDashboard } from "./migrate-grafana/types";

type Job = { id: number; dashboardId: number; slug: string; title: string; revision: number; ddDashboardId: string | null; screenshotSource: string | null; dashboardJson: DdDashboard };

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const LIMIT = Number(flag("limit") ?? 5);
const FEED_MINUTES = Number(flag("minutes") ?? process.env.PREVIEW_FEED_MINUTES ?? 10);
const MAX_SERIES = Number(process.env.PREVIEW_MAX_SERIES ?? 3000);
const DRY = argv.includes("--dry");
// PREVIEW_SITE_URL lets a dev machine (SITE_URL=localhost) target the production site
const SITE = (process.env.PREVIEW_SITE_URL ?? process.env.SITE_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.ADMIN_API_TOKEN ?? "";
const LIST_NAME = "Community uploads";
const OUT_DIR = ".cache/preview-local";
const log = (s: string) => process.stdout.write(`${new Date().toISOString()} ${s}\n`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T>(method: string, p: string, body?: BodyInit, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${SITE}${p}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, ...headers }, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${p}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

async function createOrUpdateDashboard(job: Job): Promise<string> {
  const payload = { ...job.dashboardJson, tags: [], title: `[Community] ${job.title}`.slice(0, 250) };
  const post = async () => {
    const res = await dd<{ id: string }>("POST", "/v1/dashboard", payload);
    try { await dd("POST", `/v2/dashboard/lists/manual/${await ensureList(LIST_NAME)}/dashboards`, { dashboards: [{ type: "custom_timeboard", id: res.id }] }); }
    catch (e) { log(`list add failed: ${String(e).slice(0, 120)}`); }
    return res.id;
  };
  if (!job.ddDashboardId) return post();
  try { await dd("PUT", `/v1/dashboard/${job.ddDashboardId}`, payload); return job.ddDashboardId; }
  catch (e) { if (e instanceof DdApiError && e.status === 404) return post(); throw e; }
}

async function runJob(browser: Browser, job: Job) {
  if (job.screenshotSource === "manual") { await api("POST", `/api/admin/preview-jobs/${job.id}/fail`, JSON.stringify({ error: "manual screenshot present" }), { "content-type": "application/json" }); return; }
  await api("POST", `/api/admin/preview-jobs/${job.id}/claim`);
  const ddId = await createOrUpdateDashboard(job);
  log(`[job ${job.id}] ${job.slug} rev ${job.revision}: Datadog dashboard ${ddId}`);
  const specs = seriesForDashboard(job.dashboardJson).slice(0, MAX_SERIES);
  const host = process.env.DOGSTATSD_HOST; const port = Number(process.env.DOGSTATSD_PORT ?? 8125);
  if (!host) throw new Error("DOGSTATSD_HOST not set");
  log(`[job ${job.id}] feeding ${specs.length} series for ${FEED_MINUTES} min`);
  const feeder = new Feeder(host, port, specs);
  feeder.start(10);
  const file = path.join(OUT_DIR, `u-${job.dashboardId}-${job.revision}.webp`);
  try {
    await sleep(60_000);
    await enablePercentiles(specs, log).catch(() => undefined);
    await sleep(Math.max(0, FEED_MINUTES - 1) * 60_000);
    mkdirSync(OUT_DIR, { recursive: true });
    await captureToFile(browser, ddId, Math.max(5, FEED_MINUTES - 1), file);
  } finally {
    feeder.stop();
  }
  const form = new FormData();
  form.append("screenshot", new Blob([readFileSync(file)], { type: "image/webp" }), path.basename(file));
  form.append("ddDashboardId", ddId);
  const r = await api<{ ok: boolean; screenshotUrl: string }>("POST", `/api/admin/preview-jobs/${job.id}/complete`, form);
  log(`[job ${job.id}] done -> ${r.screenshotUrl}`);
}

async function main() {
  if (!SITE || !TOKEN) throw new Error("SITE_URL and ADMIN_API_TOKEN must be set in .env.local");
  const { jobs } = await api<{ jobs: Job[] }>("GET", `/api/admin/preview-jobs?limit=${LIMIT}`);
  log(`${jobs.length} queued preview job(s)`);
  if (DRY || !jobs.length) { for (const j of jobs) log(`  #${j.id} ${j.slug} rev ${j.revision}`); return; }
  const browser = await chromium.launch();
  let ok = 0, failed = 0;
  try {
    for (const job of jobs) {
      try { await runJob(browser, job); ok++; }
      catch (e) {
        failed++;
        const msg = String(e).slice(0, 500);
        log(`[job ${job.id}] FAILED ${msg}`);
        await api("POST", `/api/admin/preview-jobs/${job.id}/fail`, JSON.stringify({ error: msg }), { "content-type": "application/json" }).catch(() => undefined);
      }
    }
  } finally {
    await browser.close();
  }
  log(`finished: ok=${ok} failed=${failed}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
