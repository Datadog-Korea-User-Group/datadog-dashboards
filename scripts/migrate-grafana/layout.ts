import type { DdLayout, GridPos } from "./types";

export const LAYOUT_SCALE = 0.25; // Grafana row unit (30px) -> Datadog unit; h=8 -> 2, h=3..5 -> 1, h=6..9 -> 2

/** Edge-consistent 24 -> 12 column mapping for x/width; height rounded (min 1). y is assigned by packGravity(). */
export function gridToLayout(g: GridPos, K = LAYOUT_SCALE): DdLayout {
  let x = Math.floor(g.x / 2);
  // Datadog widgets narrower than 2 columns are unreadable (titles truncate); widen and shift left if needed.
  let width = Math.max(2, Math.floor((g.x + g.w) / 2) - x);
  if (x + width > 12) x = Math.max(0, 12 - width);
  width = Math.min(12 - x, width);
  const height = Math.max(1, Math.round(g.h * K));
  return { x, y: 0, width, height };
}

const xOverlap = (a: DdLayout, b: DdLayout) => a.x < b.x + b.width && b.x < a.x + a.width;
const intersects = (a: DdLayout, b: DdLayout) => xOverlap(a, b) && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Places widgets like Grafana's gravity layout: each widget sits directly below the already-placed widgets that were
 * above it (in Grafana coordinates) and share columns with it. Preserves rows/columns without depending on y scaling.
 * Mutates layout.y in place; returns the total height.
 */
export function packGravity<T extends { grid: GridPos; layout: DdLayout }>(items: T[]): number {
  const sorted = [...items].sort((a, b) => a.grid.y - b.grid.y || a.grid.x - b.grid.x);
  // The minimum width can make widgets of one Grafana row overlap: flow them to the right and wrap past column 12
  // (wrapped widgets get a slightly larger effective Grafana y so gravity keeps them below the first line).
  const gy = new Map<T, number>();
  const wrapped = new Set<T>(); // act as full-width barriers so later rows do not float up beside them
  let band = NaN, cursor = 0, wrap = 0;
  for (const it of sorted) {
    if (it.grid.y !== band) { band = it.grid.y; cursor = 0; wrap = 0; }
    if (it.layout.x < cursor || wrap > 0) it.layout.x = cursor;
    if (it.layout.x + it.layout.width > 12) { it.layout.x = 0; wrap++; }
    if (wrap > 0) wrapped.add(it);
    cursor = it.layout.x + it.layout.width;
    gy.set(it, it.grid.y + wrap * 1e-3);
  }
  const placed: T[] = [];
  for (const it of sorted) {
    let y = 0;
    for (const p of placed) {
      if (gy.get(p)! < gy.get(it)! && (wrapped.has(p) || xOverlap(p.layout, it.layout))) y = Math.max(y, p.layout.y + p.layout.height);
    }
    it.layout.y = y;
    placed.push(it);
  }
  resolveOverlaps(items);
  return items.reduce((m, it) => Math.max(m, it.layout.y + it.layout.height), 0);
}

/** Pushes widgets down until nothing overlaps (safety net). Mutates layouts in place; returns total height. */
export function resolveOverlaps<T extends { layout: DdLayout }>(items: T[]): number {
  // ponytail: O(n^2) scan, fine for < 300 widgets per dashboard
  items.sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
  const placed: DdLayout[] = [];
  for (const it of items) {
    while (placed.some((p) => intersects(p, it.layout))) it.layout.y += 1;
    placed.push(it.layout);
  }
  return items.reduce((m, it) => Math.max(m, it.layout.y + it.layout.height), 0);
}
