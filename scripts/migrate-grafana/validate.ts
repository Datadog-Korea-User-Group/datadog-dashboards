import type { TranslationResult } from "./types";

// Datadog metric query: agg:metric{filters} by {tags}.modifier(...)...
const QUERY_RE = /^(avg|sum|min|max|p(?:50|75|90|95|99|999))\s*:\s*([a-zA-Z][a-zA-Z0-9_.]{0,199})\s*\{([^{}]*)\}(?:\s+by\s+\{([^{}]*)\})?((?:\s*\.(?:as_rate\(\)|as_count\(\)|rollup\(\s*(?:avg|sum|min|max|count)\s*(?:,\s*\d+\s*)?\)|fill\(\s*(?:null|zero|linear|last)\s*(?:,\s*\d+\s*)?\)))*)\s*$/;
const FILTER_RE = /^(?:\*|!?\$[A-Za-z_][A-Za-z0-9_]*|!?[A-Za-z_][A-Za-z0-9_.\/-]*\s*:\s*[^,]+|(?:NOT\s+)?[A-Za-z_][A-Za-z0-9_.\/-]*\s+(?:NOT\s+)?IN\s*\([^()]*\))$/i;
const TAG_RE = /^[A-Za-z_][A-Za-z0-9_.\/-]*$/;
const ALLOWED_FN = new Set([
  "abs", "log2", "log10", "cumsum", "integral", "derivative", "diff", "timeshift", "default_zero", "count_not_null", "count_nonzero",
  "clamp_min", "clamp_max", "top", "moving_rollup", "ewma_3", "ewma_5", "ewma_10", "ewma_20", "median_3", "median_5", "median_7", "median_9",
  "autosmooth", "exclude_null", "cutoff_min", "cutoff_max", "anomalies", "outliers", "forecast", "robust_trend", "trend_line", "piecewise_constant",
  "monotonic_diff", "per_second", "per_minute", "per_hour", "dt", "rate",
]);

export interface ValidationIssue { id: string; message: string }

/** Datadog rejects `IN (...)` clauses mixed with comma separators: join such filter lists with AND instead. */
export function normalizeQueryFilters(q: string): string {
  return q.replace(/\{([^{}]*)\}/, (whole, inner: string) => {
    if (!/\bIN\s*\(/i.test(inner)) return whole;
    // Datadog spells negated membership `key NOT IN (...)`, not `NOT key IN (...)`
    let fixed = inner.replace(/\bNOT\s+([A-Za-z_][A-Za-z0-9_.\/-]*)\s+IN\s*\(/gi, "$1 NOT IN (");
    // Tag values only allow [A-Za-z0-9_:./-]; Datadog's intake turns anything else into '_' (e.g. <none> -> _none_)
    fixed = fixed.replace(/IN\s*\(([^()]*)\)/gi, (_, list: string) => `IN (${list.split(",").map((v) => v.trim().toLowerCase().replace(/[^a-z0-9_:.\/*-]/g, "_")).join(",")})`);
    if (!fixed.includes(",")) return `{${fixed}}`;
    const parts = (/\bAND\b/.test(fixed) ? fixed.split(/\s+AND\s+/) : splitTopLevel(fixed)).map((s) => s.trim()).filter(Boolean);
    return `{${parts.join(" AND ")}}`;
  });
}

export function validateQuery(q: string): string | null {
  const m = QUERY_RE.exec(q.trim());
  if (!m) return `query does not match Datadog metric query grammar: ${q}`;
  const [, , metric, filters, by] = m;
  if (metric.includes(":")) return `metric name contains ':' (${metric}); replace with '_'`;
  const parts = filters.trim() === "" ? ["*"] : /\bAND\b/.test(filters) ? filters.split(/\s+AND\s+/) : splitTopLevel(filters);
  for (const f of parts) if (!FILTER_RE.test(f.trim())) return `bad filter "${f}" in ${q}`;
  if (by !== undefined) for (const t of by.split(",")) if (!TAG_RE.test(t.trim())) return `bad group-by tag "${t}" in ${q}`;
  return null;
}

function splitTopLevel(s: string): string[] {
  const out: string[] = []; let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export function validateFormula(formula: string, names: string[]): string | null {
  const f = formula.trim();
  if (!f) return "empty formula";
  let depth = 0;
  for (const ch of f) { if (ch === "(") depth++; if (ch === ")") depth--; if (depth < 0) return "unbalanced parentheses"; }
  if (depth !== 0) return "unbalanced parentheses";
  if (/[<>=!&|^%]/.test(f.replace(/'[^']*'/g, ""))) return "formula contains comparison/boolean/%/^ operators which Datadog does not support";
  const idents = f.replace(/'[^']*'/g, "").match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  for (const id of idents) {
    if (names.includes(id)) continue;
    if (ALLOWED_FN.has(id)) continue;
    if (/^(desc|asc|mean|last|max|min|sum|area|l2norm|avg|count|basic|agile|robust|adaptive|linear|seasonal)$/.test(id)) continue;
    return `formula references unknown identifier "${id}"`;
  }
  return null;
}

export function validateResult(r: TranslationResult): string | null {
  if (!r || typeof r !== "object") return "result is not an object";
  if (!["native", "openmetrics", "partial", "unsupported"].includes(r.status)) return `bad status ${String(r.status)}`;
  if (r.status === "unsupported") return null;
  if (!Array.isArray(r.queries) || r.queries.length === 0) return "no queries for a supported translation";
  const names: string[] = [];
  for (const q of r.queries) {
    if (!q || typeof q.name !== "string" || !/^[a-z][a-z0-9_]*$/.test(q.name)) return `bad query name ${String(q?.name)}`;
    if (names.includes(q.name)) return `duplicate query name ${q.name}`;
    names.push(q.name);
    const err = validateQuery(String(q.query ?? ""));
    if (err) return err;
    if (q.aggregator && !["avg", "sum", "min", "max", "last"].includes(q.aggregator)) return `bad aggregator ${q.aggregator}`;
  }
  const ferr = validateFormula(String(r.formula ?? ""), names);
  if (ferr) return ferr;
  return null;
}

/** Metrics referenced by a validated query string (for the dummy-metric feeder and reports). */
export function metricOfQuery(q: string): { agg: string; metric: string; filters: string[]; by: string[]; modifiers: string } | null {
  const m = QUERY_RE.exec(q.trim());
  if (!m) return null;
  const fl = m[3].trim() ? (/\bAND\b/.test(m[3]) ? m[3].split(/\s+AND\s+/) : splitTopLevel(m[3])).map((s) => s.trim()) : [];
  return { agg: m[1], metric: m[2], filters: fl, by: m[4] ? m[4].split(",").map((s) => s.trim()).filter(Boolean) : [], modifiers: m[5] ?? "" };
}
