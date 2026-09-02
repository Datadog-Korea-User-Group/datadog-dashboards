// Feeds dummy metrics for converted dashboards to a Datadog Agent's DogStatsD (UDP) so real dashboards render with data.
// Metric names/tags are derived from the converted Datadog queries. Runs until killed or --minutes elapse.
//   pnpm tsx scripts/migrate-grafana/dd-feed.ts --ids 1860,9614 [--minutes 15] [--interval 10] [--max-series 30000]
import "../env";
import dgram from "node:dgram";
import { existsSync, readFileSync } from "node:fs";
import { metricOfQuery, validateQuery } from "./validate";
import { dd, DdApiError } from "./dd-api";
import type { DdDashboard, DdWidget } from "./types";

export type SeriesSpec = { metric: string; type: "g" | "c" | "d"; tags: string[]; seed: number };

const HOSTS = ["demo-01", "demo-02", "demo-03"];
const TAG_VALUES: Record<string, string[]> = {
  host: HOSTS, device: ["eth0", "eth1", "sda"], device_name: ["sda", "sdb", "nvme0n1"], kube_namespace: ["default", "kube-system", "payments"], namespace: ["default", "kube-system", "payments"],
  pod_name: ["api-7d9f-abc12", "api-7d9f-def34", "worker-5c8-xyz90"], pod: ["api-7d9f-abc12", "api-7d9f-def34", "worker-5c8-xyz90"], kube_container_name: ["app", "sidecar", "init"], container: ["app", "sidecar", "init"],
  status: ["200", "404", "500"], code: ["200", "404", "500"], method: ["get", "post", "put"], handler: ["/api", "/login", "/health"], path: ["/api", "/login", "/health"], ingress: ["web", "api", "admin"], service: ["web", "api", "admin"],
  mode: ["user", "system", "iowait"], pod_phase: ["running", "pending", "failed"], phase: ["running", "pending", "failed"], condition: ["ready", "memorypressure", "diskpressure"], job: ["node", "api", "db"], instance: ["demo-01:9100", "demo-02:9100", "demo-03:9100"],
  cpu: ["0", "1", "2"], le: ["0.1", "0.5", "1"], quantile: ["0.5", "0.9", "0.99"], state: ["active", "reading", "writing"], node: HOSTS, name: ["alpha", "beta", "gamma"], cluster: ["prod", "staging", "dev"], project: ["default", "platform", "team-a"],
  health_status: ["healthy", "degraded", "progressing"], sync_status: ["synced", "outofsync", "unknown"], dest_server: ["in-cluster", "prod-east", "prod-west"], topic: ["orders", "events", "logs"], queue: ["default", "high", "low"], db: ["app", "analytics", "auth"], table: ["users", "orders", "events"],
  kube_deployment: ["api", "web", "worker"], deployment: ["api", "web", "worker"], kube_daemon_set: ["node-exporter", "fluentd", "kube-proxy"], daemonset: ["node-exporter", "fluentd", "kube-proxy"], kube_stateful_set: ["postgres", "kafka", "redis"], statefulset: ["postgres", "kafka", "redis"],
  controller_pod: ["ingress-nginx-controller-abc12", "ingress-nginx-controller-def34"], controller_class: ["nginx", "nginx-internal"], controller_namespace: ["ingress-nginx", "default"], kubernetes_pod_name: ["ingress-nginx-controller-abc12", "ingress-nginx-controller-def34"],
  app: ["api", "web", "worker"], version: ["1.2.0", "1.3.0", "1.4.0"], region: ["us-east-1", "eu-west-1", "ap-northeast-2"], env: ["prod", "staging", "dev"], level: ["info", "warn", "error"], type: ["read", "write", "other"], operation: ["get", "put", "delete"], resource: ["cpu", "memory", "pods"],
};
const genericValues = (tag: string) => [`${tag}-a`, `${tag}-b`, `${tag}-c`];
/** Tag keys/values that reach the DogStatsD wire: only [a-z0-9_:./*-]; anything else (newlines, pipes, '#') becomes '_'. */
const safeTag = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9_:./*-]/g, "_").slice(0, 200);
const valuesFor = (k: string) => (TAG_VALUES[k] ?? genericValues(k)).map((v) => v.toLowerCase());

function hash(s: string): number { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }

/**
 * Builds the set of series a dashboard needs. Every tag key referenced by a query (filters, template variables, group-bys)
 * is present on the emitted series so filters match; only group-by keys fan out to several values (bounded cardinality).
 */
