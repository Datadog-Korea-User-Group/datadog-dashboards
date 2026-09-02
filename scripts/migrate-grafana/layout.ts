import type { DdLayout, GridPos } from "./types";

export const LAYOUT_SCALE = 0.25; // Grafana row unit (30px) -> Datadog unit; h=8 -> 2, h=3..5 -> 1, h=6..9 -> 2

/** Edge-consistent 24 -> 12 column mapping for x/width; height rounded (min 1). y is assigned by packGravity(). */
export function gridToLayout(g: GridPos, K = LAYOUT_SCALE): DdLayout {
  const x = Math.floor(g.x / 2);
  const width = Math.max(1, Math.min(12 - x, Math.floor((g.x + g.w) / 2) - x));
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
  const placed: T[] = [];
  for (const it of sorted) {
    let y = 0;
    for (const p of placed) {
      if (p.grid.y < it.grid.y && xOverlap(p.layout, it.layout)) y = Math.max(y, p.layout.y + p.layout.height);
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
