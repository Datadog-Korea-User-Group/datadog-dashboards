import type { ConversionReport, DdDashboard, DdLayout, DdWidget, NormPanel, NormalizedDashboard, Status, TopLevel, TranslationResult } from "./types";
import { STATUS_RANK } from "./types";
import { gridToLayout, packGravity } from "./layout";
import type { VariableResult } from "./variables";
import { panelNeedsTranslation } from "./extract";
import { normalizeQueryFilters, metricOfQuery } from "./validate";

export interface AssembleMeta { grafanaId: number; sourceUrl: string; orgName: string; model: string; llm: ConversionReport["llm"] }

const UNIT_MAP: Record<string, string> = {
  bytes: "B", decbytes: "B", kbytes: "KiB", mbytes: "MiB", gbytes: "GiB", Bps: "B/s", KBs: "KiB/s", MBs: "MiB/s", bps: "bit/s", Kbits: "Kibit/s", Mbits: "Mibit/s", bits: "bit",
  percent: "%", percentunit: "%", s: "s", ms: "ms", ns: "ns", us: "µs", m: "min", h: "h", d: "d", ops: "/s", reqps: "req/s", rps: "req/s", pps: "pkt/s", eps: "ev/s", iops: "op/s", cps: "conn/s",
  short: "", none: "", string: "", locale: "", dtdurations: "s", dthms: "s", celsius: "°C", hertz: "Hz", watt: "W",
};
const COLOR_PALETTE = (c: string): string => {
  const s = c.toLowerCase();
  if (/red|#e|#d|dark-red|semi-dark-red/.test(s)) return "white_on_red";
  if (/orange|yellow|#f|amber/.test(s)) return "white_on_yellow";
  if (/green|#5|#7|#3/.test(s)) return "white_on_green";
  return "white_on_gray";
};
const isRed = (c: string) => /red|#e0|#f2495c|#c4162a|#e24d42|#d44a3a|#bf1b00/i.test(c);
const isWarn = (c: string) => /orange|yellow|#eab839|#ff9830|#fade2a|#e0b400|#f2cc0c/i.test(c);

/**
 * `key:$var.value*` (from `label=~"$var(...)?"`) becomes `key:**` when the variable is `*`; use the variable filter
 * directly when its prefix is that key, otherwise drop the stray wildcard.
 */
export function fixVariableFilters(query: string, prefixes: Map<string, string>): string {
  return query.replace(/\b([A-Za-z_][A-Za-z0-9_.\/-]*):\$([A-Za-z_][A-Za-z0-9_]*)\.value\*?/g, (m, key: string, v: string) =>
    prefixes.get(v) === key ? `$${v}` : `${key}:$${v}.value`);
}

const NATIVE_RE = /^(system|kubernetes|kubernetes_state|kube_apiserver|kube_controller_manager|kube_scheduler|docker|container|nginx|nginx_ingress|redis|postgresql|mysql|kafka|rabbitmq|elasticsearch|mongodb|jvm|haproxy|envoy|istio|vault|consul|etcd|coredns|argocd|cert_manager|aws)\./;
const BYTE_UNITS = new Set(["B", "KiB", "MiB", "GiB", "B/s", "KiB/s", "MiB/s"]);
export const isNative = (metrics: string[]) => metrics.length > 0 && metrics.every((m) => NATIVE_RE.test(m));
/**
 * Datadog stores native metrics with unit metadata (system.mem.* bytes, system.io.*kb_s KiB/s, kubernetes.cpu.* nanocores)
 * and scales them for display, so the byte/core conversions a translation may add would show wrong numbers.
 */
export function stripUnitScaling(formula: string, metrics: string[]): string {
  if (!isNative(metrics)) return formula;
  return formula
    .replace(/\s*\*\s*\(?\s*1024\s*\*\s*1024\s*\)?/g, "")
    .replace(/\s*[*/]\s*1048576(\.0+)?\b/g, "")
    .replace(/\s*[*/]\s*1024(\.0+)?\b/g, "")
    .replace(/\s*\/\s*(1e9|1e\+9|1000000000)(\.0+)?\b/g, "")
    .replace(/\s*\*\s*(1e-9|0\.000000001)\b/g, "")
    .trim();
}

function rename(queries: TranslationResult["queries"], formula: string, start: number): { queries: TranslationResult["queries"]; formula: string; next: number } {
  const map = new Map<string, string>();
  const out = queries.map((q, i) => { const n = `query${start + i}`; map.set(q.name, n); return { ...q, name: n }; });
  const f = formula.replace(/'[^']*'|[A-Za-z_][A-Za-z0-9_]*/g, (tok) => (tok.startsWith("'") ? tok : map.get(tok) ?? tok));
  return { queries: out, formula: f, next: start + queries.length };
}

function fence(s: string): string { return "```\n" + s + "\n```"; }

function noteWidget(title: string, content: string): DdWidget["definition"] {
  return { type: "note", content: (title ? `**${title}**\n\n` : "") + content, background_color: "white", font_size: "14", text_align: "left", vertical_align: "top", show_tick: false, tick_pos: "50%", tick_edge: "left", has_padding: true };
}

function unsupportedNote(p: NormPanel, reasons: string[]): DdWidget["definition"] {
  const body = [`Unsupported panel (${p.rawType})`, ...(reasons.length ? ["", ...reasons.map((r) => `- ${r}`)] : []), "", "Original PromQL:", fence(p.targets.map((t) => `${t.refId}: ${t.expr}`).join("\n") || "(none)")].join("\n");
  return noteWidget(p.title, body.slice(0, 3900));
}

interface Built { def: DdWidget["definition"]; status: Status; targets: ConversionReport["panels"][number]["targets"] }

function buildQueryWidget(p: NormPanel, tr: Map<string, TranslationResult>, prefixes: Map<string, string>): Built {
  const targets: Built["targets"] = [];
  let n = 1;
  const queries: (TranslationResult["queries"][number] & { data_source: "metrics" })[] = [];
  const formulas: { formula: string; alias?: string; limit?: { count: number; order: "asc" | "desc" } }[] = [];
  let worst: Status = "native";
  const scalar = ["stat", "gauge", "bargauge", "table", "piechart"].includes(p.type);
  const defaultAgg = p.type === "stat" || p.type === "gauge" ? "last" : "avg";
  for (const t of p.targets) {
    const r = tr.get(`${p.id}.${t.refId}`);
    if (!r) { targets.push({ expr: t.expr, status: "unsupported", notes: ["no translation"] }); worst = "unsupported"; continue; }
    if (STATUS_RANK[r.status] > STATUS_RANK[worst]) worst = r.status;
    targets.push({ expr: t.expr, status: r.status, queries: r.queries.map((q) => q.query), formula: r.formula, notes: r.notes });
    if (r.status === "unsupported" || !r.queries.length) continue;
    const rn = rename(r.queries, r.formula, n); n = rn.next;
    for (const q of rn.queries) queries.push({ data_source: "metrics", name: q.name, query: normalizeQueryFilters(fixVariableFilters(q.query, prefixes)), ...(scalar ? { aggregator: q.aggregator ?? defaultAgg } : {}) });
    let formula = stripUnitScaling(rn.formula, rn.queries.map((q) => metricOfQuery(q.query)?.metric ?? ""));
    if (p.unit === "percentunit") formula = `(${formula}) * 100`;
    const alias = t.legendFormat && t.legendFormat !== "__auto" && !t.legendFormat.includes("{{") ? t.legendFormat : undefined;
    formulas.push({ formula, ...(alias ? { alias } : {}) });
  }
  if (!queries.length) {
    const reasons = targets.flatMap((t) => t.notes);
    return { def: unsupportedNote(p, reasons), status: "unsupported", targets };
  }
  // Panels whose targets were all unsupported are handled above; a partially unsupported panel keeps the good targets.
  if (targets.some((t) => t.status === "unsupported") && worst !== "unsupported") worst = "partial";
  // byte-family units are known to Datadog for native metrics; a custom unit would mislabel the auto-scaled value
  const metrics = queries.map((q) => metricOfQuery(q.query)?.metric ?? "");
  const unit = p.unit && !(BYTE_UNITS.has(UNIT_MAP[p.unit]) && isNative(metrics)) ? UNIT_MAP[p.unit] : undefined;
  const thresholds = (p.thresholds ?? []).filter((s) => s.value !== null && Number.isFinite(s.value));
  switch (p.type) {
    case "timeseries": {
      const display_type = p.drawStyle === "bars" ? "bars" : p.stacking || (p.fill ?? 0) > 0 ? "area" : "line";
      const markers = thresholds.map((s) => ({ value: `y = ${s.value}`, display_type: isRed(s.color) ? "error dashed" : isWarn(s.color) ? "warning dashed" : "info dashed" }));
      return { status: worst, targets, def: {
        type: "timeseries", title: p.title, show_legend: true, legend_layout: "auto", legend_columns: ["avg", "min", "max", "value", "sum"],
        requests: [{ queries, formulas, response_format: "timeseries", display_type, style: { palette: "dog_classic", line_type: "solid", line_width: "normal" } }],
        yaxis: { include_zero: display_type !== "line" || false, scale: "linear", label: "", min: "auto", max: "auto" },
        ...(markers.length ? { markers } : {}),
      } };
    }
    case "stat":
    case "gauge": {
      const conditional_formats = thresholds.map((s) => ({ comparator: ">=", value: s.value as number, palette: COLOR_PALETTE(s.color) }));
      return { status: worst, targets, def: {
        type: "query_value", title: p.title, autoscale: true, precision: 2, text_align: "center",
        requests: [{ queries, formulas: [formulas[0]], response_format: "scalar", ...(conditional_formats.length ? { conditional_formats } : {}) }],
        ...(unit ? { custom_unit: unit } : {}),
        ...(p.graphMode === "area" ? { timeseries_background: { type: "area" } } : {}),
      } };
    }
    case "bargauge":
      return { status: worst, targets, def: { type: "toplist", title: p.title, requests: [{ queries, formulas: [{ ...formulas[0], limit: { count: 10, order: "desc" } }], response_format: "scalar" }] } };
    case "table":
      return { status: worst, targets, def: { type: "query_table", title: p.title, has_search_bar: "auto", requests: [{ queries, formulas: formulas.map((f, i) => (i === 0 ? { ...f, limit: { count: 50, order: "desc" } } : f)), response_format: "scalar" }] } };
    case "piechart":
      return { status: worst, targets, def: { type: "sunburst", title: p.title, legend: { type: "automatic" }, requests: [{ queries, formulas: [formulas[0]], response_format: "scalar" }] } };
    case "heatmap":
      return { status: worst === "native" ? "partial" : worst, targets: targets.map((t) => ({ ...t, notes: [...t.notes, "heatmap rendered as Datadog heatmap of the series"] })), def: { type: "heatmap", title: p.title, show_legend: true, requests: [{ queries, formulas: [formulas[0]], response_format: "timeseries", style: { palette: "dog_classic" } }] } };
    default:
      return { def: unsupportedNote(p, []), status: "unsupported", targets };
  }
}

function buildPanel(p: NormPanel, tr: Map<string, TranslationResult>, prefixes: Map<string, string>): Built {
  if (p.type === "text") return { def: noteWidget("", (p.content ?? p.title ?? "").trim() || " "), status: "native", targets: [] };
  if (p.type === "logs") return { def: { type: "log_stream", title: p.title, query: "", columns: ["host", "service"], indexes: [], show_date_column: true, show_message_column: true, message_display: "expanded-md", sort: { column: "time", order: "desc" } }, status: "partial", targets: p.targets.map((t) => ({ expr: t.expr, status: "partial", notes: ["logs panel: query left empty"] })) };
  if (p.type === "unknown") return { def: unsupportedNote(p, [`no Datadog equivalent for plugin ${p.rawType}`]), status: "unsupported", targets: p.targets.map((t) => ({ expr: t.expr, status: "unsupported", notes: [] })) };
  if (!panelNeedsTranslation(p)) return { def: noteWidget(p.title, `Panel had no queries (${p.rawType}).`), status: "partial", targets: [] };
  return buildQueryWidget(p, tr, prefixes);
}

export function assemble(d: NormalizedDashboard, vars: VariableResult, tr: Map<string, TranslationResult>, meta: AssembleMeta): { dashboard: DdDashboard; report: ConversionReport } {
  const panelsReport: ConversionReport["panels"] = [];
  const unmapped = new Map<string, { count: number; panelIds: Set<number> }>();
  const tagRenames = new Map<string, string>();
  for (const r of tr.values()) for (const [k, v] of Object.entries(r.tagRenames ?? {})) if (!tagRenames.has(k)) tagRenames.set(k, v);

  const prefixes = new Map(vars.vars.map((v) => [v.name, tagRenames.get(v.prefix) ?? v.prefix]));

  const toWidget = (p: NormPanel): DdWidget & { grid: typeof p.grid } => {
    const b = buildPanel(p, tr, prefixes);
    panelsReport.push({ id: p.id, title: p.title, grafanaType: p.rawType, datadogType: b.def.type, status: b.status, targets: b.targets });
    for (const t of p.targets) {
      const r = tr.get(`${p.id}.${t.refId}`);
      for (const m of r?.unmappedMetrics ?? []) {
        const e = unmapped.get(m) ?? { count: 0, panelIds: new Set<number>() };
        e.count++; e.panelIds.add(p.id); unmapped.set(m, e);
      }
    }
    const layout = gridToLayout(p.grid);
    if ((b.def.type === "timeseries" || b.def.type === "heatmap") && layout.height < 2) layout.height = 2;
    return { definition: b.def, layout, grid: p.grid };
  };

  const strip = (w: DdWidget & { grid: unknown }): DdWidget => ({ definition: w.definition, layout: w.layout });
  const top: (DdWidget & { grid: typeof d.items[number]["grid"] })[] = [];
  for (const item of d.items as TopLevel[]) {
    if (item.kind === "group") {
      const children = item.panels.map(toWidget);
      const height = Math.max(1, packGravity(children));
      const bottom = Math.max(...item.panels.map((p) => p.grid.y + p.grid.h));
      const grid = { x: 0, y: item.grid.y, w: 24, h: Math.max(1, bottom - item.grid.y) };
      top.push({ definition: { type: "group", layout_type: "ordered", title: item.title || " ", show_title: true, widgets: children.map(strip) }, layout: { x: 0, y: 0, width: 12, height }, grid });
    } else {
      top.push(toWidget(item));
    }
  }
  packGravity(top);

  const template_variables = vars.vars.map((v) => ({ ...v, prefix: tagRenames.get(v.prefix) ?? v.prefix }));
  const dashboard: DdDashboard = {
    title: d.title,
    description: `Converted from Grafana dashboard ${meta.sourceUrl} (by ${meta.orgName}).${d.description ? ` ${d.description}` : ""}`.slice(0, 4000),
    layout_type: "ordered",
    reflow_type: "fixed",
    tags: [], // Datadog dashboard tags only accept team:/ai: keys; Grafana tags are kept in the site database instead
    template_variables,
    widgets: top.map(strip),
  };

  const counts = { total: panelsReport.length, native: 0, openmetrics: 0, partial: 0, unsupported: 0 };
  for (const p of panelsReport) counts[p.status]++;
  const score = counts.total ? Math.round((100 * (counts.native + counts.openmetrics + 0.5 * counts.partial)) / counts.total) : 0;
  const report: ConversionReport = {
    title: d.title, grafanaId: meta.grafanaId, schemaVersion: d.schemaVersion, legacyRows: d.legacyRows, model: meta.model,
    counts, score, panels: panelsReport,
    unmappedMetrics: [...unmapped.entries()].map(([metric, e]) => ({ metric, count: e.count, panelIds: [...e.panelIds] })).sort((a, b) => b.count - a.count),
    templateVariables: { converted: template_variables.map((v) => v.name), dropped: vars.dropped },
    warnings: d.warnings,
    llm: meta.llm,
  };
  return { dashboard, report };
}

export function widgetLayouts(w: DdWidget[]): DdLayout[] { return w.flatMap((x) => [x.layout, ...((x.definition.widgets as DdWidget[] | undefined)?.map((c) => c.layout) ?? [])]); }