export function seriesForDashboard(d: DdDashboard): SeriesSpec[] {
  const specs = new Map<string, SeriesSpec>();
  const widgets: DdWidget[] = d.widgets.flatMap((w) => [w, ...((w.definition.widgets as DdWidget[] | undefined) ?? [])]);
  const varPrefix = new Map((d.template_variables ?? []).map((v) => [v.name, v.prefix]));
  for (const w of widgets) {
    const reqs = (w.definition.requests as { queries?: { query: string }[] }[] | undefined) ?? [];
    for (const r of reqs) for (const q of r.queries ?? []) {
      const m = metricOfQuery(q.query);
      if (!m || validateQuery(q.query) !== null || !/^[a-zA-Z][a-zA-Z0-9_.]{0,199}$/.test(m.metric)) continue; // only well-formed queries feed the wire
      const type: SeriesSpec["type"] = /^p\d/.test(m.agg) ? "d" : /as_rate|as_count/.test(m.modifiers) ? "c" : "g";
      const fixed = new Map<string, string[]>(); // key -> candidate values that satisfy the filter
      const keys = new Set<string>(["host"]);
      for (const f of m.filters) {
        if (f === "*") continue;
        if (f.startsWith("!") || /^NOT\s+/i.test(f)) continue; // negative filters are satisfied by our default values
        const v = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(f);
        if (v) { keys.add(varPrefix.get(v[1]) ?? v[1]); continue; }
        const inm = /^([A-Za-z_][A-Za-z0-9_.\/-]*)\s+IN\s*\(([^)]*)\)$/i.exec(f);
        if (inm) { fixed.set(inm[1], inm[2].split(",").map((s) => safeTag(s)).filter(Boolean).slice(0, 3)); keys.add(inm[1]); continue; }
        const orm = /^\((.+)\)$/.exec(f); // (key:a* OR key:b): emit one of the alternatives
        if (orm) {
          const kvs = orm[1].split(/\s+OR\s+/i).map((p) => /^([A-Za-z_][A-Za-z0-9_.\/-]*):(.+)$/.exec(p.trim())).filter((x): x is RegExpExecArray => !!x);
          if (kvs.length) { keys.add(kvs[0][1]); fixed.set(kvs[0][1], kvs.map((k) => { const v = safeTag(k[2]); return v.endsWith("*") ? v.slice(0, -1) + "00" : v; }).slice(0, 3)); }
          continue;
        }
        const kv = /^([A-Za-z_][A-Za-z0-9_.\/-]*):(.+)$/.exec(f);
        if (kv) {
          const key = kv[1]; let val = safeTag(kv[2]);
          keys.add(key);
          if (kv[2].includes("$")) continue; // template variable value: any of our default values matches when the variable is *
          if (val.endsWith("*")) val = val.slice(0, -1) + (val.length > 1 ? "00" : valuesFor(key)[0]);
          if (val) fixed.set(key, [val]);
        }
      }
      const byKeys = m.by.filter((b) => b !== "host");
      for (const b of byKeys) keys.add(b);
      // Fan-out: host x2 (x3 when grouped by host), the first two group-by keys x3, everything else a single value.
      const fanout = new Set<string>(byKeys.slice(0, 2));
      let combos: string[][] = [[]];
      for (const k of keys) {
        let vals: string[];
        if (fixed.has(k)) vals = fixed.get(k)!;
        else if (k === "host") vals = m.by.includes("host") ? HOSTS : HOSTS.slice(0, 2);
        else vals = fanout.has(k) ? valuesFor(k).slice(0, 3) : valuesFor(k).slice(0, 1);
        const next: string[][] = [];
        for (const c of combos) for (const v of vals) next.push([...c, `${safeTag(k)}:${safeTag(v)}`]);
        combos = next;
        if (combos.length > 54) { combos = combos.slice(0, 54); }
      }
      for (const tags of combos) {
        const id = `${m.metric}|${tags.join(",")}`;
        if (!specs.has(id)) specs.set(id, { metric: m.metric, type, tags, seed: hash(id) });
      }
    }
  }
  return [...specs.values()];
}

/** Base magnitude by metric name so values look plausible for the unit the dashboard expects. */
function baseFor(metric: string, seed: number): { base: number; clampMax?: number } {
  const m = metric.toLowerCase();
  if (/percent|pct|util|\.idle|\.user$|\.system$|iowait|stolen|usage_pct|in_use|ratio/.test(m)) return { base: 15 + seed * 60, clampMax: 100 };
  if (/bytes|memory|mem\.|rss|working_set|heap|size|\.b$/.test(m)) return { base: 2e8 + seed * 3e9 };
  if (/seconds|duration|latency|time|rtt|delay|age/.test(m)) return { base: 0.05 + seed * 0.9 };
  if (/connections|sessions|clients|threads|goroutines|fds|handles|sockets/.test(m)) return { base: 40 + seed * 900 };
  if (/queue|depth|pending|backlog|lag/.test(m)) return { base: 2 + seed * 120 };
  if (/replicas|pods|nodes|containers|count$|\.count\.|total$|running|ready|desired|available|info$|status_phase|by_condition/.test(m)) return { base: 1 + Math.round(seed * 12) };
  if (/load\./.test(m)) return { base: 0.3 + seed * 3 };
  if (/cpu|cores|nanocores/.test(m)) return { base: 0.2e9 + seed * 2e9 };
  if (/requests|request|rps|ops|packets|messages|errors|events|hits|misses|calls|syncs|reconcile/.test(m)) return { base: 20 + seed * 400 };
  return { base: 5 + seed * 200 };
}

