import { createHash } from "node:crypto";
import type { NormPanel, NormalizedDashboard, TranslationRequest } from "./types";
import { allPanels } from "./normalize";
import { normalizeExpr, type VariableResult } from "./variables";

/** Stable cache key for a translation: same expression + legend + panel type => same Datadog translation. */
export function requestKey(r: TranslationRequest): string {
  const legend = r.panel.legendFormat ?? "";
  const vars = r.variables.map((v) => `${v.name}=${v.prefix}`).sort().join(",");
  return createHash("sha1").update(`${r.expr}\n${legend}\n${r.panel.type}\n${vars}`).digest("hex").slice(0, 20);
}

const QUERY_TYPES = new Set(["timeseries", "stat", "gauge", "bargauge", "table", "piechart", "heatmap"]);

export function panelNeedsTranslation(p: NormPanel): boolean {
  return QUERY_TYPES.has(p.type) && p.targets.length > 0;
}

/** Builds one TranslationRequest per (panel, target). Variables are limited to those referenced by the expression. */
export function extractRequests(d: NormalizedDashboard, vars: VariableResult): TranslationRequest[] {
  const out: TranslationRequest[] = [];
  const varList = vars.vars.map((v) => ({ name: v.name, prefix: v.prefix }));
  for (const p of allPanels(d.items)) {
    if (!panelNeedsTranslation(p)) continue;
    for (const t of p.targets) {
      const expr = normalizeExpr(t.expr, vars.rename);
      const used = varList.filter((v) => new RegExp(`\\$${v.name}\\b`).test(expr));
      out.push({
        id: `${p.id}.${t.refId}`,
        expr,
        panel: { title: p.title, type: p.type, unit: p.unit, legendFormat: t.legendFormat || undefined },
        variables: used,
      });
    }
  }
  return out;
}
