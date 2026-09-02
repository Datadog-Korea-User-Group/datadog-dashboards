// Captures FHD screenshots of dashboards created in Datadog: public share -> Playwright -> webp -> unshare.
//   pnpm tsx scripts/migrate-grafana/dd-capture.ts --ids 9614,1860 [--minutes 15] [--concurrency 3]
import { mkdirSync, existsSync } from "node:fs";
import { chromium, type Browser } from "playwright";
import sharp from "sharp";
import { dd, DdApiError } from "./dd-api";
import { loadState } from "./dd-create";

export const SHOT_DIR = "public/screenshots";

type Share = { token: string; public_url: string; dashboard_id: string };

export async function listShares(): Promise<Share[]> {
  const r = await dd<{ shared_dashboards?: Share[] }>("GET", "/v1/dashboard/public");
  return r.shared_dashboards ?? [];
}

export async function share(dashboardId: string, liveSpan = "15m"): Promise<Share> {
  // global_time pins the shared dashboard's default range so graphs span exactly the period we fed
  return dd<Share>("POST", "/v1/dashboard/public", { dashboard_id: dashboardId, dashboard_type: "custom_timeboard", share_type: "open", global_time: { live_span: liveSpan } });
}

export async function unshare(token: string): Promise<void> {
  try { await dd("DELETE", `/v1/dashboard/public/${token}`); } catch (e) { if (!(e instanceof DdApiError && e.status === 404)) throw e; }
}

export async function captureOne(browser: Browser, sourceId: number, ddId: string, minutes: number, log: (s: string) => void): Promise<string> {
  mkdirSync(SHOT_DIR, { recursive: true });
  const out = `${SHOT_DIR}/${sourceId}.webp`;
  await captureToFile(browser, ddId, minutes, out);
  log(`[${sourceId}] captured ${out}`);
  return out;
}

/** Shares the dashboard publicly, screenshots it at 1920x1080 into `out` (webp), then removes the share. */
export async function captureToFile(browser: Browser, ddId: string, minutes: number, out: string): Promise<void> {
  const liveSpan = minutes <= 5 ? "5m" : minutes <= 10 ? "10m" : minutes <= 15 ? "15m" : minutes <= 30 ? "30m" : "1h";
  const s = await share(ddId, liveSpan);
  try {
    const to = Date.now(), from = to - minutes * 60_000;
    const url = `${s.public_url}${s.public_url.includes("?") ? "&" : "?"}from_ts=${from}&to_ts=${to}`;
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: "light" });
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 }).catch(() => page.waitForTimeout(5_000));
      await page.waitForTimeout(4_000);
      const png = await page.screenshot({ type: "png", fullPage: false });
      await sharp(png).resize(1920, 1080, { fit: "cover", position: "top" }).webp({ quality: 75 }).toFile(out);
    } finally {
      await ctx.close();
    }
  } finally {
    await unshare(s.token);
  }
}

export async function captureMany(ids: number[], opts: { minutes: number; concurrency: number; force?: boolean; log?: (s: string) => void }): Promise<{ ok: number[]; failed: { id: number; error: string }[] }> {
  const log = opts.log ?? ((s) => process.stderr.write(s + "\n"));
  const state = loadState();
  const todo = ids.filter((id) => state[id]?.ddId && (opts.force || !existsSync(`${SHOT_DIR}/${id}.webp`)));
  const ok: number[] = []; const failed: { id: number; error: string }[] = [];
  const browser = await chromium.launch();
  try {
    const worker = async () => {
      for (;;) {
        const id = todo.shift();
        if (id === undefined) return;
        try { await captureOne(browser, id, state[id].ddId, opts.minutes, log); ok.push(id); }
        catch (e) { failed.push({ id, error: String(e).slice(0, 300) }); log(`[${id}] capture FAILED ${String(e).slice(0, 200)}`); }
      }
    };
    await Promise.all(Array.from({ length: opts.concurrency }, worker));
  } finally {
    await browser.close();
  }
  return { ok, failed };
}

/** Removes any public shares left over for dashboards we created (safety net after a crash). */
export async function cleanupShares(ourDdIds: Set<string>, log: (s: string) => void): Promise<number> {
  let n = 0;
  for (const s of await listShares()) {
    if (ourDdIds.has(s.dashboard_id)) { await unshare(s.token); n++; log(`unshared leftover ${s.dashboard_id}`); }
  }
  return n;
}

if (process.argv[1]?.endsWith("dd-capture.ts")) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const ids = (flag("ids") ?? "").split(",").map(Number).filter(Boolean);
  captureMany(ids, { minutes: Number(flag("minutes") ?? 15), concurrency: Number(flag("concurrency") ?? 3), force: argv.includes("--force") })
    .then((r) => process.stderr.write(`done ok=${r.ok.length} failed=${r.failed.length}\n`))
    .catch((e) => { console.error(e); process.exit(1); });
}