/** Smooth, varied synthetic signal: two sine components + noise + rare spikes, distinct per series via its seed. */
export function valueAt(spec: SeriesSpec, tick: number): number {
  const { base, clampMax } = baseFor(spec.metric, spec.seed);
  const p1 = 40 + spec.seed * 80, p2 = 7 + spec.seed * 20;
  let v = base * (1 + 0.28 * Math.sin(tick / p1 + spec.seed * 6.28) + 0.12 * Math.sin(tick / p2 + spec.seed * 3) + (Math.random() - 0.5) * 0.08);
  if (Math.random() < 0.02) v *= 1.6 + spec.seed;
  if (spec.type === "c") v = Math.max(0, Math.round(v / 10)); // counter increments per flush
  if (spec.type === "d") v = v / (base > 100 ? 100 : 1);
  if (clampMax !== undefined) v = Math.min(clampMax, v);
  if (/count$|replicas|pods|nodes|containers|running|ready|desired|available|info$|status_phase|by_condition/.test(spec.metric) && spec.type === "g") v = Math.max(0, Math.round(v));
  return Math.max(0, v);
}

export class Feeder {
  private sock = dgram.createSocket("udp4");
  private timer: NodeJS.Timeout | null = null;
  private tick = 0;
  constructor(private host: string, private port: number, private specs: SeriesSpec[]) {}
  start(intervalSec: number) {
    const send = () => {
      this.tick++;
      const lines: string[] = [];
      for (const s of this.specs) {
        const v = valueAt(s, this.tick);
        lines.push(`${s.metric}:${s.type === "c" ? Math.round(v) : v.toFixed(4)}|${s.type}|#${s.tags.join(",")}`);
        if (s.type === "d") for (let i = 0; i < 4; i++) lines.push(`${s.metric}:${(v * (0.6 + Math.random() * 1.2)).toFixed(4)}|d|#${s.tags.join(",")}`);
      }
      for (let i = 0; i < lines.length; i += 25) this.sock.send(Buffer.from(lines.slice(i, i + 25).join("\n")), this.port, this.host);
    };
    send();
    this.timer = setInterval(send, intervalSec * 1000);
  }
  stop() { if (this.timer) clearInterval(this.timer); this.sock.close(); }
}

export function loadSpecs(ids: number[], maxSeries: number): SeriesSpec[] {
  const all: SeriesSpec[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const f = `.cache/datadog/${id}.json`;
    if (!existsSync(f)) continue;
    for (const s of seriesForDashboard(JSON.parse(readFileSync(f, "utf8")) as DdDashboard)) {
      const key = `${s.metric}|${s.tags.join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key); all.push(s);
      if (all.length >= maxSeries) return all;
    }
  }
  return all;
}

/** Enables percentile aggregations (pNN queries) on the distribution metrics we feed. Call ~1 min after the feed started. */
export async function enablePercentiles(specs: SeriesSpec[], log: (s: string) => void): Promise<void> {
  const byMetric = new Map<string, Set<string>>();
  for (const s of specs) {
    if (s.type !== "d") continue;
    const set = byMetric.get(s.metric) ?? new Set<string>();
    for (const t of s.tags) set.add(t.split(":")[0]);
    byMetric.set(s.metric, set);
  }
  for (const [metric, tags] of byMetric) {
    const body = { data: { type: "manage_tags", id: metric, attributes: { tags: [...tags], metric_type: "distribution", include_percentiles: true } } };
    try {
      await dd("POST", `/v2/metrics/${encodeURIComponent(metric)}/tags`, body);
      log(`percentiles enabled for ${metric}`);
    } catch (e) {
      if (e instanceof DdApiError && e.status === 409) {
        try { await dd("PATCH", `/v2/metrics/${encodeURIComponent(metric)}/tags`, body); log(`percentiles updated for ${metric}`); }
        catch (e2) { log(`percentiles update failed for ${metric}: ${String(e2).slice(0, 120)}`); }
      } else log(`percentiles failed for ${metric}: ${String(e).slice(0, 120)}`);
    }
  }
}

if (process.argv[1]?.endsWith("dd-feed.ts")) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const ids = (flag("ids") ?? "").split(",").map(Number).filter(Boolean);
  const host = process.env.DOGSTATSD_HOST; const port = Number(process.env.DOGSTATSD_PORT ?? 8125);
  if (!host) { console.error("DOGSTATSD_HOST not set"); process.exit(2); }
  const specs = loadSpecs(ids, Number(flag("max-series") ?? 30000));
  process.stderr.write(`feeding ${specs.length} series for ${ids.length} dashboards to ${host}:${port}\n`);
  const feeder = new Feeder(host, port, specs);
  feeder.start(Number(flag("interval") ?? 10));
  setTimeout(() => enablePercentiles(specs, (s) => process.stderr.write(s + "\n")), 60_000);
  const minutes = Number(flag("minutes") ?? 0);
  if (minutes > 0) setTimeout(() => { feeder.stop(); process.stderr.write("feed finished\n"); process.exit(0); }, minutes * 60_000);
  process.on("SIGINT", () => { feeder.stop(); process.exit(0); });
}
