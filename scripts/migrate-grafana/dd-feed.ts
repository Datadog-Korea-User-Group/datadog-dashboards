// Feeds dummy metrics for converted dashboards to a Datadog Agent's DogStatsD (UDP) so real dashboards render with data.
// Metric names/tags are derived from the converted Datadog queries. Runs until killed or --minutes elapse.
//   pnpm tsx scripts/migrate-grafana/dd-feed.ts --ids 1860,9614 [--minutes 15] [--interval 10] [--max-series 20000]
import "../env";
import dgram from "node:dgram";
import { existsSync, readFileSync } from "node:fs";
import { metricOfQuery } from "./validate";
import type { DdDashboard, DdWidget } from "./types";

type SeriesSpec = { metric: string; type: "g" | "c" | "d"; tags: string[]; seed: number };

const HOSTS = ["demo-01", "demo-02", "demo-03"];
const TAG_VALUES: Record<string, string[]> = {
  host: HOSTS, device: ["eth0", "eth1", "sda"], device_name: ["sda", "sdb", "nvme0n1"], kube_namespace: ["default", "kube-system", "payments"], namespace: ["default", "kube-system", "payments"],
  pod_name: ["api-7d9f-abc12", "api-7d9f-def34", "worker-5c8-xyz90"], pod: ["api-7d9f-abc12", "api-7d9f-def34", "worker-5c8-xyz90"], kube_container_name: ["app", "sidecar", "init"], container: ["app", "sidecar", "init"],
  status: ["200", "404", "500"], code: ["200", "404", "500"], method: ["GET", "POST", "PUT"], handler: ["/api", "/login", "/health"], path: ["/api", "/login", "/health"], ingress: ["web", "api", "admin"], service: ["web", "api", "admin"],
  mode: ["user", "system", "iowait"], pod_phase: ["running", "pending", "failed"], phase: ["running", "pending", "failed"], condition: ["ready", "memorypressure", "diskpressure"], job: ["node", "api", "db"], instance: ["demo-01:9100", "demo-02:9100", "demo-03:9100"],
  cpu: ["0", "1", "2"], le: ["0.1", "0.5", "1"], quantile: ["0.5", "0.9", "0.99"], state: ["active", "reading", "writing"], node: HOSTS, name: ["alpha", "beta", "gamma"], cluster: ["prod", "staging", "dev"], project: ["default", "platform", "team-a"],
  health_status: ["healthy", "degraded", "progressing"], sync_status: ["synced", "outofsync", "unknown"], dest_server: ["in-cluster", "prod-east", "prod-west"], topic: ["orders", "events", "logs"], queue: ["default", "high", "low"], db: ["app", "analytics", "auth"], table: ["users", "orders", "events"],
};
const genericValues = (tag: string) => [`${tag}-a`, `${tag}-b`, `${tag}-c`];

/** Builds the set of series a dashboard needs: every metric with the tag combinations implied by its filters and group-bys. */
export function seriesForDashboard(d: DdDashboard): SeriesSpec[] {
  const specs = new Map<string, SeriesSpec>();
  const widgets: DdWidget[] = d.widgets.flatMap((w) => [w, ...((w.definition.widgets as DdWidget[] | undefined) ?? [])]);
  const varPrefix = new Map(d.template_variables.map((v) => [v.name, v.prefix]));
  for (const w of widgets) {
    const reqs = (w.definition.requests as { queries?: { query: string }[] }[] | undefined) ?? [];
    for (const r of reqs) for (const q of r.queries ?? []) {
      const m = metricOfQuery(q.query);
      if (!m) continue;
      const type: SeriesSpec["type"] = /^p\d/.test(m.agg) ? "d" : /as_rate|as_count/.test(m.modifiers) ? "c" : "g";
      const fixed = new Map<string, string[]>();
      const tagKeys = new Set<string>(["host"]);
      for (const f of m.filters) {
        if (f === "*") continue;
        const neg = f.startsWith("!") || /^NOT\s+/i.test(f);
        if (neg) continue;
        const v = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(f);
        if (v) { const p = varPrefix.get(v[1]) ?? v[1]; tagKeys.add(p); continue; }
        const inm = /^([A-Za-z_][A-Za-z0-9_.\/-]*)\s+IN\s*\(([^)]*)\)$/i.exec(f);
        if (inm) { fixed.set(inm[1], inm[2].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)); tagKeys.add(inm[1]); continue; }
        const kv = /^([A-Za-z_][A-Za-z0-9_.\/-]*):(.+)$/.exec(f);
        if (kv) {
          const key = kv[1]; let val = kv[2].toLowerCase();
          if (val.includes("$")) { tagKeys.add(key); continue; }
          if (val.endsWith("*")) val = val.slice(0, -1) + "00";
          fixed.set(key, [val]); tagKeys.add(key);
        }
      }
      for (const b of m.by) tagKeys.add(b);
      const keys = [...tagKeys].slice(0, 3); // ponytail: cap tag dimensions (host + 2) to keep cardinality sane
      const combos: string[][] = [[]];
      for (const k of keys) {
        const vals = fixed.get(k) ?? (TAG_VALUES[k] ?? genericValues(k)).map((v) => v.toLowerCase());
        const next: string[][] = [];
        for (const c of combos) for (const v of vals) next.push([...c, `${k}:${v}`]);
        combos.length = 0; combos.push(...next);
        if (combos.length > 27) break;
      }
      for (const tags of combos) {
        const id = `${m.metric}|${tags.join(",")}`;
        if (!specs.has(id)) specs.set(id, { metric: m.metric, type, tags, seed: hash(id) });
      }
    }
  }
  return [...specs.values()];
}

function hash(s: string): number { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }

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
        const base = 20 + s.seed * 80;
        const wave = Math.sin(this.tick / (6 + s.seed * 10) + s.seed * 6) * base * 0.35 + (Math.random() - 0.5) * base * 0.1;
        let value = Math.max(0, base + wave);
        if (s.metric.includes("bytes") || s.metric.includes("memory")) value *= 1e6;
        if (s.type === "c") value = Math.max(0, Math.round(value / 10));
        if (s.type === "d") value = value / 100;
        if (/pct|percent|util|idle|user|system|iowait/.test(s.metric)) value = Math.min(100, value);
        lines.push(`${s.metric}:${value.toFixed(3)}|${s.type}|#${s.tags.join(",")}`);
      }
      for (let i = 0; i < lines.length; i += 25) {
        const buf = Buffer.from(lines.slice(i, i + 25).join("\n"));
        this.sock.send(buf, this.port, this.host);
      }
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

if (process.argv[1]?.endsWith("dd-feed.ts")) {
  const argv = process.argv.slice(2);
  const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const ids = (flag("ids") ?? "").split(",").map(Number).filter(Boolean);
  const host = process.env.DOGSTATSD_HOST; const port = Number(process.env.DOGSTATSD_PORT ?? 8125);
  if (!host) { console.error("DOGSTATSD_HOST not set"); process.exit(2); }
  const specs = loadSpecs(ids, Number(flag("max-series") ?? 20000));
  process.stderr.write(`feeding ${specs.length} series for ${ids.length} dashboards to ${host}:${port}\n`);
  const feeder = new Feeder(host, port, specs);
  feeder.start(Number(flag("interval") ?? 10));
  const minutes = Number(flag("minutes") ?? 0);
  if (minutes > 0) setTimeout(() => { feeder.stop(); process.stderr.write("feed finished\n"); process.exit(0); }, minutes * 60_000);
  process.on("SIGINT", () => { feeder.stop(); process.exit(0); });
}
