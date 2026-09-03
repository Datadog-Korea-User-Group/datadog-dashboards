import type { DdDashboard, GrafanaVariable } from "./types";

export type DdVar = DdDashboard["template_variables"][number];
export interface VariableResult { vars: DdVar[]; dropped: { name: string; type: string; reason: string }[]; rename: Map<string, string> }

const sanitizeName = (n: string) => n.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "") || "var";

function labelValuesLabel(q: unknown): string | null {
  const s = typeof q === "string" ? q : typeof q === "object" && q && "query" in q ? String((q as { query: unknown }).query) : "";
  const m = /label_values\((?:.*,\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*$/.exec(s.trim());
  return m ? m[1] : null;
}

function strVal(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) return v.length ? String(v[0]) : undefined;
  return String(v);
}

export function convertVariables(list: GrafanaVariable[]): VariableResult {
  const vars: DdVar[] = [];
  const dropped: VariableResult["dropped"] = [];
  const rename = new Map<string, string>();
  const used = new Set<string>();
  for (const v of list) {
    if (!v?.name) continue;
    if (["datasource", "interval", "adhoc"].includes(v.type)) { dropped.push({ name: v.name, type: v.type, reason: "no Datadog equivalent" }); continue; }
    let name = sanitizeName(v.name);
    while (used.has(name)) name += "_";
    used.add(name);
    if (name !== v.name) rename.set(v.name, name);
    const cur = strVal(v.current?.value);
    const allish = (s?: string) => !s || s === "$__all" || s === "All" || s === ".*" || s === ".+";
    let dd: DdVar;
    switch (v.type) {
      case "query": {
        const label = labelValuesLabel(v.query);
        dd = { name, prefix: label ? sanitizeName(label) : name, default: "*", available_values: [] };
        break;
      }
      case "custom": {
        const opts = (v.options ?? []).map((o) => strVal(o.value)).filter((s): s is string => !!s && s !== "$__all");
        const def = v.includeAll || allish(cur) ? "*" : cur ?? opts[0] ?? "*";
        dd = { name, prefix: name, default: def, available_values: [...new Set(opts)] };
        break;
      }
      case "constant":
      case "textbox":
        dd = { name, prefix: name, default: cur && !allish(cur) ? cur : "*", available_values: [] };
        break;
      default:
        dd = { name, prefix: name, default: "*", available_values: [] };
    }
    vars.push(dd);
  }
  return { vars, dropped, rename };
}

/** Normalizes Grafana variable syntax and interval macros so the expression is stable PromQL with `$var` references. */
export function normalizeExpr(expr: string, rename: Map<string, string> = new Map()): string {
  let s = expr;
  s = s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::[^}]*)?\}/g, (_, v) => `$${v}`);
  s = s.replace(/\[\[([A-Za-z_][A-Za-z0-9_]*)(?::[^\]]*)?\]\]/g, (_, v) => `$${v}`);
  // range/subquery windows: [$__rate_interval], [$__interval], [$interval], [5m:$__interval] -> fixed
  s = s.replace(/\[[^\]]*\$[^\]]*\]/g, (m) => (m.includes(":") ? "[5m:1m]" : "[5m]"));
  s = s.replace(/\$__range_s\b|\$__range_ms\b|\$__range\b/g, "3600");
  s = s.replace(/\$__interval_ms\b|\$__interval\b|\$__rate_interval\b/g, "5m");
  for (const [from, to] of rename) s = s.replace(new RegExp(`\\$${from}\\b`, "g"), `$${to}`);
  return s.replace(/\s+/g, " ").trim();
}
