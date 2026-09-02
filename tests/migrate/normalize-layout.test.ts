import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allPanels, normalizeDashboard } from "../../scripts/migrate-grafana/normalize";
import { gridToLayout, packGravity } from "../../scripts/migrate-grafana/layout";
import { convertVariables, normalizeExpr } from "../../scripts/migrate-grafana/variables";

const FIX = "tests/fixtures/grafana";

describe("normalizeDashboard", () => {
  it("handles every fixture without throwing and maps types", () => {
    for (const f of readdirSync(FIX)) {
      const d = normalizeDashboard(JSON.parse(readFileSync(`${FIX}/${f}`, "utf8")));
      const panels = allPanels(d.items);
      expect(panels.length).toBeGreaterThan(0);
      for (const p of panels) expect(["timeseries", "stat", "gauge", "bargauge", "table", "piechart", "heatmap", "text", "logs", "unknown"]).toContain(p.type);
    }
  });
  it("converts legacy rows with span into gridPos", () => {
    const d = normalizeDashboard({ title: "legacy", rows: [{ title: "Row", height: "250px", panels: [{ type: "graph", span: 6, targets: [{ expr: "up" }] }, { type: "singlestat", span: 6, valueName: "current", format: "percent" }] }] });
    expect(d.legacyRows).toBe(true);
    const ps = allPanels(d.items);
    expect(ps.map((p) => [p.type, p.grid.w, p.grid.h])).toEqual([["timeseries", 12, 8], ["stat", 12, 8]]);
    expect(ps[1].calcs).toEqual(["lastNotNull"]);
    expect(ps[1].unit).toBe("percent");
  });
  it("groups panels under expanded and collapsed rows", () => {
    const d = normalizeDashboard({ panels: [
      { id: 1, type: "stat", gridPos: { x: 0, y: 0, w: 24, h: 3 } },
      { id: 2, type: "row", title: "A", gridPos: { x: 0, y: 3, w: 24, h: 1 } },
      { id: 3, type: "graph", gridPos: { x: 0, y: 4, w: 12, h: 8 }, targets: [{ expr: "up" }] },
      { id: 4, type: "row", title: "B", collapsed: true, gridPos: { x: 0, y: 12, w: 24, h: 1 }, panels: [{ id: 5, type: "graph", gridPos: { x: 0, y: 13, w: 24, h: 8 } }] },
    ] });
    expect(d.items.map((i) => i.kind)).toEqual(["panel", "group", "group"]);
    expect(d.items[1].kind === "group" && d.items[1].panels.map((p) => p.id)).toEqual([3]);
    expect(d.items[2].kind === "group" && d.items[2].panels.map((p) => p.id)).toEqual([5]);
  });
});

describe("layout", () => {
  it("maps 24 columns to 12 without overflow and keeps rows with gravity", () => {
    const grids = [
      { x: 0, y: 0, w: 6, h: 3 }, { x: 6, y: 0, w: 6, h: 3 }, { x: 12, y: 0, w: 6, h: 3 }, { x: 18, y: 0, w: 3, h: 3 }, { x: 21, y: 0, w: 3, h: 3 },
      { x: 0, y: 3, w: 12, h: 7 }, { x: 12, y: 3, w: 12, h: 7 }, { x: 0, y: 10, w: 8, h: 6 }, { x: 8, y: 10, w: 8, h: 6 }, { x: 16, y: 10, w: 8, h: 6 },
    ];
    const items = grids.map((grid) => ({ grid, layout: gridToLayout(grid) }));
    const height = packGravity(items);
    for (const it of items) expect(it.layout.x + it.layout.width).toBeLessThanOrEqual(12);
    expect(items.slice(0, 5).map((i) => i.layout.y)).toEqual([0, 0, 0, 0, 0]);
    expect(items.slice(5, 7).map((i) => i.layout.y)).toEqual([1, 1]);
    expect(items.slice(7).map((i) => i.layout.y)).toEqual([3, 3, 3]);
    expect(height).toBe(5);
    // array is in reading order (Datadog ordered layout places widgets sequentially)
    const ys = items.map((i) => i.layout.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });
  it("fits eight 3-wide gauges into one 12-column row", () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ grid: { x: i * 3, y: 0, w: 3, h: 4 }, layout: gridToLayout({ x: i * 3, y: 0, w: 3, h: 4 }) }));
    packGravity(items);
    expect(new Set(items.map((i) => i.layout.y)).size).toBe(1);
    // right edges follow floor((x+w)/2): 1.5 -> 1, 3, 4.5 -> 4, 6, ...
    expect(items.map((i) => i.layout.x + i.layout.width)).toEqual([1, 3, 4, 6, 7, 9, 10, 12]);
  });
});

describe("variables", () => {
  it("converts query/custom/constant variables and drops datasource/interval", () => {
    const r = convertVariables([
      { name: "ds", type: "datasource" }, { name: "interval", type: "interval" },
      { name: "node", type: "query", query: { query: "label_values(node_uname_info{job=~\"$job\"}, instance)" } },
      { name: "grouping", type: "custom", options: [{ value: "$__all" }, { value: "namespace" }, { value: "name" }], includeAll: true },
      { name: "my_const", type: "constant", current: { value: "42" } },
    ]);
    expect(r.dropped.map((d) => d.name)).toEqual(["ds", "interval"]);
    expect(r.vars).toEqual([
      { name: "node", prefix: "instance", default: "*", available_values: [] },
      { name: "grouping", prefix: "grouping", default: "*", available_values: ["namespace", "name"] },
      { name: "my_const", prefix: "my_const", default: "42", available_values: [] },
    ]);
    expect(normalizeExpr("rate(x{a=\"${my_const}\"}[$__rate_interval]) + [[node]] - avg_over_time(y[${__interval}:$__rate_interval])", r.rename))
      .toBe("rate(x{a=\"$my_const\"}[5m]) + $node - avg_over_time(y[5m:1m])");
  });
});
