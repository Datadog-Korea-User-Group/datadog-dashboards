import type { GrafanaDashboard, GrafanaPanel, GrafanaRow, GridPos, Group, NormPanel, NormType, NormalizedDashboard, ThresholdStep, TopLevel } from "./types";

const TYPE_ALIAS: Record<string, NormType> = {
  timeseries: "timeseries", graph: "timeseries", "graph-old": "timeseries",
  stat: "stat", singlestat: "stat", "grafana-singlestat-panel": "stat",
  gauge: "gauge", bargauge: "bargauge",
  table: "table", "table-old": "table",
  piechart: "piechart", "grafana-piechart-panel": "piechart",
  heatmap: "heatmap", "heatmap-new": "heatmap",
  text: "text", logs: "logs", row: "row",
};

const LEGACY_CALC: Record<string, string> = { current: "lastNotNull", avg: "mean", total: "sum", max: "max", min: "min", first: "firstNotNull", last: "lastNotNull" };

function px(v: string | number | undefined, fallback = 250): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") { const n = parseInt(v, 10); if (!Number.isNaN(n)) return n; }
  return fallback;
}

/** Legacy schema (< v16): rows[] with span-based panels. Synthesize row panels + gridPos. */
function rowsToPanels(rows: GrafanaRow[]): GrafanaPanel[] {
  const out: GrafanaPanel[] = [];
  let cursor = 0;
  for (const row of rows) {
    const h = Math.max(1, Math.round(px(row.height) / 30));
    out.push({ type: "row", title: row.title ?? "", collapsed: !!row.collapse, gridPos: { x: 0, y: cursor, w: 24, h: 1 }, panels: [], repeat: row.repeat });
    const rowPanel = out[out.length - 1];
    let x = 0, y = cursor + 1, rowH = 0;
    const children: GrafanaPanel[] = [];
    for (const p of row.panels ?? []) {
      const w = Math.min(24, Math.max(1, Math.round((p.span ?? 12) * 2)));
      if (x + w > 24) { x = 0; y += Math.max(rowH, h); rowH = 0; }
      const ph = p.height !== undefined ? Math.max(1, Math.round(px(p.height) / 30)) : h;
      children.push({ ...p, gridPos: { x, y, w, h: ph } });
      x += w; rowH = Math.max(rowH, ph);
    }
    if (row.collapse) rowPanel.panels = children; else out.push(...children);
    cursor = y + Math.max(rowH, children.length ? 0 : 0) + (children.length ? 0 : 0);
    cursor = Math.max(cursor, y + (children.length ? Math.max(rowH, h) : 0));
  }
  return out;
}

function defaults(p: GrafanaPanel): Record<string, unknown> { return p.fieldConfig?.defaults ?? {}; }
function custom(p: GrafanaPanel): Record<string, unknown> { return (defaults(p).custom as Record<string, unknown>) ?? {}; }

function thresholds(p: GrafanaPanel): ThresholdStep[] | undefined {
  const t = defaults(p).thresholds as { steps?: { value: number | null; color: string }[] } | undefined;
  if (t?.steps?.length) return t.steps.map((s) => ({ value: s.value ?? null, color: String(s.color ?? "") }));
  // legacy singlestat: thresholds "85,95" + colors [green, orange, red]
  if (typeof p.thresholds === "string" && p.thresholds.trim()) {
    const vals = p.thresholds.split(",").map((s) => parseFloat(s.trim())).filter((n) => !Number.isNaN(n));
    const colors = Array.isArray(p.colors) ? (p.colors as string[]) : [];
    return [{ value: null, color: colors[0] ?? "green" }, ...vals.map((v, i) => ({ value: v, color: colors[i + 1] ?? (i === vals.length - 1 ? "red" : "orange") }))];
  }
  return undefined;
}

function unit(p: GrafanaPanel): string | undefined {
  const u = defaults(p).unit;
  if (typeof u === "string" && u) return u;
  if (typeof p.format === "string" && p.format) return p.format;
  const yaxes = p.yaxes as { format?: string }[] | undefined;
  if (yaxes?.[0]?.format) return yaxes[0].format;
  return undefined;
}

function calcs(p: GrafanaPanel): string[] | undefined {
  const ro = (p.options?.reduceOptions as { calcs?: string[] } | undefined)?.calcs;
  if (ro?.length) return ro;
  if (typeof p.valueName === "string") return [LEGACY_CALC[p.valueName] ?? p.valueName];
  return undefined;
}

