import type { TranslationResult } from "./types";

// Datadog metric query: agg:metric{filters} by {tags}.modifier(...)...
const QUERY_RE = /^(avg|sum|min|max|p(?:50|75|90|95|99|999))\s*:\s*([a-zA-Z][a-zA-Z0-9_.]{0,199})\s*\{([^{}]*)\}(?:\s+by\s+\{([^{}]*)\})?((?:\s*\.(?:as_rate\(\)|as_count\(\)|rollup\(\s*(?:avg|sum|min|max|count)\s*(?:,\s*\d+\s*)?\)|fill\(\s*(?:null|zero|linear|last)\s*(?:,\s*\d+\s*)?\)))*)\s*$/;
const FILTER_RE = /^(?:\*|!?\$[A-Za-z_][A-Za-z0-9_]*|(?:!|NOT\s+)?[A-Za-z_][A-Za-z0-9_.\/-]*\s*:\s*[^,]+|(?:NOT\s+)?[A-Za-z_][A-Za-z0-9_.\/-]*\s+(?:NOT\s+)?IN\s*\([^()]*\)|\([A-Za-z_][A-Za-z0-9_.\/-]*:[^\s()]+(?:\s+OR\s+[A-Za-z_][A-Za-z0-9_.\/-]*:[^\s()]+)*\))$/i;
const TAG_RE = /^[A-Za-z_][A-Za-z0-9_.\/-]*$/;
const ALLOWED_FN = new Set([
  "abs", "log2", "log10", "cumsum", "integral", "derivative", "diff", "timeshift", "default_zero", "count_not_null", "count_nonzero",
  "clamp_min", "clamp_max", "top", "moving_rollup", "ewma_3", "ewma_5", "ewma_10", "ewma_20", "median_3", "median_5", "median_7", "median_9",
  "autosmooth", "exclude_null", "cutoff_min", "cutoff_max", "anomalies", "outliers", "forecast", "robust_trend", "trend_line", "piecewise_constant",
  "monotonic_diff", "per_second", "per_minute", "per_hour", "dt", "rate",
]);

export interface ValidationIssue { id: string; message: string }

const TAG_VALUE_BAD = /[^a-z0-9_:.\/*-]/g;
/** Datadog tag values: lowercase, quotes stripped, anything outside [a-z0-9_:./*-] becomes `_` (matches the intake). */
function sanitizeTagValue(v: string): string {
  const t = v.trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  return t.includes("$") ? t : t.toLowerCase().replace(TAG_VALUE_BAD, "_");
}

/**
 * Makes the filter list of a metric query acceptable to Datadog:
 * `m.bucket{le:+Inf}` -> `m.count{}`; `key IN (a*,b)` -> `(key:a* OR key:b)`; `NOT key IN` -> `key NOT IN`; tag values
 * sanitized; and, whenever an `IN`/`OR`/`AND` clause is present, the list is joined with AND (`!key` becomes `NOT key`)
 * because Datadog rejects those operators mixed with commas.
 */
export function normalizeQueryFilters(q: string): string {
  // the +Inf bucket of a histogram is its total count
  q = q.replace(/\.bucket\{([^{}]*)\}/, (whole, inner: string) => {
    if (!/(^|,|\bAND\s+)\s*le:"?\+?inf"?\s*(,|$|\s+AND\b)/i.test(inner)) return whole;
    const rest = splitTopLevel(inner.replace(/\s+AND\s+/g, ",")).map((s) => s.trim()).filter((s) => s && !/^le:/i.test(s));
    return `.count{${rest.join(",") || "*"}}`;
  });
  q = q.replace(/ by \{([^{}]*)\}/, (_, tags: string) => ` by {${tags.split(",").map((t) => t.trim().replace(/^[^A-Za-z]+/, "")).filter(Boolean).join(",")}}`);
  return q.replace(/\{([^{}]*)\}/, (whole, inner: string) => {
    // Datadog spells negated membership `key NOT IN (...)`, not `NOT key IN (...)`
    let fixed = inner.replace(/\bNOT\s+([A-Za-z_][A-Za-z0-9_.\/-]*)\s+IN\s*\(/gi, "$1 NOT IN (");
    // IN lists: sanitized values; wildcards are not allowed inside IN, so spell those as an OR group
    fixed = fixed.replace(/([A-Za-z_][A-Za-z0-9_.\/-]*)\s+(NOT\s+)?IN\s*\(([^()]*)\)/gi, (_, key: string, not: string | undefined, list: string) => {
      const vals = list.split(",").map(sanitizeTagValue).filter(Boolean);
      if (!vals.some((v) => v.includes("*"))) return `${key} ${not ? "NOT " : ""}IN (${vals.join(",")})`;
      return not ? vals.map((v) => `NOT ${key}:${v}`).join(" AND ") : `(${vals.map((v) => `${key}:${v}`).join(" OR ")})`;
    });
    const andForm = /\bAND\b|\bOR\b|\bIN\s*\(/i.test(fixed);
    const parts = fixed.split(/\s+AND\s+/).flatMap((s) => splitTopLevel(s)).map((s) => s.trim()).filter(Boolean)
      // `instance="$app$node"` / `"$a/$b"` concatenations have no Datadog equivalent: drop the filter
      .filter((p) => (p.match(/\$[A-Za-z_]/g) ?? []).length < 2)
      // `$var.*`, `$var-*`, `$var.MDT*`: a standalone variable with trailing text is just the variable filter
      .map((p) => p.replace(/^(!?)\$([A-Za-z_][A-Za-z0-9_]*)(?![A-Za-z0-9_])[^,]+$/, "$1$$$2"))
      .map((p) => p.replace(/^(!|NOT\s+)?([A-Za-z_][A-Za-z0-9_.\/-]*):(.+)$/s, (_, neg: string | undefined, key: string, val: string) => {
        // tag keys start with a letter; only a trailing `*` wildcard is allowed in values
        const k = key.replace(/^[^A-Za-z]+/, ""), v = sanitizeTagValue(val).replace(/\*{2,}/g, "*");
        return !k || /\*./.test(v) ? "" : `${neg ?? ""}${k}:${v}`;
      })).filter(Boolean);
    if (!parts.length) return "{*}";
    if (!andForm) return `{${parts.join(",")}}`;
    // in the AND form an exclusion is spelled `NOT key:value`; `!key:value` is only valid in comma lists
    return `{${parts.map((p) => (p.startsWith("!") ? `NOT ${p.slice(1)}` : p)).join(" AND ")}}`;
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