function normalizePanel(p: GrafanaPanel, idx: number): NormPanel {
  const rawType = String(p.type ?? "unknown");
  const type = TYPE_ALIAS[rawType] ?? "unknown";
  const c = custom(p);
  const drawStyle = (c.drawStyle as NormPanel["drawStyle"]) ?? (p.bars ? "bars" : p.lines === false && p.points ? "points" : "line");
  const stackMode = (c.stacking as { mode?: string } | undefined)?.mode;
  const stacking = stackMode ? stackMode !== "none" : !!p.stack;
  const fill = typeof c.fillOpacity === "number" ? c.fillOpacity : typeof p.fill === "number" ? p.fill * 10 : 0;
  const content = typeof p.options?.content === "string" ? p.options.content : typeof p.content === "string" ? p.content : undefined;
  const grid = p.gridPos ?? { x: 0, y: idx * 8, w: 12, h: 8 };
  return {
    kind: "panel",
    id: typeof p.id === "number" ? p.id : 100000 + idx,
    type, rawType,
    title: String(p.title ?? ""),
    description: String(p.description ?? ""),
    grid: { x: Math.max(0, grid.x | 0), y: Math.max(0, grid.y | 0), w: Math.min(24, Math.max(1, grid.w | 0)), h: Math.max(1, grid.h | 0) },
    targets: (p.targets ?? [])
      .filter((t) => !t.hide && typeof t.expr === "string" && t.expr.trim())
      .map((t, i) => ({ refId: String(t.refId ?? String.fromCharCode(65 + i)), expr: String(t.expr).trim(), legendFormat: String(t.legendFormat ?? ""), instant: !!t.instant })),
    unit: unit(p),
    thresholds: thresholds(p),
    calcs: calcs(p),
    drawStyle, stacking, fill, content,
    graphMode: typeof p.options?.graphMode === "string" ? p.options.graphMode : undefined,
    raw: p,
  };
}

/** Groups top-level panels under their preceding row (expanded rows) or the row's own nested panels (collapsed rows). */
export function groupPanels(panels: GrafanaPanel[], warnings: string[]): TopLevel[] {
  const sorted = [...panels].sort((a, b) => (a.gridPos?.y ?? 0) - (b.gridPos?.y ?? 0) || (a.gridPos?.x ?? 0) - (b.gridPos?.x ?? 0));
  const out: TopLevel[] = [];
  let current: Group | null = null;
  let idx = 0;
  const seen = new Set<number>();
  const uniq = (np: NormPanel) => { while (seen.has(np.id)) np.id += 100000; seen.add(np.id); return np; };
  for (const p of sorted) {
    if (p.repeat) warnings.push(`repeat ignored on panel "${p.title ?? ""}"`);
    if (p.type === "row") {
      if (current && current.panels.length) out.push(current);
      const grid = p.gridPos ?? { x: 0, y: idx * 8, w: 24, h: 1 };
      current = { kind: "group", title: String(p.title ?? ""), grid, panels: [] };
      if (p.collapsed && p.panels?.length) {
        for (const child of [...p.panels].sort((a, b) => (a.gridPos?.y ?? 0) - (b.gridPos?.y ?? 0) || (a.gridPos?.x ?? 0) - (b.gridPos?.x ?? 0))) {
          if (child.type === "row") continue;
          current.panels.push(uniq(normalizePanel(child, idx++)));
        }
      }
      continue;
    }
    const np = uniq(normalizePanel(p, idx++));
    if (current) current.panels.push(np); else out.push(np);
  }
  if (current && current.panels.length) out.push(current);
  return out;
}

export function normalizeDashboard(input: unknown): NormalizedDashboard {
  let d = input as GrafanaDashboard;
  if (d && typeof d === "object" && "dashboard" in d && typeof (d as { dashboard?: unknown }).dashboard === "object") d = (d as { dashboard: GrafanaDashboard }).dashboard;
  if (!d || typeof d !== "object") throw new Error("not a dashboard object");
  const warnings: string[] = [];
  const legacyRows = !Array.isArray(d.panels) && Array.isArray(d.rows);
  const panels = legacyRows ? rowsToPanels(d.rows ?? []) : (d.panels ?? []);
  if (legacyRows) warnings.push("legacy rows schema converted");
  const items = groupPanels(panels, warnings);
  return {
    title: String(d.title ?? "Untitled"),
    description: String(d.description ?? ""),
    tags: Array.isArray(d.tags) ? d.tags.map(String).filter(Boolean) : [],
    schemaVersion: Number(d.schemaVersion ?? 0),
    legacyRows,
    items,
    variables: d.templating?.list ?? [],
    warnings,
  };
}

export function allPanels(items: TopLevel[]): NormPanel[] {
  return items.flatMap((i) => (i.kind === "group" ? i.panels : [i]));
}
